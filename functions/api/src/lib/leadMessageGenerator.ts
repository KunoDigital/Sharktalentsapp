/**
 * Generador de mensajes sugeridos para responder leads de Meta Ads.
 *
 * Backend recibe lead nuevo → genera UN mensaje calibrado (estilo Chris Palma)
 * basándose en few-shot examples aprobados por Cristian (review-mensajes-2026-06-22.json).
 * El mensaje se incluye en la alerta WhatsApp a Cris para que ella copy-paste al lead.
 *
 * Falla silenciosa: si Anthropic está caído o el lead no tiene datos suficientes,
 * retorna null y la alerta sigue funcionando sin sugerencia (no bloquea el flujo).
 */

import { anthropicMessage } from './anthropic';
import { logger } from './logger';

const log = logger('LEAD_MSG_GEN');

type Rol = 'dueno_ceo' | 'rrhh' | 'gerente_area' | 'otro';
type Dolor = 'proceso_lento' | 'alta_rotacion' | 'no_rinde' | 'otro';

type EjemploAprobado = {
  id: number;
  rol: Rol;
  dolor: Dolor;
  texto: string;
};

/** 9 mensajes aprobados por Cristian en review-mensajes-2026-06-22.json. */
const EJEMPLOS_APROBADOS: EjemploAprobado[] = [
  {
    id: 5,
    rol: 'dueno_ceo',
    dolor: 'proceso_lento',
    texto: 'javier, mientras buscas candidato la operación pierde plata cada día. cuánto te costó la última vacante que tomó más de 60 días? Cuéntame.',
  },
  {
    id: 6,
    rol: 'dueno_ceo',
    dolor: 'proceso_lento',
    texto: 'javier. cada semana sin cubrir esa vacante es plata por el desagüe. cuántas semanas llevas con el último puesto abierto? Cuéntame.',
  },
  {
    id: 8,
    rol: 'rrhh',
    dolor: 'alta_rotacion',
    texto: 'lucia. cuando los nuevos no duran, la pregunta del CEO va para ti. te están midiendo la tasa de retención de los primeros 90 días? Cuéntame.',
  },
  {
    id: 15,
    rol: 'gerente_area',
    dolor: 'no_rinde',
    texto: 'sandra, el candidato que te mandó RRHH no rinde y la meta sigue igual. te reclamaron por los números mientras manejabas a alguien que no encajaba? Cuéntame.',
  },
  {
    id: 16,
    rol: 'gerente_area',
    dolor: 'no_rinde',
    texto: 'sandra. la persona en el puesto no rinde y tú tienes que defender los resultados igual. te están pidiendo cuentas por algo que tú no decidiste? Cuéntame.',
  },
  {
    id: 25,
    rol: 'dueno_ceo',
    dolor: 'alta_rotacion',
    texto: 'marcos, para los que han salido del equipo al poco tiempo, qué te urge más: alguien que se quede 3-5 años o alguien que produzca máximo en 6 meses? Cuéntame.',
  },
  {
    id: 26,
    rol: 'dueno_ceo',
    dolor: 'no_rinde',
    texto: 'ana, para reemplazar al último que no rindió, qué te urge más: alguien que resuelva solo y libere tu tiempo, o alguien al que puedas formar de cero? Cuéntame.',
  },
  {
    id: 28,
    rol: 'rrhh',
    dolor: 'alta_rotacion',
    texto: 'lucia, para frenar la rotación, qué te están pidiendo más arriba: gente que dure 3+ años o gente que aprenda rápido y se adapte? Cuéntame.',
  },
  {
    id: 32,
    rol: 'gerente_area',
    dolor: 'no_rinde',
    texto: 'sandra, para reemplazar al último que no rindió en tu equipo, qué te urge más: alguien que resuelva solo o alguien que aprenda el rol rápido? Cuéntame.',
  },
];

function inferRol(s: string | undefined | null): Rol {
  if (!s) return 'otro';
  const lower = s.toLowerCase();
  if (/(due[ñn]o|ceo|fundador|presidente|owner|c-level|director general|gerente general)/i.test(lower)) {
    return 'dueno_ceo';
  }
  if (/(rrhh|rh\b|recursos humanos|talento|people|hr|human|reclut|contrata)/i.test(lower)) {
    return 'rrhh';
  }
  if (/(gerente|jefe|manager|l[ií]der|coordinador|supervisor)/i.test(lower)) {
    return 'gerente_area';
  }
  return 'otro';
}

function inferDolor(s: string | undefined | null): Dolor {
  if (!s) return 'otro';
  const lower = s.toLowerCase();
  if (/(lento|tarda|tiempo|60 d[ií]as|90 d[ií]as|meses|busqueda|búsqueda|no encuentra)/i.test(lower)) {
    return 'proceso_lento';
  }
  if (/(rotaci[oó]n|se van|renunci|no dura|salida|alta rotaci)/i.test(lower)) {
    return 'alta_rotacion';
  }
  if (/(no rinde|no funcion|no encaja|fracas|mal contrat|mala contrat|no cumpl|underperform)/i.test(lower)) {
    return 'no_rinde';
  }
  return 'otro';
}

