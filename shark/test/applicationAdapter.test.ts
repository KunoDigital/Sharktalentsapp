/**
 * Tests del adapter applicationAdapter.ts.
 *
 * Verifica que la conversión ApiApplication + scores → mock Application sea correcta:
 * - Maneja scores null (test no completado todavía)
 * - Maneja integrity_dimensions vacío
 * - DISC se incluye solo si disc_norm_d existe
 * - VELNA se incluye solo si velna_indice existe
 * - Técnica se incluye solo si tec_score_pct existe
 * - Tec passed/no passed se mapea correctamente a estado
 */
import { describe, expect, it } from 'vitest';
import { adaptToMockApplication } from '../src/lib/applicationAdapter';

const baseApp = {
  ROWID: 'app_1',
  assessment_id: 'job_1',
  candidate_id: 'cand_1',
  pipeline_stage: 'finalist',
  started_at: '2026-04-15T10:00:00Z',
  completed_at: '2026-04-20T18:00:00Z',
};

const baseCandidate = {
  name: 'Luis Tejada',
  email: 'luis@example.com',
  phone: '+50760001234',
  age: 35,
};

describe('adaptToMockApplication', () => {
  it('mapea fields básicos correctamente', () => {
    const result = adaptToMockApplication(baseApp, baseCandidate, null, []);
    expect(result.id).toBe('app_1');
    expect(result.job_id).toBe('job_1');
    expect(result.candidate_name).toBe('Luis Tejada');
    expect(result.candidate_email).toBe('luis@example.com');
    expect(result.candidate_age).toBe(35);
    expect(result.state).toBe('finalist');
  });

  it('candidate undefined → fallback a "Candidato"', () => {
    const result = adaptToMockApplication(baseApp, undefined, null, []);
    expect(result.candidate_name).toBe('Candidato');
    expect(result.candidate_email).toBe('');
    expect(result.candidate_age).toBe(0);
  });

  it('source siempre es "direct" (no inventa linkedin/etc)', () => {
    const result = adaptToMockApplication(baseApp, baseCandidate, null, []);
    expect(result.source).toBe('direct');
  });

  it('scores null → DISC/VELNA/técnica/emocional son undefined', () => {
    const result = adaptToMockApplication(baseApp, baseCandidate, null, []);
    expect(result.disc).toBeUndefined();
    expect(result.velna).toBeUndefined();
    expect(result.tecnica).toBeUndefined();
    expect(result.emocional).toBeUndefined();
  });

  it('DISC se incluye solo si disc_norm_d existe', () => {
    const scores = { disc_norm_d: 70, disc_norm_i: 30, disc_norm_s: 20, disc_norm_c: 60, disc_perfil_dominante: 'D' };
    const result = adaptToMockApplication(baseApp, baseCandidate, scores, []);
    expect(result.disc).toBeDefined();
    expect(result.disc?.d).toBe(70);
    expect(result.disc?.dominant_label).toBe('D');
  });

  it('DISC no se incluye si disc_norm_d no es número', () => {
    const result = adaptToMockApplication(baseApp, baseCandidate, { other_field: 1 }, []);
    expect(result.disc).toBeUndefined();
  });

  it('VELNA se incluye solo si velna_indice existe', () => {
    const scores = { velna_indice: 75, velna_verbal: 70, velna_espacial: 60, velna_logica: 80, velna_numerica: 70, velna_abstracta: 65 };
    const result = adaptToMockApplication(baseApp, baseCandidate, scores, []);
    expect(result.velna).toBeDefined();
    expect(result.velna?.similitud_pct).toBe(75);
    expect(result.velna?.logica).toBe(80);
  });

  it('Técnica passed → estado "Aprobado"', () => {
    const scores = { tec_score_pct: 85, tec_passed: true };
    const result = adaptToMockApplication(baseApp, baseCandidate, scores, []);
    expect(result.tecnica?.estado).toBe('Aprobado');
    expect(result.tecnica?.pct).toBe(85);
  });

  it('Técnica passed=false → estado "No aprobado"', () => {
    const scores = { tec_score_pct: 45, tec_passed: false };
    const result = adaptToMockApplication(baseApp, baseCandidate, scores, []);
    expect(result.tecnica?.estado).toBe('No aprobado');
  });

  it('Integrity dimensions se mapean a observations solo si nivel != "bajo"', () => {
    const dims = [
      { dimension: 'Honestidad', nivel: 'bajo', pct: 10 },
      { dimension: 'Adicciones', nivel: 'medio', pct: 45 },
      { dimension: 'Violencia', nivel: 'alto', pct: 80 },
    ];
    const result = adaptToMockApplication(baseApp, baseCandidate, null, dims);
    expect(result.integridad?.dimensions).toHaveLength(3);
    expect(result.integridad?.observations).toHaveLength(2);  // medio + alto, no bajo
    expect(result.integridad?.observations[0]).toContain('Adicciones');
  });

  it('Integrity sin dimensions pero con int_overall_pct alto → genera observación general', () => {
    const result = adaptToMockApplication(baseApp, baseCandidate, { int_overall_pct: 50 }, []);
    expect(result.integridad?.observations[0]).toContain('50%');
  });

  it('Integrity sin dimensions y bajo riesgo → sin observaciones', () => {
    const result = adaptToMockApplication(baseApp, baseCandidate, { int_overall_pct: 15 }, []);
    expect(result.integridad?.observations).toHaveLength(0);
  });

  it('emo_perfil "espontaneo" se mapea a label "Espontáneo"', () => {
    const result = adaptToMockApplication(baseApp, baseCandidate, { emo_score: 70, emo_perfil: 'espontaneo' }, []);
    expect(result.emocional?.label).toBe('Espontáneo');
    expect(result.emocional?.value).toBe(70);
  });

  it('emo_perfil "reflexivo" se mapea a label "Reflexivo"', () => {
    const result = adaptToMockApplication(baseApp, baseCandidate, { emo_score: 65, emo_perfil: 'reflexivo' }, []);
    expect(result.emocional?.label).toBe('Reflexivo');
  });

  it('emo_perfil otro → label default "Mesura"', () => {
    const result = adaptToMockApplication(baseApp, baseCandidate, { emo_score: 60, emo_perfil: 'otro' }, []);
    expect(result.emocional?.label).toBe('Mesura');
  });

  it('integrity dimension nivel correcto se mapea a classification capitalizado', () => {
    const dims = [{ dimension: 'X', nivel: 'medio', pct: 50 }];
    const result = adaptToMockApplication(baseApp, baseCandidate, null, dims);
    expect(result.integridad?.dimensions[0].classification).toBe('Medio');
  });
});
