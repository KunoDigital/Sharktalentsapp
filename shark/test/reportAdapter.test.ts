import { describe, expect, it } from 'vitest';
import { adaptBundleReport } from '../src/lib/reportAdapter';
import type { BundleReport } from '../src/lib/publicApi';

const baseBundle: BundleReport = {
  generated_at: '2026-05-01T10:00:00Z',
  job: {
    title: 'Gerente Comercial',
    company: 'Banco Pacífico',
    cognitive_level: 'mid',
    ideal_profile: {
      disc: { d: 65, i: 35, s: 25, c: 75, pk_code: 'PK-09', pk_name: 'Estratega' },
      velna: { verbal: 70, espacial: 60, logica: 80, numerica: 70, abstracta: 65 },
      competencias: [
        { name: 'Análisis', required_pct: 75 },
        { name: 'Negociación', required_pct: 80 },
      ],
      tecnica_minimo_pct: 70,
      context_summary: 'Banco PyME',
    },
  },
  candidates: [
    {
      application_id: 'app_1',
      pipeline_stage: 'finalist',
      completed_at: '2026-04-30T15:00:00Z',
      candidate: { name: 'Luis Tejada', email_redacted: 'l***s@bp.com', age: 35 },
      scores: {
        disc_norm_d: 70, disc_norm_i: 30, disc_norm_s: 20, disc_norm_c: 60,
        disc_perfil_dominante: 'D',
        velna_verbal: 80, velna_espacial: 70, velna_logica: 85, velna_numerica: 75, velna_abstracta: 75,
        velna_indice: 77,
        emo_score: 70, emo_perfil: 'mesura',
        tec_score_pct: 90, tec_passed: true,
        int_overall: 'bajo', int_overall_pct: 15,
      },
      integrity_dimensions: [
        { dimension: 'hurto', nivel: 'bajo', pct: 10 },
        { dimension: 'soborno', nivel: 'medio', pct: 35 },
      ],
      summary_score: 82,
    },
  ],
  narratives: {
    candidates: {
      app_1: {
        paragraph_intro: 'Luis es un profesional sólido.',
        fortalezas: ['Experiencia banca PyME', 'Resiliente'],
        a_tomar_en_cuenta: ['Salario alto'],
        estilo_decisiones: 'Decide rápido.',
        estilo_equipo: 'Líder.',
        estilo_presion: 'Mantiene calma.',
        estilo_comunicacion: 'Directo.',
        perfil_emocional_text: 'Mesurado.',
      },
    },
    conclusion: {
      si_priorizas_autonomia: 'Luis es la opción.',
      si_priorizas_crecimiento: 'Luis trae red.',
      menor_riesgo: 'Luis estable.',
      mayor_potencial: 'Luis tiene techo.',
      recomendacion_final: 'Recomendamos a Luis.',
    },
    generated_at: '2026-05-01T10:00:05Z',
    status: 'ok',
  },
  summary: {
    total_finalists: 1,
    ordered_by_score: ['app_1'],
    best_application_id: 'app_1',
  },
};

describe('adaptBundleReport — job', () => {
  it('mapea title + company + cognitive_level', () => {
    const r = adaptBundleReport(baseBundle, 'tok_x');
    expect(r.job.title).toBe('Gerente Comercial');
    expect(r.job.client_company).toBe('Banco Pacífico');
  });

  it('extrae disc_ideal_a desde ideal_profile.disc', () => {
    const r = adaptBundleReport(baseBundle, 'tok_x');
    expect(r.job.disc_ideal_a.d).toBe(65);
    expect(r.job.disc_ideal_a.pk_profile_code).toBe('PK-09');
    expect(r.job.disc_ideal_a.pk_profile_name).toBe('Estratega');
  });

  it('disc_ideal_b undefined si no viene', () => {
    const r = adaptBundleReport(baseBundle, 'tok_x');
    expect(r.job.disc_ideal_b).toBeUndefined();
  });

  it('mapea velna_ideal y competencias_ideales', () => {
    const r = adaptBundleReport(baseBundle, 'tok_x');
    expect(r.job.velna_ideal.logica).toBe(80);
    expect(r.job.competencias_ideales).toHaveLength(2);
    expect(r.job.competencias_ideales[0].name).toBe('Análisis');
  });

  it('si no hay ideal_profile, defaults sensibles', () => {
    const noIp: BundleReport = { ...baseBundle, job: { ...baseBundle.job, ideal_profile: null } };
    const r = adaptBundleReport(noIp, 'tok_x');
    expect(r.job.disc_ideal_a.d).toBe(0);
    expect(r.job.velna_ideal.verbal).toBe(0);
    expect(r.job.competencias_ideales).toEqual([]);
    expect(r.job.tecnica_minimo_pct).toBe(70); // default
  });
});

