/**
 * Cliente HTTP tipado contra el backend Catalyst.
 * Uso:
 *   const api = useApi();
 *   const { jobs } = await api.jobs.list();
 *
 * Auth: usa el JWT de Clerk (obtenido via getToken() en cada request).
 */

import { useAuth } from '@clerk/clerk-react';
import { useMemo } from 'react';
import { config } from '../config';

// ---- Types (mirror del backend) ----

export type CognitiveLevel = 'basic' | 'mid' | 'senior';

export type ApiJob = {
  ROWID: string;
  tenant_id: string;
  title: string;
  company: string;
  tech_prompt: string | null;
  cognitive_level: CognitiveLevel;
  is_active: boolean;
  company_context: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ApiIdealProfile = {
  disc?: { d: number; i: number; s: number; c: number; pk_code?: string; pk_name?: string };
  disc_b?: { d: number; i: number; s: number; c: number; pk_code?: string; pk_name?: string };
  velna?: { verbal: number; espacial: number; logica: number; numerica: number; abstracta: number };
  competencias?: Array<{ name: string; required_pct: number }>;
  tecnica_minimo_pct?: number;
  context_summary?: string;
};

export type ApiJobInput = {
  title: string;
  company: string;
  cognitive_level?: CognitiveLevel;
  tech_prompt?: string | null;
  company_context?: string | null;
  is_active?: boolean;
  ideal_profile?: ApiIdealProfile | Record<string, unknown> | null;
};

export type ApiCandidate = {
  ROWID: string;
  name: string;
  email: string;
  phone: string | null;
  age: number | null;
  salary_expectation: number | null;
  availability: string | null;
  interview_file_id: string | null;
  created_at: string;
};

export type ApiCandidateInput = {
  name: string;
  email: string;
  phone?: string | null;
  age?: number | null;
  salary_expectation?: number | null;
  availability?: string | null;
};

export type PipelineStage =
  | 'prefilter_pending' | 'prefilter_passed' | 'salary_out_of_range'
  | 'tecnica_completed' | 'conductual_completed' | 'integridad_completed'
  | 'videos_completed' | 'bot_decision_advance'
  | 'finalist' | 'offered' | 'hired'
  | 'auto_rejected_low_score' | 'rejected_by_admin';

export type ApiApplication = {
  ROWID: string;
  assessment_id: string;
  candidate_id: string;
  answers: string | null;
  pipeline_stage: PipelineStage;
  started_at: string;
  completed_at: string | null;
  report_downloaded_at: string | null;
  idempotency_key: string | null;
};

export type ApiTransition = {
  ROWID: string;
  result_id: string;
  from_stage: string | null;
  to_stage: string;
  actor: string;
  reason: string | null;
  transitioned_at: string;
};

// ---- Score types (tabla Scores consolidada) ----

export type IntegrityClass = 'bajo' | 'medio' | 'alto';

export type ApiScores = {
  ROWID: string;
  result_id: string;
  // DISC
  disc_raw_d?: number;
  disc_raw_i?: number;
  disc_raw_s?: number;
  disc_raw_c?: number;
  disc_norm_d?: number;
  disc_norm_i?: number;
  disc_norm_s?: number;
  disc_norm_c?: number;
  disc_perfil_dominante?: 'D' | 'I' | 'S' | 'C';
  disc_pk_id?: string | null;
  disc_completed_at?: string;
  // VELNA
  velna_verbal?: number;
  velna_espacial?: number;
  velna_logica?: number;
  velna_numerica?: number;
  velna_abstracta?: number;
  velna_total?: number;
  velna_max?: number;
  velna_indice?: number;
  velna_completed_at?: string;
  // Emotional
  emo_score?: number;
  emo_perfil?: 'espontaneo' | 'mesura' | 'reflexivo';
  emo_completed_at?: string;
  // Technical
  tec_score_pct?: number;
  tec_total_correct?: number;
  tec_total_questions?: number;
  tec_passed?: boolean;
  tec_completed_at?: string;
  // Integrity header
  int_overall?: IntegrityClass;
  int_overall_pct?: number;
  int_recomendacion?: string | null;
  int_buena_impresion?: IntegrityClass;
  int_buena_impresion_pct?: number;
  int_completed_at?: string;
};

export type ApiIntegrityDimension = {
  ROWID: string;
  result_id: string;
  dimension: string;
  nivel: IntegrityClass;
  pct: number;
};

export type ScoresPayload = {
  disc?: { raw_d: number; raw_i: number; raw_s: number; raw_c: number; total_questions?: number; pk_id?: string };
  cognitive?: { verbal: number; espacial: number; logica: number; numerica: number; abstracta: number; total?: number; max?: number };
  emotional?: { score: number };
  technical?: { total_correct: number; total_questions: number; min_required?: number };
};

export type IntegrityPayload = {
  dimensions: { dimension: string; pct: number }[];
  recomendacion?: string;
};

// ---- Error class ----

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  traceId?: string;

  constructor(status: number, code: string, message: string, details?: unknown, traceId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.traceId = traceId;
  }
}

