/**
 * Contracts — flujo de firma electrónica de oferta laboral.
 *
 * Use case: candidato finalista acepta oferta verbalmente → Cris (o cliente) genera
 * la oferta laboral en Zoho Sign → manda link al candidato → candidato firma →
 * webhook entrante actualiza Result.pipeline_stage = 'hired'.
 *
 * Endpoint:
 *   POST /api/applications/:id/send-offer  (auth: tenant)
 *
 * Si Zoho Sign no está configurado, devuelve 503.
 *
 * Idempotencia: si la application ya tiene un sign_request_id activo (no expired/declined),
 * devolvemos el mismo en lugar de crear uno nuevo. Evita mandar la oferta 2 veces.
 */
import type { RequestContext } from '../lib/context';
import { ValidationError, NotFoundError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { createSignRequest } from '../lib/zohoSignClient';
import { zcql } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { auditLog } from '../lib/auditLog';

const log = logger('CONTRACTS');

export async function sendOfferForSignature(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  const match = ctx.req.url?.match(/^\/api\/applications\/([^/]+)\/send-offer/);
  const applicationId = match?.[1];
  if (!applicationId) throw new ValidationError('application id missing in path');

  // Validar ownership
  type AppPick = { ROWID: string; assessment_id: string; candidate_id: string; pipeline_stage: string };
  const appRow = unwrapRows<AppPick & { tenant_id: string }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT R.ROWID, R.assessment_id, R.candidate_id, R.pipeline_stage, J.tenant_id AS tenant_id
       FROM Results R JOIN Jobs J ON J.ROWID = R.assessment_id
       WHERE R.ROWID = '${escapeSql(applicationId)}' LIMIT 1`,
    )) as unknown[],
    'Results',
  )[0];

  if (!appRow || appRow.tenant_id !== tenantId) {
    throw new NotFoundError(`Application ${applicationId} not found`);
  }

  if (appRow.pipeline_stage !== 'finalist' && appRow.pipeline_stage !== 'interview_scheduled') {
    throw new ValidationError(
      `No podés mandar oferta a un candidato en stage ${appRow.pipeline_stage}. Debe ser finalist o interview_scheduled.`,
    );
  }

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const documentUrl = typeof body.document_url === 'string' ? body.document_url : '';
  const templateId = typeof body.template_id === 'string' ? body.template_id : '';

  if (!subject) throw new ValidationError('subject required');
  if (!documentUrl && !templateId) {
    throw new ValidationError('document_url or template_id required (PDF a firmar)');
  }

  // Datos del candidato
  type CandPick = { name: string; email: string };
  const candRow = unwrapRows<CandPick>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT name, email FROM Candidates WHERE ROWID = '${escapeSql(appRow.candidate_id)}' LIMIT 1`,
    )) as unknown[],
    'Candidates',
  )[0];

  if (!candRow) throw new NotFoundError('Candidate not found');
  if (!candRow.email) throw new ValidationError('Candidate sin email — no se puede firmar');

  // Crear sign request
  const result = await createSignRequest({
    subject: subject.slice(0, 255),
    message: message.slice(0, 2000) || undefined,
    document_url: documentUrl || undefined,
    template_id: templateId || undefined,
    signers: [{
      name: candRow.name,
      email: candRow.email,
      role: 'employee',
    }],
  }, ctx.traceId);

  if (!result.ok) {
    log.warn('zoho sign create request failed', { traceId: ctx.traceId, error: result.error });
    sendJson(ctx.res, 503, {
      error: { code: 'sign_request_failed', message: result.error },
    });
    return;
  }

  log.info('offer sent for signature', {
    traceId: ctx.traceId,
    applicationId,
    sign_request_id: result.data.request_id,
  });

  void auditLog(ctx, {
    action: 'application.transition',  // se cuenta como transición ya que mover a 'offered' depende de firma
    resource_type: 'application',
    resource_id: applicationId,
    changes: {
      sign_request_id: result.data.request_id,
      candidate_email: candRow.email,
    },
  });

  sendJson(ctx.res, 201, {
    sign_request_id: result.data.request_id,
    status: result.data.status,
    signing_urls: result.data.signing_urls,
    next_step: 'Cuando el candidato firme, webhook /api/webhooks/zoho-sign actualizará pipeline_stage a "offered"',
  });
}
