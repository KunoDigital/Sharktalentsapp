/**
 * Adapta el response del backend `GET /report/bundle/<token>` al shape
 * que espera la UI de PublicReport.tsx (originalmente diseñada para mocks).
 *
 * Reglas:
 * - Campos que no vienen del backend (ej: salary_aspiration_usd, disponibilidad)
 *   se muestran como placeholders ("—" / "No declarado") — no inventamos.
 * - Si las narrativas IA fallaron (status=failed o partial), los campos narrativos
 *   se rellenan con strings vacíos/genéricos. La UI muestra un banner.
 * - El "afinidad %" usa `summary_score` del backend (NO es afinidad contra perfil ideal).
 */
import type {
  BundleReport,
  BundleCandidate,
  BundleCandidateNarrative,
  BundleVideoAnalysis,
  BundleMindset,
  BundleEnglish,
} from './publicApi';
import type { Application } from '../data/mockApplications';
import type { Job } from '../data/mockJobs';
import type { Report, ReportCandidateNarrative } from '../data/mockReports';

export type AdaptedReport = {
  job: Job;
  report: Report;
  applications: Application[];
  /** Videos analysis por application_id (solo análisis IA, sin transcripts crudos). */
  videosByApp: Record<string, BundleVideoAnalysis[]>;
  /** Score de mentalidades por application_id (si el candidato hizo el test). */
  mindsetByApp: Record<string, BundleMindset>;
  /** Sesión de inglés por application_id (si el candidato hizo el test). */
  englishByApp: Record<string, BundleEnglish>;
};

const EMPTY_NARRATIVE: BundleCandidateNarrative = {
  paragraph_intro: '',
  fortalezas: [],
  a_tomar_en_cuenta: [],
  estilo_decisiones: '',
  estilo_equipo: '',
  estilo_presion: '',
  estilo_comunicacion: '',
  perfil_emocional_text: '',
};

function affinityLabel(pct: number | null): 'Mejor afinidad' | 'Buena afinidad' | 'Afinidad moderada' {
  if (pct == null) return 'Afinidad moderada';
  if (pct >= 85) return 'Mejor afinidad';
  if (pct >= 70) return 'Buena afinidad';
  return 'Afinidad moderada';
}

function pickScore(scores: Record<string, unknown> | null, key: string): number | null {
  if (!scores) return null;
  const v = scores[key];
  return typeof v === 'number' ? v : null;
}

function emoLabel(perfil: string | null): string {
  if (perfil === 'espontaneo') return 'Espontáneo';
  if (perfil === 'mesura') return 'Mesura';
  if (perfil === 'reflexivo') return 'Reflexivo';
  return '—';
}

function adaptCandidate(
  bc: BundleCandidate,
  narrative: BundleCandidateNarrative,
  jobId: string,
): { app: Application; narrative: ReportCandidateNarrative } {
  const scores = bc.scores;
  const tecPct = pickScore(scores, 'tec_score_pct');
  const tecPassed = scores ? scores['tec_passed'] === true : false;
  const intPct = pickScore(scores, 'int_overall_pct');
  const emoScore = pickScore(scores, 'emo_score');
  const velnaIndice = pickScore(scores, 'velna_indice');
  const emoPerfil = scores && typeof scores['emo_perfil'] === 'string' ? (scores['emo_perfil'] as string) : null;

  // observations = dimensiones de integridad con nivel medio/alto
  const observations = bc.integrity_dimensions
    .filter((d) => d.nivel === 'medio' || d.nivel === 'alto')
    .map((d) => ({
      dimension: d.dimension,
      nivel: d.nivel as 'medio' | 'alto',
      pct: d.pct,
      note: '',
    }));

  const candidateName = bc.candidate?.name ?? 'Candidato';
  const candidateAge = bc.candidate?.age ?? 0;
  const candidateEmail = bc.candidate?.email_redacted ?? '';

  const app: Application = {
    id: bc.application_id,
    job_id: jobId,
    candidate_name: candidateName,
    candidate_email: candidateEmail,
    candidate_age: candidateAge,
    candidate_phone: '',
    source: 'linkedin' as Application['source'],
    state: 'finalist' as Application['state'],
    applied_at: bc.completed_at ?? '',
    salary_aspiration_usd: 0,
    disponibilidad: 'No declarado',
    tecnica_state: 'completado',
    conductual_state: 'completado',
    integridad_state: 'completado',
    anti_cheat_events: [],
    ia_summary: narrative.paragraph_intro,
    timeline: [],
    disc: scores ? {
      d: pickScore(scores, 'disc_norm_d') ?? 0,
      i: pickScore(scores, 'disc_norm_i') ?? 0,
      s: pickScore(scores, 'disc_norm_s') ?? 0,
      c: pickScore(scores, 'disc_norm_c') ?? 0,
      dominant_label: typeof scores['disc_perfil_dominante'] === 'string' ? (scores['disc_perfil_dominante'] as string) : '',
      pk_profile_code: '',
      pk_profile_name: '',
      similitud_pct: 0,
    } : undefined,
    velna: scores ? {
      verbal: pickScore(scores, 'velna_verbal') ?? 0,
      espacial: pickScore(scores, 'velna_espacial') ?? 0,
      logica: pickScore(scores, 'velna_logica') ?? 0,
      numerica: pickScore(scores, 'velna_numerica') ?? 0,
      abstracta: pickScore(scores, 'velna_abstracta') ?? 0,
      similitud_pct: velnaIndice ?? 0,
    } : undefined,
    integridad: intPct != null ? {
      dimensions: bc.integrity_dimensions.map((d) => ({
        name: d.dimension,
        classification: d.nivel === 'bajo' ? 'Bajo' : d.nivel === 'medio' ? 'Medio' : 'Alto',
        score_pct: d.pct,
      })),
      buena_impresion_alta: false,
      observations: observations.map((o) => `${o.dimension}: ${o.nivel} (${o.pct}%)`),
    } : undefined,
    emocional: emoScore != null ? {
      value: emoScore,
      label: emoLabel(emoPerfil) as 'Espontáneo' | 'Mesura' | 'Reflexivo',
    } : undefined,
    tecnica: tecPct != null ? {
      pct: tecPct,
      estado: tecPassed ? 'Aprobado' : 'No aprobado',
      minimo_requerido_pct: 70,
    } : undefined,
  };

  const summary = bc.summary_score;

  const reportNarrative: ReportCandidateNarrative = {
    application_id: bc.application_id,
    affinity_pct: summary ?? 0,
    affinity_label: affinityLabel(summary),
    paragraph_intro: narrative.paragraph_intro,
    afinidad_conductual: 0, // sin perfil ideal disc no podemos calcular afinidad real; mostrar 0
    afinidad_cognitiva: velnaIndice ?? 0,
    afinidad_tecnica: tecPct ?? 0,
    afinidad_integridad: intPct != null ? Math.max(0, 100 - intPct) : 0,
    afinidad_emocion: emoScore ?? 0,
    estilo_decisiones: narrative.estilo_decisiones,
    estilo_equipo: narrative.estilo_equipo,
    estilo_presion: narrative.estilo_presion,
    estilo_comunicacion: narrative.estilo_comunicacion,
    fortalezas: narrative.fortalezas,
    a_tomar_en_cuenta: narrative.a_tomar_en_cuenta,
    perfil_emocional_text: narrative.perfil_emocional_text,
  };

  return { app, narrative: reportNarrative };
}