// ---- Low-level fetch wrapper ----

type GetToken = () => Promise<string | null>;

async function request<T>(
  getToken: GetToken,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await getToken();
  const url = path.startsWith('http') ? path : `${config.apiBase.replace(/\/$/, '')}${path}`;

  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // Usamos X-Clerk-Token en lugar de Authorization: Bearer porque el gateway de
  // Catalyst intercepta los Bearer tokens e intenta validarlos contra su propio
  // sistema OAuth, rechazando los JWT de Clerk con INVALID_TOKEN antes de llegar
  // al backend.
  if (token) headers['X-Clerk-Token'] = token;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    throw new ApiError(0, 'network_error', `Network error: ${(err as Error).message}`);
  }
  clearTimeout(timeoutId);

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await response.json().catch(() => null) : await response.text();

  if (!response.ok) {
    const errBody = (data && typeof data === 'object' ? data : {}) as {
      error?: { code?: string; message?: string; details?: unknown };
      trace_id?: string;
    };
    throw new ApiError(
      response.status,
      errBody.error?.code ?? 'http_error',
      errBody.error?.message ?? `HTTP ${response.status}`,
      errBody.error?.details,
      errBody.trace_id,
    );
  }

  return data as T;
}

// ---- Typed API surface ----

function buildClient(getToken: GetToken) {
  return {
    jobs: {
      list: (opts: { includeInactive?: boolean } = {}) => {
        const qs = opts.includeInactive ? '?include_inactive=true' : '';
        return request<{ jobs: ApiJob[] }>(getToken, 'GET', `/api/jobs${qs}`);
      },
      get: (id: string) => request<{ job: ApiJob }>(getToken, 'GET', `/api/jobs/${encodeURIComponent(id)}`),
      create: (input: ApiJobInput) => request<{ job: ApiJob }>(getToken, 'POST', '/api/jobs', input),
      update: (id: string, patch: Partial<ApiJobInput>) =>
        request<{ job: ApiJob }>(getToken, 'PATCH', `/api/jobs/${encodeURIComponent(id)}`, patch),
      archive: (id: string) =>
        request<{ job: ApiJob }>(getToken, 'DELETE', `/api/jobs/${encodeURIComponent(id)}`),
      notifyClientReportReady: (
        id: string,
        body: { client_email: string; client_name: string; finalist_count?: number; report_url?: string },
      ) =>
        request<{ ok: boolean; enqueued: boolean }>(
          getToken,
          'POST',
          `/api/jobs/${encodeURIComponent(id)}/notify-client-report-ready`,
          body,
        ),
    },
    outbox: {
      processNow: () =>
        request<{
          processed: number;
          results: Array<{ event_id: string; event_type: string; outcome: 'sent' | 'failed' | 'retried'; error?: string }>;
        }>(getToken, 'POST', '/api/outbox/process-now'),
      recent: () =>
        request<{
          items: Array<{
            id: string;
            event_type: string;
            status: 'pending' | 'processing' | 'sent' | 'failed';
            retry_count: number;
            last_error: string | null;
            created_at: string;
            processed_at: string | null;
          }>;
          count: number;
        }>(getToken, 'GET', '/api/outbox/recent'),
    },
    marketing: {
      createManualLead: (body: {
        email: string;
        contact_name?: string;
        company?: string;
        whatsapp?: string;
        urgency?: 'less_30d' | '1-3m' | '3m+' | 'exploring';
        salary_target?: number;
        notes?: string;
        source?: string;
      }) =>
        request<{ lead_id: string; action: 'created' | 'updated' }>(
          getToken, 'POST', '/api/marketing/lead-manual', body,
        ),
      sendDemoFromAdmin: (
        leadId: string,
        body: {
          member_to_evaluate: { full_name: string; email: string; role: string; consent_obtained: true };
        },
      ) =>
        request<{ request_id: string; message: string; test_expires_at: string }>(
          getToken, 'POST', `/api/marketing/lead/${encodeURIComponent(leadId)}/send-demo`, body,
        ),
      convertToTenant: (leadId: string) =>
        request<{ tenant_id: string; slug: string; next_steps: string[] }>(
          getToken, 'POST', `/api/marketing/lead/${encodeURIComponent(leadId)}/convert-to-tenant`,
        ),
      sendContract: (
        leadId: string,
        body: {
          puesto_nombre: string;
          puesto_salario_usd: number;
          client_ruc_nit_ein?: string;
          client_address?: string;
          client_phone?: string;
          plazo_min_dias?: number;
          plazo_max_dias?: number;
        },
      ) =>
        request<{ request_id: string; signing_url?: string; message: string }>(
          getToken, 'POST', `/api/marketing/lead/${encodeURIComponent(leadId)}/send-contract`, body,
        ),
      // Lista leads en Zoho CRM con tag=SharkTalents, anotados si ya están importados.
      listCrmLeadsForImport: (tag = 'SharkTalents') =>
        request<{
          ok: boolean;
          error?: string;
          tag: string;
          count: number;
          items: Array<{
            crm_id: string;
            email: string;
            contact_name: string | null;
            company: string | null;
            phone: string | null;
            lead_source: string | null;
            already_imported: boolean;
          }>;
        }>(getToken, 'GET', `/api/marketing/crm-leads?tag=${encodeURIComponent(tag)}`),

      // Importa un lead desde Zoho CRM a MarketingLeads de SharkTalents (por email).
      importLeadFromCrm: (email: string) =>
        request<{
          lead_id: string;
          message: string;
          crm_lead_id: string | null;
          populated: { email: string; contact_name: string | null; company: string | null; whatsapp: string | null; salary_target: number | null };
        }>(getToken, 'POST', '/api/marketing/import-from-crm', { email }),

      // Devuelve puesto + salario inferidos del draft asociado al lead + RUC/dirección desde Zoho CRM, para pre-llenar el modal de contrato.
      getContractContext: (leadId: string) =>
        request<{
          puesto_nombre: string | null;
          puesto_salario_usd: number | null;
          client_phone: string | null;
          client_ruc_nit_ein: string | null;
          client_address: string | null;
          source: 'draft' | 'lead' | 'crm' | 'draft+crm' | 'none';
          draft_id: string | null;
          crm_lead_id: string | null;
        }>(getToken, 'GET', `/api/marketing/lead/${encodeURIComponent(leadId)}/contract-context`),
      listLeads: (opts: { status?: string; urgency?: string; minScore?: number; limit?: number } = {}) => {
        const q = new URLSearchParams();
        if (opts.status) q.set('status', opts.status);
        if (opts.urgency) q.set('urgency', opts.urgency);
        if (opts.minScore) q.set('min_score', String(opts.minScore));
        if (opts.limit) q.set('limit', String(opts.limit));
        const qs = q.toString();
        return request<{
          leads: ApiMarketingLead[];
          count: number;
          stats: { total: number; new: number; eval_requested: number; eval_completed: number; call_booked: number; won: number; lost: number };
          table_ready: boolean;
        }>(getToken, 'GET', `/api/marketing/leads${qs ? '?' + qs : ''}`);
      },
    },
    candidates: {
      list: (opts: { limit?: number } = {}) => {
        const qs = opts.limit ? `?limit=${opts.limit}` : '';
        return request<{ candidates: ApiCandidate[] }>(getToken, 'GET', `/api/candidates${qs}`);
      },
      get: (id: string) => request<{ candidate: ApiCandidate }>(getToken, 'GET', `/api/candidates/${encodeURIComponent(id)}`),
      create: (input: ApiCandidateInput) =>
        request<{ candidate: ApiCandidate; existed: boolean }>(getToken, 'POST', '/api/candidates', input),
      update: (id: string, patch: Partial<ApiCandidateInput>) =>
        request<{ candidate: ApiCandidate }>(getToken, 'PATCH', `/api/candidates/${encodeURIComponent(id)}`, patch),
    },
    applications: {
      list: (opts: { jobId?: string; limit?: number } = {}) => {
        const params = new URLSearchParams();
        if (opts.jobId) params.set('job_id', opts.jobId);
        if (opts.limit) params.set('limit', String(opts.limit));
        const qs = params.toString();
        return request<{ applications: ApiApplication[] }>(getToken, 'GET', `/api/applications${qs ? `?${qs}` : ''}`);
      },
      get: (id: string) =>
        request<{ application: ApiApplication; transitions: ApiTransition[] }>(
          getToken, 'GET', `/api/applications/${encodeURIComponent(id)}`,
        ),
      create: (input: { assessment_id: string; candidate_id: string; idempotency_key?: string }) =>
        request<{ application: ApiApplication }>(getToken, 'POST', '/api/applications', input),
      transition: (id: string, toStage: PipelineStage, reason?: string) =>
        request<{ application: ApiApplication; transition: ApiTransition }>(
          getToken, 'POST', `/api/applications/${encodeURIComponent(id)}/transition`, { to_stage: toStage, reason },
        ),
      transitions: (id: string) =>
        request<{ transitions: ApiTransition[] }>(
          getToken, 'GET', `/api/applications/${encodeURIComponent(id)}/transitions`,
        ),
      writeScores: (id: string, scores: ScoresPayload) =>
        request<{ result_id: string; scores: ApiScores; blocks_written: string[] }>(
          getToken, 'POST', `/api/applications/${encodeURIComponent(id)}/scores`, scores,
        ),
      readScores: (id: string) =>
        request<{
          result_id: string;
          scores: ApiScores | null;
          integrity_dimensions: ApiIntegrityDimension[];
        }>(getToken, 'GET', `/api/applications/${encodeURIComponent(id)}/scores`),
      writeIntegrity: (id: string, payload: IntegrityPayload) =>
        request<{ integrity: { header: ApiScores; dimensions: ApiIntegrityDimension[] } }>(
          getToken, 'POST', `/api/applications/${encodeURIComponent(id)}/integrity`, payload,
        ),
      sendOffer: (id: string, input: { subject: string; message?: string; document_url?: string; template_id?: string }) =>
        request<{
          sign_request_id: string;
          status: string;
          signing_urls?: Array<{ signer_email: string; url: string }>;
          next_step: string;
        }>(getToken, 'POST', `/api/applications/${encodeURIComponent(id)}/send-offer`, input),
      listPrefilterAnswers: (id: string) =>
        request<{
          answers: Array<{
            ROWID: string;
            question_id: string;
            answer_value: string;
            is_match: boolean;
            created_at: string;
            question_text: string;
            type: string;
            expected_answer: string | null;
            is_disqualifier: boolean;
          }>;
          count: number;
          table_ready: boolean;
        }>(getToken, 'GET', `/api/applications/${encodeURIComponent(id)}/prefilter-answers`),
      readIntegrity: (id: string) =>
        request<{ integrity: { header: ApiScores; dimensions: ApiIntegrityDimension[] } }>(
          getToken, 'GET', `/api/applications/${encodeURIComponent(id)}/integrity`,
        ),
    },
    portals: {
      issue: (input: {
        company: string;
        client_name: string;
        client_email: string;
        agency_name?: string;
        ttl_days?: number;
      }) =>
        request<{ token: string; path: string; expires_in_days: number }>(
          getToken, 'POST', '/api/portals/issue', input,
        ),
    },
    reports: {
      list: () =>
        request<{ reports: ReportSummary[]; count: number }>(getToken, 'GET', '/api/reports'),
    },
    tenantConfig: {
      get: () =>
        request<{ config: TenantConfigShape; sources: Record<string, string>; table_exists: boolean }>(
          getToken, 'GET', '/api/tenant/config',
        ),
      patch: (patch: Partial<TenantConfigShape>) =>
        request<{ updated: number; config: TenantConfigShape }>(getToken, 'PATCH', '/api/tenant/config', patch),
    },
    drafts: {
      list: (status?: string) => {
        const qs = status ? `?status=${encodeURIComponent(status)}` : '';
        return request<{ drafts: JobDraft[]; count: number }>(getToken, 'GET', `/api/drafts/jobs${qs}`);
      },
      get: (id: string) =>
        request<{ draft: JobDraft }>(getToken, 'GET', `/api/drafts/jobs/${encodeURIComponent(id)}`),
      save: (input: { draft_payload: Record<string, unknown>; transcript?: string; transcript_source?: string; status?: string; version?: number; client_email?: string; meeting_url?: string; highlights?: unknown }) =>
        request<{ draft: JobDraft }>(getToken, 'POST', '/api/drafts/jobs/save', input),
      patch: (id: string, patch: { status?: string; draft_payload?: Record<string, unknown>; version?: number; highlights?: unknown }) =>
        request<{ draft: JobDraft }>(getToken, 'PATCH', `/api/drafts/jobs/${encodeURIComponent(id)}`, patch),
      convert: (id: string) =>
        request<{ job_id: string; draft_id: string }>(getToken, 'POST', `/api/drafts/jobs/${encodeURIComponent(id)}/convert`),
      sendToClient: (id: string, input?: { client_email?: string }) =>
        request<{ ok: true; status: string; portal_url: string }>(
          getToken, 'POST', `/api/drafts/jobs/${encodeURIComponent(id)}/send-to-client`, input ?? {},
        ),
      generate: (input: { transcript: string }) =>
        request<{ draft: Record<string, unknown>; usage: { input_tokens: number; output_tokens: number; cache_read: number } }>(
          getToken, 'POST', '/api/drafts/generate', input,
        ),
      refine: (input: { draft: Record<string, unknown>; feedback: string }) =>
        request<{ draft: Record<string, unknown> }>(getToken, 'POST', '/api/drafts/refine', input),
    },
    bot: {
      listReviewQueue: () =>
        request<{ items: ReviewQueueItem[]; count: number }>(getToken, 'GET', '/api/bot/review-queue'),
      decide: (id: string, input: { action: 'confirm' | 'override'; override_stage?: string; rationale?: string }) =>
        request<{ resolved: boolean; action: string; final_stage: string; application_id: string }>(
          getToken, 'POST', `/api/bot/review-queue/${encodeURIComponent(id)}/decide`, input,
        ),
    },
    videos: {
      generate: (applicationId: string) =>
        request<{ application_id: string; count: number; persisted: number; table_missing: boolean; questions: VideoQuestionAdmin[] }>(
          getToken, 'POST', `/api/applications/${encodeURIComponent(applicationId)}/videos/generate`,
        ),
      list: (applicationId: string) =>
        request<{ application_id: string; questions: VideoQuestionAdmin[]; responses: VideoResponse[] }>(
          getToken, 'GET', `/api/applications/${encodeURIComponent(applicationId)}/videos`,
        ),
      analyze: (applicationId: string, responseId: string) =>
        request<{ application_id: string; response_id: string; analysis: VideoAnalysis }>(
          getToken, 'POST', `/api/applications/${encodeURIComponent(applicationId)}/videos/${encodeURIComponent(responseId)}/analyze`,
        ),
    },
    pool: {
      list: (opts: { tag?: string; availableOnly?: boolean; limit?: number } = {}) => {
        const params = new URLSearchParams();
        if (opts.tag) params.set('tag', opts.tag);
        if (opts.availableOnly) params.set('available_only', 'true');
        if (opts.limit) params.set('limit', String(opts.limit));
        const qs = params.toString();
        return request<{ pool: PoolEntry[]; count: number }>(
          getToken, 'GET', `/api/pool${qs ? `?${qs}` : ''}`,
        );
      },
      add: (input: {
        candidate_id: string;
        tags?: string[];
        languages?: string[];
        disponible_para_outreach?: boolean;
        contact_preference?: 'email' | 'whatsapp' | 'linkedin';
        notes_internal?: string;
        disc_d?: number;
        disc_i?: number;
        disc_s?: number;
        disc_c?: number;
        velna_indice?: number;
        cognitive_level?: 'basic' | 'mid' | 'senior';
        last_active?: string;
      }) =>
        request<{ pool_entry: PoolEntry }>(getToken, 'POST', '/api/pool', input),
      patch: (id: string, patch: { tags?: string[]; languages?: string[]; disponible_para_outreach?: boolean; notes_internal?: string; contact_preference?: string }) =>
        request<{ pool_entry: PoolEntry }>(getToken, 'PATCH', `/api/pool/${encodeURIComponent(id)}`, patch),
      remove: (id: string) =>
        request<{ removed: boolean; id: string }>(getToken, 'DELETE', `/api/pool/${encodeURIComponent(id)}`),
      match: (input: { job_id: string; area_tags?: string[]; requires_english?: boolean; limit?: number }) =>
        request<{ job_id: string; pool_size: number; available_for_match: number; matches: PoolMatchResult[] }>(
          getToken, 'POST', '/api/pool/match', input,
        ),
    },
    apiKeys: {
      list: () =>
        request<{ api_keys: ApiKey[]; count: number }>(getToken, 'GET', '/api/api-keys'),
      create: (input: {
        name: string;
        permissions?: string[];
        rate_limit_per_min?: number;
        expires_at?: string;
      }) =>
        request<{ api_key: ApiKey & { plain_key: string }; warning: string }>(
          getToken, 'POST', '/api/api-keys', input,
        ),
      patch: (id: string, patch: { name?: string; permissions?: string[]; rate_limit_per_min?: number }) =>
        request<{ api_key: ApiKey }>(getToken, 'PATCH', `/api/api-keys/${encodeURIComponent(id)}`, patch),
      revoke: (id: string) =>
        request<{ revoked: boolean; id: string }>(getToken, 'DELETE', `/api/api-keys/${encodeURIComponent(id)}`),
    },
    prefilter: {
      list: (jobId: string) =>
        request<{ questions: ApiPrefilterQuestion[]; table_ready: boolean }>(
          getToken, 'GET', `/api/jobs/${encodeURIComponent(jobId)}/prefilter`,
        ),
      create: (jobId: string, input: {
        question_text: string;
        type: 'yes_no' | 'multi_choice' | 'number' | 'text';
        options?: string[];
        expected_answer?: string;
        is_disqualifier?: boolean;
        order_index?: number;
      }) =>
        request<{ question: ApiPrefilterQuestion }>(
          getToken, 'POST', `/api/jobs/${encodeURIComponent(jobId)}/prefilter`, input,
        ),
      patch: (jobId: string, questionId: string, patch: {
        question_text?: string;
        expected_answer?: string;
        is_disqualifier?: boolean;
        order_index?: number;
      }) =>
        request<{ updated: boolean }>(
          getToken, 'PATCH', `/api/jobs/${encodeURIComponent(jobId)}/prefilter/${encodeURIComponent(questionId)}`, patch,
        ),
      remove: (jobId: string, questionId: string) =>
        request<{ deleted: boolean }>(
          getToken, 'DELETE', `/api/jobs/${encodeURIComponent(jobId)}/prefilter/${encodeURIComponent(questionId)}`,
        ),
    },
    integrations: {
      status: () =>
        request<{
          integrations: Array<{
            key: string;
            name: string;
            desc: string;
            configured: boolean;
            required: boolean;
          }>;
          summary: {
            required_configured: number;
            required_total: number;
            optional_configured: number;
            optional_total: number;
            health: 'ok' | 'incomplete';
          };
        }>(getToken, 'GET', '/api/integrations/status'),
    },
    briefings: {
      schedule: (input: {
        client_email: string;
        client_name: string;
        client_company?: string;
        client_phone?: string;
        start_time: string; // ISO 8601
        duration_minutes?: number;
      }) =>
        request<{
          booking_id: string;
          status: string;
          start_time: string;
          meeting_url?: string;
          next_step: string;
        }>(getToken, 'POST', '/api/briefings/schedule', input),
    },
    emailTemplates: {
      list: (locale: 'es' | 'en' = 'es') =>
        request<{
          locale: string;
          sample_vars: Record<string, string>;
          templates: Array<{
            key: string;
            locale: string;
            raw: { subject: string; body_text: string; body_html: string };
            rendered: { subject: string; body_text: string; body_html: string };
            variables: string[];
          }>;
          count: number;
        }>(getToken, 'GET', `/api/email-templates?locale=${locale}`),
    },
    outreach: {
      listCampaigns: (opts: { status?: string; jobId?: string } = {}) => {
        const q = new URLSearchParams();
        if (opts.status) q.set('status', opts.status);
        if (opts.jobId) q.set('job_id', opts.jobId);
        const qs = q.toString();
        return request<{ campaigns: ApiOutreachCampaign[]; count: number; table_ready: boolean }>(
          getToken, 'GET', `/api/outreach/campaigns${qs ? '?' + qs : ''}`,
        );
      },
      createCampaign: (input: { name: string; provider?: 'internal' | 'email'; status?: string; job_id?: string }) =>
        request<{ campaign: ApiOutreachCampaign }>(getToken, 'POST', '/api/outreach/campaigns', input),
      listInbox: (opts: { filter?: 'needs_response' | 'unread' | 'all' } = {}) => {
        const q = opts.filter && opts.filter !== 'all' ? `?filter=${opts.filter}` : '';
        return request<{ messages: ApiOutreachMessage[]; count: number; table_ready: boolean }>(
          getToken, 'GET', `/api/outreach/inbox${q}`,
        );
      },
      patchInbox: (id: string, patch: { is_read?: boolean; needs_response?: boolean }) =>
        request<{ updated: boolean }>(getToken, 'PATCH', `/api/outreach/inbox/${encodeURIComponent(id)}`, patch),
      reply: (id: string, text: string) =>
        request<{ ok: boolean }>(getToken, 'POST', `/api/outreach/inbox/${encodeURIComponent(id)}/reply`, { text }),
    },
  };
}

