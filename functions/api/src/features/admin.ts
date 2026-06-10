import type { RequestContext } from '../lib/context';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { catalyst, zcql } from '../lib/db';
import { unwrapRows } from '../lib/dbHelpers';
import { requireInternalKey } from '../lib/internalAuth';
import { anthropicMessage, extractText } from '../lib/anthropic';
import { readJsonBody } from '../lib/http';
import { ValidationError } from '../lib/errors';
import { signPortalToken } from '../lib/clientPortalTokens';
import { TEMPLATES, getTemplate, renderTemplate, type TemplateKey, type EmailLocale } from '../lib/emailTemplates';

const log = logger('ADMIN');

/**
 * Verifica que todas las tablas del Block 1 existan con sus columnas correctas.
 * Endpoint protegido — solo accesible con el header `X-Internal-Key` válido.
 *
 * Uso:
 *   curl -H "X-Internal-Key: $INTERNAL_API_KEY" https://<catalyst-url>/admin/verify-tables
 */

type ExpectedColumn = {
  name: string;
  type: string; // tipo informativo, no estricto
  mandatory?: boolean;
  unique?: boolean;
};

type ExpectedTable = {
  name: string;
  columns: ExpectedColumn[];
};

// Esquema esperado (en sync con docs/master-plan/MIGRATIONS_BLOCK1.md)
const EXPECTED: ExpectedTable[] = [
  {
    name: 'Tenants',
    columns: [
      { name: 'clerk_org_id', type: 'Text', mandatory: true, unique: true },
      { name: 'name', type: 'Text', mandatory: true },
      { name: 'slug', type: 'Text', mandatory: true, unique: true },
      { name: 'plan', type: 'Text', mandatory: true },
      { name: 'status', type: 'Text', mandatory: true },
      { name: 'max_active_jobs', type: 'Integer', mandatory: true },
      { name: 'max_candidates_per_month', type: 'Integer', mandatory: true },
      { name: 'features_enabled', type: 'Text' },
      { name: 'branding_config', type: 'Text' },
      { name: 'billing_email', type: 'Text' },
      { name: 'created_at', type: 'DateTime', mandatory: true },
      { name: 'updated_at', type: 'DateTime', mandatory: true },
    ],
  },
  {
    name: 'ProcessedEvents',
    columns: [
      { name: 'event_id', type: 'Text', mandatory: true, unique: true },
      { name: 'provider', type: 'Text', mandatory: true },
      { name: 'received_at', type: 'DateTime', mandatory: true },
    ],
  },
  {
    name: 'Jobs',
    columns: [
      { name: 'tenant_id', type: 'Text', mandatory: true },
      { name: 'title', type: 'Text', mandatory: true },
      { name: 'company', type: 'Text', mandatory: true },
      { name: 'tech_prompt', type: 'Text' },
      { name: 'cognitive_level', type: 'Text', mandatory: true },
      { name: 'is_active', type: 'Boolean', mandatory: true },
      { name: 'company_context', type: 'Text' },
      { name: 'ideal_profile', type: 'Text' },
      { name: 'tech_questions_cache', type: 'Text' },
      { name: 'created_by', type: 'Text', mandatory: true },
      // (above is Jobs)
      { name: 'created_at', type: 'DateTime', mandatory: true },
      { name: 'updated_at', type: 'DateTime', mandatory: true },
    ],
  },
  {
    name: 'Candidates',
    columns: [
      { name: 'name', type: 'Text', mandatory: true },
      { name: 'email', type: 'Email', mandatory: true },
      { name: 'phone', type: 'Var Char' },
      { name: 'age', type: 'Integer' },
      { name: 'salary_expectation', type: 'Integer' },
      { name: 'availability', type: 'Text' },
      { name: 'interview_file_id', type: 'Text' },
      { name: 'created_at', type: 'DateTime', mandatory: true },
    ],
  },
  {
    name: 'Results',
    columns: [
      { name: 'assessment_id', type: 'Text', mandatory: true },
      { name: 'candidate_id', type: 'Text', mandatory: true },
      { name: 'answers', type: 'Text' },
      { name: 'pipeline_stage', type: 'Text', mandatory: true },
      { name: 'started_at', type: 'DateTime', mandatory: true },
      { name: 'completed_at', type: 'DateTime' },
      { name: 'report_downloaded_at', type: 'DateTime' },
      { name: 'idempotency_key', type: 'Text' },
    ],
  },
  {
    name: 'PipelineTransitions',
    columns: [
      { name: 'result_id', type: 'Text', mandatory: true },
      { name: 'from_stage', type: 'Text' },
      { name: 'to_stage', type: 'Text', mandatory: true },
      { name: 'actor', type: 'Text', mandatory: true },
      { name: 'reason', type: 'Text' },
      { name: 'transitioned_at', type: 'DateTime', mandatory: true },
    ],
  },
  {
    name: 'Scores',
    columns: [
      { name: 'result_id', type: 'Var Char', mandatory: true, unique: true },
      // DISC
      { name: 'disc_raw_d', type: 'Int' },
      { name: 'disc_raw_i', type: 'Int' },
      { name: 'disc_raw_s', type: 'Int' },
      { name: 'disc_raw_c', type: 'Int' },
      { name: 'disc_norm_d', type: 'Int' },
      { name: 'disc_norm_i', type: 'Int' },
      { name: 'disc_norm_s', type: 'Int' },
      { name: 'disc_norm_c', type: 'Int' },
      { name: 'disc_perfil_dominante', type: 'Var Char' },
      { name: 'disc_pk_id', type: 'Var Char' },
      // VELNA
      { name: 'velna_verbal', type: 'Int' },
      { name: 'velna_espacial', type: 'Int' },
      { name: 'velna_logica', type: 'Int' },
      { name: 'velna_numerica', type: 'Int' },
      { name: 'velna_abstracta', type: 'Int' },
      { name: 'velna_total', type: 'Int' },
      { name: 'velna_max', type: 'Int' },
      { name: 'velna_indice', type: 'Int' },
      // Emotional
      { name: 'emo_score', type: 'Int' },
      { name: 'emo_perfil', type: 'Var Char' },
      // Technical
      { name: 'tec_score_pct', type: 'Int' },
      { name: 'tec_total_correct', type: 'Int' },
      { name: 'tec_total_questions', type: 'Int' },
      { name: 'tec_passed', type: 'Boolean' },
      // Integrity header
      { name: 'int_overall', type: 'Var Char' },
      { name: 'int_overall_pct', type: 'Int' },
      { name: 'int_recomendacion', type: 'Var Char' },
      { name: 'int_buena_impresion', type: 'Var Char' },
      { name: 'int_buena_impresion_pct', type: 'Int' },
      // Timestamps por bloque
      { name: 'disc_completed_at', type: 'DateTime' },
      { name: 'velna_completed_at', type: 'DateTime' },
      { name: 'emo_completed_at', type: 'DateTime' },
      { name: 'tec_completed_at', type: 'DateTime' },
      { name: 'int_completed_at', type: 'DateTime' },
      // Doble eje (doc 19) — opcional, populated solo si las preguntas son doble eje
      { name: 'tec_situational_validity_pct', type: 'Int' },
      { name: 'tec_style_autonomy_consult', type: 'Int' }, // 0-100 (lo guardamos *100 para evitar Decimal)
      { name: 'tec_style_match_with_boss_pct', type: 'Int' },
    ],
  },
  {
    name: 'IntegrityDimensions',
    columns: [
      { name: 'result_id', type: 'Var Char', mandatory: true },
      { name: 'dimension', type: 'Var Char', mandatory: true },
      { name: 'nivel', type: 'Var Char', mandatory: true },
      { name: 'pct', type: 'Int', mandatory: true },
    ],
  },
  {
    name: 'AuditLog',
    columns: [
      { name: 'actor_user', type: 'Text', mandatory: true },
      { name: 'action', type: 'Text', mandatory: true },
      { name: 'resource_type', type: 'Text', mandatory: true },
      { name: 'resource_id', type: 'Text' },
      { name: 'changes', type: 'Text' },
      { name: 'ip', type: 'Text' },
      { name: 'user_agent', type: 'Text' },
      { name: 'created_at', type: 'DateTime', mandatory: true },
    ],
  },
  {
    name: 'OutboxEvents',
    columns: [
      { name: 'event_type', type: 'Text', mandatory: true },
      { name: 'payload', type: 'Text', mandatory: true },
      { name: 'status', type: 'Text', mandatory: true },
      { name: 'retry_count', type: 'Integer', mandatory: true },
      { name: 'last_error', type: 'Text' },
      { name: 'created_at', type: 'DateTime', mandatory: true },
      { name: 'processed_at', type: 'DateTime' },
    ],
  },
  // ===== Block 2 (deferred — se crean cuando el feature lo necesita) =====
  {
    name: 'Config',
    columns: [
      { name: 'tenant_id', type: 'Var Char', mandatory: true },
      { name: 'config_key', type: 'Var Char', mandatory: true },
      { name: 'value', type: 'Text', mandatory: true },
      { name: 'value_type', type: 'Var Char', mandatory: true },
      { name: 'description', type: 'Var Char' },
      { name: 'updated_by', type: 'Var Char' },
      { name: 'updated_at', type: 'DateTime', mandatory: true },
    ],
  },
  {
    name: 'BotDecisions',
    columns: [
      { name: 'tenant_id', type: 'Var Char', mandatory: true },
      { name: 'result_id', type: 'Var Char', mandatory: true },
      { name: 'job_id', type: 'Var Char', mandatory: true },
      { name: 'from_stage', type: 'Var Char', mandatory: true },
      { name: 'to_stage_proposed', type: 'Var Char', mandatory: true },
      { name: 'decision', type: 'Var Char', mandatory: true },
      { name: 'confidence', type: 'Int', mandatory: true },
      { name: 'rationale', type: 'Text' },
      { name: 'similar_cases', type: 'Text' },
      { name: 'auto_executed', type: 'Boolean', mandatory: true },
      { name: 'executed_at', type: 'DateTime' },
      { name: 'overridden', type: 'Boolean', mandatory: true },
      { name: 'overridden_by', type: 'Var Char' },
      { name: 'overridden_at', type: 'DateTime' },
      { name: 'overridden_reason', type: 'Text' },
      { name: 'created_at', type: 'DateTime', mandatory: true },
    ],
  },
  {
    name: 'ReviewQueue',
    columns: [
      { name: 'tenant_id', type: 'Var Char', mandatory: true },
      { name: 'result_id', type: 'Var Char', mandatory: true },
      { name: 'bot_decision_id', type: 'Var Char', mandatory: true },
      { name: 'reason', type: 'Text', mandatory: true },
      { name: 'review_priority', type: 'Var Char', mandatory: true },
      { name: 'resolved_at', type: 'DateTime' },
      { name: 'resolved_by', type: 'Var Char' },
      { name: 'resolution', type: 'Var Char' },
      { name: 'created_at', type: 'DateTime', mandatory: true },
    ],
  },
  {
    name: 'ApiKeys',
    columns: [
      { name: 'tenant_id', type: 'Var Char', mandatory: true },
      { name: 'name', type: 'Var Char', mandatory: true },
      { name: 'key_hash', type: 'Var Char', mandatory: true, unique: true },
      { name: 'key_prefix', type: 'Var Char', mandatory: true },
      { name: 'created_by_user', type: 'Var Char', mandatory: true },
      { name: 'permissions', type: 'Text', mandatory: true },
      { name: 'rate_limit_per_min', type: 'Int', mandatory: true },
      { name: 'last_used_at', type: 'DateTime' },
      { name: 'expires_at', type: 'DateTime' },
      { name: 'is_active', type: 'Boolean', mandatory: true },
      { name: 'revoked_at', type: 'DateTime' },
      { name: 'created_at', type: 'DateTime', mandatory: true },
    ],
  },
  {
    name: 'ClientReports',
    columns: [
      { name: 'tenant_id', type: 'Var Char', mandatory: true },
      { name: 'job_id', type: 'Var Char', mandatory: true },
      { name: 'cache_key', type: 'Var Char', mandatory: true, unique: true },
      { name: 'bundle_payload', type: 'Text', mandatory: true },
      { name: 'status', type: 'Var Char', mandatory: true },
      { name: 'opened_count', type: 'Int', mandatory: true },
      { name: 'last_opened_at', type: 'DateTime' },
      { name: 'generated_at', type: 'DateTime', mandatory: true },
      { name: 'expires_at', type: 'DateTime', mandatory: true },
    ],
  },
  {
    name: 'CandidatePool',
    columns: [
      { name: 'tenant_id', type: 'Var Char', mandatory: true },
      { name: 'candidate_id', type: 'Var Char', mandatory: true },
      { name: 'tags', type: 'Text' },
      { name: 'languages', type: 'Text' },
      { name: 'disponible_para_outreach', type: 'Boolean', mandatory: true },
      { name: 'last_active', type: 'DateTime', mandatory: true },
      { name: 'contact_preference', type: 'Var Char' },
      { name: 'times_contacted', type: 'Int', mandatory: true },
      { name: 'last_contacted_at', type: 'DateTime' },
      { name: 'notes_internal', type: 'Text' },
      { name: 'disc_d', type: 'Int' },
      { name: 'disc_i', type: 'Int' },
      { name: 'disc_s', type: 'Int' },
      { name: 'disc_c', type: 'Int' },
      { name: 'velna_indice', type: 'Int' },
      { name: 'cognitive_level', type: 'Var Char' },
      { name: 'added_at', type: 'DateTime', mandatory: true },
      { name: 'updated_at', type: 'DateTime', mandatory: true },
    ],
  },
  // ===== Tests nuevos (mejoras 2026-05-05) =====
  {
    name: 'EnglishTestSessions',
    columns: [
      { name: 'tenant_id', type: 'Var Char', mandatory: true },
      { name: 'result_id', type: 'Var Char', mandatory: true },
      { name: 'level_required', type: 'Var Char', mandatory: true },
      { name: 'started_at', type: 'DateTime', mandatory: true },
      { name: 'completed_at', type: 'DateTime' },
      { name: 'mc_score_pct', type: 'Int' },
      { name: 'listening_score_pct', type: 'Int' },
      { name: 'writing_score_pct', type: 'Int' },
      { name: 'total_score_pct', type: 'Int' },
      { name: 'passed', type: 'Boolean', mandatory: true },
      { name: 'writing_text', type: 'Text' },
      { name: 'writing_word_count', type: 'Int' },
      { name: 'writing_time_seconds', type: 'Int' },
      { name: 'writing_paste_attempts', type: 'Int' },
      { name: 'writing_focus_lost_count', type: 'Int' },
      { name: 'audio_listening_id', type: 'Var Char' },
      { name: 'video_response_id', type: 'Var Char' },
      { name: 'writing_analysis_json', type: 'Text' },
    ],
  },
  {
    name: 'MindsetScores',
    columns: [
      { name: 'tenant_id', type: 'Var Char', mandatory: true },
      { name: 'result_id', type: 'Var Char', mandatory: true, unique: true },
      { name: 'started_at', type: 'DateTime', mandatory: true },
      { name: 'completed_at', type: 'DateTime' },
      // Polos adaptables (% del total)
      { name: 'mindset_growth_pct', type: 'Int' },
      { name: 'mindset_curious_pct', type: 'Int' },
      { name: 'mindset_creative_pct', type: 'Int' },
      { name: 'mindset_agent_pct', type: 'Int' },
      { name: 'mindset_abundance_pct', type: 'Int' },
      { name: 'mindset_exploration_pct', type: 'Int' },
      { name: 'mindset_opportunity_pct', type: 'Int' },
      // Polos limitantes
      { name: 'mindset_fija_pct', type: 'Int' },
      { name: 'mindset_experto_pct', type: 'Int' },
      { name: 'mindset_reactiva_pct', type: 'Int' },
      { name: 'mindset_victima_pct', type: 'Int' },
      { name: 'mindset_escasez_pct', type: 'Int' },
      { name: 'mindset_certeza_pct', type: 'Int' },
      { name: 'mindset_proteccion_pct', type: 'Int' },
      // Score global + patrón
      { name: 'adaptability_score_pct', type: 'Int' },
      { name: 'adaptability_pattern', type: 'Var Char' },
      { name: 'answers_json', type: 'Text' },
    ],
  },
  // ===== Block 2 deferred tables (creadas en Catalyst on-demand) =====
  {
    name: 'JobTrackingSnapshots',
    columns: [
      { name: 'tenant_id', type: 'Var Char', mandatory: true },
      { name: 'job_id', type: 'Var Char' },
      { name: 'portal_token_hash', type: 'Var Char' },
      { name: 'event_type', type: 'Var Char', mandatory: true },
      { name: 'event_data', type: 'Text' },
      { name: 'client_ip_masked', type: 'Var Char' },
      { name: 'user_agent', type: 'Var Char' },
      { name: 'occurred_at', type: 'DateTime', mandatory: true },
    ],
  },
  {
    name: 'MarketingLeads',
    columns: [
      { name: 'email', type: 'Var Char', mandatory: true, unique: true },
      { name: 'contact_name', type: 'Var Char' },
      { name: 'company', type: 'Var Char' },
      { name: 'whatsapp', type: 'Var Char' },
      { name: 'quiz_data', type: 'Text' },
      { name: 'calculator_data', type: 'Text' },
      { name: 'score_quality', type: 'Int' },
      { name: 'urgency', type: 'Var Char' },
      { name: 'salary_target', type: 'Var Char' },
      { name: 'source', type: 'Var Char' },
      { name: 'utm_source', type: 'Var Char' },
      { name: 'utm_medium', type: 'Var Char' },
      { name: 'utm_campaign', type: 'Var Char' },
      { name: 'utm_content', type: 'Var Char' },
      { name: 'utm_term', type: 'Var Char' },
      { name: 'status', type: 'Var Char' },
      { name: 'eval_result_id', type: 'Var Char' },
      { name: 'eval_completed_at', type: 'DateTime' },
      { name: 'demo_report_url', type: 'Var Char' },
      { name: 'call_booking_url', type: 'Var Char' },
      { name: 'zoho_crm_lead_id', type: 'Var Char' },
      // Attribution headers (capturados de la landing)
      { name: 'visit_id', type: 'Var Char' },
      { name: 'meta_event_id', type: 'Var Char' },
      // GDPR delete flow (request-deletion + DELETE)
      { name: 'deletion_token_hash', type: 'Var Char' },
      { name: 'deletion_token_expires_at', type: 'DateTime' },
      { name: 'created_at', type: 'DateTime', mandatory: true },
      { name: 'updated_at', type: 'DateTime' },
    ],
  },
  {
    name: 'PrefQuestions',  // ex-PrefilterQuestions (renombrada 2026-05-11 — bug Catalyst con nombre original)
    columns: [
      { name: 'job_id', type: 'Var Char', mandatory: true },
      { name: 'question_text', type: 'Var Char', mandatory: true },
      { name: 'type', type: 'Var Char', mandatory: true },
      { name: 'options', type: 'Text' },
      { name: 'expected_answer', type: 'Var Char' },
      { name: 'is_disqualifier', type: 'Boolean', mandatory: true },
      { name: 'order_index', type: 'Int', mandatory: true },
      { name: 'created_at', type: 'DateTime', mandatory: true },
    ],
  },
  {
    name: 'PrefilterAnswers',
    columns: [
      { name: 'result_id', type: 'Var Char', mandatory: true },
      { name: 'question_id', type: 'Var Char', mandatory: true },
      { name: 'answer_value', type: 'Text' },
      { name: 'is_match', type: 'Boolean' },
      { name: 'created_at', type: 'DateTime', mandatory: true },
    ],
  },
  {
    name: 'BotTrainingExamples',
    columns: [
      { name: 'tenant_id', type: 'Var Char', mandatory: true },
      { name: 'application_id', type: 'Var Char', mandatory: true },
      { name: 'job_id', type: 'Var Char', mandatory: true },
      { name: 'job_cognitive_level', type: 'Var Char', mandatory: true },
      { name: 'candidate_disc_d', type: 'Int' },
      { name: 'candidate_disc_i', type: 'Int' },
      { name: 'candidate_disc_s', type: 'Int' },
      { name: 'candidate_disc_c', type: 'Int' },
      { name: 'candidate_cognitive_indice', type: 'Int' },
      { name: 'candidate_technical_pct', type: 'Int' },
      { name: 'candidate_integrity_overall', type: 'Var Char' },
      { name: 'from_stage', type: 'Var Char', mandatory: true },
      { name: 'to_stage_chosen', type: 'Var Char', mandatory: true },
      { name: 'chosen_by', type: 'Var Char', mandatory: true },
      { name: 'rationale_human', type: 'Text' },
      { name: 'bot_had_suggested', type: 'Var Char' },
      { name: 'bot_confidence', type: 'Int' },
      { name: 'was_override', type: 'Boolean', mandatory: true },
      { name: 'quality', type: 'Var Char', mandatory: true },
      { name: 'created_at', type: 'DateTime', mandatory: true },
    ],
  },
  {
    name: 'Briefings',
    columns: [
      { name: 'tenant_id', type: 'Var Char', mandatory: true },
      { name: 'client_email', type: 'Var Char', mandatory: true },
      { name: 'client_name', type: 'Var Char' },
      { name: 'client_company', type: 'Var Char' },
      { name: 'booking_id', type: 'Var Char' },
      { name: 'meeting_url', type: 'Var Char' },
      { name: 'transcript_url', type: 'Var Char' },
      { name: 'transcript_text', type: 'Text' },
      { name: 'draft_id', type: 'Var Char' },
      { name: 'status', type: 'Var Char', mandatory: true },
      { name: 'scheduled_at', type: 'DateTime' },
      { name: 'completed_at', type: 'DateTime' },
      { name: 'created_at', type: 'DateTime', mandatory: true },
    ],
  },
  {
    name: 'ContinueTokens',
    columns: [
      { name: 'result_id', type: 'Var Char', mandatory: true },
      { name: 'token_hash', type: 'Var Char', mandatory: true, unique: true },
      { name: 'last_block_completed', type: 'Var Char', mandatory: true },
      { name: 'reminder_sent_at', type: 'DateTime' },
      { name: 'expires_at', type: 'DateTime', mandatory: true },
      { name: 'created_at', type: 'DateTime', mandatory: true },
      { name: 'used_at', type: 'DateTime' },
    ],
  },
  {
    name: 'TokenUsage',
    columns: [
      { name: 'tenant_id', type: 'Var Char' },
      { name: 'feature', type: 'Var Char', mandatory: true },
      { name: 'model', type: 'Var Char', mandatory: true },
      { name: 'input_tokens', type: 'Int', mandatory: true },
      { name: 'cached_input_tokens', type: 'Int', mandatory: true },
      { name: 'output_tokens', type: 'Int', mandatory: true },
      { name: 'latency_ms', type: 'Int', mandatory: true },
      { name: 'trace_id', type: 'Var Char' },
      { name: 'cost_usd_estimated', type: 'Decimal' },
      { name: 'occurred_at', type: 'DateTime', mandatory: true },
    ],
  },
];

