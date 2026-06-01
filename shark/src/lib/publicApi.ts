/**
 * Cliente HTTP para endpoints PÚBLICOS del backend (sin Clerk auth).
 * Auth: el token signed va en la URL `/test/:token/submit`.
 *
 * Solo lo usan las pantallas del candidato (no la app del recruiter).
 */

import { config } from '../config';
import { ApiError } from './api';

type SubmitTecnica = {
  total_questions: number;
  total_correct: number;
  min_required?: number;
};

type SubmitDisc = {
  raw_d: number;
  raw_i: number;
  raw_s: number;
  raw_c: number;
  total_questions: number;
  pk_id?: string;
};

type SubmitVelna = {
  verbal: number;
  espacial: number;
  logica: number;
  numerica: number;
  abstracta: number;
  total: number;
  max: number;
};

type SubmitEmotional = {
  score: number;
};

type SubmitIntegridad = {
  dimensions: { dimension: string; pct: number }[];
};

export type AntiCheatEvent = {
  type: 'cursor_out' | 'window_blur' | 'paste';
  question_id?: string;
  duration_ms?: number;
};

type SubmitTestPayload = {
  tecnica?: SubmitTecnica;
  disc?: SubmitDisc;
  velna?: SubmitVelna;
  emotional?: SubmitEmotional;
  integridad?: SubmitIntegridad;
  anti_cheat?: {
    count: number;
    events: AntiCheatEvent[];
    phase: 'tecnica' | 'conductual' | 'integridad';
  };
};

/**
 * Reintenta hasta 3 veces con backoff exponencial. Solo errores transitorios
 * (5xx, network, 429) — 4xx no reintenta porque son errores del cliente.
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isRetryable = err instanceof ApiError
        && (err.status === 0 || err.status === 429 || (err.status >= 500 && err.status < 600));
      if (!isRetryable || attempt >= maxRetries) throw err;
      const delay = 200 * Math.pow(2, attempt) + Math.random() * 100;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Hace fetch al endpoint público. No envía Authorization header.
 * Si `useApi=false` (modo mock), no hace nada y devuelve éxito simulado.
 */