export type ApiMarketingLead = {
  ROWID: string;
  email: string;
  contact_name: string | null;
  company: string | null;
  whatsapp: string | null;
  score_quality: number;
  urgency: 'less_30d' | '1-3m' | '3m+' | 'exploring';
  salary_target: number | null;
  source: string;
  utm_source: string | null;
  utm_campaign: string | null;
  status: 'new' | 'eval_requested' | 'eval_completed' | 'call_booked' | 'won' | 'lost';
  eval_result_id: string | null;
  eval_completed_at: string | null;
  demo_report_url: string | null;
  created_at: string;
  updated_at: string;
};

export type ApiPrefilterQuestion = {
  ROWID: string;
  job_id: string;
  question_text: string;
  type: 'yes_no' | 'multi_choice' | 'number' | 'text';
  options: string | null;
  expected_answer: string | null;
  is_disqualifier: boolean;
  order_index: number;
  created_at: string;
};

export type ApiOutreachCampaign = {
  ROWID: string;
  tenant_id: string;
  name: string;
  job_id: string | null;
  provider: 'heyreach' | 'internal' | 'email';
  status: 'active' | 'paused' | 'closed' | 'draft';
  invites_sent: number;
  accepted: number;
  replied: number;
  meeting_booked: number;
  started_at: string;
  created_at: string;
};

