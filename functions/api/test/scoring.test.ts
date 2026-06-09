import { describe, expect, it } from 'vitest';
import {
  scoreDisc,
  normalizeDiscRaw,
  calculateDiscSimilarity,
  discDominantAxis,
  scoreCognitive,
  scoreEmotional,
  scoreIntegrity,
  scoreTechnical,
  classifyIntegrityPct,
  velnaAggregate,
  velnaSimilarity,
  calculateTechnicalScore,
  type DiscQuestion,
  type CognitiveQuestion,
  type EmotionalQuestion,
  type IntegrityQuestion,
} from '../src/lib/scoring';

describe('scoreDisc — forced choice format del v1', () => {
  const questions: DiscQuestion[] = [
    { id: 'q1', text: '...', options: ['a', 'b', 'c', 'd'], dimension: ['D', 'I', 'S', 'C'] },
    { id: 'q2', text: '...', options: ['a', 'b', 'c', 'd'], dimension: ['D', 'C', 'I', 'S'] },
    { id: 'q3', text: '...', options: ['a', 'b', 'c', 'd'], dimension: ['I', 'D', 'C', 'S'] },
  ];

  it('cuenta correctamente cada dimensión elegida', () => {
    const r = scoreDisc(questions, { q1: 0, q2: 0, q3: 1 });
    // q1 → D, q2 → D, q3 → D (idx 1 = D en q3)
    expect(r.d).toBe(3);
    expect(r.i).toBe(0);
    expect(r.s).toBe(0);
    expect(r.c).toBe(0);
    expect(r.perfil_dominante).toBe('D');
  });

  it('ignora preguntas sin respuesta', () => {
    const r = scoreDisc(questions, { q1: 0 });
    expect(r.d).toBe(1);
    expect(r.total_questions).toBe(3);
  });

  it('detecta dominante con empate por orden D > I > S > C', () => {
    const r = scoreDisc(questions, { q1: 1, q2: 2, q3: 0 });
    // q1 → I, q2 → I, q3 → I → I dominante
    expect(r.perfil_dominante).toBe('I');
  });
});

describe('scoreCognitive — VELNA del v1', () => {
  const questions: CognitiveQuestion[] = [
    { id: 'q1', text: '...', options: ['a', 'b'], dimension: 'verbal', correct: 0 },
    { id: 'q2', text: '...', options: ['a', 'b'], dimension: 'verbal', correct: 1 },
    { id: 'q3', text: '...', options: ['a', 'b'], dimension: 'numerico', correct: 0 },
    { id: 'q4', text: '...', options: ['a', 'b'], dimension: 'logico', correct: 1 },
  ];

  it('mapea logico→logica, numerico→numerica, abstracto→abstracta', () => {
    const r = scoreCognitive(questions, { q1: 0, q2: 1, q3: 0, q4: 1 });
    expect(r.verbal).toBe(2);
    expect(r.numerica).toBe(1); // mapeada de numerico
    expect(r.logica).toBe(1); // mapeada de logico
    expect(r.total).toBe(4);
  });

  it('calcula indice como promedio de pcts por sub-test (no global)', () => {
    // verbal: 2/2=100, numerica: 1/1=100, logica: 1/1=100
    // promedio = 100 (los 3 que tienen preguntas)
    const r = scoreCognitive(questions, { q1: 0, q2: 1, q3: 0, q4: 1 });
    expect(r.indice).toBe(100);
  });

  it('todo incorrecto → 0 en todo', () => {
    const r = scoreCognitive(questions, { q1: 1, q2: 0, q3: 1, q4: 0 });
    expect(r.total).toBe(0);
    expect(r.indice).toBe(0);
  });
});

