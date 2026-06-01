import { describe, expect, it } from 'vitest';
import { _internal } from '../src/lib/techQuestions';

const { buildTechPrompt, validateQuestion } = _internal;

describe('buildTechPrompt', () => {
  it('incluye todos los datos del puesto', () => {
    const p = buildTechPrompt({
      jobTitle: 'Backend Engineer',
      jobCompany: 'AcmeTech',
      techPrompt: 'Buscamos alguien con Node.js y SQL',
      level: 'mid',
      count: 12,
    });
    expect(p).toContain('Backend Engineer');
    expect(p).toContain('AcmeTech');
    expect(p).toContain('Node.js y SQL');
    expect(p).toContain('NIVEL: mid');
    expect(p).toContain('CANTIDAD DE PREGUNTAS: 12');
  });

  it('omite company si no viene', () => {
    const p = buildTechPrompt({
      jobTitle: 'X',
      techPrompt: 'Y',
      level: 'basic',
      count: 8,
    });
    expect(p).toContain('PUESTO: X');
    expect(p).not.toContain('—');
  });
});

describe('validateQuestion', () => {
  it('rechaza no-objeto', () => {
    expect(validateQuestion('string', 0)).toBe(null);
    expect(validateQuestion(null, 0)).toBe(null);
    expect(validateQuestion(123, 0)).toBe(null);
  });

  it('rechaza si options no son 4', () => {
    expect(validateQuestion({ text: 'x', options: ['a', 'b'], correct: 0 }, 0)).toBe(null);
    expect(validateQuestion({ text: 'x', options: ['a', 'b', 'c', 'd', 'e'], correct: 0 }, 0)).toBe(null);
  });

  it('rechaza si correct fuera de rango', () => {
    expect(validateQuestion({ text: 'x', options: ['a', 'b', 'c', 'd'], correct: 4 }, 0)).toBe(null);
    expect(validateQuestion({ text: 'x', options: ['a', 'b', 'c', 'd'], correct: -1 }, 0)).toBe(null);
  });

  it('rechaza si text vacío', () => {
    expect(validateQuestion({ text: '', options: ['a', 'b', 'c', 'd'], correct: 0 }, 0)).toBe(null);
    expect(validateQuestion({ text: '   ', options: ['a', 'b', 'c', 'd'], correct: 0 }, 0)).toBe(null);
  });

  it('genera id default si no viene', () => {
    const q = validateQuestion({ text: 'q', options: ['a', 'b', 'c', 'd'], correct: 1 }, 4);
    expect(q?.id).toBe('tq_5');
  });

  it('preserva rationale si viene', () => {
    const q = validateQuestion({
      id: 'q1',
      text: '¿Qué hace map?',
      options: ['itera', 'filtra', 'reduce', 'ordena'],
      correct: 0,
      rationale: 'Conceptos de FP',
    }, 0);
    expect(q?.rationale).toBe('Conceptos de FP');
  });

  it('trimea text/options largos', () => {
    const longText = 'x'.repeat(2000);
    const q = validateQuestion({
      text: longText,
      options: ['a'.repeat(500), 'b', 'c', 'd'],
      correct: 0,
    }, 0);
    expect(q?.text.length).toBe(1000);
    expect(q?.options[0].length).toBe(300);
  });
});
