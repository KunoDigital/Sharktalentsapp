/**
 * Cliente HTTP minimal para hablar con la API pública de SharkTalents.
 *
 * Auth: header `Authorization: Bearer st_live_<API_KEY>`. La key viene de la env var
 * `SHARKTALENTS_API_KEY` que el usuario setea en `claude_desktop_config.json`.
 *
 * Base URL: `SHARKTALENTS_API_BASE` (default a la URL de Catalyst Development).
 */

const DEFAULT_BASE = 'https://sharktalentsapp-883996440.development.catalystserverless.com/server/api';

export class SharkTalentsClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(opts: { apiKey: string; baseUrl?: string }) {
    if (!opts.apiKey) {
      throw new Error('SHARKTALENTS_API_KEY env var requerida');
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new Error(`Network error ${method} ${path}: ${(err as Error).message}`);
    }
    clearTimeout(timer);

    const isJson = response.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await response.json().catch(() => null) : await response.text();

    if (!response.ok) {
      const code = (data as { error?: { code?: string } })?.error?.code ?? `http_${response.status}`;
      const msg = (data as { error?: { message?: string } })?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`API error ${code}: ${msg}`);
    }

    return data as T;
  }

  // ===== Jobs =====

  listJobs(opts: { includeInactive?: boolean } = {}): Promise<{ jobs: Job[] }> {
    const qs = opts.includeInactive ? '?include_inactive=true' : '';
    return this.request('GET', `/api/v1/jobs${qs}`);
  }

  getJob(id: string): Promise<{ job: Job }> {
    return this.request('GET', `/api/v1/jobs/${encodeURIComponent(id)}`);
  }

  createJob(input: {
    title: string;
    company: string;
    cognitive_level?: 'basic' | 'mid' | 'senior';
    tech_prompt?: string | null;
    company_context?: string | null;
  }): Promise<{ job: Job }> {
    return this.request('POST', '/api/v1/jobs', input);
  }

  archiveJob(id: string): Promise<{ job: Job }> {
    return this.request('DELETE', `/api/v1/jobs/${encodeURIComponent(id)}`);
  }

  // ===== Candidates =====

  listCandidates(opts: { limit?: number } = {}): Promise<{ candidates: Candidate[] }> {
    const qs = opts.limit ? `?limit=${opts.limit}` : '';
    return this.request('GET', `/api/v1/candidates${qs}`);
  }

  getCandidate(id: string): Promise<{ candidate: Candidate }> {
    return this.request('GET', `/api/v1/candidates/${encodeURIComponent(id)}`);
  }

  // ===== Applications =====

  listApplications(opts: { jobId?: string; limit?: number } = {}): Promise<{ applications: Application[] }> {
    const params = new URLSearchParams();
    if (opts.jobId) params.set('job_id', opts.jobId);
    if (opts.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return this.request('GET', `/api/v1/applications${qs ? `?${qs}` : ''}`);
  }

  getApplication(id: string): Promise<{ application: Application; transitions: Transition[] }> {
    return this.request('GET', `/api/v1/applications/${encodeURIComponent(id)}`);
  }

  transitionApplication(id: string, toStage: string, reason?: string): Promise<{ application: Application; transition: Transition }> {
    return this.request('POST', `/api/v1/applications/${encodeURIComponent(id)}/transition`, { to_stage: toStage, reason });
  }

  readApplicationScores(id: string): Promise<{ scores: Record<string, unknown> | null; integrity_dimensions: Array<{ dimension: string; nivel: string; pct: number }> }> {
    return this.request('GET', `/api/v1/applications/${encodeURIComponent(id)}/scores`);
  }

  // ===== Bot review queue =====

  listReviewQueue(): Promise<{ items: ReviewQueueItem[]; count: number }> {
    return this.request('GET', '/api/v1/bot/review-queue');
  }

  decideReviewQueueItem(id: string, input: { action: 'confirm' | 'override'; override_stage?: string; rationale?: string }): Promise<{ resolved: boolean; final_stage: string }> {
    return this.request('POST', `/api/v1/bot/review-queue/${encodeURIComponent(id)}/decide`, input);
  }
}

// ===== Tipos (snapshot — pueden quedar desactualizados respecto al backend canónico) =====

export type Job = {
  ROWID: string;
  tenant_id: string;
  title: string;
  company: string;
  cognitive_level: 'basic' | 'mid' | 'senior';
  is_active: boolean;
  tech_prompt: string | null;
  company_context: string | null;
  ideal_profile: string | null;
  created_at: string;
};

export type Candidate = {
  ROWID: string;
  name: string;
  email: string;
  phone: string | null;
  age: number | null;
};

export type Application = {
  ROWID: string;
  assessment_id: string;
  candidate_id: string;
  pipeline_stage: string;
  started_at: string;
  completed_at: string | null;
};

export type Transition = {
  ROWID: string;
  result_id: string;
  from_stage: string | null;
  to_stage: string;
  actor: string;
  reason: string | null;
  transitioned_at: string;
};

export type ReviewQueueItem = {
  ROWID: string;
  application_id: string;
  bot_decision_id: string;
  reason: string;
  priority: 'low' | 'normal' | 'high';
  created_at: string;
  bot_decision: {
    to_stage_proposed: string;
    confidence: number;
    rationale: string;
    from_stage: string;
  } | null;
};