export type ApiOutreachMessage = {
  ROWID: string;
  tenant_id: string;
  campaign_id: string | null;
  contact_name: string;
  contact_linkedin: string | null;
  contact_company: string | null;
  contact_role: string | null;
  channel: 'linkedin_dm' | 'email';
  direction: 'in' | 'out';
  body: string;
  sent_at: string;
  is_read: boolean;
  needs_response: boolean;
  created_at: string;
};

export type VideoQuestionAdmin = {
  ROWID: string;
  application_id: string;
  question_id: string;
  category: 'technical' | 'weakness_followup' | 'situational' | 'cv_claim_check' | 'integrity_check' | 'english_check';
  question_text: string;
  rationale_internal: string;
  expected_signals: string[];
  max_duration_sec: number;
  created_at: string;
};

export type VideoAnalysis = {
  overall_pct: number;
  signals_matched_pct: number;
  observations: string[];
  flags: string[];
  claim_corroborated?: boolean;
  integrity_concern_pct?: number;
  english_level_pct?: number;
};

export type VideoResponse = {
  ROWID: string;
  application_id: string;
  question_id: string;
  attempt: number;
  catalyst_file_id: string | null;
  duration_sec: number | null;
  transcript: string | null;
  transcript_status: 'pending' | 'ok' | 'failed';
  analysis_payload: string | null;
  analysis_status: 'pending' | 'ok' | 'failed';
  submitted_at: string;
};

