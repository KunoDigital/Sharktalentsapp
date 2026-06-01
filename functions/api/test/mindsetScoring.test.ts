import { describe, it, expect } from 'vitest';
import { scoreMindsetAnswers, MINDSET_TO_AXIS, type MindsetAnswer, type Mentalidad } from '../src/lib/mindsetScoring';

function makeAnswer(id: string, mentalidad: Mentalidad): MindsetAnswer {
  return { question_id: id, chosen_mentalidad: mentalidad };
}

describe('mindsetScoring.scoreMindsetAnswers', () => {
  it('candidato 100% adaptable → adaptability 100% + pattern adaptable', () => {
    const answers: MindsetAnswer[] = [
      makeAnswer('m1', 'crecimiento'),
      makeAnswer('m2', 'curiosa'),
      makeAnswer('m3', 'creativa'),
      makeAnswer('m4', 'agente'),
      makeAnswer('m5', 'abundancia'),
      makeAnswer('m6', 'exploracion'),
      makeAnswer('m7', 'oportunidad'),
      makeAnswer('m8', 'crecimiento'),
      makeAnswer('m9', 'agente'),
      makeAnswer('m10', 'creativa'),
    ];
    const result = scoreMindsetAnswers(answers);
    expect(result.adaptability_score_pct).toBe(100);
    expect(result.adaptability_pattern).toBe('adaptable');
    expect(result.total_answers).toBe(10);
  });

  it('candidato 100% limitante → adaptability 0% + pattern limitante', () => {
    const answers: MindsetAnswer[] = [
      makeAnswer('m1', 'fija'),
      makeAnswer('m2', 'experto'),
      makeAnswer('m3', 'reactiva'),
      makeAnswer('m4', 'victima'),
      makeAnswer('m5', 'escasez'),
      makeAnswer('m6', 'certeza'),
      makeAnswer('m7', 'proteccion'),
      makeAnswer('m8', 'fija'),
      makeAnswer('m9', 'victima'),
      makeAnswer('m10', 'reactiva'),
    ];
    const result = scoreMindsetAnswers(answers);
    expect(result.adaptability_score_pct).toBe(0);
    expect(result.adaptability_pattern).toBe('limitante');
  });

  it('candidato 50/50 → mixto', () => {
    const answers: MindsetAnswer[] = [
      makeAnswer('m1', 'crecimiento'),  // adaptable
      makeAnswer('m2', 'experto'),      // limitante
      makeAnswer('m3', 'creativa'),     // adaptable
      makeAnswer('m4', 'victima'),      // limitante
      makeAnswer('m5', 'abundancia'),   // adaptable
      makeAnswer('m6', 'certeza'),      // limitante
      makeAnswer('m7', 'oportunidad'),  // adaptable
      makeAnswer('m8', 'fija'),         // limitante
      makeAnswer('m9', 'agente'),       // adaptable
      makeAnswer('m10', 'reactiva'),    // limitante
    ];
    const result = scoreMindsetAnswers(answers);
    expect(result.adaptability_score_pct).toBe(50);
    expect(result.adaptability_pattern).toBe('mixto');
  });

  it('borderline 70% → adaptable (incluye exactly threshold)', () => {
    // 7 adaptables + 3 limitantes = 70%
    const answers: MindsetAnswer[] = [
      makeAnswer('m1', 'crecimiento'),
      makeAnswer('m2', 'curiosa'),
      makeAnswer('m3', 'creativa'),
      makeAnswer('m4', 'agente'),
      makeAnswer('m5', 'abundancia'),
      makeAnswer('m6', 'exploracion'),
      makeAnswer('m7', 'oportunidad'),
      makeAnswer('m8', 'fija'),
      makeAnswer('m9', 'experto'),
      makeAnswer('m10', 'reactiva'),
    ];
    const result = scoreMindsetAnswers(answers);
    expect(result.adaptability_score_pct).toBe(70);
    expect(result.adaptability_pattern).toBe('adaptable');
  });

  it('borderline 49% → limitante (incluye exactly threshold)', () => {
    // 49% adaptable. Necesitamos 49/100 → con 100 respuestas. Reducimos a 49 adaptables / 51 limitantes.
    const answers: MindsetAnswer[] = [];
    for (let i = 0; i < 49; i++) answers.push(makeAnswer(`a${i}`, 'crecimiento'));
    for (let i = 0; i < 51; i++) answers.push(makeAnswer(`l${i}`, 'fija'));
    const result = scoreMindsetAnswers(answers);
    expect(result.adaptability_score_pct).toBe(49);
    expect(result.adaptability_pattern).toBe('limitante');
  });

  it('per_mentalidad_count refleja exactamente las elecciones', () => {
    const answers: MindsetAnswer[] = [
      makeAnswer('m1', 'crecimiento'),
      makeAnswer('m2', 'crecimiento'),
      makeAnswer('m3', 'agente'),
    ];
    const result = scoreMindsetAnswers(answers);
    expect(result.per_mentalidad_count.crecimiento).toBe(2);
    expect(result.per_mentalidad_count.agente).toBe(1);
    expect(result.per_mentalidad_count.fija).toBe(0);
    expect(result.total_answers).toBe(3);
  });

  it('per_mentalidad_pct suma ~100', () => {
    const answers: MindsetAnswer[] = [
      makeAnswer('m1', 'crecimiento'),
      makeAnswer('m2', 'agente'),
      makeAnswer('m3', 'creativa'),
      makeAnswer('m4', 'curiosa'),
    ];
    const result = scoreMindsetAnswers(answers);
    const sum = Object.values(result.per_mentalidad_pct).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThanOrEqual(99);
    expect(sum).toBeLessThanOrEqual(101);
  });

  it('throws si no hay respuestas', () => {
    expect(() => scoreMindsetAnswers([])).toThrow(/at least one/);
  });

  it('throws si todas las respuestas son inválidas', () => {
    const answers = [
      { question_id: 'x', chosen_mentalidad: 'inexistente' as Mentalidad },
    ];
    expect(() => scoreMindsetAnswers(answers)).toThrow(/no valid answers/);
  });

  it('MINDSET_TO_AXIS cubre las 14 mentalidades con sus polos correctos', () => {
    expect(MINDSET_TO_AXIS.crecimiento).toEqual({ axis: 1, polo: 'adaptable' });
    expect(MINDSET_TO_AXIS.fija).toEqual({ axis: 1, polo: 'limitante' });
    expect(MINDSET_TO_AXIS.oportunidad).toEqual({ axis: 7, polo: 'adaptable' });
    expect(MINDSET_TO_AXIS.proteccion).toEqual({ axis: 7, polo: 'limitante' });
    expect(Object.keys(MINDSET_TO_AXIS)).toHaveLength(14);
  });
});