type TableReport = {
  name: string;
  exists: boolean;
  missing_columns: string[];
  extra_columns: string[];
  total_expected: number;
  total_found: number;
};

export async function verifyTables(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  log.info('verify-tables: starting', { traceId: ctx.traceId });
  const ds = catalyst(ctx.req).datastore();

  const reports: TableReport[] = [];
  let allOk = true;

  for (const expectedTable of EXPECTED) {
    let report: TableReport = {
      name: expectedTable.name,
      exists: false,
      missing_columns: [],
      extra_columns: [],
      total_expected: expectedTable.columns.length,
      total_found: 0,
    };

    try {
      const table = ds.table(expectedTable.name);
      const cols = await table.getAllColumns();
      report.exists = true;
      const foundNames = new Set(cols.map((c) => c.column_name));
      report.total_found = foundNames.size;

      for (const expectedCol of expectedTable.columns) {
        if (!foundNames.has(expectedCol.name)) {
          report.missing_columns.push(expectedCol.name);
        }
      }

      const expectedNames = new Set(expectedTable.columns.map((c) => c.name));
      const ignored = new Set(['ROWID', 'CREATEDTIME', 'MODIFIEDTIME', 'CREATORID']);
      for (const found of foundNames) {
        if (!expectedNames.has(found) && !ignored.has(found)) {
          report.extra_columns.push(found);
        }
      }

      if (report.missing_columns.length > 0) allOk = false;
    } catch (err) {
      log.warn('table missing or unreadable', {
        traceId: ctx.traceId,
        table: expectedTable.name,
        message: (err as Error).message,
      });
      report.exists = false;
      allOk = false;
    }

    reports.push(report);
  }

  sendJson(ctx.res, 200, {
    ok: allOk,
    summary: {
      total_tables_expected: EXPECTED.length,
      total_tables_ok: reports.filter((r) => r.exists && r.missing_columns.length === 0).length,
      total_tables_missing: reports.filter((r) => !r.exists).length,
      total_tables_with_issues: reports.filter((r) => r.exists && r.missing_columns.length > 0).length,
    },
    tables: reports,
    next_step: allOk
      ? '✓ Todas las tablas OK. Podés seguir con setup de env vars en Catalyst Console y deploy del backend.'
      : '✕ Hay tablas faltantes o columnas que no coinciden. Revisá MIGRATIONS_BLOCK1.md y completá lo que falta.',
  });
}

/**
 * Lista todos los tenants. Endpoint admin — solo accesible con INTERNAL_API_KEY.
 *
 * Uso: curl -H "X-Internal-Key: $INTERNAL_API_KEY" $URL/admin/tenants
 */
export async function listAllTenants(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);

  type TenantRow = {
    ROWID: string;
    clerk_org_id: string;
    name: string;
    slug: string;
    plan: string;
    status: string;
    created_at: string;
  };

  const rows = (await zcql(ctx.req).executeZCQLQuery(
    `SELECT ROWID, clerk_org_id, name, slug, plan, status, created_at FROM Tenants ORDER BY CREATEDTIME DESC`,
  )) as unknown[];
  const tenants = unwrapRows<TenantRow>(rows, 'Tenants');

  log.info('list tenants', { traceId: ctx.traceId, count: tenants.length });
  sendJson(ctx.res, 200, {
    total: tenants.length,
    tenants,
  });
}

/**
 * Stats globales del sistema. Endpoint admin.
 *
 * Devuelve conteos por tabla (útil para dashboarding o monitoring de uso).
 */
export async function getAdminStats(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);

  const tables = ['Tenants', 'Jobs', 'Candidates', 'Results', 'Scores', 'AuditLog', 'OutboxEvents'];
  const counts: Record<string, number> = {};
  const errors: Record<string, string> = {};

  for (const table of tables) {
    try {
      const rows = (await zcql(ctx.req).executeZCQLQuery(
        `SELECT COUNT(ROWID) AS total FROM ${table}`,
      )) as unknown[];
      type Pick = { total: number };
      const result = unwrapRows<Pick>(rows, table)[0];
      counts[table] = result?.total ?? 0;
    } catch (err) {
      const msg = (err as Error).message;
      log.warn('stats query failed', { table, error: msg });
      errors[table] = msg.slice(0, 200);
    }
  }

  let outboxPending: number | null = null;
  try {
    const rows = (await zcql(ctx.req).executeZCQLQuery(
      `SELECT COUNT(ROWID) AS total FROM OutboxEvents WHERE status = 'pending'`,
    )) as unknown[];
    type Pick = { total: number };
    const result = unwrapRows<Pick>(rows, 'OutboxEvents')[0];
    outboxPending = result?.total ?? 0;
  } catch (err) {
    const msg = (err as Error).message;
    log.warn('outbox pending count failed', { error: msg });
    errors['outbox_pending'] = msg.slice(0, 200);
  }

  log.info('admin stats served', {
    traceId: ctx.traceId,
    tables_ok: Object.keys(counts).length,
    tables_failed: Object.keys(errors).length,
  });
  sendJson(ctx.res, 200, {
    timestamp: new Date().toISOString(),
    table_counts: counts,
    outbox_pending: outboxPending,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  });
}

/**
 * Sanity ping a Anthropic. Manda un prompt mínimo, mide latency, y devuelve el resultado.
 * Útil para validar que la API key + créditos + circuit breaker funcionan después de deploy.
 *
 * Uso:
 *   curl -H "X-Internal-Key: $INTERNAL_API_KEY" $URL/admin/anthropic-ping
 */