export type PoolEntry = {
  ROWID: string;
  tenant_id: string;
  candidate_id: string;
  tags: string[];
  languages: string[];
  disponible_para_outreach: boolean;
  last_active: string | null;
  contact_preference: string;
  times_contacted: number;
  last_contacted_at: string | null;
  notes_internal: string | null;
  disc_d: number | null;
  disc_i: number | null;
  disc_s: number | null;
  disc_c: number | null;
  velna_indice: number | null;
  cognitive_level: 'basic' | 'mid' | 'senior' | null;
  created_at: string;
  updated_at: string;
};

export type PoolMatchResult = {
  pool_entry_id: string;
  candidate_id: string;
  match_score: number;
  available: boolean;
  reasoning: string[];
  breakdown: {
    disc: number;
    cognitive: number;
    area: number;
    english: number;
    recency: number;
    contact_history: number;
  };
};

export type TenantConfigShape = {
  bot_threshold: number;
  bot_mode: 'cold' | 'warm' | 'hot';
  tecnica_default_min: number;
  auto_purge_videos_days: number;
};

export type JobDraft = {
  ROWID: string;
  tenant_id: string;
  transcript: string | null;
  transcript_source: string;
  meeting_url: string | null;
  draft_payload: string; // JSON serialized
  status: 'draft_generated' | 'pending_client_review' | 'client_approved' | 'client_changes_requested' | 'converted_to_job' | 'discarded';
  version: number;
  highlights: string | null;
  created_by: string;
  client_email: string | null;
  client_approved_at: string | null;
  job_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ReportSummary = {
  job_id: string;
  job_title: string;
  job_company: string;
  job_active: boolean;
  finalists_count: number;
  total_applications: number;
  has_report: boolean;
  cache_status: 'unknown' | 'cached' | 'missing';
  last_opened_at: string | null;
  opened_count: number;
};

export type ReviewQueueItem = {
  ROWID: string;
  tenant_id: string;
  application_id: string;
  bot_decision_id: string;
  reason: string;
  priority: 'low' | 'normal' | 'high';
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: string | null;
  created_at: string;
  bot_decision: {
    ROWID: string;
    to_stage_proposed: string;
    confidence: number;
    rationale: string;
    from_stage: string;
  } | null;
};

export type ApiKey = {
  ROWID: string;
  tenant_id: string;
  name: string;
  key_prefix: string;
  created_by_user: string;
  permissions: string;
  rate_limit_per_min: number;
  last_used_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  revoked_at: string | null;
  created_at: string;
};

export const ALL_API_PERMISSIONS = [
  'jobs:read', 'jobs:write',
  'candidates:read', 'candidates:write',
  'applications:read', 'applications:write',
  'reports:read', '*',
] as const;

export type ApiClient = ReturnType<typeof buildClient>;

// ---- React hook ----

export function useApi(): ApiClient {
  const { getToken } = useAuth();
  return useMemo(() => buildClient(() => getToken()), [getToken]);
}

// ---- Standalone (sin Clerk) — para llamadas server-to-server o tests ----

export function buildStandaloneClient(token: string | null): ApiClient {
  return buildClient(async () => token);
}
