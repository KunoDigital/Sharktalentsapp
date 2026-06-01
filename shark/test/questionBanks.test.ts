/**
 * Validador de los bancos de preguntas (mindset + inglés A2/B1/B2/C1).
 *
 * Verifica estructura, calibración, IDs únicos, opciones válidas, índices `correct`
 * dentro de rango. Si algún banco se corrompe o se edita mal, este test lo agarra antes
 * de que rompa el flow del candidato.
 */
import { describe, it, expect } from 'vitest';
import mindsetBank from '../src/data/questions/mindset.json';
import englishA2 from '../src/data/questions/english-a2.json';
import englishB1 from '../src/data/questions/english-b1.json';
import englishB2 from '../src/data/questions/english-b2.json';
import englishC1 from '../src/data/questions/english-c1.json';
import englishConfig from '../src/data/english-config.json';
import mindsetConfig from '../src/data/mindset-config.json';

const VALID_MENTALIDADES = [
  'fija', 'crecimiento',
  'experto', 'curiosa',
  'reactiva', 'creativa',
  'victima', 'agente',
  'escasez', 'abundancia',
  'certeza', 'exploracion',
  'proteccion', 'oportunidad',
];

describe('Mindset bank — mindset.json', () => {
  it('tiene exactamente 10 preguntas', () => {
    expect(mindsetBank).toHaveLength(10);
  });

  it('todas las preguntas tienen 6 opciones', () => {
    for (const q of mindsetBank) {
      expect(q.options).toHaveLength(6);
      expect(q.dimension).toHaveLength(6);
    }
  });

  it('todos los IDs son únicos', () => {
    const ids = mindsetBank.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cada dimension es una mentalidad válida', () => {
    for (const q of mindsetBank) {
      for (const dim of q.dimension) {
        expect(VALID_MENTALIDADES).toContain(dim);
      }
    }
  });

  it('cada pregunta tiene un `text` no vacío', () => {
    for (const q of mindsetBank) {
      expect(q.text).toBeTruthy();
      expect(q.text.length).toBeGreaterThan(20);
    }
  });

  it('correct es siempre null (no hay respuesta correcta)', () => {
    for (const q of mindsetBank) {
      expect(q.correct).toBeNull();
    }
  });
});

const englishBanks = [
  { name: 'A2', bank: englishA2 as Array<{ id: string; type: string; text: string; options: string[]; correct: number }> },
  { name: 'B1', bank: englishB1 as typeof englishA2 },
  { name: 'B2', bank: englishB2 as typeof englishA2 },
  { name: 'C1', bank: englishC1 as typeof englishA2 },
];

for (const { name, bank } of englishBanks) {
  describe(`English bank ${name}`, () => {
    it('tiene exactamente 40 preguntas', () => {
      expect(bank).toHaveLength(40);
    });

    it('IDs únicos y empiezan con prefijo del nivel', () => {
      const ids = bank.map((q) => q.id);
      expect(new Set(ids).size).toBe(ids.length);
      const prefix = name.toLowerCase();
      for (const id of ids) {
        expect(id.startsWith(prefix + '_')).toBe(true);
      }
    });

    it('todas las preguntas tienen 4 opciones', () => {
      for (const q of bank) {
        expect(q.options).toHaveLength(4);
      }
    });

    it('correct es índice válido (0-3)', () => {
      for (const q of bank) {
        expect(typeof q.correct).toBe('number');
        expect(q.correct).toBeGreaterThanOrEqual(0);
        expect(q.correct).toBeLessThanOrEqual(3);
      }
    });

    it('type es vocab/grammar/reading', () => {
      const validTypes = ['vocab', 'grammar', 'reading'];
      for (const q of bank) {
        expect(validTypes).toContain(q.type);
      }
    });

    it('distribución: 16 vocab + 16 grammar + 8 reading', () => {
      const counts = { vocab: 0, grammar: 0, reading: 0 };
      for (const q of bank) {
        counts[q.type as 'vocab' | 'grammar' | 'reading']++;
      }
      expect(counts.vocab).toBe(16);
      expect(counts.grammar).toBe(16);
      expect(counts.reading).toBe(8);
    });

    it('text no vacío', () => {
      for (const q of bank) {
        expect(q.text).toBeTruthy();
        expect(q.text.length).toBeGreaterThan(5);
      }
    });

    it('opciones no vacías ni duplicadas dentro de la pregunta', () => {
      for (const q of bank) {
        for (const opt of q.options) {
          expect(opt).toBeTruthy();
        }
        expect(new Set(q.options).size).toBe(q.options.length);
      }
    });
  });
}

describe('English config — english-config.json', () => {
  it('tiene los 4 niveles CEFR', () => {
    expect(englishConfig.levels.A2).toBeDefined();
    expect(englishConfig.levels.B1).toBeDefined();
    expect(englishConfig.levels.B2).toBeDefined();
    expect(englishConfig.levels.C1).toBeDefined();
  });

  it('thresholds son 60/65/70/75', () => {
    expect(englishConfig.levels.A2.pass_threshold_pct).toBe(60);
    expect(englishConfig.levels.B1.pass_threshold_pct).toBe(65);
    expect(englishConfig.levels.B2.pass_threshold_pct).toBe(70);
    expect(englishConfig.levels.C1.pass_threshold_pct).toBe(75);
  });

  it('weights del score total suman 1.0', () => {
    const sum = englishConfig.weights.multiple_choice + englishConfig.weights.listening + englishConfig.weights.writing;
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('listening tiene los 4 audios con scripts no vacíos + 2-3 preguntas', () => {
    const levels = ['A2', 'B1', 'B2', 'C1'] as const;
    for (const lvl of levels) {
      const audio = englishConfig.listening[lvl];
      expect(audio.script.length).toBeGreaterThan(50);
      expect(audio.questions.length).toBeGreaterThanOrEqual(2);
      for (const q of audio.questions) {
        expect(q.options).toHaveLength(4);
        expect(q.correct).toBeGreaterThanOrEqual(0);
        expect(q.correct).toBeLessThanOrEqual(3);
      }
    }
  });

  it('writing prompts presentes para los 4 niveles', () => {
    const levels = ['A2', 'B1', 'B2', 'C1'] as const;
    for (const lvl of levels) {
      const wp = englishConfig.writing_prompts[lvl];
      expect(wp.prompt.length).toBeGreaterThan(40);
      expect(wp.min_words).toBeGreaterThan(0);
    }
  });
});

describe('Mindset config — mindset-config.json', () => {
  it('tiene 7 ejes', () => {
    expect(Object.keys(mindsetConfig.axes)).toHaveLength(7);
  });

  it('mapeo mindset_to_axis cubre las 14 mentalidades', () => {
    expect(Object.keys(mindsetConfig.mindset_to_axis)).toHaveLength(14);
    for (const mentalidad of VALID_MENTALIDADES) {
      expect(mindsetConfig.mindset_to_axis).toHaveProperty(mentalidad);
    }
  });

  it('thresholds: adaptable >= 70, limitante <= 49', () => {
    expect(mindsetConfig.thresholds.adaptable_min_pct).toBe(70);
    expect(mindsetConfig.thresholds.limitante_max_pct).toBe(49);
  });
});
