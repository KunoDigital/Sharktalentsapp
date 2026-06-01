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
    log.error('anthropic ping failed', {
      traceId: ctx.traceId,
      latency_ms: ms,
      error: (err as Error).message,
    });
    sendJson(ctx.res, 502, {
      ok: false,
      latency_ms: ms,
      error: (err as Error).message,
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