describe('scoreEmotional — del v1', () => {
  const questions: EmotionalQuestion[] = [
    { id: 'e1', text: '...', options: ['a', 'b', 'c', 'd'], scores: [0, 33, 66, 100] },
    { id: 'e2', text: '...', options: ['a', 'b', 'c', 'd'], scores: [0, 33, 66, 100] },
  ];

  it('promedia scores y clasifica perfil correctamente', () => {
    expect(scoreEmotional(questions, { e1: 0, e2: 0 })?.perfil).toBe('espontaneo'); // avg 0
    expect(scoreEmotional(questions, { e1: 1, e2: 1 })?.perfil).toBe('espontaneo'); // avg 33 → ≤33
    expect(scoreEmotional(questions, { e1: 2, e2: 2 })?.perfil).toBe('mesura'); // avg 66
    expect(scoreEmotional(questions, { e1: 3, e2: 3 })?.perfil).toBe('reflexivo'); // avg 100
  });

  it('mix → mesura', () => {
    const r = scoreEmotional(questions, { e1: 1, e2: 2 }); // avg ~50
    expect(r?.perfil).toBe('mesura');
    expect(r?.score).toBe(50);
  });
});

describe('scoreIntegrity — del v1 con thresholds calibrados', () => {
  const questions: IntegrityQuestion[] = [
    { id: 'h1', dimension: 'hurto', text: '...', options: ['a', 'b', 'c', 'd'], risk_weights: [0, 1, 2, 3] },
    { id: 'h2', dimension: 'hurto', text: '...', options: ['a', 'b', 'c', 'd'], risk_weights: [0, 1, 2, 3] },
    { id: 'b1', dimension: 'buena_impresion', text: '...', options: ['a', 'b', 'c', 'd'], risk_weights: [3, 0, 1, 2] },
  ];

  it('respuestas con riesgo 0 → bajo en todas las dimensiones', () => {
    const r = scoreIntegrity(questions, { h1: 0, h2: 0, b1: 1 });
    const hurto = r.dimensiones.find((d) => d.dimension === 'hurto');
    expect(hurto?.nivel).toBe('bajo');
    expect(r.overall).toBe('bajo');
  });

  it('respuestas con riesgo máximo en hurto → alto (threshold 41 para hurto)', () => {
    const r = scoreIntegrity(questions, { h1: 3, h2: 3, b1: 1 });
    const hurto = r.dimensiones.find((d) => d.dimension === 'hurto');
    expect(hurto?.pct).toBe(100);
    expect(hurto?.nivel).toBe('alto');
    expect(r.overall).toBe('alto');
    expect(r.recomendacion).toBe('No se recomienda');
  });

  it('separa buena_impresion del overall', () => {
    const r = scoreIntegrity(questions, { h1: 0, h2: 0, b1: 0 }); // bi → 100% (riesgo total)
    expect(r.buena_impresion).toBe('alto');
    expect(r.buena_impresion_pct).toBe(100);
    // pero overall sin contar BI sigue siendo bajo
    expect(r.overall).toBe('bajo');
  });

  it('si alguna dim es alto, overall NO puede ser bajo', () => {
    const r = scoreIntegrity(questions, { h1: 3, h2: 3, b1: 1 });
    expect(r.overall).not.toBe('bajo');
  });
});

describe('classifyIntegrityPct — thresholds diferenciados', () => {
  it('hurto es más estricto (medio = 21)', () => {
    expect(classifyIntegrityPct(20, 'hurto')).toBe('bajo');
    expect(classifyIntegrityPct(21, 'hurto')).toBe('medio');
    expect(classifyIntegrityPct(41, 'hurto')).toBe('alto');
  });

  it('buena_impresion es más laxa (medio = 41)', () => {
    expect(classifyIntegrityPct(40, 'buena_impresion')).toBe('bajo');
    expect(classifyIntegrityPct(41, 'buena_impresion')).toBe('medio');
    expect(classifyIntegrityPct(66, 'buena_impresion')).toBe('alto');
  });

  it('default si dimension desconocida', () => {
    expect(classifyIntegrityPct(30, 'unknown')).toBe('bajo');
    expect(classifyIntegrityPct(31, 'unknown')).toBe('medio');
    expect(classifyIntegrityPct(56, 'unknown')).toBe('alto');
  });
});

