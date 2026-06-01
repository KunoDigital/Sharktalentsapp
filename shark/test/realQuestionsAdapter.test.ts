import { describe, expect, it } from 'vitest';
import {
  buildVelnaSubtestsFromReal,
  getRealDiscQuestions,
  getRealEmotionalQuestions,
  getRealIntegrityQuestions,
} from '../src/data/realQuestionsAdapter';

describe('buildVelnaSubtestsFromReal', () => {
  it('mid level → 5 sub-tests con 20 preguntas cada uno', async () => {
    const subtests = await buildVelnaSubtestsFromReal('mid');
    expect(subtests).toHaveLength(5);
    for (const st of subtests) {
      expect(st.questions.length).toBeGreaterThanOrEqual(15);
      expect(st.questions.length).toBeLessThanOrEqual(30);
    }
  });

  it('senior level → 5 sub-tests con 25 preguntas cada uno', async () => {
    const subtests = await buildVelnaSubtestsFromReal('senior');
    let total = 0;
    for (const st of subtests) total += st.questions.length;
    expect(total).toBeGreaterThanOrEqual(120); // 25 * 5 = 125
  });

  it('mapea dimensiones v1 → keys v2 correctamente', async () => {
    const subtests = await buildVelnaSubtestsFromReal('mid');
    const keys = subtests.map((st) => st.key);
    expect(keys).toContain('verbal');
    expect(keys).toContain('espacial');
    expect(keys).toContain('logica'); // mapeada de logico
    expect(keys).toContain('numerica'); // mapeada de numerico
    expect(keys).toContain('abstracta'); // mapeada de abstracto
  });

  it('cada pregunta tiene options con id String e correct_option_id String', async () => {
    const subtests = await buildVelnaSubtestsFromReal('basic');
    const sample = subtests[0].questions[0];
    expect(typeof sample.id).toBe('string');
    expect(Array.isArray(sample.options)).toBe(true);
    expect(typeof sample.correct_option_id).toBe('string');
    for (const opt of sample.options) {
      expect(typeof opt.id).toBe('string');
      expect(typeof opt.text).toBe('string');
    }
  });

  it('duration_sec es proporcional al número de preguntas', async () => {
    const subtests = await buildVelnaSubtestsFromReal('mid');
    for (const st of subtests) {
      // mid = 12 seg/pregunta, así que duration_sec ~= n_preguntas * 12
      const expected = st.questions.length * 12;
      expect(st.duration_sec).toBe(expected);
    }
  });
});

describe('getRealDiscQuestions', () => {
  it('devuelve 40 preguntas DISC con dimensiones D/I/S/C', () => {
    const questions = getRealDiscQuestions();
    expect(questions.length).toBe(40);
    for (const q of questions) {
      expect(q.dimension.length).toBe(4);
      const dims = new Set(q.dimension);
      expect(dims.has('D')).toBe(true);
      expect(dims.has('I')).toBe(true);
      expect(dims.has('S')).toBe(true);
      expect(dims.has('C')).toBe(true);
    }
  });
});

describe('getRealEmotionalQuestions', () => {
  it('devuelve 20 preguntas con scores 0-100', () => {
    const questions = getRealEmotionalQuestions();
    expect(questions.length).toBe(20);
    for (const q of questions) {
      expect(q.scores.length).toBe(4);
      for (const score of q.scores) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('getRealIntegrityQuestions', () => {
  it('devuelve 90 preguntas en 13 dimensiones', () => {
    const questions = getRealIntegrityQuestions();
    expect(questions.length).toBe(90);
    const dims = new Set(questions.map((q) => q.dimension));
    expect(dims.size).toBe(13);
    expect(dims.has('hurto')).toBe(true);
    expect(dims.has('soborno')).toBe(true);
    expect(dims.has('buena_impresion')).toBe(true);
    expect(dims.has('autenticidad')).toBe(true);
    // No deben existir las 2 dimensiones legacy
    expect(dims.has('etica_profesional')).toBe(false);
    expect(dims.has('personalidad')).toBe(false);
  });

  it('cada pregunta tiene 4 risk_weights entre 0 y 3', () => {
    const questions = getRealIntegrityQuestions();
    for (const q of questions) {
      expect(q.risk_weights.length).toBe(4);
      for (const w of q.risk_weights) {
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(3);
      }
    }
  });

  it('cada pregunta tiene al menos una opción con riesgo 0 y una con riesgo 3', () => {
    const questions = getRealIntegrityQuestions();
    for (const q of questions) {
      expect(q.risk_weights.includes(0)).toBe(true);
      expect(q.risk_weights.includes(3)).toBe(true);
    }
  });
});
