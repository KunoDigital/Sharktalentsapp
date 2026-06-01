/**
 * Tracker de eventos del portal cliente.
 *
 * Llama POST /portal/<token>/track desde el frontend para registrar:
 *   - portal.opened       (cuando carga la landing del portal)
 *   - portal.job_viewed   (cuando abre un puesto)
 *   - portal.report_viewed (cuando abre el reporte)
 *   - portal.draft_approved
 *   - portal.draft_rejected
 *   - portal.feedback
 *
 * Es fire-and-forget — si falla el track, no rompe la UI del cliente. Lo manda con
 * `keepalive: true` para que sobreviva navegación.
 *
 * Backend: features/jobTracking.ts. Si la tabla JobTrackingSnapshots no existe,
 * el endpoint devuelve 200 silencioso.
 */
import { config } from '../config';

export type PortalEventType =
  | 'portal.opened'
  | 'portal.job_viewed'
  | 'portal.report_viewed'
  | 'portal.draft_approved'
  | 'portal.draft_rejected'
  | 'portal.feedback';

export type PortalEventPayload = {
  event_type: PortalEventType;
  job_id?: string;
  event_data?: Record<string, unknown>;
};

const sentEvents = new Set<string>(); // dedupe en sesión actual (evita doble track al re-render)

/**
 * Trackea un evento del portal. Fire-and-forget.
 *
 * @param token  el portal token de la URL
 * @param payload  evento a registrar
 * @param dedupeKey  si se provee, no manda el mismo dedupeKey 2 veces en la sesión
 */
export function trackPortalEvent(token: string, payload: PortalEventPayload, dedupeKey?: string): void {
  if (!config.useApi || !token) return;
  if (dedupeKey && sentEvents.has(dedupeKey)) return;
  if (dedupeKey) sentEvents.add(dedupeKey);

  const url = `${config.apiBase}/portal/${encodeURIComponent(token)}/track`;
  const body = JSON.stringify(payload);

  // sendBeacon prioritario (sobrevive navigation)
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon(url, blob)) return;
  }

  // Fallback fetch keepalive
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // silent — track no debe impactar UX
  });
}

export function _resetForTests() {
  sentEvents.clear();
}
