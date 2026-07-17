/**
 * Tests anti-sesgo "correcta = más larga" (Me2 BUGS_FEEDBACK).
 *
 * En producción se midió que un candidato sin conocimiento técnico podía acertar
 * 57% eligiendo siempre la opción más larga porque el modelo justifica la correcta
 * con más detalle. Estos tests validan:
 *
 *   1. El system prompt incluye la instrucción dura anti-sesgo.
 *   2. El tool schema impone maxLength por opción.
 *   3. measureLengthBias detecta correctamente preguntas con ratio >1.3×.
 *   4. Un set "balanceado" no dispara false positives.
 */
import { describe, expect, it } from 'vitest';
import { _internal } from '../src/lib/techQuestions';

const { measureLengthBias, SYSTEM_TECH, TOOL_TECHNICAL, TOOL_SITUATIONAL } = _internal;

describe('SYSTEM_TECH anti-sesgo longitud', () => {
  it('incluye reglas duras anti-sesgo "correcta = más larga"', () => {
    expect(SYSTEM_TECH).toContain('ANTI-PATRÓN longitud');
    // Mención explícita del % de acierto detectado en producción para que nadie
    // borre la regla pensando que es opcional.
    expect(SYSTEM_TECH).toContain('57%');
  });

  it('especifica cap duro de caracteres por opción', () => {
    expect(SYSTEM_TECH).toMatch(/180 caracteres/);
  });

  it('prohíbe explícitamente hacer la correcta más larga', () => {
    expect(SYSTEM_TECH).toMatch(/PROHIBIDO hacer la opción correcta MÁS LARGA/);
  });

  it('exige verificación previa al output (contar chars)', () => {
    expect(SYSTEM_TECH).toMatch(/VERIFICACIÓN OBLIGATORIA/);
  });
});

describe('Tool schemas — maxLength por opción', () => {
  it('TOOL_TECHNICAL fuerza maxLength=180 en cada opción', () => {
    const props = (TOOL_TECHNICAL.input_schema as any).properties.questions.items.properties;
    expect(props.options.items.maxLength).toBe(180);
    expect(props.options.minItems).toBe(4);
    expect(props.options.maxItems).toBe(4);
  });

  it('TOOL_SITUATIONAL fuerza maxLength=180 en cada opción', () => {
    const props = (TOOL_SITUATIONAL.input_schema as any).properties.questions.items.properties;
    expect(props.options.items.maxLength).toBe(180);
    expect(props.options.minItems).toBe(4);
    expect(props.options.maxItems).toBe(4);
  });
});

describe('measureLengthBias', () => {
  it('detecta sesgo cuando la correcta es 2× el promedio de incorrectas', () => {
    const questions = [
      {
        id: 'tq_1',
        kind: 'technical' as const,
        text: 'Q?',
        options: [
          'opción correcta detallada y larga con varios matices que la justifican',
          'mal',
          'mal',
          'mal',
        ],
        correct: 0,
      },
    ];
    const result = measureLengthBias(questions);
    expect(result.biasedCount).toBe(1);
    expect(result.maxRatio).toBeGreaterThan(1.3);
  });

  it('NO marca sesgo cuando las 4 opciones tienen longitudes parejas', () => {
    const questions = [
      {
        id: 'tq_1',
        kind: 'technical' as const,
        text: 'Q?',
        options: [
          '15% sobre el valor CIF declarado en aduana panameña',
          '25% directo sobre el arancel base más sobretasa',
          '16.5% aplicado en cascada arancel mas ITBMS Panama',
          '20% sobre arancel base mas recargo de zona franca',
        ],
        correct: 2,
      },
    ];
    const result = measureLengthBias(questions);
    expect(result.biasedCount).toBe(0);
    expect(result.maxRatio).toBeLessThan(1.3);
  });

  it('ignora preguntas situacionales (no tienen correct unico)', () => {
    const questions = [
      {
        id: 'sq_1',
        kind: 'situational' as const,
        text: 'Scenario',
        options: ['opcion muy larga con detalle adicional explicado', 'corta', 'corta', 'corta'],
      },
    ];
    const result = measureLengthBias(questions);
    // Situacional no aporta al cálculo → no hay ratios → no hay bias.
    expect(result.biasedCount).toBe(0);
    expect(result.avgRatio).toBe(0);
  });

  it('promedio sobre múltiples preguntas suaviza outliers', () => {
    const questions = [
      // Una sesgada
      {
        id: 'tq_1', kind: 'technical' as const, text: 'Q1',
        options: ['x'.repeat(100), 'x'.repeat(20), 'x'.repeat(20), 'x'.repeat(20)],
        correct: 0,
      },
      // Tres balanceadas
      {
        id: 'tq_2', kind: 'technical' as const, text: 'Q2',
        options: ['x'.repeat(50), 'x'.repeat(48), 'x'.repeat(52), 'x'.repeat(50)],
        correct: 0,
      },
      {
        id: 'tq_3', kind: 'technical' as const, text: 'Q3',
        options: ['x'.repeat(50), 'x'.repeat(48), 'x'.repeat(52), 'x'.repeat(50)],
        correct: 1,
      },
      {
        id: 'tq_4', kind: 'technical' as const, text: 'Q4',
        options: ['x'.repeat(50), 'x'.repeat(48), 'x'.repeat(52), 'x'.repeat(50)],
        correct: 2,
      },
    ];
    const result = measureLengthBias(questions);
    expect(result.biasedCount).toBe(1);
    // El avg debería estar cerca de 2.0: una ratio=5.0 + tres ratios=1.0 → avg ~2.0.
    // El punto del test es que un solo outlier no domina si el resto está balanceado.
    expect(result.avgRatio).toBeLessThan(2.5);
  });

  it('opciones vacías o array malformado no rompen el cálculo', () => {
    const questions = [
      {
        id: 'tq_1', kind: 'technical' as const, text: 'Q1',
        options: ['a', 'b', 'c'], // solo 3, malformada
        correct: 0,
      },
      {
        id: 'tq_2', kind: 'technical' as const, text: 'Q2',
        options: ['a', 'b', 'c', 'd'],
        correct: 0,
      },
    ];
    expect(() => measureLengthBias(questions)).not.toThrow();
  });

  it('todas balanceadas → ratio cercano a 1.0', () => {
    const questions = Array.from({ length: 12 }, (_, i) => ({
      id: `tq_${i + 1}`,
      kind: 'technical' as const,
      text: `Q${i + 1}`,
      options: ['x'.repeat(50), 'x'.repeat(48), 'x'.repeat(52), 'x'.repeat(50)],
      correct: i % 4,
    }));
    const result = measureLengthBias(questions);
    expect(result.biasedCount).toBe(0);
    expect(result.avgRatio).toBeGreaterThan(0.9);
    expect(result.avgRatio).toBeLessThan(1.1);
  });
});

describe('integración prompt + schema', () => {
  it('schema y prompt están alineados en el cap de 180', () => {
    // Si alguien cambia el cap, ambas piezas tienen que moverse juntas.
    const techCap = (TOOL_TECHNICAL.input_schema as any).properties.questions.items.properties.options.items.maxLength;
    const sitCap = (TOOL_SITUATIONAL.input_schema as any).properties.questions.items.properties.options.items.maxLength;
    expect(techCap).toBe(sitCap);
    expect(SYSTEM_TECH).toContain(`${techCap} caracteres`);
  });
});