export async function anthropicPing(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);

  const startedAt = Date.now();
  try {
    const response = await anthropicMessage({
      system: 'Responde solo con la palabra OK.',
      messages: [{ role: 'user', content: 'Test ping' }],
      maxTokens: 10,
      temperature: 0,
    }, ctx.traceId);

    const ms = Date.now() - startedAt;
    const text = extractText(response).trim();

    sendJson(ctx.res, 200, {
      ok: true,
      latency_ms: ms,
      model: response.model,
      stop_reason: response.stop_reason,
      response_text: text,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read: response.usage.cache_read_input_tokens ?? 0,
      },
    });
  } catch (err) {
    const ms = Date.now() - startedAt;
    const e = err as Error & { details?: unknown };
    const upstreamBody = (e.details && typeof e.details === 'object' && 'body' in e.details)
      ? String((e.details as { body: unknown }).body).slice(0, 800)
      : null;
    const upstreamStatus = (e.details && typeof e.details === 'object' && 'status' in e.details)
      ? (e.details as { status: unknown }).status
      : null;
    const { env } = await import('../lib/env.js');
    const envCfg = env();
    log.error('anthropic ping failed', {
      traceId: ctx.traceId,
      latency_ms: ms,
      error: e.message,
      upstream_status: upstreamStatus,
      upstream_body: upstreamBody,
    });
    sendJson(ctx.res, 502, {
      ok: false,
      latency_ms: ms,
      error: e.message,
      upstream_status: upstreamStatus,
      upstream_body: upstreamBody,
      model_configured: envCfg.ANTHROPIC_MODEL,
      api_key_fragment: envCfg.ANTHROPIC_API_KEY
        ? `${envCfg.ANTHROPIC_API_KEY.slice(0, 8)}...${envCfg.ANTHROPIC_API_KEY.slice(-4)}`
        : '<empty>',
    });
  }
}

/**
 * Lista las últimas N entries de AuditLog. Endpoint admin.
 *
 * Query params:
 *   - limit (default 100, max 500)
 *   - resource_type (opcional, filtro)
 *   - actor_user (opcional, filtro)
 *
 * Ordenado por created_at DESC (más recientes primero).
 */
export async function listAuditLog(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') ?? 100)));
  const resourceType = url.searchParams.get('resource_type')?.trim();
  const actorUser = url.searchParams.get('actor_user')?.trim();

  const filters: string[] = [];
  if (resourceType) {
    filters.push(`resource_type = '${resourceType.replace(/'/g, "''")}'`);
  }
  if (actorUser) {
    filters.push(`actor_user = '${actorUser.replace(/'/g, "''")}'`);
  }

  const where = filters.length > 0 ? ` WHERE ${filters.join(' AND ')}` : '';
  const query = `SELECT * FROM AuditLog${where} ORDER BY CREATEDTIME DESC LIMIT ${limit}`;

  type AuditRow = {
    ROWID: string;
    actor_user: string;
    action: string;
    resource_type: string;
    resource_id: string | null;
    changes: string | null;
    ip: string | null;
    user_agent: string | null;
    created_at: string;
  };

  try {
    const rows = unwrapRows<AuditRow>(
      (await zcql(ctx.req).executeZCQLQuery(query)) as unknown[],
      'AuditLog',
    );
    log.info('audit-log served', { traceId: ctx.traceId, count: rows.length, limit });
    sendJson(ctx.res, 200, {
      total: rows.length,
      limit,
      filters: { resource_type: resourceType ?? null, actor_user: actorUser ?? null },
      entries: rows,
    });
  } catch (err) {
    log.warn('audit-log query failed', { traceId: ctx.traceId, error: (err as Error).message });
    sendJson(ctx.res, 500, {
      error: { code: 'audit_query_failed', message: (err as Error).message },
    });
  }
}

/**
 * Lista eventos anti-trampa para análisis. Filtros: result_id (specific candidate)
 * o phase (tecnica/conductual/integridad).
 *
 *   GET /admin/anti-cheat?result_id=...&phase=...&limit=50
 */
export async function listAntiCheatEvents(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') ?? 100)));
  const resultId = url.searchParams.get('result_id')?.trim();
  const phase = url.searchParams.get('phase')?.trim();

  const filters: string[] = [];
  if (resultId) filters.push(`result_id = '${resultId.replace(/'/g, "''")}'`);
  if (phase) filters.push(`phase = '${phase.replace(/'/g, "''")}'`);
  const where = filters.length > 0 ? ` WHERE ${filters.join(' AND ')}` : '';

  type Row = {
    ROWID: string;
    result_id: string;
    phase: string;
    event_type: string;
    question_id: string | null;
    duration_ms: number | null;
    created_at: string;
  };

  try {
    const rows = unwrapRows<Row>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT * FROM AntiCheatEvents${where} ORDER BY CREATEDTIME DESC LIMIT ${limit}`,
      )) as unknown[],
      'AntiCheatEvents',
    );
    // Stats: count by event_type
    const byType: Record<string, number> = {};
    for (const r of rows) {
      byType[r.event_type] = (byType[r.event_type] ?? 0) + 1;
    }
    sendJson(ctx.res, 200, {
      events: rows,
      total: rows.length,
      filters: { result_id: resultId ?? null, phase: phase ?? null },
      counts_by_type: byType,
    });
  } catch (err) {
    log.warn('anti-cheat list failed', { error: (err as Error).message });
    sendJson(ctx.res, 503, {
      error: { code: 'table_not_ready', message: 'Tabla AntiCheatEvents no creada todavía (Block 2 §7)' },
    });
  }
}

/**
 * Genera un link firmado para el portal del cliente externo.
 *
 *   POST /admin/portals/issue
 *   { tenant_id, company, client_name, client_email, agency_name?, ttl_days? }
 *
 * Devuelve { token, path }. El path es relativo (`/portal/<token>`); el frontend
 * arma la URL final con su propio dominio.
 *
 * Como el portal NO es queryeable en BD (token autocontenido), revocar un link
 * puntual hoy requiere rotar URL_SIGNING_SECRET. Cuando se cree ClientPortals,
 * migrar a un esquema con revocación por ROWID.
 */
export async function issuePortalToken(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  const body = await readJsonBody<Record<string, unknown>>(ctx.req);

  const tenantId = typeof body.tenant_id === 'string' ? body.tenant_id.trim() : '';
  const company = typeof body.company === 'string' ? body.company.trim() : '';
  const clientName = typeof body.client_name === 'string' ? body.client_name.trim() : '';
  const clientEmail = typeof body.client_email === 'string' ? body.client_email.trim() : '';
  const agencyName = typeof body.agency_name === 'string' && body.agency_name.trim()
    ? body.agency_name.trim()
    : 'Kuno Digital';
  const ttlDays = Number.isFinite(body.ttl_days) ? Number(body.ttl_days) : 90;

  if (!tenantId) throw new ValidationError('tenant_id required');
  if (!company) throw new ValidationError('company required');
  if (!clientName) throw new ValidationError('client_name required');
  if (!clientEmail || !clientEmail.includes('@')) throw new ValidationError('client_email required');
  if (ttlDays < 1 || ttlDays > 365) throw new ValidationError('ttl_days must be 1..365');

  const token = signPortalToken({
    ref: tenantId,
    company,
    client_name: clientName,
    client_email: clientEmail,
    agency_name: agencyName,
    ttl_days: ttlDays,
  });

  log.info('portal token issued', {
    traceId: ctx.traceId,
    tenantId,
    company,
    ttl_days: ttlDays,
  });

  sendJson(ctx.res, 200, {
    token,
    path: `/portal/${token}`,
    expires_in_days: ttlDays,
  });
}

/**
 * Lista todos los templates de email disponibles, renderizados con valores de ejemplo
 * para preview en el dashboard admin.
 *
 *   GET /admin/email-templates?locale=es
 *
 * Devuelve cada template con subject/body_text/body_html renderizados, las variables
 * disponibles, y sample vars usadas para el preview.
 */
const SAMPLE_VARS: Record<string, string> = {
  candidate_name: 'Carolina Méndez',
  candidate_email: 'carolina@example.com',
  job_title: 'Gerente Comercial Senior',
  job_company: 'Banco Pacífico',
  test_link: 'https://app.sharktalents.ai/#/test/sample-token',
  next_link: 'https://app.sharktalents.ai/#/test/sample-token/conductual',
  expiry_days: '7',
  client_name: 'Roberto Castillo',
  agency_name: 'SharkTalents',
  portal_link: 'https://app.sharktalents.ai/#/portal/sample-token',
  report_link: 'https://app.sharktalents.ai/#/report/sample-token',
};

export async function listEmailTemplates(ctx: RequestContext): Promise<void> {
  // Templates no son sensibles — cualquier user autenticado del tenant puede previsualizar.
  // No usamos requireInternalKey acá (sería para ops); router pone auth='tenant'.
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const locale = (url.searchParams.get('locale') ?? 'es') as EmailLocale;
  if (locale !== 'es' && locale !== 'en') {
    throw new ValidationError('locale must be es or en');
  }

  const result = (Object.keys(TEMPLATES) as TemplateKey[]).map((key) => {
    const raw = getTemplate(key, locale);
    const rendered = renderTemplate(raw, SAMPLE_VARS);
    // Variables detectadas en el template (lista de placeholders {{var}} usados)
    const variables = new Set<string>();
    for (const text of [raw.subject, raw.body_text, raw.body_html]) {
      const matches = text.match(/\{\{(\w+)\}\}/g) ?? [];
      for (const m of matches) variables.add(m.slice(2, -2));
    }
    return {
      key,
      locale,
      raw: raw,
      rendered,
      variables: [...variables].sort(),
    };
  });

  sendJson(ctx.res, 200, {
    locale,
    sample_vars: SAMPLE_VARS,
    templates: result,
    count: result.length,
  });
}

/**
 * Admin metrics snapshot — counters + histograms in-memory.
 *
 *   GET /admin/metrics
 *   Headers: X-Internal-Key
 *
 * Para Grafana/Datadog: scrapearlo cada minuto. Los counters resetean en cold-start
 * de la function, así que sumarlos del lado del scraper. Para métricas históricas
 * persistentes, scrapeo + push a tabla Metrics o servicio externo.
 */
export async function getMetricsSnapshot(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  const { metrics } = await import('../lib/metrics.js');
  const snapshot = metrics.snapshot();
  sendJson(ctx.res, 200, {
    timestamp: new Date().toISOString(),
    uptime_sec: Math.round(process.uptime()),
    ...snapshot,
  });
}

/**
 * POST /api/admin/_force_recruit_sync/:resultId
 *
 * Re-emite el evento `sync.recruit` para un Result existente en su estado actual.
 * Útil cuando una transición ya pasó pero el publishRecruitSync silenciosamente
 * skipeó (ej. env vars mal alineadas — bug detectado 2026-06-03).
 *
 * Auth: E2E key admin (X-E2E-Test-Key) por simplicidad — agregar internal key si se hace productivo.
 */
export async function forceRecruitSync(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  // 2026-06-04 (security audit fix #3): scoping por tenant. Antes este endpoint pedía
  // requireAuth pero NO requireTenant ni chequeo del tenant del Result, así que un usuario
  // logueado podía manipular Results de otro cliente con solo conocer su ROWID.
  await requireTenant(ctx);

  const url = ctx.req.url ?? '';
  const m = url.match(/^\/api\/admin\/_force_recruit_sync\/([^/?]+)/);
  if (!m) {
    sendJson(ctx.res, 400, { error: 'resultId missing in path' });
    return;
  }
  const resultId = m[1];

  const { zcql } = await import('../lib/db.js');
  const { unwrapRows, escapeSql } = await import('../lib/dbHelpers.js');

  // Hacemos JOIN con Jobs para verificar el tenant del Job al que pertenece este Result.
  // Si el Result existe pero el tenant no matchea → 404 (mismo mensaje que "no encontrado",
  // no leak de "existe pero no es tuyo"). Si el Job no tiene tenant_id (legacy row),
  // permitimos pasar para no romper Results históricos sin migrar.
  const rows = unwrapRows<{ ROWID: string; candidate_id: string; assessment_id: string; pipeline_stage: string; job_tenant_id: string | null }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT r.ROWID, r.candidate_id, r.assessment_id, r.pipeline_stage, j.tenant_id AS job_tenant_id
       FROM Results r LEFT JOIN Jobs j ON r.assessment_id = j.ROWID
       WHERE r.ROWID = '${escapeSql(resultId)}' LIMIT 1`,
    )) as unknown[],
    'Results',
  );
  const result = rows[0];
  if (!result) {
    sendJson(ctx.res, 404, { error: 'Result not found' });
    return;
  }
  const callerTenantId = ctx.tenantId;
  if (result.job_tenant_id && callerTenantId && result.job_tenant_id !== callerTenantId) {
    // No leak: mismo 404 que arriba.
    log.warn('forceRecruitSync: cross-tenant attempt blocked', {
      traceId: ctx.traceId, resultId, callerTenantId, jobTenantId: result.job_tenant_id,
    });
    sendJson(ctx.res, 404, { error: 'Result not found' });
    return;
  }

  // Body opcional: { to_stage?, recruit_candidate_id?, recruit_application_id? }
  // - to_stage: forzar la transición en DB (salta state machine)
  // - recruit_candidate_id: setear el ID del candidato en Recruit en la fila de Candidates
  // - recruit_application_id: pasar al dispatcher para que llame el Deluge function de
  //   actualización de Application Status directamente
  let toStage = result.pipeline_stage;
  let setRecruitCandidateId: string | null = null;
  let recruitApplicationId: string | null = null;
  try {
    const body = await readJsonBody<{ to_stage?: string; recruit_candidate_id?: string; recruit_application_id?: string }>(ctx.req).catch(() => ({} as Record<string, string>));
    if (typeof body.to_stage === 'string' && body.to_stage.trim()) {
      toStage = body.to_stage.trim();
    }
    if (typeof body.recruit_candidate_id === 'string' && body.recruit_candidate_id.trim()) {
      setRecruitCandidateId = body.recruit_candidate_id.trim();
    }
    if (typeof body.recruit_application_id === 'string' && body.recruit_application_id.trim()) {
      recruitApplicationId = body.recruit_application_id.trim();
    }
  } catch { /* sin body, OK */ }

  // Si vino recruit_candidate_id, actualizar Candidates antes que nada
  if (setRecruitCandidateId && result.candidate_id) {
    const { datastore: ds } = await import('../lib/db.js');
    try {
      // Candidates table no tiene updated_at (verificado 2026-06-03: "Invalid column updated_at")
      await ds(ctx.req).table('Candidates').updateRow({
        ROWID: result.candidate_id,
        recruit_candidate_id: setRecruitCandidateId,
      });
    } catch (err) {
      // Capturar TODO del err sin asumir que es Error con .message
      const errAny = err as Record<string, unknown> | null;
      const errPayload = {
        message: errAny?.message ?? String(err),
        error_code: errAny?.error_code,
        error_message: errAny?.error_message,
        raw: JSON.stringify(err).slice(0, 500),
        type: typeof err,
        candidate_id: result.candidate_id,
        recruit_candidate_id: setRecruitCandidateId,
      };
      sendJson(ctx.res, 500, { error: 'failed to update recruit_candidate_id', err: errPayload });
      return;
    }
  }

  const { publishOutboxEvent } = await import('./outbox.js');
  const { now, datastore } = await import('../lib/db.js');

  // Si el to_stage difiere del actual, forzar la transición en DB
  if (toStage !== result.pipeline_stage) {
    await datastore(ctx.req).table('Results').updateRow({
      ROWID: result.ROWID,
      pipeline_stage: toStage,
      completed_at: now(),
    });
    await datastore(ctx.req).table('ResultTransitions').insertRow({
      result_id: result.ROWID,
      from_stage: result.pipeline_stage,
      to_stage: toStage,
      actor: 'admin_force_sync',
      reason: 'Forced via _force_recruit_sync admin endpoint',
      transitioned_at: now(),
    });
  }

  await publishOutboxEvent(ctx.req, 'sync.recruit', {
    action: 'transition',
    application_id: result.ROWID,
    job_id: result.assessment_id,
    tenant_id: '',
    from_stage: result.pipeline_stage,
    to_stage: toStage,
    actor: 'admin_force_sync',
    candidate_id: result.candidate_id,
    transitioned_at: now(),
    ...(recruitApplicationId ? { recruit_application_id: recruitApplicationId } : {}),
  });

  sendJson(ctx.res, 200, {
    ok: true,
    result_id: result.ROWID,
    previous_stage: result.pipeline_stage,
    new_stage: toStage,
    event_published: 'sync.recruit',
    note: 'Llamá POST /api/outbox/process-now para procesar el evento ahora.',
  });
}

