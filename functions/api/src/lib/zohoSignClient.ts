/**
 * Cliente HTTP para Zoho Sign — firma electrónica de contratos / ofertas.
 *
 * Use case principal: cuando un candidato finalista acepta una oferta laboral, el cliente
 * cierra el deal mandando la oferta firmable. Zoho Sign maneja firma electrónica
 * con valor legal en LATAM (con tratado eIDAS para EU + ESIGN Act para USA).
 *
 * Endpoint Zoho Sign: https://sign.zoho.com/api/v1/
 *
 * No-op si `ZOHO_SIGN_API_URL` o `ZOHO_SIGN_OAUTH_TOKEN` no están seteados.
 *
 * Pasa por circuit breaker `zoho_sign` (threshold 5, cooldown 60s).
 */

import { fetchWithTimeout } from './fetchWithTimeout';
import { withBreaker } from './circuitBreaker';
import { logger } from './logger';
import { env } from './env';

const log = logger('ZOHO_SIGN');

const BREAKER_OPTS = { name: 'zoho_sign', threshold: 5, cooldownMs: 60_000 };
const TIMEOUT_MS = 20_000; // PDFs pueden tardar más

export type SignResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

export type CreateRequestInput = {
  template_id?: string;          // si tenés templates predefinidos
  document_url?: string;         // o URL de PDF a firmar
  document_buffer?: Buffer;      // o buffer in-memory
  document_filename?: string;
  signers: Array<{
    name: string;
    email: string;
    role?: string;               // 'employer', 'employee', 'witness'
  }>;
  subject: string;
  message?: string;
};

export type SignRequest = {
  request_id: string;
  status: 'sent' | 'in_progress' | 'completed' | 'declined' | 'expired';
  signing_urls?: Array<{ signer_email: string; url: string }>;
  created_time: string;
};

function isConfigured(): boolean {
  // Zoho Sign usa el mismo refresh token system que Recruit/CRM (vía zohoOAuth).
  // El refresh token de Cris (ZOHO_OAUTH_REFRESH_TOKEN) tiene que incluir scopes
  // de Sign: ZohoSign.documents.ALL, ZohoSign.templates.ALL, ZohoSign.requests.ALL.
  // Si no los tiene, hay que regenerarlo con esos scopes agregados.
  return !!process.env.ZOHO_OAUTH_CLIENT_ID
    && !!process.env.ZOHO_OAUTH_CLIENT_SECRET
    && !!process.env.ZOHO_OAUTH_REFRESH_TOKEN;
}

