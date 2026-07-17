/**
 * Notifier centralizado: manda email + WhatsApp al candidato en cada transición de stage.
 *
 * Se llama desde:
 *   - applications.ts:transitionApplication (Cris transiciona manual desde admin)
 *   - publicTest.ts:submitTest (candidato termina una prueba)
 *   - publicTest.ts:submitTestPrescreening (candidato termina prescreening)
 *
 * Mapeo de stage destino → (template, next URL):
 *   prefilter_passed   → invitación técnica
 *   tecnica_completed  → invitación DISC
 *   conductual_completed → invitación integridad
 *   integridad_completed → invitación video
 *   finalist           → invitación entrevista (requiere detalles manuales de Cris)
 *   auto_rejected_*    → rechazo amable
 *   rejected_by_admin  → rechazo amable
 *
 * Idempotencia: el outbox de email tiene retry. Si la transición se dispara dos veces
 * por race condition, el candidato recibe 2 emails idénticos — aceptable trade-off.
 *
 * Para evitar duplicados estrictos, podríamos chequear OutboxEvents con misma candidate+stage,
 * pero agrega complejidad por marginal valor.
 */

import type { IncomingMessage } from 'http';
import { zcql } from './db';
import { escapeSql, unwrapRows } from './dbHelpers';
import { signToken, expiresIn, WEEK_SEC } from './urlSigning';
import { env } from './env';
import { logger } from './logger';

const log = logger('CANDIDATE_NOTIFIER');

/**
 * Mapeo de stage destino → template + phase del link.
 * `null` = no se manda nada para esa transición.
 */
const STAGE_NOTIFICATION_MAP: Record<string, { template: string; phase?: string } | null> = {
  // 2026-06-18: refactor a templates "paso N de 5". Cada correo dice UNA cosa concreta.
  // El candidato pasó el prescreening → correo "siguiente paso: prueba técnica"
  prefilter_passed: { template: 'candidate_tecnica_start', phase: 'tecnica' },
  // Terminó técnica → correo "siguiente paso: evaluación conductual"
  tecnica_completed: { template: 'candidate_conductual_start', phase: 'disc' },
  // Terminó conductual → correo "siguiente paso: integridad"
  conductual_completed: { template: 'candidate_integridad_start', phase: 'integridad' },
  // Terminó integridad → SIN email todavía. El link de video no existe hasta
  // que la IA genere las preguntas (dispara la transición → videos_pending), y
  // recién ahí el candidato puede acceder al test. Antes acá se mandaba el email
  // pero llegaba prematuro — el candidato clickeaba y no había preguntas.
  integridad_completed: null,
  // Ya se generaron las preguntas del video → correo "último paso: video respuestas"
  // con el link real al test.
  videos_pending: { template: 'candidate_video_start', phase: 'videos' },
  // videos_completed y bot_decision_advance: el bot decide internamente; sin email todavía
  videos_completed: null,
  bot_decision_advance: null,
  // Duda CV: sin email al candidato (Cris revisa manual, si decide avanzar dispara desde admin)
  duda_cv: null,
  // Finalist: SharkTalents NO manda nada — Cris manda invitación a entrevista manual
  // (porque necesita detalles como fecha/hora/link Meet)
  finalist: null,
  awaiting_client_review: null,
  // interview_scheduled: lo manda Cris manual con detalles
  interview_scheduled: null,
  // Rechazos
  auto_rejected_low_score: { template: 'candidate_rejected' },
  rejected_by_admin: { template: 'candidate_rejected' },
  // No notificar en estos
  salary_out_of_range: null,
  withdrew: null,
  hired: null,
  offered: null,
  offer_declined: null,
};

/**
 * Devuelve el template + phase para una transición, o null si no aplica.
 */
export function getNotificationForStage(toStage: string): { template: string; phase?: string } | null {
  return STAGE_NOTIFICATION_MAP[toStage] ?? null;
}

type CandidateInfo = {
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string | null;
  jobId: string;
  jobTitle: string;
  tenantId: string;
  applicationId: string;
};

/**
 * Resuelve datos necesarios para notificar — el caller solo pasa applicationId.
 */