/**
 * Diagnóstico: prueba insertRow en Candidates con valores controlados y devuelve
 * la respuesta o el error COMPLETO del SDK. Sirve para entender qué rechaza Catalyst
 * cuando los logs normales no muestran detalle suficiente.
 *
 * Uso:
 *   curl -X POST -H "X-Internal-Key: $K" \
 *     "https://.../api/admin/_diag-insert-candidate?table=Candidates&payload=basic"
 *
 * Query params:
 *   table   — Candidates (default) | Results
 *   payload — basic (email+name+created_at) | minimal (sin created_at) | name_only
 */
import { datastore, now as nowFn } from '../lib/db';
export async function diagInsertCandidate(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const table = url.searchParams.get('table') ?? 'Candidates';
  const variant = url.searchParams.get('payload') ?? 'basic';
  const seed = `diag${Date.now()}@test.sharktalents.ai`;

  let payload: Record<string, unknown> = {};
  if (table === 'Candidates') {
    if (variant === 'basic') payload = { email: seed, name: 'Diag Test', created_at: nowFn() };
    else if (variant === 'minimal') payload = { email: seed, name: 'Diag' };
    else if (variant === 'name_only') payload = { name: 'Diag' };
    else if (variant === 'with_phone') payload = { email: seed, name: 'Diag Test', phone: '+50712345678', created_at: nowFn() };
  } else if (table === 'Results') {
    payload = { tenant_id: 'diag', candidate_id: 'diag', assessment_id: 'diag', pipeline_stage: 'prefilter_pending', created_at: nowFn() };
  } else if (table === 'ProcessedEvents') {
    payload = { event_id: `diag_${Date.now()}`, provider: 'diag_test', processed_at: nowFn() };
  }

  try {
    const inserted = await datastore(ctx.req).table(table).insertRow(payload);
    sendJson(ctx.res, 200, { ok: true, table, variant, payload, inserted });
  } catch (err) {
    const e = err as { message?: string; code?: string; statusCode?: number; data?: unknown; toString?: () => string };
    sendJson(ctx.res, 200, {
      ok: false,
      table,
      variant,
      payload,
      error: {
        message: e.message,
        code: e.code,
        statusCode: e.statusCode,
        data: typeof e.data === 'object' ? JSON.stringify(e.data).slice(0, 1000) : String(e.data),
        string: String(err).slice(0, 1000),
        constructor: (err as Error)?.constructor?.name,
      },
    });
  }
}

/**
 * One-shot: adopta drafts huérfanos (tenant_id=null) al tenant especificado.
 * Necesario porque dispatchBriefingAutoDraft persistía con tenant_id=null hasta el
 * fix de 2026-06-05. Drafts viejos quedaron invisibles. Este endpoint los rescata.
 *
 * Uso:
 *   curl -X POST -H "X-Internal-Key: $K" \
 *     "https://.../admin/_adopt-orphan-drafts?to_tenant=28606000000783947"
 */
export async function adoptOrphanDrafts(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const toTenant = (url.searchParams.get('to_tenant') ?? '').trim();
  if (!toTenant) {
    sendJson(ctx.res, 400, { error: 'to_tenant query param required' });
    return;
  }
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20)));

  // Buscar drafts con tenant_id null o vacío.
  const rows = await zcql(ctx.req).executeZCQLQuery(
    `SELECT ROWID FROM JobProfileDrafts WHERE tenant_id IS NULL LIMIT ${limit}`,
  ) as Array<{ JobProfileDrafts?: { ROWID?: string } }>;
  const orphanIds = rows.map((r) => r.JobProfileDrafts?.ROWID).filter(Boolean) as string[];

  const adopted: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const id of orphanIds) {
    try {
      const { datastore } = await import('../lib/db.js');
      await datastore(ctx.req).table('JobProfileDrafts').updateRow({
        ROWID: id,
        tenant_id: toTenant,
        updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      });
      adopted.push(id);
    } catch (err) {
      failed.push({ id, error: (err as Error).message });
    }
  }
  sendJson(ctx.res, 200, {
    to_tenant: toTenant,
    found: orphanIds.length,
    adopted: adopted.length,
    failed: failed.length,
    adopted_ids: adopted,
    failures: failed,
  });
}

/**
 * Lista las últimas alertas de SystemAlerts (cualquier severity), útil para diagnosticar
 * problemas recientes — incluye el `context` que tiene los datos del evento que falló.
 *
 * Uso:
 *   curl -H "X-Internal-Key: $K" "https://.../api/admin/_diag-recent-alerts?limit=10"
 *   curl -H "X-Internal-Key: $K" "https://.../api/admin/_diag-recent-alerts?code=recruit"
 */
export async function diagRecentAlerts(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  try {
    const url = new URL(ctx.req.url ?? '/', 'http://x');
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit') ?? 10)));
    const codeFilter = url.searchParams.get('code') ?? '';

    const { escapeSql } = await import('../lib/dbHelpers.js');
    const where = codeFilter ? `WHERE code LIKE '%${escapeSql(codeFilter)}%'` : '';
    type AlertRow = {
      ROWID: string;
      severity: string;
      code: string;
      message: string;
      context: string | null;
      resource_type: string | null;
      resource_id: string | null;
      created_at: string;
      occurrence_count: number;
    };
    const rows = unwrapRows<AlertRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, severity, code, message, context, resource_type, resource_id, created_at, occurrence_count
         FROM SystemAlerts ${where} ORDER BY CREATEDTIME DESC LIMIT ${limit}`,
      )) as unknown[],
      'SystemAlerts',
    );
    sendJson(ctx.res, 200, {
      count: rows.length,
      alerts: rows.map((r) => ({
        ROWID: r.ROWID,
        severity: r.severity,
        code: r.code,
        message: r.message,
        context: r.context ? (() => { try { return JSON.parse(r.context); } catch { return r.context; } })() : null,
        resource_type: r.resource_type,
        resource_id: r.resource_id,
        created_at: r.created_at,
        occurrence_count: r.occurrence_count,
      })),
    });
  } catch (err) {
    sendJson(ctx.res, 500, { error: (err as Error).message });
  }
}

/**
 * Crea un Candidate + Result (Application) para un Job y devuelve testToken/URL.
 * Para spec B (10 candidatos hacen los tests) — sin auth tenant.
 *
 * Uso:
 *   curl -X POST -H "X-Internal-Key: $K" -H "Content-Type: application/json" \
 *     -d '{"job_id":"...","email":"foo@bar.com","name":"Foo Test","level":"bueno"}' \
 *     "https://.../api/admin/_diag-create-test-candidate"
 *
 *   level: 'bueno' | 'medio' | 'malo' — guardado en candidate como metadata
 *   solo para tracking del spec; no afecta lógica del backend.
 */
export async function diagCreateTestCandidate(ctx: RequestContext): Promise<void> {
  log.info('diag-create-test-candidate: start');
  try {
    requireInternalKey(ctx);
    const body = await readJsonBody<{
      job_id: string;
      email: string;
      name?: string;
      level?: 'bueno' | 'medio' | 'malo';
    }>(ctx.req);
    if (!body.job_id) throw new ValidationError('job_id required');
    if (!body.email) throw new ValidationError('email required');

    const { escapeSql } = await import('../lib/dbHelpers.js');
    const { datastore, now } = await import('../lib/db.js');
    const { env } = await import('../lib/env.js');

    // 1. Buscar el Job para sacar tenant_id.
    type JobRow = { ROWID: string; tenant_id: string; title: string };
    const jobs = unwrapRows<JobRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, tenant_id, title FROM Jobs WHERE ROWID = '${escapeSql(body.job_id)}' LIMIT 1`,
      )) as unknown[],
      'Jobs',
    );
    const job = jobs[0];
    if (!job) {
      sendJson(ctx.res, 404, { error: 'Job not found' });
      return;
    }
    const tenantId = job.tenant_id;
    const email = body.email.trim().toLowerCase();
    const name = (body.name ?? email.split('@')[0]).slice(0, 255);

    // 2. Buscar Candidate por email + tenant; si no existe crearlo.
    type CandRow = { ROWID: string };
    const existing = unwrapRows<CandRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM Candidates WHERE email = '${escapeSql(email)}' AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`,
      )) as unknown[],
      'Candidates',
    );
    let candidateId: string;
    if (existing[0]) {
      candidateId = existing[0].ROWID;
    } else {
      const inserted = await datastore(ctx.req).table('Candidates').insertRow({
        tenant_id: tenantId,
        email,
        name,
        source: `e2e_spec_b_${body.level ?? 'unknown'}`,
        created_at: now(),
        updated_at: now(),
      });
      const row = unwrapRows<{ ROWID: string }>([inserted as unknown], 'Candidates')[0];
      if (!row) throw new Error('Candidate insert returned null');
      candidateId = row.ROWID;
    }

    // 3. Crear Result (Application).
    const resultInserted = await datastore(ctx.req).table('Results').insertRow({
      tenant_id: tenantId,
      candidate_id: candidateId,
      assessment_id: job.ROWID,
      pipeline_stage: 'prefilter_pending',
      score_total: 0,
      created_at: now(),
      updated_at: now(),
    });
    const resultRow = unwrapRows<{ ROWID: string }>([resultInserted as unknown], 'Results')[0];
    if (!resultRow) throw new Error('Results insert returned null');
    const resultId = resultRow.ROWID;

    // 4. Firmar testToken (mismo patrón que marketing.ts:457).
    const { signToken, expiresIn, WEEK_SEC } = await import('../lib/urlSigning.js');
    const testToken = signToken({ kind: 'test', ref: resultId, exp: expiresIn(WEEK_SEC) });
    const e = env();
    const testUrl = `${e.APP_BASE_URL.replace(/\/$/, '')}/app/index.html#/test/${testToken}`;

    sendJson(ctx.res, 200, {
      candidate_id: candidateId,
      result_id: resultId,
      job_id: job.ROWID,
      job_title: job.title,
      test_token: testToken,
      test_url: testUrl,
      level: body.level ?? 'unknown',
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      sendJson(ctx.res, 400, { error: err.message });
      return;
    }
    const e = err as Error;
    log.error('diag-create-test-candidate: ERROR', { message: e.message, stack: e.stack?.slice(0, 500) });
    sendJson(ctx.res, 500, { error: e.message });
  }
}

/**
 * Lista todos los jobs activos (para que Playwright los itere en generación de preguntas).
 * Igual que el otro `_diag-publish-test-jobs` con dry_run, pero más simple.
 *
 * Uso:
 *   curl -H "X-Internal-Key: $K" "https://.../api/admin/_diag-list-jobs?title_prefix="
 */
