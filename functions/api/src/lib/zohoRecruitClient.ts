/**
 * Cliente Zoho Recruit — sync de candidatos del pipeline SharkTalents → Zoho Recruit.
 *
 * Esqueleto con métodos mínimos. Cristian extiende con casos reales según necesidad.
 * Usa `zohoOAuth.ts` para gestión de tokens.
 *
 * Docs API: https://www.zoho.com/recruit/developer-guide/apiv2/
 *
 * Env vars necesarias (compartidas con otras integraciones Zoho):
 *   ZOHO_OAUTH_CLIENT_ID
 *   ZOHO_OAUTH_CLIENT_SECRET
 *   ZOHO_OAUTH_REFRESH_TOKEN
 *   ZOHO_RECRUIT_API_URL  (default: https://recruit.zoho.com/recruit/v2)
 */

import { fetchWithTimeout } from './fetchWithTimeout';
import { withBreaker } from './circuitBreaker';
import { getZohoAuthHeader } from './zohoOAuth';
import { logger } from './logger';

const log = logger('ZOHO_RECRUIT');

const DEFAULT_API_URL = 'https://recruit.zoho.com/recruit/v2';

function getApiUrl(): string {
  return process.env.ZOHO_RECRUIT_API_URL ?? DEFAULT_API_URL;
}

export type ZohoRecruitResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

/**
 * Wrapper común para llamadas a Zoho Recruit. Agrega auth + circuit breaker.
 */
