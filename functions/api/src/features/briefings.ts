/**
 * Briefings — flow de onboarding cliente: agendar reunión + recibir transcripción.
 *
 * Flow operativo:
 *   1. Cliente nuevo aprueba contrato
 *   2. Cris (o automático) llama POST /api/briefings/schedule con datos del cliente + slot preferido
 *   3. Backend crea booking en Zoho Bookings → cliente recibe invite con link Zia
 *   4. Reunión sucede, Zia transcribe automáticamente
 *   5. Webhook entrante (POST /api/webhooks/zia) sube el transcript
 *   6. Cuando llega transcript, automáticamente llama drafts.generateDraft con ese transcript
 *   7. Cris revisa draft + confirma → se crea Job real
 *
 * Endpoint:
 *   POST /api/briefings/schedule  (auth: tenant)
 *
 * Si Zoho Bookings no está configurado, devuelve error explícito.
 *
 * Tabla `Briefings` (deferred — opcional, para tracking; podríamos no tener tabla y solo
 * usar el booking_id de Zoho como referencia):
 *   ROWID, tenant_id, client_email, client_name, client_company, booking_id, transcript_url?,
 *   transcript_text?, draft_id?, status [scheduled|completed|transcribed|drafted|failed],
 *   scheduled_at, completed_at?, created_at
 */
import type { RequestContext } from '../lib/context';
import { ValidationError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { createBooking, type CreateBookingInput } from '../lib/zohoBookingsClient';
import { env } from '../lib/env';
import { auditLog } from '../lib/auditLog';
import { zcql } from '../lib/db';
import { unwrapRows, escapeSql } from '../lib/dbHelpers';

const log = logger('BRIEFINGS');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function scheduleBriefing(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  const clientEmail = typeof body.client_email === 'string' ? body.client_email.trim().toLowerCase() : '';
  const clientName = typeof body.client_name === 'string' ? body.client_name.trim() : '';
  const clientCompany = typeof body.client_company === 'string' ? body.client_company.trim() : '';
  const startTime = typeof body.start_time === 'string' ? body.start_time : '';
  const durationMinutes = Number(body.duration_minutes ?? 30);

  if (!clientEmail || !EMAIL_RE.test(clientEmail)) throw new ValidationError('client_email inválido');
  if (!clientName) throw new ValidationError('client_name required');
  if (!startTime || Number.isNaN(new Date(startTime).getTime())) {
    throw new ValidationError('start_time debe ser ISO 8601');
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes < 15 || durationMinutes > 180) {
    throw new ValidationError('duration_minutes debe estar entre 15 y 180');
  }

  const e = env();
  if (!e.ZOHO_BOOKINGS_WORKSPACE_ID || !e.ZOHO_BOOKINGS_BRIEFING_SERVICE_ID) {
    sendJson(ctx.res, 503, {
      error: {
        code: 'bookings_not_configured',
        message: 'Setear ZOHO_BOOKINGS_WORKSPACE_ID y ZOHO_BOOKINGS_BRIEFING_SERVICE_ID en env vars',
      },
    });
    return;
  }

  const input: CreateBookingInput = {
    workspace_id: e.ZOHO_BOOKINGS_WORKSPACE_ID,
    service_id: e.ZOHO_BOOKINGS_BRIEFING_SERVICE_ID,
    customer_email: clientEmail,
    customer_name: clientName.slice(0, 200),
    customer_phone: typeof body.client_phone === 'string' ? body.client_phone.slice(0, 50) : undefined,
    start_time: startTime,
    duration_minutes: Math.round(durationMinutes),
    notes: clientCompany ? `Empresa: ${clientCompany}` : undefined,
  };

  const result = await createBooking(input, ctx.traceId);

  if (!result.ok) {
    log.warn('schedule briefing failed', { traceId: ctx.traceId, error: result.error, status: result.status });
    sendJson(ctx.res, 503, {
      error: {
        code: 'bookings_call_failed',
        message: result.error,
      },
    });
    return;
  }

  log.info('briefing scheduled', {
    traceId: ctx.traceId,
    tenantId,
    bookingId: result.data.booking_id,
    client_email_masked: clientEmail.slice(0, 2) + '***',
  });

  void auditLog(ctx, {
    action: 'tenant.update',
    resource_type: 'briefing',
    resource_id: result.data.booking_id,
    changes: {
      client_email: clientEmail,
      client_name: clientName,
      start_time: startTime,
      duration_minutes: durationMinutes,
    },
  });

  sendJson(ctx.res, 201, {
    booking_id: result.data.booking_id,
    status: result.data.status,
    start_time: result.data.start_time,
    meeting_url: result.data.meeting_url,
    next_step: 'Cuando termine la reunión, Zia mandará el transcript via webhook a /api/webhooks/zia',
  });
}

// ===== GET /api/briefings — listar briefings del tenant =====

/**
 * Lista los briefings (reuniones de onboarding) del tenant.
 *
 * Si la tabla Briefings no existe → devuelve array vacío + flag indicando.
 * No falla — para que el frontend pueda mostrar "no hay briefings" o "tabla no lista".
 */
export async function listBriefings(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const status = url.searchParams.get('status');
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 50)));

  const filters = [`tenant_id = '${escapeSql(tenantId)}'`];
  if (status) filters.push(`status = '${escapeSql(status)}'`);
  const query = `SELECT * FROM Briefings WHERE ${filters.join(' AND ')} ORDER BY CREATEDTIME DESC LIMIT ${limit}`;

  type BriefingRow = {
    ROWID: string;
    tenant_id: string;
    client_email: string;
    client_name?: string | null;
    client_company?: string | null;
    booking_id?: string | null;
    meeting_url?: string | null;
    transcript_url?: string | null;
    draft_id?: string | null;
    status: string;
    scheduled_at?: string | null;
    completed_at?: string | null;
    created_at: string;
  };

  try {
    const rows = unwrapRows<BriefingRow>(
      (await zcql(ctx.req).executeZCQLQuery(query)) as unknown[],
      'Briefings',
    );
    sendJson(ctx.res, 200, { briefings: rows, count: rows.length, table_ready: true });
  } catch {
    // Briefings tabla no existe todavía. Devolvemos array vacío + flag claro.
    log.info('Briefings table not yet ready — returning empty list');
    sendJson(ctx.res, 200, { briefings: [], count: 0, table_ready: false });
  }
}
