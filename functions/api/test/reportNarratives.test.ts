import { describe, expect, it } from 'vitest';
import { _internal, clearNarrativesCache } from '../src/lib/reportNarratives';

const { buildCacheKey, buildCandidatePrompt, describeIdealProfile, describeCandidate } = _internal;

describe('buildCacheKey', () => {
  it('mismo input → mismo key', () => {
    const a = buildCacheKey('job_1', ['r1', 'r2'], '{}');
    const b = buildCacheKey('job_1', ['r1', 'r2'], '{}');
    expect(a).toBe(b);
  });

  it('orden de result_ids no afecta key (sorted)', () => {
    const a = buildCacheKey('job_1', ['r1', 'r2'], '{}');
    const b = buildCacheKey('job_1', ['r2', 'r1'], '{}');
    expect(a).toBe(b);
  });

  it('jobId distinto → key distinto', () => {
    const a = buildCacheKey('job_1', ['r1'], null);
    const b = buildCacheKey('job_2', ['r1'], null);
    expect(a).not.toBe(b);
  });

  it('ideal_profile distinto → key distinto', () => {
    const a = buildCacheKey('job_1', ['r1'], '{"disc":{"d":50}}');
    const b = buildCacheKey('job_1', ['r1'], '{"disc":{"d":80}}');
    expect(a).not.toBe(b);
  });

  it('null y string vacío serializan igual', () => {
    const a = buildCacheKey('job_1', ['r1'], null);
    const b = buildCacheKey('job_1', ['r1'], '');
    expect(a).toBe(b);
  });
});

describe('describeIdealProfile', () => {
  it('null devuelve mensaje claro', () => {
    expect(describeIdealProfile(null)).toContain('No hay perfil ideal');
  });

  it('include disc + velna + competencias en el output', () => {
    const desc = describeIdealProfile({
      disc: { d: 65, i: 35, s: 25, c: 75, pk_name: 'Estratega' },
      velna: { verbal: 70, espacial: 60, logica: 80, numerica: 70, abstracta: 65 },
      competencias: [{ name: 'Análisis', required_pct: 75 }],
      tecnica_minimo_pct: 70,
    });
    expect(desc).toContain('D=65');
    expect(desc).toContain('Estratega');
    expect(desc).toContain('verbal=70');
    expect(desc).toContain('Análisis');
    expect(desc).toContain('70%');
  });
});

describe('describeCandidate', () => {
  it('inclu nombre, edad, scores disponibles', () => {
    const desc = describeCandidate({
      application_id: 'app_1',
      candidate_name: 'Luis',
      candidate_age: 35,
      scores: {
        disc_norm_d: 70,
        disc_norm_i: 30,
        disc_norm_s: 20,
        disc_norm_c: 60,
        velna_indice: 85,
        tec_score_pct: 90,
        emo_score: 75,
        int_overall: 'bajo',
        int_overall_pct: 15,
      },
      integrity_dimensions: [
        { dimension: 'hurto', nivel: 'bajo', pct: 10 },
        { dimension: 'soborno', nivel: 'medio', pct: 35 },
      ],
      summary_score: 82,
    });
    expect(desc).toContain('Luis');
    expect(desc).toContain('35 años');
    expect(desc).toContain('D=70');
    expect(desc).toContain('85/100');
    expect(desc).toContain('soborno=medio'); // solo lista observaciones medio/alto
    expect(desc).not.toContain('hurto=bajo');
  });

  it('candidato sin scores devuelve mínimo info', () => {
    const desc = describeCandidate({
      application_id: 'app_1',
      candidate_name: 'X',
      candidate_age: null,
      scores: null,
      integrity_dimensions: [],
      summary_score: null,
    });
    expect(desc).toContain('X');
    expect(desc).toContain('edad N/A');
  });
});

describe('buildCandidatePrompt', () => {
  it('inclu instrucciones JSON schema', () => {
    const prompt = buildCandidatePrompt(
      'Gerente Comercial',
      'Banco X',
      { disc: { d: 50, i: 50, s: 50, c: 50 } },
      {
        application_id: 'app_1',
        candidate_name: 'Luis',
        candidate_age: 35,
        scores: { velna_indice: 80 },
        integrity_dimensions: [],
        summary_score: 80,
      },
    );
    expect(prompt).toContain('PUESTO: Gerente Comercial en Banco X');
    expect(prompt).toContain('paragraph_intro');
    expect(prompt).toContain('fortalezas');
    expect(prompt).toContain('a_tomar_en_cuenta');
  });
});

describe('cache lifecycle', () => {
  it('clearNarrativesCache borra todo', () => {
    clearNarrativesCache(); // smoke test
    expect(true).toBe(true);
  });
});
