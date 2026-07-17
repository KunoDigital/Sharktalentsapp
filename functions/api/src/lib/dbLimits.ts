/**
 * Límites de tamaño para columnas de Catalyst Datastore.
 *
 * **Catalyst Datastore facts (verificados con soporte 2026-05-08):**
 * - Var Char: max 255 chars por columna
 * - Text: **max 10,000 chars por columna** (NO 64KB como pensábamos antes)
 * - Si necesitás guardar más de 10K chars → usar File Store + guardar el file_id
 *   en una columna Var Char. Ver `lib/largeContentStore.ts`.
 *
 * Si una fila excede 10K en algún campo Text, Catalyst:
 *   - silenciosamente trunca, o
 *   - tira error 500 sin mensaje claro
 *
 * Por eso truncamos defensivamente en código antes de insertar.
 * Nuestro límite efectivo es **9,500 chars** (margen de 500 ante posibles overheads).
 *
 * **Límites por campo** (en chars). TODOS ≤ 9,500 chars (margen de 500 sobre el 10K duro):
 *
 * **Campos que usan File Store** (contenido > 9,500 chars):
 * | Campo                              | Estrategia                                  |
 * |------------------------------------|---------------------------------------------|
 * | bundle_payload (ClientReports)     | File Store. La columna guarda file_id only. |
 * | transcript (JobProfileDrafts)      | File Store si > 9.5K, sino inline           |
 * | draft_payload (JobProfileDrafts)   | File Store si > 9.5K, sino inline           |
 * | tech_questions_cache (Jobs)        | File Store si > 9.5K, sino inline           |
 * | transcript_text (Briefings)        | File Store                                  |
 *
 * **Campos inline (todos ≤ 9,500):**
 * | Campo                              | Límite | Justificación                               |
 * |------------------------------------|--------|---------------------------------------------|
 * | analysis_payload (VideoResponses)  | 8000   | Análisis IA estructurado (renombrado 17-jul)|
 * | ideal_profile (Jobs)               | 8000   | DISC + VELNA + competencias + boss          |
 * | quiz_data (MarketingLeads)         | 4000   | 5 respuestas del quiz                       |
 * | calculator_data (MarketingLeads)   | 2000   | Cálculos del riesgo                         |
 * | payload (OutboxEvents)             | 8000   | Eventos típicos                             |
 * | transcript (VideoResponses)        | 9500   | Whisper 60-90sec ≈ 2K real, margen          |
 * | payload (RecruitSyncQueue)         | 8000   | Recruit sync                                 |
 * | event_data (JobTrackingSnapshots)  | 2000   | Eventos del portal                          |
 * | rationale (BotDecisions)           | 2000   | Razonamiento del bot                        |
 * | scenario_summary (Training)        | 2000   | Caso de training                            |
 * | reason (PipelineTransitions)       | 200    | Razón humana corta                          |
 * | reason (ReviewQueue)               | 1000   | Razón del bot                               |
 * | message (Notifications)            | 500    | UI texto corto                              |
 * | notes_internal (CandidatePool)     | 4000   | Notas del recruiter                          |
 * | encrypted_value (IntegrationSecrets) | 4000 | Token cifrado                               |
 * | body (OutreachInbox)               | 4000   | Mensaje LinkedIn/email                      |
 * | body (OutreachTemplates)           | 4000   | Template                                    |
 * | body_html (ClientNotifTemplates)   | 8000   | HTML del email                              |
 * | options (PrefilterQuestions)       | 2000   | JSON options                                |
 * | answer_value (PrefilterAnswers)    | 1000   | Respuesta del candidato                     |
 * | tags (CandidatePool)               | 2000   | JSON array de tags                          |
 * | languages (CandidatePool)          | 500    | JSON array                                  |
 * | event_data (varios)                | 2000   | Event payload                               |
 *
 * **Var Char limits** (max 255):
 * | Campo                     | Largo |
 * |---------------------------|-------|
 * | email                     | 255   |
 * | name                      | 255   |
 * | URLs cortas               | 255   |
 * | tokens cortos (cache_key) | 64    |
 * | tokens largos (HMAC sign) | usar Text con truncate |
 */

/** Tamaño máximo de un campo Text en Catalyst Datastore — el límite duro */
export const CATALYST_TEXT_MAX_CHARS = 10_000;

/** Margen de seguridad — truncamos a 9_500 para dejar 500 chars ante posibles overheads */
export const SAFE_TEXT_BUDGET = 9_500;

/**
 * Límites por campo (en chars). TODOS ≤ 9_500.
 * Campos que necesitan más espacio → File Store (ver `lib/largeContentStore.ts`).
 */