export function adaptBundleReport(bundle: BundleReport, token: string): AdaptedReport {
  const ip = bundle.job.ideal_profile;
  const jobId = `bundle_${token.slice(0, 12)}`;

  const job: Job = {
    id: jobId,
    slug: jobId,
    title: bundle.job.title,
    client_company: bundle.job.company,
    client_industry: '',
    location: '',
    status: 'active',
    created_at: bundle.generated_at,
    applications_count: bundle.candidates.length,
    applications_in_progress: 0,
    finalists_count: bundle.candidates.length,
    fee_usd: 0,
    salary_range_usd: { min: 0, max: 0 },
    context: ip?.context_summary ?? '',
    disc_ideal_a: {
      d: ip?.disc?.d ?? 0,
      i: ip?.disc?.i ?? 0,
      s: ip?.disc?.s ?? 0,
      c: ip?.disc?.c ?? 0,
      pk_profile_code: ip?.disc?.pk_code ?? '',
      pk_profile_name: ip?.disc?.pk_name ?? '',
      description: [],
    },
    disc_ideal_b: ip?.disc_b ? {
      d: ip.disc_b.d,
      i: ip.disc_b.i,
      s: ip.disc_b.s,
      c: ip.disc_b.c,
      pk_profile_code: ip.disc_b.pk_code ?? '',
      pk_profile_name: ip.disc_b.pk_name ?? '',
      description: [],
    } : undefined,
    velna_ideal: ip?.velna ?? { verbal: 0, espacial: 0, logica: 0, numerica: 0, abstracta: 0 },
    competencias_ideales: ip?.competencias ?? [],
    tecnica_minimo_pct: ip?.tecnica_minimo_pct ?? 70,
  };

  const narrativesMap = bundle.narratives?.candidates ?? {};
  const adapted = bundle.candidates.map((bc) => {
    const narrative = narrativesMap[bc.application_id] ?? EMPTY_NARRATIVE;
    return adaptCandidate(bc, narrative, jobId);
  });

  const conclusion = bundle.narratives?.conclusion ?? {
    si_priorizas_autonomia: '',
    si_priorizas_crecimiento: '',
    menor_riesgo: '',
    mayor_potencial: '',
    recomendacion_final: '',
  };

  const report: Report = {
    token,
    job_id: jobId,
    tenant_name: '', // backend no lo expone hoy; UI usa el branding del header
    published_at: bundle.generated_at,
    status: 'published',
    candidate_app_ids: adapted.map((a) => a.app.id),
    narratives: Object.fromEntries(adapted.map((a) => [a.app.id, a.narrative])),
    conclusion,
  };

  // Videos analysis indexado por application_id (solo análisis IA, sin contenido crudo)
  const videosByApp: Record<string, BundleVideoAnalysis[]> = {};
  const mindsetByApp: Record<string, BundleMindset> = {};
  const englishByApp: Record<string, BundleEnglish> = {};

  for (const c of bundle.candidates) {
    if (c.videos && c.videos.length > 0) {
      videosByApp[c.application_id] = c.videos;
    }
    if (c.mindset) {
      mindsetByApp[c.application_id] = c.mindset;
    }
    if (c.english) {
      englishByApp[c.application_id] = c.english;
    }
  }

  return {
    job,
    report,
    applications: adapted.map((a) => a.app),
    videosByApp,
    mindsetByApp,
    englishByApp,
  };
}