async function zohoCall<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; traceId?: string } = {},
): Promise<ZohoRecruitResult<T>> {
  const auth = await getZohoAuthHeader(options.traceId);
  if (!auth) {
    return { ok: false, error: 'Zoho OAuth not configured' };
  }

  const url = `${getApiUrl()}${path}`;
  const method = options.method ?? 'GET';

  try {
    const result = await withBreaker(
      { name: 'zoho_recruit', threshold: 5, cooldownMs: 60_000 },
      async () => {
        const response = await fetchWithTimeout(url, {
          method,
          headers: {
            Authorization: auth,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          timeoutMs: 15_000,
        });

        const text = await response.text();
        let data: unknown = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          // No es JSON
        }

        if (!response.ok) {
          throw new Error(`Zoho Recruit HTTP ${response.status}: ${text.slice(0, 200)}`);
        }

        return data as T;
      },
    );

    return { ok: true, data: result };
  } catch (err) {
    log.warn('zoho recruit call failed', {
      traceId: options.traceId,
      path,
      method,
      error: (err as Error).message,
    });
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Crea un Candidate en Zoho Recruit.
 * https://www.zoho.com/recruit/developer-guide/apiv2/insert-records.html
 */
export async function createRecruitCandidate(
  candidate: {
    First_Name: string;
    Last_Name: string;
    Email: string;
    Phone?: string;
    Source?: string;
    /** Custom fields del módulo */
    customFields?: Record<string, unknown>;
  },
  traceId = '',
): Promise<ZohoRecruitResult<{ data: Array<{ details: { id: string } }> }>> {
  return zohoCall('/Candidates', {
    method: 'POST',
    body: {
      data: [
        {
          ...candidate,
          ...(candidate.customFields ?? {}),
        },
      ],
    },
    traceId,
  });
}

/**
 * Actualiza el Candidate Status (stage) de un candidato en Zoho Recruit.
 * Mapea nuestros stages de SharkTalents → stages de Recruit (configurable).
 *
 * @deprecated Prefiere `updateApplicationStatus` — los workflow rules de Recruit
 * se disparan en el módulo JobApplications, no en Candidates. Esta función queda
 * como fallback para casos donde la Application aún no existe.
 */
export async function updateCandidateStatus(
  candidateId: string,
  status: string,
  traceId = '',
): Promise<ZohoRecruitResult<unknown>> {
  return zohoCall(`/Candidates/${encodeURIComponent(candidateId)}`, {
    method: 'PUT',
    body: {
      data: [{ Candidate_Status: status }],
    },
    traceId,
  });
}

/**
 * Busca la Job Application en Recruit que conecta un candidato + un job opening.
 * Devuelve el ROWID de la JobApplication si existe.
 *
 * Necesario porque los workflow rules de Recruit se disparan al cambiar el
 * "Application Status" del JobApplications module, no del Candidate global.
 */
export async function findJobApplication(
  candidateId: string,
  jobOpeningId: string,
  traceId = '',
): Promise<ZohoRecruitResult<{ id: string } | null>> {
  const criteria = `((Candidate_Id:equals:${candidateId})and(Job_Opening_Id:equals:${jobOpeningId}))`;
  const path = `/JobApplications/search?criteria=${encodeURIComponent(criteria)}`;
  const result = await zohoCall<{ data?: Array<{ id: string }> }>(path, { traceId });
  if (!result.ok) {
    // Search devuelve 204 No Content si no encuentra match → algunos clients lo
    // mapean a error. Considerar "no encontrado" como caso válido.
    if (result.error.includes('204') || result.error.includes('No Content')) {
      return { ok: true, data: null };
    }
    return { ok: false, error: result.error };
  }
  const application = result.data.data?.[0];
  return { ok: true, data: application ? { id: application.id } : null };
}

/**
 * Actualiza el Application Status en una Job Application específica.
 * Este es el field que dispara los workflow rules de Recruit (email + WhatsApp).
 *
 * Si la JobApplication no existe (porque el candidato se creó manualmente sin
 * job linkeado), devuelve error y el caller debe decidir si crear la application
 * o solo updatear el Candidate_Status global.
 */
export async function updateApplicationStatus(
  jobApplicationId: string,
  applicationStatus: string,
  traceId = '',
): Promise<ZohoRecruitResult<unknown>> {
  return zohoCall(`/JobApplications/${encodeURIComponent(jobApplicationId)}`, {
    method: 'PUT',
    body: {
      data: [{ Application_Status: applicationStatus }],
    },
    traceId,
  });
}

/**
 * Trae datos básicos del Candidate de Recruit (nombre, email, phone, etc).
 * Usado por `/api/recruit/test-link` para crear Application en SharkTalents
 * sin requerir que el candidato vuelva a ingresar sus datos.
 */
export async function getRecruitCandidate(
  candidateId: string,
  traceId = '',
): Promise<ZohoRecruitResult<{ data: Array<Record<string, unknown>> }>> {
  return zohoCall(`/Candidates/${encodeURIComponent(candidateId)}`, { traceId });
}

/**
 * Lista jobs (Job_Openings) de Zoho Recruit. Útil para sincronizar de Recruit → SharkTalents.
 */
export async function listRecruitJobs(traceId = ''): Promise<ZohoRecruitResult<{ data: unknown[] }>> {
  return zohoCall('/Job_Openings', { traceId });
}

/**
 * Actualiza un Job Opening existente en Zoho Recruit. Útil para llenar los campos custom
 * con los links de las pruebas DESPUÉS de crearlo (porque el recruit_id no existe hasta el create).
 */
export async function updateRecruitJobOpening(
  jobOpeningId: string,
  fields: Record<string, unknown>,
  traceId = '',
): Promise<ZohoRecruitResult<unknown>> {
  return zohoCall(`/Job_Openings/${encodeURIComponent(jobOpeningId)}`, {
    method: 'PUT',
    body: { data: [fields] },
    traceId,
  });
}

/**
 * Crea un Job Opening en Zoho Recruit. Se llama cuando un draft de SharkTalents es aprobado
 * y convertido a Job real — sincroniza el puesto a Recruit para que el equipo lo vea allá también.
 *
 * https://www.zoho.com/recruit/developer-guide/apiv2/insert-records.html
 */
export async function createRecruitJobOpening(
  job: {
    /** Mandatory en Recruit. Si no se manda, Recruit devuelve "Job_Opening_Name required". */
    Job_Opening_Name: string;
    Posting_Title?: string;
    Client_Name?: string;
    Job_Description?: string;
    Salary?: string;
    Job_Opening_Status?: string;
    Industry?: string;
    /** Campos custom del módulo */
    customFields?: Record<string, unknown>;
  },
  traceId = '',
): Promise<ZohoRecruitResult<{ data: Array<{ details: { id: string } }> }>> {
  return zohoCall('/Job_Openings', {
    method: 'POST',
    body: {
      data: [
        {
          Job_Opening_Name: job.Job_Opening_Name,
          Posting_Title: job.Posting_Title ?? job.Job_Opening_Name,
          Job_Opening_Status: job.Job_Opening_Status ?? 'In-progress',
          ...(job.Client_Name ? { Client_Name: job.Client_Name } : {}),
          ...(job.Job_Description ? { Job_Description: job.Job_Description } : {}),
          ...(job.Salary ? { Salary: job.Salary } : {}),
          ...(job.Industry ? { Industry: job.Industry } : {}),
          ...(job.customFields ?? {}),
        },
      ],
    },
    traceId,
  });
}

/**
 * Devuelve los fields del módulo Job_Openings con sus API names + display labels.
 * Útil para introspección + diagnóstico cuando los API names no matchean.
 * https://www.zoho.com/recruit/developer-guide/apiv2/module-meta.html
 */
export async function listJobOpeningFields(traceId = ''): Promise<ZohoRecruitResult<{ fields: Array<{ api_name: string; field_label: string; data_type: string; custom_field: boolean }> }>> {
  const result = await zohoCall<{ fields: Array<{ api_name: string; field_label: string; data_type: string; custom_field: boolean }> }>(
    '/settings/fields?module=Job_Openings',
    { traceId },
  );
  return result;
}

/**
 * Helper para detectar si Zoho Recruit está completamente configurado.
 */
export function isZohoRecruitConfigured(): boolean {
  return !!(
    process.env.ZOHO_OAUTH_CLIENT_ID &&
    process.env.ZOHO_OAUTH_CLIENT_SECRET &&
    process.env.ZOHO_OAUTH_REFRESH_TOKEN
  );
}