async function publicFetch<T>(method: string, path: string, body?: unknown): Promise<T | null> {
  if (!config.useApi) {
    // Modo mock: no submitea al backend.
    return null;
  }

  // apiBase = función root (Catalyst function URL). Path arranca con `/test/...` o `/report/...`.
  const url = `${config.apiBase.replace(/\/$/, '')}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new ApiError(0, 'network_error', `Network error: ${(err as Error).message}`);
  }
  clearTimeout(timer);

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

export type PortalJobStage = 'profile_pending' | 'search_started' | 'funnel_active' | 'finalists_ready' | 'closed';

export type PortalMilestone = {
  key: 'profile_ready' | 'search_started' | 'funnel_active' | 'finalists_ready';
  label: string;
  completed_at: string | null;
};

export type PortalFunnelStats = {
  applied: number;
  prefilter_passed: number;
  tecnica_done: number;
  conductual_done: number;
  integridad_done: number;
  finalists: number;
  estimated_finalists_ready: string;
};

export type PortalJobApi = {
  id: string;
  job_id: string;
  display_title: string;
  stage: PortalJobStage;
  created_at: string;
  funnel?: PortalFunnelStats;
  report_token?: string;
  milestones: PortalMilestone[];
};

export type PortalApi = {
  client_name: string;
  client_email: string;
  client_company: string;
  agency_name: string;
  jobs: PortalJobApi[];
};

export type BundleIdealProfile = {
  disc?: { d: number; i: number; s: number; c: number; pk_code?: string; pk_name?: string };
  disc_b?: { d: number; i: number; s: number; c: number; pk_code?: string; pk_name?: string };
  velna?: { verbal: number; espacial: number; logica: number; numerica: number; abstracta: number };
  competencias?: Array<{ name: string; required_pct: number }>;
  tecnica_minimo_pct?: number;
  context_summary?: string;
};

export type BundleCandidateNarrative = {
  paragraph_intro: string;
  fortalezas: string[];
  a_tomar_en_cuenta: string[];
  estilo_decisiones: string;
  estilo_equipo: string;
  estilo_presion: string;
  estilo_comunicacion: string;
  perfil_emocional_text: string;
};

export type BundleReportConclusion = {
  si_priorizas_autonomia: string;
  si_priorizas_crecimiento: string;
  menor_riesgo: string;
  mayor_potencial: string;
  recomendacion_final: string;
};

export type BundleVideoAnalysis = {
  question_id: string;
  category: string;
  question_text: string;
  has_response: boolean;
  analysis_status: 'pending' | 'ok' | 'failed' | null;
  analysis: {
    overall_pct?: number;
    signals_matched_pct?: number;
    observations?: string[];
    flags?: string[];
    claim_corroborated?: boolean;
    integrity_concern_pct?: number;
    english_level_pct?: number;
  } | null;
};

export type BundleMindset = {
  adaptability_score_pct: number | null;
  adaptability_pattern: 'adaptable' | 'mixto' | 'limitante' | null;
  polos_adaptables: {
    crecimiento: number | null;
    curiosa: number | null;
    creativa: number | null;
    agente: number | null;
    abundancia: number | null;
    exploracion: number | null;
    oportunidad: number | null;
  };
};

export type BundleEnglish = {
  level_required: 'A2' | 'B1' | 'B2' | 'C1' | null;
  total_score_pct: number | null;
  passed: boolean | null;
};

export type BundleCandidate = {
  application_id: string;
  pipeline_stage: string;
  completed_at: string | null;
  candidate: { name: string; email_redacted: string; age: number | null } | null;
  scores: Record<string, unknown> | null;
  integrity_dimensions: Array<{ dimension: string; nivel: string; pct: number }>;
  summary_score: number | null;
  videos: BundleVideoAnalysis[] | null;
  mindset: BundleMindset | null;
  english: BundleEnglish | null;
};

export type BundleReport = {
  generated_at: string;
  job: {
    title: string;
    company: string;
    cognitive_level: string;
    ideal_profile: BundleIdealProfile | null;
  };
  candidates: BundleCandidate[];
  narratives: {
    candidates: Record<string, BundleCandidateNarrative>;
    conclusion: BundleReportConclusion;
    generated_at: string;
    status: 'ok' | 'partial' | 'failed';
  } | null;
  summary: {
    total_finalists: number;
    ordered_by_score: string[];
    best_application_id: string | null;
  } | null;
};

export const publicApi = {
  /** Submit con retry automático en errores transitorios (3 intentos). */
  submitTest: (token: string, payload: SubmitTestPayload) =>
    withRetry(() => publicFetch<{ submitted: string[] }>(
      'POST',
      `/test/${encodeURIComponent(token)}/submit`,
      payload,
    )),

  getTestStatus: (token: string) =>
    publicFetch<{ application_id: string; pipeline_stage: string; expired: boolean }>(
      'GET',
      `/test/${encodeURIComponent(token)}`,
    ),

  getReport: (token: string) =>
    publicFetch<{
      report: {
        generated_at: string;
        job: { title: string; company: string; cognitive_level: string } | null;
        candidate: { name: string; email: string; age: number | null } | null;
        pipeline_stage: string;
        scores: Record<string, unknown> | null;
        integrity_dimensions: Array<{ dimension: string; nivel: string; pct: number }>;
      };
    }>('GET', `/report/${encodeURIComponent(token)}`),

  getReportBundle: (token: string) =>
    publicFetch<{
      report: BundleReport;
    }>('GET', `/report/bundle/${encodeURIComponent(token)}`),

  /** Lista preguntas de video para el candidato. NO incluye rationale_internal. */
  getTestVideos: (token: string) =>
    publicFetch<{
      application_id: string;
      questions: Array<{
        question_id: string;
        category: 'technical' | 'weakness_followup' | 'situational' | 'cv_claim_check' | 'integrity_check' | 'english_check';
        question_text: string;
        expected_signals: string[];
        max_duration_sec: number;
      }>;
      count: number;
    }>('GET', `/test/${encodeURIComponent(token)}/videos`),

  /**
   * Submitea una respuesta a una pregunta de video. Por ahora soporta:
   * - `transcript`: texto largo (fallback cuando no hay grabación o transcripción ya hecha)
   * - `catalyst_file_id`: ID del archivo en Catalyst File Store (cuando upload directo se implemente)
   * - `duration_sec`: duración del audio/video (opcional)
   * Máximo 2 attempts por pregunta — el backend cuenta y rechaza el 3er attempt.
   */
  submitTestVideo: (
    token: string,
    questionId: string,
    payload: { transcript?: string; catalyst_file_id?: string; duration_sec?: number },
  ) =>
    publicFetch<{
      response_id: string;
      attempt: number;
      transcript_status: 'pending' | 'ok' | 'failed';
      next_steps: string;
    }>(
      'POST',
      `/test/${encodeURIComponent(token)}/videos/${encodeURIComponent(questionId)}/submit`,
      payload,
    ),

  /**
   * Sube el blob raw del video/audio al Catalyst File Store. Devuelve catalyst_file_id
   * para después mandar en submitTestVideo. Max 25MB.
   */
  uploadTestVideoBlob: async (
    token: string,
    questionId: string,
    blob: Blob,
  ): Promise<{ catalyst_file_id: string; filename: string; bytes: number } | null> => {
    if (!config.useApi) return null;
    const url = `${config.apiBase.replace(/\/$/, '')}/test/${encodeURIComponent(token)}/videos/${encodeURIComponent(questionId)}/upload`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'video/webm' },
        body: blob,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new ApiError(0, 'network_error', `Upload failed: ${(err as Error).message}`);
    }
    clearTimeout(timer);

    const isJson = response.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await response.json().catch(() => null) : await response.text();

    if (!response.ok) {
      const errBody = (data && typeof data === 'object' ? data : {}) as { error?: { code?: string; message?: string } };
      throw new ApiError(
        response.status,
        errBody.error?.code ?? 'upload_failed',
        errBody.error?.message ?? `HTTP ${response.status}`,
      );
    }
    return data as { catalyst_file_id: string; filename: string; bytes: number };
  },

  getPublicJobInfo: (tenantSlug: string, jobIdentifier: string) =>
    publicFetch<{
      tenant: { slug: string; name: string };
      job: { id: string; title: string; company: string; cognitive_level: string; context: string | null };
    }>('GET', `/apply/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(jobIdentifier)}`),

  submitPublicApplication: (
    tenantSlug: string,
    jobIdentifier: string,
    payload: {
      full_name: string;
      email: string;
      phone: string;
      consent_data: boolean;
      consent_communications?: boolean;
      age?: number;
      salary_aspiration_usd?: number;
      disponibilidad?: string;
      linkedin_url?: string;
    },
  ) =>
    withRetry(() => publicFetch<{
      application_id: string;
      candidate_id: string;
      pipeline_stage: string;
      created_now: boolean;
      message: string;
    }>(
      'POST',
      `/apply/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(jobIdentifier)}`,
      payload,
    )),

  getClientPortal: (token: string) =>
    publicFetch<{ portal: PortalApi }>('GET', `/portal/${encodeURIComponent(token)}`),

  getClientPortalJob: (token: string, jobId: string) =>
    publicFetch<{ portal: Omit<PortalApi, 'jobs'>; job: PortalJobApi }>(
      'GET',
      `/portal/${encodeURIComponent(token)}/jobs/${encodeURIComponent(jobId)}`,
    ),
};

export type { SubmitTecnica, SubmitDisc, SubmitVelna, SubmitEmotional };
