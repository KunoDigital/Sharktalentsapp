/**
 * Publisher de eventos `sync.recruit` al outbox.
 *
 * Llamado desde `transitionApplication` cuando un candidato cambia de stage en el
 * pipeline. Genera un evento outbox que el dispatcher (en outbox.ts) consume y
 * propaga a Zoho Recruit via API.
 *
 * Idempotencia: el outbox dispatcher tiene retry + dedup. Acá solo nos aseguramos
 * de NO publicar 2 veces para el mismo (application_id, transition_id) en una sola
 * call (eso es responsabilidad del state machine, que llama transitionApplication
 * exactamente una vez por transición exitosa).
 *
 * Ver doc: [docs/master-plan/23_INTEGRACIONES_ZOHO.md](../../../docs/master-plan/23_INTEGRACIONES_ZOHO.md)
 */

import type { IncomingMessage } from 'http';
import { logger } from './logger';
import { publishOutboxEvent } from '../features/outbox';

const log = logger('RECRUIT_SYNC_PUBLISHER');

export type RecruitSyncEvent = {
  /** ID del Application/Result en SharkTalents. */
  application_id: string;
  /** ID del Job en SharkTalents. */
  job_id: string;
  /** Tenant ID. */
  tenant_id: string;
  /** Stage anterior (puede ser null si es creación). */
  from_stage: string | null;
  /** Stage nuevo. */
  to_stage: string;
  /** Quién hizo el cambio (clerk_user_id o 'bot' o 'system'). */
  actor: string;
  /** Razón humana (opcional). */
  reason?: string;
  /** Timestamp del transition. */
  transitioned_at: string;
  /** ID del Candidate en SharkTalents (no es lo mismo que recruit_candidate_id). */
  candidate_id?: string;
  /** Email del candidato. Necesario para action='create' (Recruit lo usa como dedup). */
  candidate_email?: string;
  /** Nombre completo del candidato. Necesario para action='create'. */
  candidate_name?: string;
  /** Job title (lo manda Recruit en el email automático). */
  job_title?: string;
  /** Company name (lo manda Recruit en el email). */
  company?: string;
  /** ID del candidato YA EXISTENTE en Recruit. Necesario para action='transition'. */
  recruit_candidate_id?: string | null;
};

/**
 * Publica un evento sync.recruit al outbox. Best-effort: si falla la publicación,
 * loggea warning pero NO throw (no queremos que un fallo de sync rompa el pipeline).
 *
 * @returns true si se publicó, false si falló
 */
export async function publishRecruitSync(
  req: IncomingMessage,
  event: RecruitSyncEvent,
): Promise<boolean> {
  // Si Zoho Recruit no está configurado, no publicar (evita acumular eventos failed
  // en outbox que nunca se van a procesar).
  //
  // FIX 2026-06-03: el chequeo previo usaba env vars `ZOHO_RECRUIT_API_URL` +
  // `ZOHO_RECRUIT_OAUTH_TOKEN` (legacy). Pero el resto del sistema (zohoOAuth helper
  // que usa zohoRecruitClient) usa `ZOHO_OAUTH_REFRESH_TOKEN` + `ZOHO_OAUTH_CLIENT_ID`.
  // Como las vars legacy NO están seteadas, esta función skipeaba SILENCIOSAMENTE
  // y la transición de candidato NUNCA llegaba a Recruit. Detectado cuando Andrea
  // completó técnica y no cambió de etapa en Recruit. Síntoma: no había evento
  // `sync.recruit` en outbox después del submit.
  const recruitConfigured =
    !!process.env.ZOHO_OAUTH_REFRESH_TOKEN && !!process.env.ZOHO_OAUTH_CLIENT_ID;

  if (!recruitConfigured) {
    log.debug('skipping recruit sync — Zoho OAuth no configurado', {
      application_id: event.application_id,
    });
    return false;
  }

  try {
    await publishOutboxEvent(req, 'sync.recruit', {
      action: event.from_stage ? 'transition' : 'create',
      application_id: event.application_id,
      job_id: event.job_id,
      tenant_id: event.tenant_id,
      from_stage: event.from_stage,
      to_stage: event.to_stage,
      actor: event.actor,
      reason: event.reason,
      transitioned_at: event.transitioned_at,
      candidate_id: event.candidate_id,
      candidate_email: event.candidate_email,
      candidate_name: event.candidate_name,
      job_title: event.job_title,
      company: event.company,
      recruit_candidate_id: event.recruit_candidate_id ?? undefined,
    });
    log.info('recruit sync published', {
      application_id: event.application_id,
      from: event.from_stage,
      to: event.to_stage,
    });
    return true;
  } catch (err) {
    log.warn('publish recruit sync failed', {
      application_id: event.application_id,
      error: (err as Error).message,
    });
    return false;
  }
}