export async function diagListJobs(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  try {
    const url = new URL(ctx.req.url ?? '/', 'http://x');
    const titlePrefix = url.searchParams.get('title_prefix') ?? '';
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit') ?? 20)));
    const { escapeSql } = await import('../lib/dbHelpers.js');
    const whereTitle = titlePrefix.length > 0 ? `AND title LIKE '${escapeSql(titlePrefix)}%'` : '';
    type Row = {
      ROWID: string; title: string; company: string; cognitive_level: string;
      tech_prompt: string | null; is_active: boolean;
      prescreening_questions_cache: string | null; tech_questions_cache: string | null;
    };
    const rows = unwrapRows<Row>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, title, company, cognitive_level, tech_prompt, is_active,
                prescreening_questions_cache, tech_questions_cache
         FROM Jobs WHERE is_active = true ${whereTitle}
         ORDER BY CREATEDTIME DESC LIMIT ${limit}`,
      )) as unknown[],
      'Jobs',
    );
    sendJson(ctx.res, 200, {
      count: rows.length,
      jobs: rows.map((j) => ({
        id: j.ROWID,
        title: j.title,
        company: j.company,
        cognitive_level: j.cognitive_level,
        has_tech_prompt: !!(j.tech_prompt && j.tech_prompt.trim().length > 0),
        has_prefilter_cache: !!j.prescreening_questions_cache,
        has_tech_cache: !!j.tech_questions_cache,
      })),
    });
  } catch (err) {
    sendJson(ctx.res, 500, { error: (err as Error).message });
  }
}

/**
 * Para diagnostico de CALIDAD: genera prefiltro + técnica para un Job y devuelve
 * ambas listas. Para que Chris (o Claude) revise si las preguntas tienen sentido.
 *
 * Uso:
 *   curl -X POST -H "X-Internal-Key: $K" -H "Content-Type: application/json" \
 *     -d '{"job_id":"28606..."}' "https://.../api/admin/_diag-generate-questions-for-job"
 *
 *   Si job_id NO se manda, usa el último Job creado.
 */
export async function diagGenerateQuestionsForJob(ctx: RequestContext): Promise<void> {
  log.info('diag-generate-questions-for-job: start');
  try {
    requireInternalKey(ctx);
    const body = await readJsonBody<{ job_id?: string }>(ctx.req).catch(() => ({} as Record<string, unknown>));
    const { escapeSql } = await import('../lib/dbHelpers.js');
    const { datastore, now } = await import('../lib/db.js');

    // 1. Encontrar el Job (por id o el último).
    type JobRow = {
      ROWID: string; tenant_id: string; title: string; company: string;
      tech_prompt: string | null; cognitive_level: string;
      prescreening_questions_cache: string | null; tech_questions_cache: string | null;
    };
    let jobs: JobRow[] = [];
    if (typeof body.job_id === 'string' && body.job_id) {
      jobs = unwrapRows<JobRow>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT ROWID, tenant_id, title, company, tech_prompt, cognitive_level, prescreening_questions_cache, tech_questions_cache
           FROM Jobs WHERE ROWID = '${escapeSql(body.job_id)}' LIMIT 1`,
        )) as unknown[],
        'Jobs',
      );
    } else {
      jobs = unwrapRows<JobRow>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT ROWID, tenant_id, title, company, tech_prompt, cognitive_level, prescreening_questions_cache, tech_questions_cache
           FROM Jobs WHERE is_active = true ORDER BY CREATEDTIME DESC LIMIT 1`,
        )) as unknown[],
        'Jobs',
      );
    }
    const job = jobs[0];
    if (!job) {
      sendJson(ctx.res, 404, { error: 'No job found' });
      return;
    }
    if (!job.tech_prompt || !job.tech_prompt.trim()) {
      sendJson(ctx.res, 400, { error: 'job has no tech_prompt — cannot generate questions', job_id: job.ROWID, title: job.title });
      return;
    }
    log.info('diag-generate-questions-for-job: target job', { job_id: job.ROWID, title: job.title });

    // Para no exceder el timeout del LB Zoho (~30s), procesamos UN tipo por call.
    // Body: { job_id, type: 'prefilter' | 'tech' }
    // Default 'prefilter' si no viene.
    const typeRaw = typeof (body as Record<string, unknown>).type === 'string' ? (body as Record<string, string>).type : 'prefilter';
    const type = typeRaw === 'tech' ? 'tech' : 'prefilter';
    const { publishAndProcessEvent } = await import('./outbox.js');
    const { loadLargeJson } = await import('../lib/largeContentStore.js');

    // Marcar pending el cache que vamos a regenerar.
    const cacheField = type === 'prefilter' ? 'prescreening_questions_cache' : 'tech_questions_cache';
    await datastore(ctx.req).table('Jobs').updateRow({
      ROWID: job.ROWID,
      [cacheField]: JSON.stringify({ status: 'pending', queued_at: now() }),
      updated_at: now(),
    });

    // Procesar inline. Si timeout, queda en outbox como pending para retry cron.
    if (type === 'prefilter') {
      await publishAndProcessEvent(ctx.req, 'job.generate_prescreening_questions', {
        tenant_id: job.tenant_id,
        job_id: job.ROWID,
        tech_prompt: job.tech_prompt,
        job_title: job.title,
        job_company: job.company,
      });
    } else {
      await publishAndProcessEvent(ctx.req, 'job.generate_tech_questions', {
        tenant_id: job.tenant_id,
        job_id: job.ROWID,
        count: 15,
        tech_prompt: job.tech_prompt,
        job_title: job.title,
        job_company: job.company,
        cognitive_level: job.cognitive_level,
      });
    }
    log.info('diag-generate-questions-for-job: generation done', { type });

    // Recargar para devolver lo generado.
    const reloaded = unwrapRows<JobRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, tenant_id, title, company, tech_prompt, cognitive_level, prescreening_questions_cache, tech_questions_cache
         FROM Jobs WHERE ROWID = '${escapeSql(job.ROWID)}' LIMIT 1`,
      )) as unknown[],
      'Jobs',
    )[0];

    const cacheRaw = type === 'prefilter' ? reloaded?.prescreening_questions_cache : reloaded?.tech_questions_cache;
    let questions: unknown = null;
    if (cacheRaw) {
      try {
        if (cacheRaw.startsWith('file:')) {
          questions = await loadLargeJson(ctx.req, cacheRaw);
        } else {
          questions = JSON.parse(cacheRaw);
        }
      } catch (parseErr) {
        questions = { error: 'parse failed', raw: cacheRaw.slice(0, 500) };
      }
    }

    sendJson(ctx.res, 200, {
      job: {
        id: job.ROWID,
        title: job.title,
        company: job.company,
        cognitive_level: job.cognitive_level,
        tech_prompt_preview: job.tech_prompt.slice(0, 300),
      },
      type,
      questions,
    });
  } catch (err) {
    const e = err as Error;
    log.error('diag-generate-questions-for-job: ERROR', { message: e.message, stack: e.stack?.slice(0, 500) });
    sendJson(ctx.res, 500, { error: e.message, stack: e.stack?.slice(0, 500) });
  }
}

/**
 * Consulta el cache de prefiltro + técnica para un Job. Útil después de disparar
 * `_diag-generate-questions-for-job` (que es fire-and-forget).
 *
 * Uso:
 *   curl -H "X-Internal-Key: $K" "https://.../api/admin/_diag-get-questions-for-job?job_id=28606..."
 */
export async function diagGetQuestionsForJob(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  try {
    const url = new URL(ctx.req.url ?? '/', 'http://x');
    const jobId = url.searchParams.get('job_id') ?? '';
    if (!jobId) {
      sendJson(ctx.res, 400, { error: 'job_id query param required' });
      return;
    }
    const { escapeSql } = await import('../lib/dbHelpers.js');
    type Row = {
      ROWID: string; title: string; company: string; cognitive_level: string;
      tech_prompt: string | null;
      prescreening_questions_cache: string | null; tech_questions_cache: string | null;
    };
    const rows = unwrapRows<Row>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, title, company, cognitive_level, tech_prompt, prescreening_questions_cache, tech_questions_cache
         FROM Jobs WHERE ROWID = '${escapeSql(jobId)}' LIMIT 1`,
      )) as unknown[],
      'Jobs',
    );
    const job = rows[0];
    if (!job) {
      sendJson(ctx.res, 404, { error: 'job not found' });
      return;
    }

    const { loadLargeJson } = await import('../lib/largeContentStore.js');
    const parseCache = async (raw: string | null): Promise<unknown> => {
      if (!raw) return null;
      try {
        if (raw.startsWith('file:')) {
          return await loadLargeJson(ctx.req, raw);
        }
        return JSON.parse(raw);
      } catch {
        return { error: 'parse failed', raw: raw.slice(0, 500) };
      }
    };

    const prefilter = await parseCache(job.prescreening_questions_cache);
    const tech = await parseCache(job.tech_questions_cache);

    sendJson(ctx.res, 200, {
      job: { id: job.ROWID, title: job.title, company: job.company, cognitive_level: job.cognitive_level },
      tech_prompt_preview: job.tech_prompt?.slice(0, 300) ?? null,
      prefilter,
      tech,
    });
  } catch (err) {
    sendJson(ctx.res, 500, { error: (err as Error).message });
  }
}

/**
 * Diag: devuelve scores + ideal_profile del Job + similarity calculada para
 * un application_id. Permite ver dónde rompe el cálculo de DISC/VELNA similarity.
 *
 *   curl -H "X-Internal-Key: $K" "https://.../api/admin/_diag-get-scores?application_id=28606..."
 */
export async function diagGetScores(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  try {
    const url = new URL(ctx.req.url ?? '/', 'http://x');
    const applicationId = url.searchParams.get('application_id') ?? '';
    if (!applicationId) {
      sendJson(ctx.res, 400, { error: 'application_id query param required' });
      return;
    }
    const { escapeSql } = await import('../lib/dbHelpers.js');

    const resRows = unwrapRows<{ ROWID: string; assessment_id: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, assessment_id FROM Results WHERE ROWID = '${escapeSql(applicationId)}' LIMIT 1`,
      )) as unknown[],
      'Results',
    );
    const result = resRows[0];
    if (!result) {
      sendJson(ctx.res, 404, { error: 'application not found' });
      return;
    }

    const scoresRows = unwrapRows<Record<string, unknown>>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT * FROM Scores WHERE result_id = '${escapeSql(applicationId)}' LIMIT 1`,
      )) as unknown[],
      'Scores',
    );
    const scores = scoresRows[0] ?? null;

    const jobRows = unwrapRows<{ ROWID: string; ideal_profile: string | null }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, ideal_profile FROM Jobs WHERE ROWID = '${escapeSql(result.assessment_id)}' LIMIT 1`,
      )) as unknown[],
      'Jobs',
    );
    const job = jobRows[0];
    let idealProfile: Record<string, unknown> | null = null;
    if (job?.ideal_profile) {
      try {
        idealProfile = JSON.parse(job.ideal_profile) as Record<string, unknown>;
      } catch {
        idealProfile = { error: 'parse failed', raw: job.ideal_profile.slice(0, 300) };
      }
    }

    // Intentar calcular similitud DISC manualmente para ver dónde rompe.
    // Catalyst devuelve int como string ("83" en vez de 83) — toleramos ambos.
    const toNum = (v: unknown): number | null => {
      if (v == null) return null;
      if (typeof v === 'number') return Number.isFinite(v) ? v : null;
      if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    };
    let discCalc: Record<string, unknown> = { status: 'not attempted' };
    if (scores && idealProfile) {
      const discIdeal = (idealProfile as { disc?: { d?: number; i?: number; s?: number; c?: number } }).disc;
      const sd = toNum(scores.disc_norm_d), si = toNum(scores.disc_norm_i);
      const ss = toNum(scores.disc_norm_s), sc = toNum(scores.disc_norm_c);
      discCalc = {
        candidate_disc_norm: { d: sd, i: si, s: ss, c: sc },
        ideal_disc: discIdeal ?? null,
      };
      if (discIdeal && sd !== null && si !== null && ss !== null && sc !== null) {
        const { calculateDiscSimilarity } = await import('../lib/scoring.js');
        const sim = calculateDiscSimilarity(
          { d: sd, i: si, s: ss, c: sc },
          { d: discIdeal.d ?? 0, i: discIdeal.i ?? 0, s: discIdeal.s ?? 0, c: discIdeal.c ?? 0 },
        );
        discCalc.calculated_similarity_pct = sim;
      } else {
        discCalc.reason_no_calc = !discIdeal
          ? 'ideal_profile.disc missing'
          : 'candidate disc_norm fields missing or invalid';
      }
    }

    sendJson(ctx.res, 200, {
      application_id: applicationId,
      job_id: result.assessment_id,
      scores_completed_at: {
        disc: scores?.disc_completed_at ?? null,
        velna: scores?.velna_completed_at ?? null,
        emo: scores?.emo_completed_at ?? null,
        int: scores?.int_completed_at ?? null,
        tec: scores?.tec_completed_at ?? null,
      },
      ideal_profile: idealProfile,
      disc_calc_debug: discCalc,
    });
  } catch (err) {
    sendJson(ctx.res, 500, { error: (err as Error).message });
  }
}

/**
 * Diag: dispara un WhatsApp de prueba usando el dispatcher (Twilio o Meta según env).
 *
 *   curl -X POST -H "X-Internal-Key: $K" -H "Content-Type: application/json" \
 *     -d '{"to":"+50763333870","body":"Hola desde el backend"}' \
 *     "https://.../api/admin/_diag-send-whatsapp"
 *
 * Útil para validar end-to-end de la integración Twilio Sandbox sin tener que crear
 * un outbox event. NO usa el outbox — llama directo a sendText.
 */
export async function diagSendWhatsApp(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  try {
    const body = await readJsonBody<{ to?: string; body?: string }>(ctx.req);
    if (!body.to || !body.body) {
      sendJson(ctx.res, 400, { error: 'to and body required' });
      return;
    }
    const { sendText } = await import('../lib/whatsappDispatcher.js');
    const result = await sendText({ to_phone: body.to, body: body.body }, ctx.traceId);
    if (!result.ok) {
      sendJson(ctx.res, 500, { ok: false, error: result.error });
      return;
    }
    sendJson(ctx.res, 200, {
      ok: true,
      message_id: result.data.message_id,
      status: result.data.status,
      provider: (process.env.WHATSAPP_PROVIDER ?? 'twilio').toLowerCase(),
    });
  } catch (err) {
    sendJson(ctx.res, 500, { error: (err as Error).message });
  }
}

/**
 * Backfill del campo `recruit_job_slug` (ZR_XX_JOB) para Jobs que ya tienen
 * `recruit_job_id` poblado pero el slug NULL. Sin esto, el webhook de Recruit
 * (que envía el slug, no el bigint) no encuentra el Job y dispara alerta
 * `job_unknown` cuando entra un candidato.
 *
 * Uso:
 *   curl -X POST -H "X-Internal-Key: $K" -H "Content-Type: application/json" \
 *     -d '{"max":20}' "https://.../api/admin/_diag-backfill-recruit-slugs"
 */
export async function diagBackfillRecruitSlugs(ctx: RequestContext): Promise<void> {
  log.info('diag-backfill-recruit-slugs: start');
  try {
    requireInternalKey(ctx);
    const body = await readJsonBody<{ max?: number }>(ctx.req).catch(() => ({} as Record<string, unknown>));
    const maxJobs = typeof body.max === 'number' ? Math.min(body.max, 50) : 20;

    const { datastore, now } = await import('../lib/db.js');
    const { getZohoAuthHeader } = await import('../lib/zohoOAuth.js');
    const { fetchWithTimeout } = await import('../lib/fetchWithTimeout.js');

    type JobRow = { ROWID: string; title: string; recruit_job_id: string; recruit_job_slug: string | null };
    const jobs = unwrapRows<JobRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, title, recruit_job_id, recruit_job_slug FROM Jobs
         WHERE recruit_job_id IS NOT NULL
           AND (recruit_job_slug IS NULL OR recruit_job_slug LIKE '756144%')
         ORDER BY CREATEDTIME DESC LIMIT ${maxJobs}`,
      )) as unknown[],
      'Jobs',
    );

    // Si recruit_job_slug está con el bigint mal guardado, primero lo limpiamos.
    for (const job of jobs) {
      if (job.recruit_job_slug && job.recruit_job_slug.startsWith('756144')) {
        try {
          await datastore(ctx.req).table('Jobs').updateRow({
            ROWID: job.ROWID,
            recruit_job_slug: null,
            updated_at: now(),
          });
        } catch { /* best-effort */ }
      }
    }
    log.info('diag-backfill-recruit-slugs: jobs to backfill', { count: jobs.length });

    const results: Array<Record<string, unknown>> = [];
    const auth = await getZohoAuthHeader(ctx.traceId ?? 'admin-diag');
    if (!auth) {
      sendJson(ctx.res, 503, { error: 'Zoho OAuth no disponible (chequear ZOHO_OAUTH_REFRESH_TOKEN + scope ZohoRecruit)' });
      return;
    }

    for (const job of jobs) {
      try {
        const res = await fetchWithTimeout(
          `https://recruit.zoho.com/recruit/v2/Job_Openings/${job.recruit_job_id}`,
          { headers: { Authorization: auth, Accept: 'application/json' }, timeoutMs: 10_000 },
        );
        const responseText = await res.text();
        const data = JSON.parse(responseText) as Record<string, unknown> | null;
        // Recruit v2 envuelve en {data: [{...}]}. Buscamos SOLO Job_Opening_Id (el slug ZR_XX_JOB),
        // no caemos al `id` que es el bigint duplicado.
        const dataArr = (data?.data ?? data) as Array<Record<string, unknown>> | undefined;
        const first = Array.isArray(dataArr) ? dataArr[0] : undefined;
        const slug = (first?.Job_Opening_Id as string | undefined) ?? null;
        // Modo diagnóstico: devolvemos siempre los top keys + sample del first para saber
        // dónde está realmente el slug (puede ser otro campo según versión API).
        const sample = first ? Object.fromEntries(Object.entries(first).slice(0, 20)) : null;
        if (!slug) {
          results.push({
            job_id: job.ROWID,
            title: job.title,
            status: 'no_slug_returned',
            http_status: res.status,
            response_keys: data ? Object.keys(data).slice(0, 15) : [],
            first_keys: first ? Object.keys(first).slice(0, 40) : [],
            sample_first: JSON.stringify(sample).slice(0, 1500),
          });
          continue;
        }
        await datastore(ctx.req).table('Jobs').updateRow({
          ROWID: job.ROWID,
          recruit_job_slug: slug,
          updated_at: now(),
        });
        results.push({ job_id: job.ROWID, title: job.title, status: 'backfilled', recruit_job_slug: slug });
      } catch (err) {
        results.push({ job_id: job.ROWID, title: job.title, status: 'error', error: (err as Error).message });
      }
    }

    const summary = {
      total_found: jobs.length,
      backfilled: results.filter((r) => r.status === 'backfilled').length,
      errors: results.filter((r) => r.status === 'error' || r.status === 'no_slug_returned').length,
    };
    log.info('diag-backfill-recruit-slugs: done', summary);
    sendJson(ctx.res, 200, { summary, results });
  } catch (err) {
    const e = err as Error;
    log.error('diag-backfill-recruit-slugs: ERROR', { message: e.message });
    sendJson(ctx.res, 500, { error: e.message });
  }
}