export const FIELD_LIMITS = {
  // ClientReports — bundle_payload usa File Store (la columna guarda solo el file_id)
  BUNDLE_PAYLOAD: 9_500,

  // JobProfileDrafts — transcript + draft_payload usan File Store si > 9_500, sino inline
  DRAFT_PAYLOAD: 9_500,
  DRAFT_TRANSCRIPT: 9_500,
  DRAFT_HIGHLIGHTS: 4_000,

  // Jobs — tech_questions_cache usa File Store si > 9_500
  TECH_QUESTIONS_CACHE: 9_500,
  IDEAL_PROFILE: 8_000,

  // VideoResponses — transcript inline (Whisper 60-90s ≈ 2K, sobra margen)
  VIDEO_TRANSCRIPT: 9_500,
  VIDEO_ANALYSIS: 8_000,

  // Briefings — transcript_text usa File Store
  BRIEFING_TRANSCRIPT: 9_500,

  // EnglishTestSessions — writing_text (essay del candidato, max C1 ≈ 2K chars)
  ENGLISH_WRITING_TEXT: 4_000,

  // OutboxEvents
  OUTBOX_PAYLOAD: 8_000,

  // RecruitSyncQueue
  RECRUIT_PAYLOAD: 8_000,

  // BotDecisions
  RATIONALE: 2_000,

  // BotTrainingExamples
  SCENARIO_SUMMARY: 2_000,
  OVERRIDE_REASON: 2_000,

  // Notifications
  NOTIFICATION_MESSAGE: 500,

  // PipelineTransitions
  TRANSITION_REASON: 200,

  // ReviewQueue
  REVIEW_REASON: 1_000,

  // CandidatePool
  POOL_NOTES: 4_000,
  POOL_TAGS: 2_000,
  POOL_LANGUAGES: 500,

  // OutreachInbox / Templates
  OUTREACH_BODY: 4_000,

  // ClientNotificationTemplates
  EMAIL_BODY_HTML: 8_000,

  // PrefilterQuestions / Answers
  PREFILTER_OPTIONS: 2_000,
  PREFILTER_ANSWER: 1_000,
  PREFILTER_QUESTION_TEXT: 1_000,
  PREFILTER_EXPECTED: 500,

  // VideoQuestions
  VIDEO_QUESTION_TEXT: 2_000,
  VIDEO_RATIONALE: 1_000,
  VIDEO_EXPECTED_SIGNALS: 2_000,

  // MarketingLeads
  QUIZ_DATA: 4_000,
  CALCULATOR_DATA: 2_000,

  // IntegrationSecrets
  ENCRYPTED_VALUE: 4_000,

  // JobTrackingSnapshots
  EVENT_DATA: 2_000,

  // AntiCheat / general user agent
  USER_AGENT: 500,

  // Tenants — branding_config (logo URL, colors, legal name, etc.)
  BRANDING_CONFIG: 4_000,
} as const;

/**
 * Trunca un string a un largo máximo. Si trunca, loggea un warning para que sepamos
 * cuándo estamos al borde del límite (señal de que necesitamos optimizar el contenido
 * o subir el límite del campo).
 *
 * Uso típico:
 *   transcript: truncate(longText, FIELD_LIMITS.DRAFT_TRANSCRIPT, 'JobProfileDrafts.transcript'),
 *
 * @param value      string a truncar (acepta null/undefined → devuelve null)
 * @param max        largo máximo en chars
 * @param contextLabel  identificador para logs (ej: "ClientReports.bundle_payload")
 */
export function truncate(
  value: string | null | undefined,
  max: number,
  contextLabel?: string,
): string | null {
  if (value == null) return null;
  if (value.length <= max) return value;
  // Log solo si tenemos un logger context (evitamos circular imports usando console)
  // En producción este warning aparece en Catalyst logs.
  if (contextLabel) {
    console.warn(
      `[DB_LIMITS] truncating ${contextLabel}: ${value.length} → ${max} chars (${value.length - max} chars dropped)`,
    );
  }
  return value.slice(0, max);
}

/**
 * Helper para JSON: stringifica + trunca. Útil cuando insertás un objeto grande que
 * vas a guardar como JSON en una columna Text.
 *
 *   bundle_payload: stringifyAndTruncate(bundle, FIELD_LIMITS.BUNDLE_PAYLOAD, 'ClientReports'),
 */
export function stringifyAndTruncate(
  obj: unknown,
  max: number,
  contextLabel?: string,
): string {
  const json = JSON.stringify(obj);
  return truncate(json, max, contextLabel) ?? '';
}