describe('scoreTechnical', () => {
  it('cuenta correctas y calcula pct', () => {
    const qs = [
      { id: 'q1', text: '', options: ['a', 'b'], correct: 0 },
      { id: 'q2', text: '', options: ['a', 'b'], correct: 1 },
      { id: 'q3', text: '', options: ['a', 'b'], correct: 0 },
    ];
    const r = scoreTechnical(qs, { q1: 0, q2: 1, q3: 1 }, 60);
    expect(r.total_correct).toBe(2);
    expect(r.score_pct).toBe(67);
    expect(r.passed).toBe(true);
  });

  it('debajo del mínimo → no passes', () => {
    const qs = [{ id: 'q1', text: '', options: ['a', 'b'], correct: 0 }];
    const r = scoreTechnical(qs, { q1: 1 }, 60);
    expect(r.passed).toBe(false);
  });
});

describe('helpers existentes', () => {
  it('normalizeDiscRaw re-escala counts a per-axis 0-100 (modelo V1)', () => {
    // 40 preguntas → maxPerAxis = 10. raw 20 → cap 100 (era 100% en ese eje).
    // raw 10 → 100%. raw 5 → 50%.
    const r = normalizeDiscRaw({ d: 20, i: 10, s: 5, c: 5 }, 40);
    expect(r.d).toBe(100); // cap
    expect(r.i).toBe(100);
    expect(r.s).toBe(50);
    expect(r.c).toBe(50);
  });

  it('normalizeDiscRaw: si suma > 100 lo deja (ya viene normalizado per-axis)', () => {
    // Modelo V1: ideal puede venir per-axis 0-100 sumando hasta 400. No re-escalar.
    const r = normalizeDiscRaw({ d: 80, i: 20, s: 20, c: 80 }, 24);
    expect(r.d).toBe(80);
    expect(r.i).toBe(20);
    expect(r.s).toBe(20);
    expect(r.c).toBe(80);
  });

  it('calculateDiscSimilarity perfiles iguales = 100', () => {
    // Min/max ratio: 50/50=1.0 por eje, promedio = 100.
    expect(calculateDiscSimilarity({ d: 50, i: 30, s: 10, c: 10 }, { d: 50, i: 30, s: 10, c: 10 })).toBe(100);
  });

  it('calculateDiscSimilarity per-axis V1 (escalas distintas)', () => {
    // Candidato D=40, ideal D=80 → min/max = 40/80 = 0.5 = 50%.
    // I=50/20 → 20/50 = 0.4 = 40%.
    // S=50/20 → 20/50 = 0.4 = 40%.
    // C=40/80 → 40/80 = 0.5 = 50%.
    // Promedio: (50+40+40+50)/4 = 45.
    expect(calculateDiscSimilarity({ d: 40, i: 50, s: 50, c: 40 }, { d: 80, i: 20, s: 20, c: 80 })).toBe(45);
  });

  it('discDominantAxis detecta máximo', () => {
    expect(discDominantAxis({ d: 80, i: 20, s: 10, c: 30 })).toBe('D');
  });

  it('velnaAggregate promedia', () => {
    expect(velnaAggregate({ verbal: 80, espacial: 60, logica: 70, numerica: 90, abstracta: 50 })).toBe(70);
  });

  it('velnaSimilarity perfiles iguales = 100', () => {
    const p = { verbal: 70, espacial: 70, logica: 70, numerica: 70, abstracta: 70 };
    expect(velnaSimilarity(p, p)).toBe(100);
  });

  it('calculateTechnicalScore', () => {
    expect(calculateTechnicalScore(7, 10, 60).passed).toBe(true);
    expect(calculateTechnicalScore(5, 10, 60).passed).toBe(false);
  });
});