describe('adaptBundleReport — candidates', () => {
  it('mapea nombre, edad, email_redacted', () => {
    const r = adaptBundleReport(baseBundle, 'tok_x');
    expect(r.applications[0].candidate_name).toBe('Luis Tejada');
    expect(r.applications[0].candidate_age).toBe(35);
    expect(r.applications[0].candidate_email).toBe('l***s@bp.com');
  });

  it('extrae DISC scores', () => {
    const r = adaptBundleReport(baseBundle, 'tok_x');
    expect(r.applications[0].disc?.d).toBe(70);
    expect(r.applications[0].disc?.dominant_label).toBe('D');
  });

  it('similitud_pct de velna usa velna_indice', () => {
    const r = adaptBundleReport(baseBundle, 'tok_x');
    expect(r.applications[0].velna?.similitud_pct).toBe(77);
  });

  it('integridad observations filtra solo medio/alto', () => {
    const r = adaptBundleReport(baseBundle, 'tok_x');
    expect(r.applications[0].integridad?.observations).toHaveLength(1);
    expect(r.applications[0].integridad?.observations[0]).toContain('soborno');
    expect(r.applications[0].integridad?.observations[0]).toContain('medio');
  });

  it('tecnica.estado mapea pasó/no pasó a Aprobado/No aprobado', () => {
    const r = adaptBundleReport(baseBundle, 'tok_x');
    expect(r.applications[0].tecnica?.estado).toBe('Aprobado');
  });

  it('emocional.label mapea perfil', () => {
    const r = adaptBundleReport(baseBundle, 'tok_x');
    expect(r.applications[0].emocional?.label).toBe('Mesura');
  });

  it('candidato sin scores no rompe', () => {
    const noScores: BundleReport = {
      ...baseBundle,
      candidates: [{
        ...baseBundle.candidates[0],
        scores: null,
        integrity_dimensions: [],
        candidate: null,
      }],
    };
    const r = adaptBundleReport(noScores, 'tok_x');
    expect(r.applications[0].candidate_name).toBe('Candidato');
    expect(r.applications[0].disc).toBeUndefined();
    expect(r.applications[0].tecnica).toBeUndefined();
  });
});

describe('adaptBundleReport — narratives', () => {
  it('reportNarrative incluye paragraph_intro y fortalezas', () => {
    const r = adaptBundleReport(baseBundle, 'tok_x');
    const n = r.report.narratives['app_1'];
    expect(n.paragraph_intro).toBe('Luis es un profesional sólido.');
    expect(n.fortalezas).toEqual(['Experiencia banca PyME', 'Resiliente']);
  });

  it('affinity_pct usa summary_score', () => {
    const r = adaptBundleReport(baseBundle, 'tok_x');
    expect(r.report.narratives['app_1'].affinity_pct).toBe(82);
    expect(r.report.narratives['app_1'].affinity_label).toBe('Buena afinidad');
  });

  it('classify >=85 = Mejor afinidad', () => {
    const high: BundleReport = {
      ...baseBundle,
      candidates: [{ ...baseBundle.candidates[0], summary_score: 90 }],
    };
    const r = adaptBundleReport(high, 'tok_x');
    expect(r.report.narratives['app_1'].affinity_label).toBe('Mejor afinidad');
  });

  it('si no hay narrativas, fields vacíos', () => {
    const noNarr: BundleReport = { ...baseBundle, narratives: null };
    const r = adaptBundleReport(noNarr, 'tok_x');
    expect(r.report.narratives['app_1'].paragraph_intro).toBe('');
    expect(r.report.narratives['app_1'].fortalezas).toEqual([]);
  });

  it('conclusion se preserva', () => {
    const r = adaptBundleReport(baseBundle, 'tok_x');
    expect(r.report.conclusion.recomendacion_final).toBe('Recomendamos a Luis.');
  });

  it('afinidad_integridad invierte int_overall_pct', () => {
    const r = adaptBundleReport(baseBundle, 'tok_x');
    // int_overall_pct=15 → 85 invertido
    expect(r.report.narratives['app_1'].afinidad_integridad).toBe(85);
  });
});