function selectExamples(rol: Rol, dolor: Dolor): EjemploAprobado[] {
  // 1) Match exacto rol + dolor
  const exact = EJEMPLOS_APROBADOS.filter((e) => e.rol === rol && e.dolor === dolor);
  if (exact.length > 0) return exact;
  // 2) Match rol solamente
  const rolOnly = EJEMPLOS_APROBADOS.filter((e) => e.rol === rol);
  if (rolOnly.length > 0) return rolOnly;
  // 3) Match dolor solamente
  const dolorOnly = EJEMPLOS_APROBADOS.filter((e) => e.dolor === dolor);
  if (dolorOnly.length > 0) return dolorOnly;
  // 4) Todos
  return EJEMPLOS_APROBADOS;
}

function primerNombre(s: string | undefined | null): string {
  if (!s) return '';
  const trimmed = s.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0].toLowerCase();
}

export type GenerateLeadMessageInput = {
  nombre?: string | null;
  rol?: string | null;
  dolor?: string | null;
};

/**
 * Genera un mensaje sugerido para responder al lead.
 *
 * Retorna null si:
 * - No hay datos suficientes (sin nombre y sin rol y sin dolor)
 * - Anthropic falla (circuit breaker, timeout, error)
 * - Claude devolvió respuesta vacía
 *
 * Llamadores deben tratar null como "no hay sugerencia, sigue con la alerta sin ese campo".
 */
export async function generateLeadSuggestedMessage(
  input: GenerateLeadMessageInput,
  traceId: string,
): Promise<string | null> {
  const nombre = primerNombre(input.nombre);
  const rolRaw = (input.rol || '').trim();
  const dolorRaw = (input.dolor || '').trim();

  // Sin nombre Y sin rol Y sin dolor → no vale la pena llamar a Claude
  if (!nombre && !rolRaw && !dolorRaw) {
    log.debug('skip: no usable input', { traceId });
    return null;
  }

  const rol = inferRol(rolRaw);
  const dolor = inferDolor(dolorRaw);
  const ejemplos = selectExamples(rol, dolor);

  const ejemplosTexto = ejemplos
    .map((e) => `[${e.rol} / ${e.dolor}] → ${e.texto}`)
    .join('\n');

  const system = `Eres asistente de Chris Palma, fundadora de SharkTalents (reclutamiento ejecutivo Panamá/LatAm).

Tu tarea: generar UN mensaje de WhatsApp para que Chris responda a un lead nuevo de Meta Ads.

REGLAS estrictas:
- Tuteo neutro LatAm. NUNCA voseo ("vos", "tenés", "sos", "podés"). Usar: "tú", "tienes", "eres", "puedes".
- 1-2 frases máximo. Conciso.
- Estructura validada: nombre en minúscula al inicio + dolor declarado al frente + pregunta de discriminación (con 2 opciones) o pregunta concreta de cantidad/consecuencia.
- Terminar con "Cuéntame."
- Sin frases tipo "creemos en X", "te entendemos", "definitivamente", "100%".
- Sin saludos genéricos ("hola", "saludos", "buenas").
- Sin promesas absolutas ("garantizado", "siempre", "te aseguro").
- Tono: asesor con experiencia que ya vio el problema antes, no vendedor desesperado.
- Si el nombre del lead viene en mayúsculas, pasarlo a minúscula.

EJEMPLOS APROBADOS por mi socio (Cristian García):
${ejemplosTexto}

Generá UN solo mensaje siguiendo los patrones de los ejemplos. Sin comillas, sin "Aquí está:", sin explicaciones. Solo el mensaje.`;

  const user = `Datos del lead:
- Nombre: ${nombre || '(sin nombre, omití el nombre en el mensaje)'}
- Rol declarado: ${rolRaw || '(no especificado)'}
- Dolor declarado: ${dolorRaw || '(no especificado)'}

Mensaje:`;

  try {
    const reply = await anthropicMessage(
      {
        model: 'claude-haiku-4-5-20251001',
        system,
        messages: [{ role: 'user', content: user }],
        maxTokens: 200,
        temperature: 0.7,
      },
      { traceId, feature: 'lead_message_suggest' },
    );

    const text = reply.content.find((c) => c.type === 'text');
    if (!text || text.type !== 'text') {
      log.warn('empty response from Claude', { traceId });
      return null;
    }
    const trimmed = text.text.trim();
    if (!trimmed) return null;

    log.info('generated', {
      traceId,
      rol,
      dolor,
      ejemplos_usados: ejemplos.length,
      output_chars: trimmed.length,
    });

    return trimmed;
  } catch (err) {
    log.warn('failed to generate suggested message', {
      traceId,
      error: (err as Error).message,
    });
    return null;
  }
}
