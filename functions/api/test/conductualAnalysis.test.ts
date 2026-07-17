/**
 * Tests del análisis IA Conductual contextual (Capa 4).
 *
 * NO testea contra Anthropic real (costoso + flaky). Testea:
 *   - Cache: misma entrada → mismo hash
 *   - Prompt building: incluye todo el contexto relevante
 *   - Tool schema: todos los required fields están presentes
 */
import { describe, expect, it } from 'vitest';
import {
  hashInput,
  buildUserMessage,
  TOOL_SCHEMA,
  type ConductualInput,
} from '../src/lib/conductualAnalysis';

function makeInput(overrides: Partial<ConductualInput> = {}): ConductualInput {
  return {
    candidate_name: 'María González',
    scores: {
      disc_norm_d: 60, disc_norm_i: 90, disc_norm_s: 30, disc_norm_c: 40,
      disc_similarity_pct: 75,
      velna_verbal: 70, velna_espacial: 50, velna_logica: 65, velna_numerica: 80, velna_abstracta: 60,
      velna_indice: 65, velna_similarity_pct: 70,
      emo_score: 55, emo_perfil: 'mesura',
      tec_score_pct: 82,
      tec_style_autonomy_consult: 70,
      tec_style_match_with_boss_pct: 78,
    },
    ideal: {
      disc: { d: 50, i: 90, s: 40, c: 30 },
      velna: { verbal: 70, espacial: 50, logica: 60, numerica: 70, abstracta: 60 },
      competencias: [
        { name: 'persuasion_negociacion', required_pct: 75 },
        { name: 'orientacion_al_cliente', required_pct: 70 },
      ],
      context_summary: 'Vendedor de productos femeninos. El cliente busca conexión emocional y empatía, no specs técnicas.',
    },
    ...overrides,
  };
}

describe('hashInput', () => {
  it('misma entrada produce mismo hash', () => {
    const a = makeInput();
    const b = makeInput();
    expect(hashInput(a)).toBe(hashInput(b));
  });

  it('cambiar nombre del candidato NO afecta hash (no es parte del cache key)', () => {
    const a = makeInput({ candidate_name: 'María' });
    const b = makeInput({ candidate_name: 'Pedro' });
    expect(hashInput(a)).toBe(hashInput(b));
  });

  it('cambiar scores SÍ afecta hash', () => {
    const a = makeInput();
    const b = makeInput({ scores: { ...makeInput().scores, disc_norm_d: 99 } });
    expect(hashInput(a)).not.toBe(hashInput(b));
  });

  it('cambiar contexto del puesto SÍ afecta hash', () => {
    const a = makeInput();
    const b = makeInput({
      ideal: { ...makeInput().ideal, context_summary: 'Otro contexto totalmente distinto' },
    });
    expect(hashInput(a)).not.toBe(hashInput(b));
  });

  it('agregar anti_cheat events SÍ afecta hash', () => {
    const a = makeInput();
    const b = makeInput({
      anti_cheat_events: [{ type: 'page_exit', count: 5, total_seconds: 120 }],
    });
    expect(hashInput(a)).not.toBe(hashInput(b));
  });
});

