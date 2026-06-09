import type { Application } from '../data/mockApplications';

/**
 * Catalyst Datastore devuelve columnas `int` como strings (ej "100" en vez de 100).
 * Helpers para tolerar ambos formatos al leer scores.
 */
function hasNumericValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n);
  }
  return false;
}
function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Bug C/M1 (modelo V1): si candidato hizo técnica con score < 70 y NO hay override manual
 * del admin (pipeline_stage en un stage explícito tipo bot_decision_*, finalist, etc),
 * marcar como 'auto_rejected_low_score' para que aparezca en columna "Rechazado".
 *
 * Estados "auto" que se pueden sobrescribir: prefilter_passed, tecnica_completed.
 * El admin puede mover la card y eso setea pipeline_stage explícito (gana sobre el cálculo).
 */
function deriveAutoRejectedState(
  rawStage: unknown,
  tecCompletedAt: unknown,
  tecPassed: unknown,
): string {
  const stage = String(rawStage ?? '');
  // Estados "auto" donde la regla V1 aplica (sin override manual)
  const isAutoStage = stage === 'prefilter_passed' || stage === 'tecnica_completed' || stage === '';
  if (isAutoStage && tecCompletedAt && tecPassed === false) {
    return 'auto_rejected_low_score';
  }
  return stage;
}

type ApiApp = {
  ROWID: string;
  assessment_id: string;
  candidate_id: string;
  pipeline_stage: string;
  started_at: string;
  completed_at: string | null;
};

type ApiCand = {
  name: string;
  email: string;
  phone: string | null;
  age: number | null;
};

type IntegrityDim = { dimension: string; nivel: string; pct: number };

export function adaptToMockApplication(
  app: ApiApp,
  candidate: ApiCand | undefined,
  scores: Record<string, unknown> | null,
  integrityDims: IntegrityDim[],
): Application {
  const s = scores ?? {};
  const tecPct = toNum(s.tec_score_pct);
  const intPct = typeof s.int_overall_pct === 'number' ? s.int_overall_pct : 0;
  return {
    id: app.ROWID,
    job_id: app.assessment_id,
    candidate_name: candidate?.name ?? 'Candidato',
    candidate_email: candidate?.email ?? '',
    candidate_age: candidate?.age ?? 0,
    candidate_phone: candidate?.phone ?? '',
    source: 'direct',
    // Regla V1 (Bug C/M1): auto-rechazo en técnica si score < min Y NO hay pipeline_stage manual.
    // V1 (JobPipeline.tsx:147-157): el admin puede sobrescribir moviendo la card; el override gana.
    // Aquí "manual" significa stages que NO sean prefiltro o tecnica_completed (estados auto).
    state: deriveAutoRejectedState(app.pipeline_stage, s.tec_completed_at, s.tec_passed) as Application['state'],
    applied_at: app.started_at,
    salary_aspiration_usd: 0,
    disponibilidad: 'No declarado',
    tecnica_state: 'completado',
    conductual_state: 'completado',
    integridad_state: 'completado',
    anti_cheat_events: [],
    ia_summary: '',
    timeline: [],
    // Regla V1 (Bug D, H, J): completed_at es la fuente única de verdad. Si el bloque
    // no se completó, retornar undefined → la UI NO muestra "0%" falso, muestra "Sin datos".
    // similitud_pct se calcula on-the-fly en backend (readScores) usando modelo V1 min/max.
    disc: s.disc_completed_at ? {
      d: toNum(s.disc_norm_d),
      i: toNum(s.disc_norm_i),
      s: toNum(s.disc_norm_s),
      c: toNum(s.disc_norm_c),
      dominant_label: typeof s.disc_perfil_dominante === 'string' ? s.disc_perfil_dominante : '',
      pk_profile_code: '',
      pk_profile_name: '',
      similitud_pct: hasNumericValue(s.disc_similarity_pct) ? toNum(s.disc_similarity_pct) : 0,
    } : undefined,
    velna: s.velna_completed_at ? {
      verbal: toNum(s.velna_verbal),
      espacial: toNum(s.velna_espacial),
      logica: toNum(s.velna_logica),
      numerica: toNum(s.velna_numerica),
      abstracta: toNum(s.velna_abstracta),
      // Si backend computó similitud vs ideal, usar esa. Sino fallback al índice agregado.
      similitud_pct: hasNumericValue(s.velna_similarity_pct)
        ? toNum(s.velna_similarity_pct)
        : toNum(s.velna_indice),
    } : undefined,
    // tec_score_pct = 0 es válido (candidato no acertó nada), por eso uso `> 0` solo
    // para distinguir "no hizo el test" (null/0/undefined) de "hizo el test (0..100)".
    // tec_completed_at es el indicador real de "hizo el test".
    tecnica: s.tec_completed_at ? {
      pct: tecPct,
      estado: s.tec_passed ? 'Aprobado' as const : 'No aprobado' as const,
      minimo_requerido_pct: 70,
      // Doble eje (doc 19): mapear los 3 campos. Catalyst devuelve int como string
      // (ej "100"), por eso usamos `hasNumericValue` que tolera ambos.
      situational_validity_pct: hasNumericValue(s.tec_situational_validity_pct) ? toNum(s.tec_situational_validity_pct) : undefined,
      style_autonomy_consult: hasNumericValue(s.tec_style_autonomy_consult) ? toNum(s.tec_style_autonomy_consult) : undefined,
      style_match_with_boss_pct: hasNumericValue(s.tec_style_match_with_boss_pct) ? toNum(s.tec_style_match_with_boss_pct) : undefined,
    } : undefined,
    // Regla V1 (Bug H): int_completed_at es la fuente de verdad. Si vacío → sin datos.
    // Antes leíamos integrityDims sin chequear completed_at, lo que hacía inconsistencia con detail.
    integridad: s.int_completed_at ? (integrityDims.length > 0 ? {
      dimensions: integrityDims.map((d) => ({
        name: d.dimension,
        classification: (d.nivel === 'bajo' ? 'Bajo' : d.nivel === 'medio' ? 'Medio' : 'Alto') as 'Bajo' | 'Medio' | 'Alto',
        score_pct: d.pct,
      })),
      buena_impresion_alta: false,
      observations: integrityDims.filter((d) => d.nivel !== 'bajo').map((d) => `${d.dimension}: ${d.nivel} (${d.pct}%)`),
    } : {
      dimensions: [],
      buena_impresion_alta: false,
      observations: intPct > 30 ? [`Integridad general: ${intPct}% riesgo`] : [],
    }) : undefined,
    // Regla V1 (Bug J): emo_completed_at es la fuente de verdad. Antes leíamos solo emo_score
    // que puede ser 0 válido vs null no completado → falsos negativos.
    emocional: s.emo_completed_at ? {
      value: toNum(s.emo_score),
      label: (typeof s.emo_perfil === 'string' && s.emo_perfil === 'espontaneo' ? 'Espontáneo' :
              typeof s.emo_perfil === 'string' && s.emo_perfil === 'reflexivo' ? 'Reflexivo' : 'Mesura') as 'Espontáneo' | 'Mesura' | 'Reflexivo',
    } : undefined,
  };
}