/**
 * Publica en bulk los Jobs creados por los tests E2E a Zoho Recruit. Misma lógica
 * que `retryRecruitSync` pero sin auth de Clerk + itera múltiples Jobs a la vez.
 *
 * Busca Jobs por filtro (default: últimas 24h, sin `recruit_job_id`, título que
 * empiece con "Gerente Comercial" — patrón típico de los tests E2E).
 *
 * Uso:
 *   curl -X POST -H "X-Internal-Key: $K" -H "Content-Type: application/json" \
 *     -d '{"title_prefix":"Gerente Comercial","hours_back":24,"max":10,"dry_run":false}' \
 *     "https://.../api/admin/_diag-publish-test-jobs"
 *
 * Si `dry_run: true` solo lista qué Jobs publicaría sin pegarle a Recruit.
 */
export async function diagPublishTestJobs(ctx: RequestContext): Promise<void> {
  log.info('diag-publish-test-jobs: start');
  try {
    requireInternalKey(ctx);
    log.info('diag-publish-test-jobs: auth ok');

    const body = await readJsonBody<{
      title_prefix?: string;
      hours_back?: number;
      max?: number;
      dry_run?: boolean;
    }>(ctx.req).catch(() => ({} as Record<string, unknown>));
    const titlePrefix = typeof body.title_prefix === 'string' ? body.title_prefix : 'Gerente Comercial';
    const maxJobs = typeof body.max === 'number' ? Math.min(body.max, 20) : 10;
    const dryRun = body.dry_run === true;
    log.info('diag-publish-test-jobs: body parsed', { titlePrefix, maxJobs, dryRun });

    const { escapeSql } = await import('../lib/dbHelpers.js');
    const { datastore, now } = await import('../lib/db.js');
    log.info('diag-publish-test-jobs: imports ok');

    type JobRow = {
      ROWID: string;
      tenant_id: string;
      title: string;
      company: string | null;
      recruit_job_id: string | null;
      recruit_job_slug: string | null;
      company_context: string | null;
    };
    // No filtramos por created_at (Catalyst rechaza datetime con T/Z). Solo
    // ordenamos por CREATEDTIME desc para que los más recientes salgan primero.
    // Si title_prefix viene vacío, no aplicamos filtro de título (LIKE '' no matchea
    // todo en Catalyst, devuelve 0 rows).
    const whereClause = titlePrefix.length > 0
      ? `WHERE title LIKE '${escapeSql(titlePrefix)}%'`
      : '';
    const sqlQuery = `SELECT ROWID, tenant_id, title, company, recruit_job_id, recruit_job_slug, company_context FROM Jobs ${whereClause} ORDER BY CREATEDTIME DESC LIMIT ${maxJobs}`;
    log.info('diag-publish-test-jobs: query built', { sql: sqlQuery.slice(0, 200) });
    const jobs = unwrapRows<JobRow>(
      (await zcql(ctx.req).executeZCQLQuery(sqlQuery)) as unknown[],
      'Jobs',
    );
    log.info('diag-publish-test-jobs: found jobs', { count: jobs.length });

    const results: Array<Record<string, unknown>> = [];
    const { isZohoRecruitConfigured, createRecruitJobOpening } = await import('../lib/zohoRecruitClient.js');

    if (!isZohoRecruitConfigured() && !dryRun) {
      sendJson(ctx.res, 503, { error: 'Zoho Recruit not configured (faltan ZOHO_OAUTH_*)' });
      return;
    }

    for (const job of jobs) {
      if (job.recruit_job_id) {
        results.push({
          job_id: job.ROWID,
          title: job.title,
          status: 'already_synced',
          recruit_job_id: job.recruit_job_id,
          recruit_job_slug: job.recruit_job_slug,
        });
        continue;
      }
      if (dryRun) {
        results.push({ job_id: job.ROWID, title: job.title, company: job.company, status: 'would_publish' });
        continue;
      }
      try {
        const result = await createRecruitJobOpening({
          Job_Opening_Name: job.title,
          Posting_Title: job.title,
          Client_Name: job.company || 'Cliente Test',
          Job_Description: job.company_context ?? `Puesto E2E test — ${job.title} @ ${job.company}`,
          Industry: 'Tecnología',
          Job_Opening_Status: 'In-progress',
          customFields: {
            Publish: true,
            Keep_on_Career_Site: true,
            City: 'Ciudad de Panamá',
            State: 'Panamá',
            Country: 'Panama',
            Remote_Job: false,
            Date_Opened: new Date().toISOString().slice(0, 10),
            Zip_Code: '0000',
          },
        }, ctx.traceId);
        if (!result.ok) {
          results.push({ job_id: job.ROWID, title: job.title, status: 'error', error: result.error });
          continue;
        }
        // Recruit puede devolver el id en varios shapes (mismo patrón tolerante que syncJobToRecruit).
        const respData = result.data as unknown as Record<string, unknown>;
        const dataArr = (respData?.data ?? respData) as Array<Record<string, unknown>> | undefined;
        const first = Array.isArray(dataArr) ? dataArr[0] : undefined;
        const details = (first?.details ?? {}) as Record<string, unknown>;
        const recruitId = String(
          (details.id as string | undefined) ??
          (first?.id as string | undefined) ??
          (first?.Job_Opening_Id as string | undefined) ??
          ''
        );
        if (!recruitId) {
          results.push({
            job_id: job.ROWID,
            title: job.title,
            status: 'no_id_returned',
            raw_response: JSON.stringify(result.data).slice(0, 800),
          });
          continue;
        }
        // Obtener el slug humano (Job_Opening_Id = ZR_XX_JOB) para webhooks de Recruit.
        let slug: string | null = null;
        try {
          const { getZohoAuthHeader } = await import('../lib/zohoOAuth.js');
          const { fetchWithTimeout } = await import('../lib/fetchWithTimeout.js');
          const auth = await getZohoAuthHeader(ctx.traceId);
          if (auth) {
            const slugRes = await fetchWithTimeout(
              `https://recruit.zoho.com/recruit/v2/Job_Openings/${recruitId}`,
              { headers: { Authorization: auth, Accept: 'application/json' }, timeoutMs: 10_000 },
            );
            const slugData = await slugRes.json().catch(() => null) as { data?: Array<{ Job_Opening_Id?: string }> } | null;
            slug = slugData?.data?.[0]?.Job_Opening_Id ?? null;
          }
        } catch { /* slug es nice-to-have, no critical */ }

        // Update Jobs.recruit_job_id (+ slug si lo obtuvimos) en SharkTalents.
        const patch: Record<string, unknown> = {
          ROWID: job.ROWID,
          recruit_job_id: recruitId,
          updated_at: now(),
        };
        if (slug) patch.recruit_job_slug = slug;
        await datastore(ctx.req).table('Jobs').updateRow(patch as { ROWID: string });
        results.push({ job_id: job.ROWID, title: job.title, status: 'published', recruit_job_id: recruitId, recruit_job_slug: slug });
      } catch (err) {
        results.push({ job_id: job.ROWID, title: job.title, status: 'exception', error: (err as Error).message });
      }
    }

    const summary = {
      total_found: jobs.length,
      already_synced: results.filter((r) => r.status === 'already_synced').length,
      published: results.filter((r) => r.status === 'published').length,
      errors: results.filter((r) => r.status === 'error' || r.status === 'exception' || r.status === 'no_id_returned').length,
      would_publish: results.filter((r) => r.status === 'would_publish').length,
    };
    log.info('diag-publish-test-jobs: done', summary);
    sendJson(ctx.res, 200, { dry_run: dryRun, summary, results });
  } catch (err) {
    // Catalyst a veces tira objetos planos en vez de Error — serializamos todo.
    const e = err as Error;
    const errAny = err as Record<string, unknown>;
    const fullErr = {
      message: e?.message,
      name: e?.name,
      stack: e?.stack?.slice(0, 800),
      typeof_err: typeof err,
      raw_keys: errAny ? Object.keys(errAny).slice(0, 30) : [],
      raw_serialized: JSON.stringify(errAny, Object.getOwnPropertyNames(errAny ?? {})).slice(0, 1500),
    };
    log.error('diag-publish-test-jobs: ERROR', fullErr);
    sendJson(ctx.res, 500, fullErr);
  }
}

/**
 * Genera un draft con Anthropic desde un transcript mock. Misma lógica que
 * `uploadBriefingTranscript` pero sin auth de Clerk (usa internal key), pensado
 * para tests E2E que necesitan disparar el draft con IA real.
 *
 * Pasos:
 *   1. Busca/crea MarketingLead por email
 *   2. Persiste el transcript en File Store
 *   3. Publica evento outbox `briefing.transcript_received` y lo procesa inline
 *      → el handler dispatchBriefingAutoDraft llama a Anthropic
 *      → genera draft con perfil DISC A+B, competencias, salario, etc
 *   4. Devuelve el draft_id + portal_url
 *
 * Toma 30-90 segundos por la llamada a Anthropic.
 *
 * Uso:
 *   curl -X POST -H "X-Internal-Key: $K" -H "Content-Type: application/json" \
 *     -d '{"email":"foo@bar.com","client_name":"Foo","client_company":"Test SA","transcript":"...transcript..."}' \
 *     "https://.../api/admin/_diag-generate-draft"
 */