describe('buildUserMessage', () => {
  it('incluye nombre del candidato', () => {
    const msg = buildUserMessage(makeInput());
    expect(msg).toContain('María González');
  });

  it('incluye scores DISC con valores reales', () => {
    const msg = buildUserMessage(makeInput());
    expect(msg).toContain('D=60');
    expect(msg).toContain('I=90');
    expect(msg).toContain('S=30');
    expect(msg).toContain('C=40');
  });

  it('incluye similitud DISC vs ideal', () => {
    const msg = buildUserMessage(makeInput());
    expect(msg).toContain('Similitud DISC vs ideal: 75%');
  });

  it('incluye VELNA por dimensión', () => {
    const msg = buildUserMessage(makeInput());
    expect(msg).toContain('verbal=70');
    expect(msg).toContain('lógica=65');
  });

  it('incluye perfil emocional', () => {
    const msg = buildUserMessage(makeInput());
    expect(msg).toContain('Emocional');
    expect(msg).toContain('mesura');
  });

  it('clasifica estilo autonomy/consult correctamente', () => {
    expect(buildUserMessage(makeInput({ scores: { ...makeInput().scores, tec_style_autonomy_consult: 70 } })))
      .toContain('autónomo');
    expect(buildUserMessage(makeInput({ scores: { ...makeInput().scores, tec_style_autonomy_consult: 30 } })))
      .toContain('consultivo');
    expect(buildUserMessage(makeInput({ scores: { ...makeInput().scores, tec_style_autonomy_consult: 50 } })))
      .toContain('balanceado');
  });

  it('incluye context_summary del puesto', () => {
    const msg = buildUserMessage(makeInput());
    expect(msg).toContain('Vendedor de productos femeninos');
    expect(msg).toContain('conexión emocional');
  });

  it('incluye perfil DISC ideal del puesto', () => {
    const msg = buildUserMessage(makeInput());
    expect(msg).toMatch(/D=50.*I=90.*S=40.*C=30/);
  });

  it('incluye competencias requeridas', () => {
    const msg = buildUserMessage(makeInput());
    expect(msg).toContain('persuasion_negociacion');
    expect(msg).toContain('mínimo 75%');
  });

  it('incluye boss profile cuando está presente', () => {
    const msg = buildUserMessage(makeInput({
      ideal: {
        ...makeInput().ideal,
        boss: { name: 'Ana López', role: 'Gerente de Ventas', style_autonomy_consult: 0.8 },
      },
    }));
    expect(msg).toContain('Ana López');
    expect(msg).toContain('Gerente de Ventas');
    expect(msg).toContain('autónomo');
  });

  it('incluye anti-cheat events cuando se proveen', () => {
    const msg = buildUserMessage(makeInput({
      anti_cheat_events: [{ type: 'page_exit', count: 4, total_seconds: 90 }],
    }));
    expect(msg).toContain('Salidas de pantalla: 4');
    expect(msg).toContain('Tiempo fuera acumulado: 90s');
  });

  it('omite secciones opcionales gracefully (sin context_summary, sin boss)', () => {
    const msg = buildUserMessage(makeInput({
      ideal: {
        disc: makeInput().ideal.disc,
        velna: makeInput().ideal.velna,
        competencias: makeInput().ideal.competencias,
      },
    }));
    expect(msg).toContain('(sin contexto narrativo cargado)');
    expect(msg).not.toContain('Perfil del jefe');
  });

  it('NO usa voseo argentino', () => {
    const msg = buildUserMessage(makeInput());
    expect(msg).not.toMatch(/\b(tenés|querés|sos|podés|hacés|elegís|mirá|pegá|firmá)\b/i);
  });
});

describe('TOOL_SCHEMA', () => {
  it('tiene los 6 campos required', () => {
    const required = (TOOL_SCHEMA.input_schema as { required: string[] }).required;
    expect(required).toEqual([
      'veredicto',
      'razones_a_favor',
      'razones_en_contra',
      'recomendacion',
      'alertas_especificas',
      'resumen_ejecutivo',
    ]);
  });

  it('veredicto solo acepta 3 valores válidos', () => {
    const props = (TOOL_SCHEMA.input_schema as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(props.veredicto.enum).toEqual(['encaja', 'encaja_con_reservas', 'no_encaja']);
  });

  it('recomendacion solo acepta 4 valores válidos', () => {
    const props = (TOOL_SCHEMA.input_schema as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(props.recomendacion.enum).toEqual([
      'avanzar_a_entrevista',
      'duda_cv_revisar_manual',
      'considerar_perfil_alternativo',
      'no_avanzar',
    ]);
  });

  it('razones_a_favor capped a 5 items', () => {
    const props = (TOOL_SCHEMA.input_schema as { properties: Record<string, { maxItems?: number }> }).properties;
    expect(props.razones_a_favor.maxItems).toBe(5);
  });

  it('razones_en_contra capped a 4 items', () => {
    const props = (TOOL_SCHEMA.input_schema as { properties: Record<string, { maxItems?: number }> }).properties;
    expect(props.razones_en_contra.maxItems).toBe(4);
  });

  it('resumen_ejecutivo limitado a 250 chars', () => {
    const props = (TOOL_SCHEMA.input_schema as { properties: Record<string, { maxLength?: number }> }).properties;
    expect(props.resumen_ejecutivo.maxLength).toBe(250);
  });
});