async function loadCandidateInfo(req: IncomingMessage, applicationId: string): Promise<CandidateInfo | null> {
  try {
    const rows = unwrapRows<{
      ROWID: string;
      candidate_id: string;
      assessment_id: string;
      candidate_name?: string;
      candidate_email?: string;
      candidate_phone?: string | null;
      job_title?: string;
      job_tenant?: string;
    }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT R.ROWID, R.candidate_id, R.assessment_id,
                C.name AS candidate_name, C.email AS candidate_email, C.phone AS candidate_phone,
                J.title AS job_title, J.tenant_id AS job_tenant
         FROM Results R
         JOIN Candidates C ON C.ROWID = R.candidate_id
         JOIN Jobs J ON J.ROWID = R.assessment_id
         WHERE R.ROWID = '${escapeSql(applicationId)}' LIMIT 1`,
      )) as unknown[],
      'Results',
    );
    const r = rows[0];
    if (!r) return null;
    return {
      candidateId: r.candidate_id,
      candidateName: (r.candidate_name ?? '').trim() || 'candidato',
      candidateEmail: (r.candidate_email ?? '').trim(),
      candidatePhone: r.candidate_phone ?? null,
      jobId: r.assessment_id,
      jobTitle: (r.job_title ?? '').trim() || 'el puesto',
      tenantId: (r.job_tenant ?? '').trim(),
      applicationId: r.ROWID,
    };
  } catch (err) {
    log.warn('loadCandidateInfo failed', { applicationId, error: (err as Error).message });
    return null;
  }
}

/**
 * Construye un test URL firmado para que el candidato continúe en la siguiente fase.
 * Token kind='test' apunta al applicationId, expira en 2 semanas.
 */
function buildContinuationUrl(applicationId: string, phase: string): string {
  const token = signToken({
    kind: 'test',
    ref: applicationId,
    exp: expiresIn(2 * WEEK_SEC),
  });
  const base = env().APP_BASE_URL.replace(/\/$/, '');
  return `${base}/app/#/test/${token}/${phase}`;
}

/**
 * Notifica al candidato del siguiente paso. Fire-and-forget.
 */
export async function notifyCandidateOnTransition(
  req: IncomingMessage,
  args: { applicationId: string; toStage: string; reason?: string },
): Promise<void> {
  const notif = getNotificationForStage(args.toStage);
  if (!notif) return;

  const info = await loadCandidateInfo(req, args.applicationId);
  if (!info) {
    log.warn('candidate info not found, skip notification', { applicationId: args.applicationId });
    return;
  }
  if (!info.candidateEmail) {
    log.warn('candidate has no email, skip notification', { applicationId: args.applicationId });
    return;
  }

  const testUrl = notif.phase ? buildContinuationUrl(info.applicationId, notif.phase) : '';
  const reasonNote = args.reason ? `Razón: ${args.reason.slice(0, 200)}` : 'No es un comentario sobre vos — buscamos un perfil muy específico para este puesto.';

  try {
    const { publishOutboxEvent } = await import('../features/outbox.js');
    await publishOutboxEvent(req, 'email.send_pending', {
      to: info.candidateEmail,
      template: notif.template,
      locale: 'es',
      job_id: info.jobId,
      tenant_id: info.tenantId,
      vars: {
        candidate_name: info.candidateName,
        job_title: info.jobTitle,
        test_url: testUrl,
        reason_note: reasonNote,
        recruiter_name: 'Kuno Digital',
      },
    });

    // WhatsApp: solo si el candidato tiene teléfono Y el template existe.
    // Hoy mandamos send_text simple. Cuando tengamos templates aprobados, send_template.
    if (info.candidatePhone) {
      const waBody = buildWhatsAppBody(notif.template, info, testUrl, reasonNote);
      if (waBody) {
        await publishOutboxEvent(req, 'whatsapp.send_text', {
          to: info.candidatePhone,
          body: waBody,
          job_id: info.jobId,
          tenant_id: info.tenantId,
        });
      }
    }

    log.info('candidate notified', {
      applicationId: args.applicationId,
      toStage: args.toStage,
      template: notif.template,
      has_phone: !!info.candidatePhone,
    });
  } catch (err) {
    log.warn('candidate notify enqueue failed', { applicationId: args.applicationId, error: (err as Error).message });
  }
}

/**
 * Cuerpo del WhatsApp por template. Mantenemos cortos para no saturar.
 * Devuelve null si no hay versión WhatsApp para ese template.
 */
function buildWhatsAppBody(template: string, info: CandidateInfo, testUrl: string, reasonNote: string): string | null {
  switch (template) {
    case 'candidate_tecnica_invitation':
      return `Hola ${info.candidateName}, pasaste el prescreening. Ahora viene la prueba técnica de ${info.jobTitle} (15-25 min): ${testUrl}`;
    case 'candidate_disc_invitation':
      return `Hola ${info.candidateName}, próxima etapa: evaluación conductual DISC (10-15 min). Sin respuestas buenas ni malas: ${testUrl}`;
    case 'candidate_integridad_invitation':
      return `Hola ${info.candidateName}, próxima etapa: prueba de integridad (10-15 min): ${testUrl}`;
    case 'candidate_video_invitation':
      return `Hola ${info.candidateName}, última etapa: video respuestas cortas (10-15 min): ${testUrl}`;
    case 'candidate_rejected':
      return `Hola ${info.candidateName}, gracias por evaluar para ${info.jobTitle}. En esta búsqueda decidimos avanzar con otros candidatos. ${reasonNote} Te dejamos en nuestra base.`;
    default:
      return null;
  }
}