export async function diagGenerateDraft(ctx: RequestContext): Promise<void> {
  log.info('diag-generate-draft: start');
  try {
    requireInternalKey(ctx);
    log.info('diag-generate-draft: auth ok');

    const body = await readJsonBody<{
      email: string;
      client_name: string;
      client_company?: string;
      transcript: string;
    }>(ctx.req);
    if (!body.email || !body.client_name || !body.transcript) {
      sendJson(ctx.res, 400, { error: 'email + client_name + transcript required' });
      return;
    }
    if (body.transcript.length < 100) {
      sendJson(ctx.res, 400, { error: 'transcript muy corto (min 100 chars)' });
      return;
    }
    const email = body.email.trim().toLowerCase();
    log.info('diag-generate-draft: body ok', { transcript_chars: body.transcript.length });

    const { escapeSql } = await import('../lib/dbHelpers.js');
    const { datastore, now } = await import('../lib/db.js');
    const { env } = await import('../lib/env.js');

    // 1. Buscar tenant activo.
    type TenantRow = { ROWID: string; name: string };
    const tenants = unwrapRows<TenantRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, name FROM Tenants WHERE status = 'active' ORDER BY CREATEDTIME ASC LIMIT 1`,
      )) as unknown[],
      'Tenants',
    );
    const tenantId = tenants[0]?.ROWID;
    const agencyName = tenants[0]?.name ?? 'SharkTalents';
    if (!tenantId) {
      sendJson(ctx.res, 503, { error: 'No active tenant found' });
      return;
    }
    log.info('diag-generate-draft: tenant ready', { tenantId });

    // 2. Buscar/crear MarketingLead.
    type LeadRow = { ROWID: string };
    const existing = unwrapRows<LeadRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM MarketingLeads WHERE email = '${escapeSql(email)}' LIMIT 1`,
      )) as unknown[],
      'MarketingLeads',
    );
    if (!existing[0]) {
      await datastore(ctx.req).table('MarketingLeads').insertRow({
        email,
        contact_name: body.client_name,
        company: body.client_company ?? null,
        source: 'playwright_e2e_with_ai',
        created_at: now(),
        updated_at: now(),
      });
    }
    log.info('diag-generate-draft: lead ready');

    // 3. Persistir transcript en File Store.
    const { persistLargeContent } = await import('../lib/largeContentStore.js');
    const meetingId = `e2e_${tenantId}_${Date.now().toString(36)}`;
    const transcriptRef = await persistLargeContent(
      ctx.req,
      body.transcript,
      `Briefings.transcript_text[${meetingId}]`,
    );
    log.info('diag-generate-draft: transcript persisted', { meetingId });

    // 4. Publicar evento outbox y procesarlo inline → llama a Anthropic.
    const { publishAndProcessEvent } = await import('./outbox.js');
    await publishAndProcessEvent(ctx.req, 'briefing.transcript_received', {
      meeting_id: meetingId,
      booking_id: null,
      tenant_id: tenantId,
      client_email: email,
      client_name: body.client_name,
      client_company: body.client_company ?? null,
      transcript_ref: transcriptRef,
      transcript_chars: body.transcript.length,
      language: 'es',
      occurred_at: new Date(Date.now() - 60_000).toISOString(),
      source: 'manual_upload',
    });
    log.info('diag-generate-draft: outbox event processed');

    // 5. Buscar el draft generado.
    type DraftRow = { ROWID: string; status: string; draft_payload: string };
    const drafts = unwrapRows<DraftRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, status, draft_payload FROM JobProfileDrafts WHERE tenant_id = '${escapeSql(tenantId)}' AND client_email = '${escapeSql(email)}' ORDER BY CREATEDTIME DESC LIMIT 1`,
      )) as unknown[],
      'JobProfileDrafts',
    );
    const draft = drafts[0];
    if (!draft) {
      sendJson(ctx.res, 500, { error: 'Draft was not created — Anthropic may have failed silently', meetingId });
      return;
    }
    log.info('diag-generate-draft: draft found', { draftId: draft.ROWID, status: draft.status });

    // 6. Cargar payload para devolverlo.
    const { loadLargeJson } = await import('../lib/largeContentStore.js');
    const payload = await loadLargeJson<Record<string, unknown>>(ctx.req, draft.draft_payload);

    // 7. Generar portal token + URL.
    const portalToken = signPortalToken({
      ref: tenantId,
      company: body.client_company ?? 'Cliente',
      client_name: body.client_name,
      client_email: email,
      agency_name: agencyName,
      ttl_days: 1,
    });
    const e = env();
    const portalUrl = `${e.APP_BASE_URL.replace(/\/$/, '')}/app/#/portal/${portalToken}/draft/${draft.ROWID}`;

    log.info('diag-generate-draft: success', { draftId: draft.ROWID });
    sendJson(ctx.res, 200, {
      portal_url: portalUrl,
      draft_id: draft.ROWID,
      draft_status: draft.status,
      meeting_id: meetingId,
      tenant_id: tenantId,
      payload_summary: payload ? {
        title: payload.title,
        company: payload.company,
        has_disc_ideal_a: !!payload.disc_ideal_a,
        has_disc_ideal_b: !!payload.disc_ideal_b,
        disc_ideal_a: payload.disc_ideal_a,
        disc_ideal_b: payload.disc_ideal_b,
        competencias: payload.competencias,
        competencias_count: Array.isArray(payload.competencias) ? payload.competencias.length : 0,
        salary_range_usd: payload.salary_range_usd,
        jefe: payload.jefe,
        // Campos descriptivos que mapean al ideal_profile al aprobar el draft (que_busco,
        // que_debe_hacer, que_debe_saber). Exponemos los originales del draft IA para auditar
        // contenido y longitud, sin necesidad de descargar el payload completo del File Store.
        objetivo_cargo: payload.objetivo_cargo,
        responsabilidades: payload.responsabilidades,
        responsabilidades_count: Array.isArray(payload.responsabilidades) ? payload.responsabilidades.length : 0,
        tareas_especificas: payload.tareas_especificas,
        tareas_especificas_count: Array.isArray(payload.tareas_especificas) ? payload.tareas_especificas.length : 0,
        herramientas_conocimientos: payload.herramientas_conocimientos,
        herramientas_conocimientos_count: Array.isArray(payload.herramientas_conocimientos) ? payload.herramientas_conocimientos.length : 0,
        formacion_requerida: payload.formacion_requerida,
        experiencia_requerida: payload.experiencia_requerida,
        sector: payload.sector,
        modalidad: payload.modalidad,
        full_payload_keys: Object.keys(payload).sort(),
      } : null,
    });
  } catch (err) {
    const e = err as Error;
    const errAny = err as Record<string, unknown>;
    log.error('diag-generate-draft: ERROR', {
      message: e?.message,
      stack: e?.stack?.slice(0, 800),
      raw: JSON.stringify(errAny, Object.getOwnPropertyNames(errAny ?? {})).slice(0, 1500),
    });
    sendJson(ctx.res, 500, {
      error: e?.message || 'unknown',
      raw: JSON.stringify(errAny, Object.getOwnPropertyNames(errAny ?? {})).slice(0, 1500),
    });
  }
}

/**
 * Setup completo para un test E2E del flow cliente: crea MarketingLead +
 * JobProfileDraft con payload mock + portal token. Devuelve la URL del portal
 * para que Playwright (u otro tool) la abra y simule la aprobación del cliente.
 *
 * Skip los pasos que requieren auth de tenant (briefing manual, generar draft con IA).
 *
 * Uso:
 *   curl -X POST -H "X-Internal-Key: $K" -H "Content-Type: application/json" \
 *     -d '{"email":"foo+e2e1@bar.com","contact_name":"Foo Test","company":"Test SA"}' \
 *     "https://.../api/admin/_diag-trigger-test-flow"
 *
 * Devuelve:
 *   { portal_url, draft_id, marketing_lead_id, tenant_id }
 */
export async function diagTriggerTestFlow(ctx: RequestContext): Promise<void> {
  log.info('diag-trigger-test-flow: start');
  try {
    requireInternalKey(ctx);
    log.info('diag-trigger-test-flow: auth ok');

    const body = await readJsonBody<{ email: string; contact_name?: string; company?: string; whatsapp?: string }>(ctx.req);
    log.info('diag-trigger-test-flow: body parsed', { has_email: !!body.email });
    if (!body.email) {
      sendJson(ctx.res, 400, { error: 'email required' });
      return;
    }
    const email = body.email.trim().toLowerCase();
    const contactName = body.contact_name?.trim() || 'Cliente E2E';
    const company = body.company?.trim() || 'Empresa E2E';

    const { escapeSql } = await import('../lib/dbHelpers.js');
    const { datastore, now } = await import('../lib/db.js');
    const { env } = await import('../lib/env.js');
    log.info('diag-trigger-test-flow: imports ok');

    // 1. Buscar o crear MarketingLead.
    type LeadRow = { ROWID: string };
    const existing = unwrapRows<LeadRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM MarketingLeads WHERE email = '${escapeSql(email)}' LIMIT 1`,
      )) as unknown[],
      'MarketingLeads',
    );
    log.info('diag-trigger-test-flow: lead search done', { found: existing.length });
    let marketingLeadId: string;
    if (existing[0]) {
      marketingLeadId = existing[0].ROWID;
    } else {
      const inserted = await datastore(ctx.req).table('MarketingLeads').insertRow({
        email,
        contact_name: contactName,
        company,
        whatsapp: body.whatsapp ?? null,
        source: 'playwright_e2e',
        created_at: now(),
        updated_at: now(),
      });
      log.info('diag-trigger-test-flow: lead insert raw', { insertedType: typeof inserted, insertedKeys: inserted ? Object.keys(inserted as object) : [] });
      const { unwrapRow } = await import('../lib/dbHelpers.js');
      const row = unwrapRow<{ ROWID: string }>(inserted, 'MarketingLeads');
      if (!row) throw new Error('MarketingLeads insert returned null');
      marketingLeadId = row.ROWID;
    }
    log.info('diag-trigger-test-flow: marketing lead ready', { marketingLeadId });

    // 2. Buscar un tenant de testing. Si no hay ninguno, usar el primero disponible.
    type TenantRow = { ROWID: string; name: string };
    const tenants = unwrapRows<TenantRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, name FROM Tenants WHERE status = 'active' ORDER BY CREATEDTIME ASC LIMIT 1`,
      )) as unknown[],
      'Tenants',
    );
    const tenantId = tenants[0]?.ROWID;
    const agencyName = tenants[0]?.name ?? 'SharkTalents';
    if (!tenantId) {
      sendJson(ctx.res, 503, { error: 'No active tenant found. Need at least one for testing.' });
      return;
    }

    // 3. Crear payload mock del draft (cubre el caso típico que el cliente vería).
    const mockPayload: Record<string, unknown> = {
      title: 'Gerente de Ventas E2E',
      company,
      sector: 'Distribución',
      modalidad: 'Híbrido (3 días oficina)',
      viajes: 'Eventual (1-2x al mes)',
      salario: 'USD 2.500 base + comisiones',
      reporta_a: 'Director Comercial',
      a_cargo: '4 ejecutivos de cuenta',
      incorporacion: 'Inmediata',
      objetivo_cargo: 'Liderar el equipo comercial regional y duplicar la cartera en 18 meses.',
      responsabilidades: [
        'Dirigir al equipo comercial de 4 personas',
        'Cumplir cuota mensual de ventas',
        'Reportar al director comercial semanalmente',
      ],
      tareas_especificas: [
        'Visitar clientes top-20 cada mes',
        'Cerrar deals > USD 50K personalmente',
      ],
      herramientas_conocimientos: ['CRM Zoho', 'Excel avanzado', 'Inglés intermedio'],
      formacion_requerida: 'Universitaria en Administración, Comercial o afín',
      experiencia_requerida: '5+ años liderando equipos comerciales B2B',
      disc_ideal_a: {
        patron: 'D dominante con I de soporte',
        pk_profile_code: 'PK11',
        pk_profile_name: 'El Cazador',
        d: 75, i: 55, s: 35, c: 35,
        description: ['Decidido', 'Orientado a resultados', 'Persuasivo'],
        gana_en: ['Cierra rápido', 'Maneja presión'],
        sacrifica: ['Detallismo', 'Paciencia con procesos'],
      },
      disc_ideal_b: {
        patron: 'I alto con D media',
        pk_profile_code: 'PK14',
        pk_profile_name: 'El Diplomático',
        d: 55, i: 75, s: 35, c: 35,
        description: ['Sociable', 'Inspirador', 'Optimista'],
        gana_en: ['Construye relaciones', 'Motiva al equipo'],
        sacrifica: ['Foco en métricas', 'Dureza para cortar'],
      },
      tensiones_detectadas: [
        { ejes: 'D vs I', descripcion: 'Equilibrio entre cerrar rápido y construir relaciones largas.' },
      ],
      competencias: [
        { name: 'liderazgo', required_pct: 80, que_evaluamos: 'Capacidad de coordinar equipo bajo presión.' },
        { name: 'negociacion', required_pct: 85, que_evaluamos: 'Habilidad para cerrar deals complejos.' },
      ],
      salary_range_usd: { min: 2000, max: 3500 },
      tecnica_minimo_pct: 65,
    };

    log.info('diag-trigger-test-flow: tenant ready', { tenantId });

    const { persistLargeJson } = await import('../lib/largeContentStore.js');
    const payloadRef = await persistLargeJson(ctx.req, mockPayload, 'e2e-test-draft');
    log.info('diag-trigger-test-flow: payload persisted', { payloadRefLen: payloadRef?.length });

    // 4. Crear el draft (mismo shape que saveJobDraft real).
    const draftInsert: Record<string, unknown> = {
      tenant_id: tenantId,
      transcript: 'E2E test mock transcript',
      transcript_source: 'manual',
      draft_payload: payloadRef,
      status: 'pending_client_review',
      version: 1,
      highlights: null,
      client_email: email,
      client_name: contactName,
      client_company: company,
      meeting_id: null,
      marketing_lead_id: marketingLeadId,
      job_id: null,
      created_at: now(),
      updated_at: now(),
    };
    const draftInserted = await datastore(ctx.req).table('JobProfileDrafts').insertRow(draftInsert);
    log.info('diag-trigger-test-flow: draft inserted', { type: typeof draftInserted });
    const { unwrapRow: unwrapDraftRow } = await import('../lib/dbHelpers.js');
    const draftRow = unwrapDraftRow<{ ROWID: string }>(draftInserted, 'JobProfileDrafts');
    if (!draftRow) throw new Error('JobProfileDrafts insert returned null');
    const draftId = draftRow.ROWID;
    log.info('diag-trigger-test-flow: draft ready', { draftId });

    // 5. Generar portal token.
    const portalToken = signPortalToken({
      ref: tenantId,
      company,
      client_name: contactName,
      client_email: email,
      agency_name: agencyName,
      ttl_days: 1,
    });

    const e = env();
    const portalUrl = `${e.APP_BASE_URL.replace(/\/$/, '')}/app/#/portal/${portalToken}/draft/${draftId}`;

    log.info('diag-trigger-test-flow: success', { portalUrl, draftId });
    sendJson(ctx.res, 200, {
      portal_url: portalUrl,
      draft_id: draftId,
      marketing_lead_id: marketingLeadId,
      tenant_id: tenantId,
      email,
    });
  } catch (err) {
    // Catalyst a veces tira objetos planos en vez de Error — serializamos todo
    // para no perder info de qué columna/tipo fue el problema.
    const e = err as Error;
    const errAny = err as Record<string, unknown>;
    const fullErr: Record<string, unknown> = {
      message: e?.message,
      name: e?.name,
      stack: e?.stack?.slice(0, 800),
      raw_keys: errAny ? Object.keys(errAny) : [],
      raw_serialized: JSON.stringify(errAny, Object.getOwnPropertyNames(errAny ?? {})).slice(0, 1500),
      typeof_err: typeof err,
    };
    log.error('diag-trigger-test-flow: ERROR', fullErr);
    sendJson(ctx.res, 500, fullErr);
  }
}

/**
 * Dispara manualmente un push a CRM con datos de prueba para verificar que la
 * integración funcione. Útil para test rápido sin tener que aprobar un draft real.
 *
 * Uso:
 *   curl -X POST -H "X-Internal-Key: $K" -H "Content-Type: application/json" \
 *     -d '{"email":"foo@bar.com","first_name":"Cris","last_name":"García","company":"Test","phone":"+507...","ruc_nit":"123","street":"Calle 50","city":"Panamá","state":"","country":"Panamá"}' \
 *     "https://.../api/admin/_diag-crm-push"
 */
export async function diagCrmPush(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  try {
    const { readJsonBody } = await import('../lib/http.js');
    const body = await readJsonBody<{
      email: string;
      first_name?: string;
      last_name?: string;
      company?: string;
      phone?: string;
      ruc_nit?: string;
      street?: string;
      city?: string;
      state?: string;
      country?: string;
    }>(ctx.req);
    if (!body.email) {
      sendJson(ctx.res, 400, { error: 'email required' });
      return;
    }
    const { createLead } = await import('../lib/zohoCrmClient.js');
    const customFields: Record<string, string | number | boolean | null> = {};
    if (body.ruc_nit) customFields.RUC_NIT = body.ruc_nit;
    if (body.street) customFields.Street = body.street;
    if (body.city) customFields.City = body.city;
    if (body.state) customFields.State = body.state;
    if (body.country) customFields.Country = body.country;
    const result = await createLead({
      email: body.email,
      first_name: body.first_name,
      last_name: body.last_name,
      company: body.company,
      phone: body.phone,
      custom_fields: Object.keys(customFields).length > 0 ? customFields : undefined,
    }, ctx.traceId ?? 'admin-diag');
    sendJson(ctx.res, result.ok ? 200 : 502, {
      ok: result.ok,
      crm_result: result,
      sent_payload: {
        email: body.email,
        first_name: body.first_name,
        last_name: body.last_name,
        company: body.company,
        phone: body.phone,
        custom_fields: customFields,
        layout_id_env: process.env.ZOHO_CRM_LEAD_LAYOUT_ID || '(NOT SET)',
      },
    });
  } catch (err) {
    sendJson(ctx.res, 500, { error: (err as Error).message });
  }
}