async function callSign<T>(
  path: string,
  options: { method: 'GET' | 'POST'; body?: unknown },
  traceId: string,
): Promise<SignResult<T>> {
  if (!isConfigured()) {
    return { ok: false, error: 'Zoho Sign not configured (necesita ZOHO_OAUTH_CLIENT_ID + ZOHO_OAUTH_CLIENT_SECRET + ZOHO_OAUTH_REFRESH_TOKEN)' };
  }
  const apiUrl = env().ZOHO_SIGN_API_URL || 'https://sign.zoho.com/api/v1';
  const url = `${apiUrl.replace(/\/$/, '')}${path}`;

  // Obtener access token vía refresh (mismo helper que usa Recruit/CRM).
  const { getZohoAuthHeader } = await import('./zohoOAuth.js');
  const auth = await getZohoAuthHeader(traceId);
  if (!auth) {
    return { ok: false, error: 'Could not get Zoho OAuth access token from refresh token' };
  }

  try {
    const result = await withBreaker(BREAKER_OPTS, async () => {
      const response = await fetchWithTimeout(url, {
        method: options.method,
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        timeoutMs: TIMEOUT_MS,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const err: Error & { status?: number } = new Error(`Sign ${response.status}: ${text.slice(0, 200)}`);
        err.status = response.status;
        throw err;
      }
      return (await response.json()) as T;
    });
    log.info('zoho sign call ok', { traceId, path });
    return { ok: true, data: result };
  } catch (err) {
    const e = err as Error & { status?: number };
    log.warn('zoho sign call failed', { traceId, path, error: e.message, status: e.status });
    return { ok: false, error: e.message, status: e.status };
  }
}

export async function createSignRequest(
  input: Omit<CreateRequestInput, 'document_buffer'>,
  traceId: string,
): Promise<SignResult<SignRequest>> {
  return callSign<SignRequest>('/requests', {
    method: 'POST',
    body: {
      template_id: input.template_id,
      document_url: input.document_url,
      subject: input.subject,
      message: input.message,
      signers: input.signers,
    },
  }, traceId);
}

export async function getSignRequest(requestId: string, traceId: string): Promise<SignResult<SignRequest>> {
  return callSign<SignRequest>(`/requests/${encodeURIComponent(requestId)}`, { method: 'GET' }, traceId);
}

export async function cancelSignRequest(requestId: string, traceId: string): Promise<SignResult<{ ok: boolean }>> {
  return callSign<{ ok: boolean }>(`/requests/${encodeURIComponent(requestId)}/cancel`, { method: 'POST' }, traceId);
}

/**
 * Manda el contrato standard SharkTalents usando el template pre-cargado en Sign.
 *
 * Pre-requisito: el template existe en Zoho Sign Console con los merge fields documentados
 * en `docs/contracts/zoho_sign_setup_guide.md`. Su ID va en env var
 * `ZOHO_SIGN_CONTRACT_TEMPLATE_ID`.
 *
 * Si el template_id no está configurado, devuelve 503-equivalente con mensaje claro.
 */
export type SendContractInput = {
  client_email: string;
  client_name: string;
  client_company: string;
  client_ruc_nit_ein?: string;
  client_address?: string;
  client_phone?: string;
  puesto_nombre: string;
  puesto_salario_usd: number;
  plazo_min_dias?: number;
  plazo_max_dias?: number;
  // Si querés override el template_id (ej: distinto contrato por tier de cliente)
  template_id_override?: string;
};

export async function sendContract(
  input: SendContractInput,
  traceId: string,
): Promise<SignResult<{ request_id: string; signing_url?: string }>> {
  const templateId = input.template_id_override ?? env().ZOHO_SIGN_CONTRACT_TEMPLATE_ID;
  if (!templateId) {
    return { ok: false, error: 'ZOHO_SIGN_CONTRACT_TEMPLATE_ID no configurado. Cargá el contrato como Template en Zoho Sign y setá la env var.' };
  }

  const feeTotal = Math.round(input.puesto_salario_usd * 1.2 * 100) / 100;
  const feeTracto = Math.round((feeTotal / 2) * 100) / 100;

  return callSign<{ request_id: string; signing_url?: string }>(
    '/requests',
    {
      method: 'POST',
      body: {
        template_id: templateId,
        signers: [
          { name: input.client_name, email: input.client_email, role: 'cliente' },
        ],
        subject: `Contrato de servicios SharkTalents — ${input.client_company}`,
        message: `Hola ${input.client_name}, este es el contrato para iniciar el proceso de búsqueda del puesto "${input.puesto_nombre}". Revisalo y firmalo desde el link de abajo. Si tenés dudas, respondé a este email.`,
        // Merge fields para el template (los nombres deben matchear los Field Names en Sign Template Editor)
        field_data: {
          cliente_nombre_representante: input.client_name,
          cliente_empresa: input.client_company,
          cliente_ruc_nit_ein: input.client_ruc_nit_ein ?? '',
          cliente_direccion: input.client_address ?? '',
          cliente_email: input.client_email,
          cliente_telefono: input.client_phone ?? '',
          puesto_nombre: input.puesto_nombre,
          puesto_salario_usd: String(input.puesto_salario_usd),
          fee_total_usd: String(feeTotal),
          fee_tracto_1_usd: String(feeTracto),
          fee_tracto_2_usd: String(feeTracto),
          plazo_min_dias: String(input.plazo_min_dias ?? 14),
          plazo_max_dias: String(input.plazo_max_dias ?? 30),
        },
      },
    },
    traceId,
  );
}

export const _internal = { isConfigured };
