import type { Application } from '../data/mockApplications';

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
  const tecPct = typeof s.tec_score_pct === 'number' ? s.tec_score_pct : 0;
  const intPct = typeof s.int_overall_pct === 'number' ? s.int_overall_pct : 0;
  return {
    id: app.ROWID,
    job_id: app.assessment_id,
    candidate_name: candidate?.name ?? 'Candidato',
    candidate_email: candidate?.email ?? '',
    candidate_age: candidate?.age ?? 0,
    candidate_phone: candidate?.phone ?? '',
    source: 'direct',
    state: app.pipeline_stage as Application['state'],
    applied_at: app.started_at,
    salary_aspiration_usd: 0,
    disponibilidad: 'No declarado',
    tecnica_state: 'completado',
    conductual_state: 'completado',
    integridad_state: 'completado',
    anti_cheat_events: [],
    ia_summary: '',
    timeline: [],
    disc: typeof s.disc_norm_d === 'number' ? {
      d: Number(s.disc_norm_d),
      i: Number(s.disc_norm_i ?? 0),
      s: Number(s.disc_norm_s ?? 0),
      c: Number(s.disc_norm_c ?? 0),
      dominant_label: typeof s.disc_perfil_dominante === 'string' ? s.disc_perfil_dominante : '',
      pk_profile_code: '',
      pk_profile_name: '',
      similitud_pct: 0,
    } : undefined,
    velna: typeof s.velna_indice === 'number' ? {
      verbal: Number(s.velna_verbal ?? 0),
      espacial: Number(s.velna_espacial ?? 0),
      logica: Number(s.velna_logica ?? 0),
      numerica: Number(s.velna_numerica ?? 0),
      abstracta: Number(s.velna_abstracta ?? 0),
      similitud_pct: Number(s.velna_indice),
    } : undefined,
    tecnica: typeof s.tec_score_pct === 'number' ? {
      pct: tecPct,
      estado: s.tec_passed ? 'Aprobado' as const : 'No aprobado' as const,
      minimo_requerido_pct: 70,
    } : undefined,
    integridad: integrityDims.length > 0 ? {
      dimensions: integrityDims.map((d) => ({
        name: d.dimension,
        classification: (d.nivel === 'bajo' ? 'Bajo' : d.nivel === 'medio' ? 'Medio' : 'Alto') as 'Bajo' | 'Medio' | 'Alto',
        score_pct: d.pct,
      })),
      buena_impresion_alta: false,
      observations: integrityDims.filter((d) => d.nivel !== 'bajo').map((d) => `${d.dimension}: ${d.nivel} (${d.pct}%)`),
    } : (typeof s.int_overall_pct === 'number' ? {
      dimensions: [],
      buena_impresion_alta: false,
      observations: intPct > 30 ? [`Integridad general: ${intPct}% riesgo`] : [],
    } : undefined),
    emocional: typeof s.emo_score === 'number' ? {
      value: Number(s.emo_score),
      label: (typeof s.emo_perfil === 'string' && s.emo_perfil === 'espontaneo' ? 'Espontáneo' :
              typeof s.emo_perfil === 'string' && s.emo_perfil === 'reflexivo' ? 'Reflexivo' : 'Mesura') as 'Espontáneo' | 'Mesura' | 'Reflexivo',
    } : undefined,
  };
}