/**
 * Busca un lead en Zoho CRM por email y devuelve TODOS los campos que tiene.
 * Útil para verificar si el push desde SharkTalents llegó OK y qué campos están
 * llenos vs vacíos.
 *
 * Uso:
 *   curl -H "X-Internal-Key: $K" "https://.../api/admin/_diag-crm-lead?email=foo@bar.com"
 */
export async function diagCrmLead(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  const emailParam = new URL(ctx.req.url ?? '/', 'http://x').searchParams.get('email') ?? '';
  if (!emailParam) {
    sendJson(ctx.res, 400, { error: 'email query param required' });
    return;
  }
  try {
    const { findLeadInCrmByEmail } = await import('../lib/zohoCrmClient.js');
    const traceId = ctx.traceId ?? 'admin-diag';
    const result = await findLeadInCrmByEmail(emailParam, traceId);
    if (!result.ok) {
      sendJson(ctx.res, 502, { error: result.error, status: result.status });
      return;
    }
    if (!result.data) {
      sendJson(ctx.res, 404, { email: emailParam, found: false, message: 'Lead no encontrado en CRM' });
      return;
    }
    const lead = result.data;
    sendJson(ctx.res, 200, {
      email: emailParam,
      found: true,
      lead_id: lead.id,
      layout_id: (lead.Layout as { id?: string } | undefined)?.id,
      key_fields: {
        First_Name: lead.First_Name,
        Last_Name: lead.Last_Name,
        Company: lead.Company,
        Phone: lead.Phone,
        Lead_Source: lead.Lead_Source,
        Lead_Status: lead.Lead_Status,
      },
      contract_fields: {
        RUC_NIT: lead.RUC_NIT,
        Street: lead.Street,
        City: lead.City,
        State: lead.State,
        Zip_Code: lead.Zip_Code,
        Country: lead.Country,
      },
      modified_at: lead.Modified_Time,
      all_field_keys: Object.keys(lead).sort(),
    });
  } catch (err) {
    sendJson(ctx.res, 500, { error: (err as Error).message });
  }
}

/**
 * Lista los últimos N drafts generados con su payload completo. Para que Claude
 * pueda analizar la calidad de los outputs de la IA después de un test E2E.
 *
 * Devuelve para cada draft:
 *   - metadata (id, client_email, client_company, status, created_at)
 *   - payload completo (title, DISC A+B, competencias, salario, jefe, etc)
 *
 * Uso:
 *   curl -H "X-Internal-Key: $K" "https://.../api/admin/_diag-list-drafts?limit=10"
 */
export async function diagListDrafts(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  try {
    const url = new URL(ctx.req.url ?? '/', 'http://x');
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit') ?? 10)));

    type Row = {
      ROWID: string;
      tenant_id: string;
      client_email: string;
      client_name: string | null;
      client_company: string | null;
      status: string;
      draft_payload: string;
      created_at: string;
    };
    const rows = unwrapRows<Row>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, tenant_id, client_email, client_name, client_company, status, draft_payload, created_at
         FROM JobProfileDrafts ORDER BY CREATEDTIME DESC LIMIT ${limit}`,
      )) as unknown[],
      'JobProfileDrafts',
    );

    const { loadLargeJson } = await import('../lib/largeContentStore.js');
    const drafts = [];
    for (const r of rows) {
      const payload = await loadLargeJson<Record<string, unknown>>(ctx.req, r.draft_payload);
      drafts.push({
        ROWID: r.ROWID,
        tenant_id: r.tenant_id,
        client_email: r.client_email,
        client_name: r.client_name,
        client_company: r.client_company,
        status: r.status,
        created_at: r.created_at,
        payload,
      });
    }
    sendJson(ctx.res, 200, { count: drafts.length, drafts });
  } catch (err) {
    sendJson(ctx.res, 500, { error: (err as Error).message });
  }
}

/**
 * Lista todos los layouts disponibles para el módulo Leads en Zoho CRM, y los
 * campos custom (data_type === 'text' / 'picklist' / etc) — para identificar
 * cuál es el layout de SharkTalents y qué fields existen sin entrar a la UI.
 *
 * Uso:
 *   curl -H "X-Internal-Key: $K" "https://.../api/admin/_diag-crm-layouts"
 *   curl -H "X-Internal-Key: $K" "https://.../api/admin/_diag-crm-layouts?module=Contacts"
 */
export async function diagCrmLayouts(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  const moduleParam = new URL(ctx.req.url ?? '/', 'http://x').searchParams.get('module') ?? 'Leads';
  try {
    const { listLayouts, listFields } = await import('../lib/zohoCrmClient.js');
    const traceId = ctx.traceId ?? 'admin-diag';
    const [layoutsResult, fieldsResult] = await Promise.all([
      listLayouts(traceId, moduleParam),
      listFields(traceId, moduleParam),
    ]);
    sendJson(ctx.res, 200, {
      module: moduleParam,
      layouts: layoutsResult.ok
        ? layoutsResult.data.map((l) => ({
            id: l.id,
            name: l.name,
            api_name: l.api_name,
            status: l.status,
            source: l.source,
          }))
        : { error: layoutsResult.error, status: layoutsResult.status },
      custom_fields: fieldsResult.ok
        ? fieldsResult.data
            .filter((f) => f.custom_field)
            .map((f) => ({
              api_name: f.api_name,
              label: f.field_label,
              type: f.data_type,
              required: f.required,
              pick_list:
                f.pick_list_values && f.pick_list_values.length > 0
                  ? f.pick_list_values.map((v) => v.display_value)
                  : undefined,
            }))
        : { error: fieldsResult.error, status: fieldsResult.status },
      standard_fields_count: fieldsResult.ok
        ? fieldsResult.data.filter((f) => !f.custom_field).length
        : 0,
    });
  } catch (err) {
    sendJson(ctx.res, 500, { error: (err as Error).message });
  }
}

/**
 * Devuelve el payload completo (parseado del File Store) del último JobProfileDraft.
 * Útil para inspeccionar qué generó la IA cuando algo no se ve en el frontend.
 *
 * Uso:
 *   curl -H "X-Internal-Key: $K" "https://.../api/admin/_diag-last-draft"
 */
export async function diagLastDraft(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  try {
    const rows = unwrapRows<{ ROWID: string; tenant_id: string; status: string; draft_payload: string; created_at: string; client_email: string }>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, tenant_id, status, draft_payload, created_at, client_email FROM JobProfileDrafts ORDER BY CREATEDTIME DESC LIMIT 3`,
      )) as unknown[],
      'JobProfileDrafts',
    );
    const { loadLargeJson } = await import('../lib/largeContentStore.js');
    const out = [];
    for (const r of rows) {
      const payload = await loadLargeJson<Record<string, unknown>>(ctx.req, r.draft_payload);
      out.push({
        ROWID: r.ROWID,
        tenant_id: r.tenant_id,
        status: r.status,
        client_email: r.client_email,
        created_at: r.created_at,
        payload_keys: payload ? Object.keys(payload).sort() : [],
        payload_competencias: payload?.competencias ?? null,
        payload_objetivo_cargo: payload?.objetivo_cargo ?? null,
        payload_responsabilidades: payload?.responsabilidades ?? null,
        payload_tareas_especificas: payload?.tareas_especificas ?? null,
        payload_disc_ideal: payload?.disc_ideal ?? null,
        payload_disc_ventajas: payload?.disc_ventajas ?? null,
        payload_modalidad: payload?.modalidad ?? null,
        payload_disc_ideal_a: payload?.disc_ideal_a ?? null,
        payload_disc_ideal_b: payload?.disc_ideal_b ?? null,
        payload_jefe: payload?.jefe ?? null,
        payload_cualidades_pedidas: payload?.cualidades_pedidas ?? null,
        payload_tensiones_detectadas: payload?.tensiones_detectadas ?? null,
        payload_full_keys_with_value: payload ? Object.keys(payload).filter((k) => payload[k] !== null && payload[k] !== undefined && (typeof payload[k] !== 'string' || (payload[k] as string).length > 0) && (!Array.isArray(payload[k]) || (payload[k] as unknown[]).length > 0)).sort() : [],
      });
    }
    sendJson(ctx.res, 200, { count: out.length, drafts: out });
  } catch (err) {
    sendJson(ctx.res, 500, { error: (err as Error).message });
  }
}

/**
 * Devuelve el token signed para invocar /test/:token/* de un application_id dado.
 * Usado por Spec B: en lugar de leer el email del candidato para extraer el link,
 * pedimos directo al backend el token que el outbox handler hubiera generado.
 *
 * NO expone PII del candidato. NO crea estado. Solo deriva el token desde el
 * application_id (= Result.ROWID).
 *
 * Uso:
 *   curl -H "X-Internal-Key: $K" "https://.../api/admin/_diag-get-test-token?application_id=ROWID"
 *   → { token, test_url, application_id, job_id }
 */
export async function diagGetTestToken(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  try {
    const url = new URL(ctx.req.url ?? '/', 'http://x');
    const applicationId = (url.searchParams.get('application_id') ?? '').trim();
    if (!applicationId) {
      sendJson(ctx.res, 400, { error: 'application_id query param required' });
      return;
    }

    const { escapeSql } = await import('../lib/dbHelpers.js');
    type Row = { ROWID: string; assessment_id: string; candidate_id: string };
    const rows = unwrapRows<Row>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, assessment_id, candidate_id FROM Results WHERE ROWID = '${escapeSql(applicationId)}' LIMIT 1`,
      )) as unknown[],
      'Results',
    );
    const result = rows[0];
    if (!result) {
      sendJson(ctx.res, 404, { error: 'application not found' });
      return;
    }

    const { signToken, expiresIn, WEEK_SEC } = await import('../lib/urlSigning.js');
    const { env } = await import('../lib/env.js');
    const token = signToken({ kind: 'test', ref: applicationId, exp: expiresIn(2 * WEEK_SEC) });
    const baseUrl = env().APP_BASE_URL.replace(/\/$/, '');
    const testUrl = `${baseUrl}/app/#/test/${token}`;

    sendJson(ctx.res, 200, {
      token,
      test_url: testUrl,
      application_id: applicationId,
      job_id: result.assessment_id,
      candidate_id: result.candidate_id,
    });
  } catch (err) {
    sendJson(ctx.res, 500, { error: (err as Error).message });
  }
}

/**
 * Cleanup de jobs de prueba — soft-delete (is_active=false) por patrón de title o company.
 *
 * Patrón típico:
 *   POST con { title_prefix: "Empresa Real Run" }       → 10 jobs E2E
 *   POST con { company_contains: "Distribuidora XYZ" }  → puestos de prueba antiguos
 *   POST con { title_prefix: "Empresa E2E Run" }        → variante
 *   POST con { dry_run: true }                          → no borra, solo lista
 *
 * SOFT delete: pone is_active=false. NO borra rows. Esto permite que las Results /
 * Candidates ligadas sigan refiriéndose al puesto sin orphan FK.
 *
 * Reservas de seguridad:
 *   - Necesita pattern (NO acepta wildcard vacío)
 *   - Max 50 jobs por llamada
 *   - Log de cada job tocado en SystemAlert
 *
 * Uso:
 *   curl -X POST -H "X-Internal-Key: $K" -H "Content-Type: application/json" \
 *     -d '{"title_prefix":"Empresa Real Run","dry_run":true}' \
 *     "https://.../api/admin/_diag-cleanup-test-jobs"
 */
export async function diagCleanupTestJobs(ctx: RequestContext): Promise<void> {
  requireInternalKey(ctx);
  try {
    const body = await readJsonBody<{
      title_prefix?: string;
      company_contains?: string;
      dry_run?: boolean;
    }>(ctx.req).catch(() => ({} as Record<string, unknown>));

    const titlePrefix = typeof body.title_prefix === 'string' ? body.title_prefix.trim() : '';
    const companyContains = typeof body.company_contains === 'string' ? body.company_contains.trim() : '';
    const dryRun = body.dry_run === true;

    if (!titlePrefix && !companyContains) {
      sendJson(ctx.res, 400, {
        error: 'Required: title_prefix OR company_contains. Refusing to wildcard-delete everything.',
        hint: 'Ejemplos: {"title_prefix":"Empresa Real Run"} | {"company_contains":"Distribuidora XYZ"}',
      });
      return;
    }

    const { escapeSql } = await import('../lib/dbHelpers.js');
    const conditions: string[] = ['is_active = true']; // solo afectar activos
    if (titlePrefix) conditions.push(`title LIKE '${escapeSql(titlePrefix)}%'`);
    if (companyContains) conditions.push(`company LIKE '%${escapeSql(companyContains)}%'`);
    const where = conditions.join(' AND ');

    type Row = { ROWID: string; title: string; company: string; tenant_id: string };
    const rows = unwrapRows<Row>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID, title, company, tenant_id FROM Jobs WHERE ${where} LIMIT 50`,
      )) as unknown[],
      'Jobs',
    );

    if (rows.length === 0) {
      sendJson(ctx.res, 200, { matched: 0, dry_run: dryRun, jobs: [], deleted: 0 });
      return;
    }

    const jobsPreview = rows.map((r) => ({ id: r.ROWID, title: r.title, company: r.company }));

    if (dryRun) {
      sendJson(ctx.res, 200, {
        matched: rows.length,
        dry_run: true,
        jobs: jobsPreview,
        deleted: 0,
        hint: 'Repetí con "dry_run": false para soft-delete (is_active=false).',
      });
      return;
    }

    // Soft-delete: is_active=false. No tocamos tech_questions_cache ni prescreening_cache.
    let deleted = 0;
    const failures: { job_id: string; error: string }[] = [];
    for (const row of rows) {
      try {
        await datastore(ctx.req).table('Jobs').updateRow({
          ROWID: row.ROWID,
          is_active: false,
          updated_at: nowFn(),
        });
        deleted += 1;
      } catch (err) {
        failures.push({ job_id: row.ROWID, error: (err as Error).message });
      }
    }

    log.info('cleanup test jobs done', {
      matched: rows.length,
      deleted,
      failures: failures.length,
      title_prefix: titlePrefix || null,
      company_contains: companyContains || null,
    });

    sendJson(ctx.res, 200, {
      matched: rows.length,
      dry_run: false,
      jobs: jobsPreview,
      deleted,
      failures,
    });
  } catch (err) {
    sendJson(ctx.res, 500, { error: (err as Error).message });
  }
}
