/**
 * Tests del generador de preguntas para módulo Video.
 *
 * NO testea contra Anthropic real (costoso + flaky). Testea:
 *   - Prompt building: incluye job_title, context_summary, competencias
 *   - Tool schema: required fields, enums, caps, mix obligatorio
 *   - clampCount: respeta min/max/default
 *   - Sin voseo argentino en el system prompt ni el user message
 */
import { describe, expect, it } from 'vitest';
import {
  buildUserMessage,
  clampCount,
  TOOL_SCHEMA,
  SYSTEM_PROMPT,
  MIN_COUNT,
  MAX_COUNT,
  type GenerateVideoQuestionsInput,
} from '../src/lib/videoQuestionGen';

function makeInput(overrides: Partial<GenerateVideoQuestionsInput> = {}): GenerateVideoQuestionsInput {
  return {
    job_title: 'Ejecutivo Comercial Senior',
    context_summary: 'Vendedor de productos femeninos. El cliente busca conexión emocional y empatía, no specs técnicas.',
    competencias: [
      { name: 'orientacion_al_cliente', required_pct: 75 },
      { name: 'persuasion_negociacion', required_pct: 70 },
    ],
    ...overrides,
  };
}

describe('clampCount', () => {
  it('default cuando no se pasa nada', () => {
    expect(clampCount(undefined)).toBe(6);
  });

  it('clampea por debajo del mínimo', () => {
    expect(clampCount(2)).toBe(MIN_COUNT);
    expect(clampCount(0)).toBe(MIN_COUNT);
  });

  it('clampea por encima del máximo', () => {
    expect(clampCount(15)).toBe(MAX_COUNT);
  });

  it('respeta valores válidos en el rango', () => {
    expect(clampCount(5)).toBe(5);
    expect(clampCount(6)).toBe(6);
    expect(clampCount(7)).toBe(7);
  });

  it('redondea hacia abajo si recibe decimal', () => {
    expect(clampCount(6.9)).toBe(6);
  });
});

describe('buildUserMessage', () => {
  it('incluye el título del puesto', () => {
    const msg = buildUserMessage(makeInput(), 6);
    expect(msg).toContain('Ejecutivo Comercial Senior');
  });

  it('incluye context_summary', () => {
    const msg = buildUserMessage(makeInput(), 6);
    expect(msg).toContain('productos femeninos');
    expect(msg).toContain('conexión emocional');
  });

  it('incluye competencias requeridas con su umbral', () => {
    const msg = buildUserMessage(makeInput(), 6);
    expect(msg).toContain('orientacion_al_cliente');
    expect(msg).toContain('mínimo 75%');
    expect(msg).toContain('persuasion_negociacion');
  });

  it('indica al modelo el count exacto', () => {
    const msg = buildUserMessage(makeInput(), 5);
    expect(msg).toContain('exactamente 5 preguntas');
  });

  it('fallback gracefully cuando context_summary está vacío', () => {
    const msg = buildUserMessage(makeInput({ context_summary: '' }), 6);
    expect(msg).toContain('sin contexto narrativo');
  });

  it('omite sección de competencias si no hay', () => {
    const msg = buildUserMessage(makeInput({ competencias: [] }), 6);
    expect(msg).not.toContain('Competencias requeridas');
  });

  it('NO usa voseo argentino en el mensaje generado', () => {
    const msg = buildUserMessage(makeInput(), 6);
    expect(msg).not.toMatch(/\b(tenés|querés|sos|podés|hacés|elegís|mirá|pegá|firmá)\b/i);
  });
});

describe('SYSTEM_PROMPT', () => {
  it('exige mix tecnica + conductual + integridad', () => {
    expect(SYSTEM_PROMPT).toMatch(/técnica/i);
    expect(SYSTEM_PROMPT).toMatch(/conductual/i);
    expect(SYSTEM_PROMPT).toMatch(/integridad/i);
  });

  it('prohibe voseo argentino explícitamente', () => {
    expect(SYSTEM_PROMPT).toMatch(/voseo/i);
    expect(SYSTEM_PROMPT).toContain('tú/tienes/puedes');
  });

  it('exige output vía tool call', () => {
    expect(SYSTEM_PROMPT).toContain('submit_video_questions');
  });

  it('NO contiene voseo argentino fuera de la línea PROHIBIDO', () => {
    // Filtramos la línea "PROHIBIDO voseo argentino (tenés, querés, ...)" porque
    // ahí lista los términos como ejemplos negativos — esperado.
    const filtered = SYSTEM_PROMPT.split('\n').filter((line) => !/PROHIBIDO/i.test(line)).join('\n');
    expect(filtered).not.toMatch(/\b(tenés|querés|sos|podés|hacés|elegís|mirá|pegá|firmá)\b/i);
  });
});

describe('TOOL_SCHEMA', () => {
  function items() {
    return (TOOL_SCHEMA.input_schema as { properties: { questions: { items: { properties: Record<string, { enum?: string[]; maxLength?: number; minimum?: number; maximum?: number }>; required: string[] } } } }).properties.questions.items;
  }
  function root() {
    return TOOL_SCHEMA.input_schema as { properties: { questions: { minItems: number; maxItems: number } }; required: string[] };
  }

  it('root required incluye questions', () => {
    expect(root().required).toContain('questions');
  });

  it('array tiene min/max items consistente con MIN_COUNT/MAX_COUNT', () => {
    expect(root().properties.questions.minItems).toBe(MIN_COUNT);
    expect(root().properties.questions.maxItems).toBe(MAX_COUNT);
  });

  it('cada pregunta requiere los 6 fields críticos', () => {
    expect(items().required).toEqual([
      'id',
      'type',
      'pregunta',
      'respuesta_correcta_interna',
      'justificacion_para_admin',
      'tiempo_max_segundos',
    ]);
  });

  it('type solo acepta los 3 valores válidos', () => {
    expect(items().properties.type.enum).toEqual(['tecnica', 'conductual', 'integridad']);
  });

  it('pregunta capped a 400 chars', () => {
    expect(items().properties.pregunta.maxLength).toBe(400);
  });

  it('respuesta_correcta_interna capped a 800 chars (para no derrochar tokens)', () => {
    expect(items().properties.respuesta_correcta_interna.maxLength).toBe(800);
  });

  it('justificacion_para_admin capped a 300 chars', () => {
    expect(items().properties.justificacion_para_admin.maxLength).toBe(300);
  });

  it('tiempo_max_segundos rango 30-180', () => {
    expect(items().properties.tiempo_max_segundos.minimum).toBe(30);
    expect(items().properties.tiempo_max_segundos.maximum).toBe(180);
  });

  it('tool name es estable para que extractToolUse funcione', () => {
    expect(TOOL_SCHEMA.name).toBe('submit_video_questions');
  });
});
