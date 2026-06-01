/**
 * Drafts: IA arma Job Profile Draft desde el transcript de la reunión cliente.
 * Flujo:
 *   - Cliente agenda en Bookings → reunión → Zia/Whisper transcribe
 *   - Webhook trae el transcript
 *   - Acá: anthropicMessage(transcript) → draft estructurado (JSON)
 *   - Cris revisa en /drafts → ajusta → manda al cliente
 *   - Cliente aprueba → se publica como Job
 *
 * Endpoint stub:
 *   POST /api/drafts/generate    (admin - genera draft desde transcript)
 *   POST /api/drafts/refine       (admin - re-genera con feedback)
 *
 * NOTA: este feature todavía no escribe a tabla porque la tabla `Drafts`
 * está en Block 2 (DIFERIDA). Por ahora solo invoca al modelo y devuelve
 * el JSON. Cuando sumemos la tabla, agregamos persistencia.
 */

import type { RequestContext } from '../lib/context';
import { UpstreamError, ValidationError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { anthropicMessage, extractJson, extractText, type AnthropicResponse } from '../lib/anthropic';
import { COMPETENCIAS } from '../data/competencias';

const log = logger('DRAFTS');

const COMPETENCIAS_LIST_FOR_PROMPT = COMPETENCIAS
  .map((c) => `  - ${c.id}: ${c.nombre}`)
  .join('\n');

export type JobProfileDraft = {
  // Datos básicos del puesto (tabla header del PDF)
  title: string;                          // Cargo (ej. "Gerente de Operaciones")
  company: string;                        // Empresa (ej. "Latam Vaping")
  sector?: string;                        // Sector / industria (ej. "Distribución mayorista de vapes — LATAM")
  modalidad?: string;                     // "Presencial" | "Híbrido" | "Remoto" + zona
  viajes?: string;                        // Disponibilidad de viajes
  salario?: string;                       // Texto humano del salario (ej. "USD 3,500 mensuales")
  reporta_a?: string;                     // A quién reporta (ej. "Socios / Dueños de la empresa")
  a_cargo?: string;                       // Quién está a su cargo (ej. "Equipo de vendedores + Project Manager")
  incorporacion?: string;                 // Fecha o "A convenir"

  // Narrativa del puesto
  objetivo_cargo: string;                 // Párrafo: qué hace esta persona en general
  responsabilidades: string[];            // Lista de responsabilidades principales
  tareas_especificas: string[];           // Lista de tareas concretas del día a día
  herramientas_conocimientos: string[];   // Lista de herramientas y conocimientos técnicos requeridos

  // Perfil del candidato
  formacion_requerida?: string;           // Formación académica esperada
  experiencia_requerida?: string;         // Años + tipo de experiencia

  // Tipo de persona — DISC traducido a lenguaje humano
  disc_perfil_descripcion: string;        // Párrafo: "Buscamos persona [D alto + C alto] que pueda..."
  disc_ventajas: string[];                // Lista: qué va a poder hacer esta persona
  disc_desventajas_potenciales: string[]; // Lista: qué cosas le pueden costar / a tener en cuenta

  // Datos técnicos (interno, opcional mostrarlos al cliente)
  context_summary: string;
  cognitive_level: 'basic' | 'mid' | 'senior';
  disc_ideal: { d: number; i: number; s: number; c: number; description: string[] };
  velna_ideal: { verbal: number; espacial: number; logica: number; numerica: number; abstracta: number };
  competencias: { name: string; required_pct: number; que_evaluamos?: string }[];
  tech_prompt_seed: string;
  salary_range_usd: { min: number; max: number };
  tecnica_minimo_pct: number;
  highlights_from_transcript: { type: string; text: string }[];
};

const DRAFT_SYSTEM_PROMPT = `[PROMPT_VERSION:v3-perfil-completo-2026-05-15] Sos un experto en evaluación de talento que ayuda a una recruiter a estructurar puestos.

Tu input: el transcript (texto plano) de una reunión entre la recruiter y un cliente que necesita contratar.
Tu output: un JSON con el Job Profile Draft listo para revisar.

Reglas:
- Inferí el rol del cliente, la empresa, los requisitos técnicos y soft del puesto.
- "title" y "company" son OBLIGATORIOS, nunca los dejes vacíos. Si el transcript no menciona la empresa por nombre, usá la mejor inferencia ("Cliente nuevo", "Empresa del rubro X", etc.) — pero siempre llenalos.
- DISC ideal: basate en lo que el cliente describe.
- **DISC INVARIANTE OBLIGATORIO:** la suma D+I+S+C debe ser EXACTAMENTE 200, ni más ni menos. Ajustá los valores hasta que sumen 200. Si te equivocás en esto el draft completo queda mal. Verificá la suma antes de devolver el JSON.
- **DISC características — qué encaja con cada letra y qué NO** (importante para no inventar combinaciones que no existen):
  - **D alto** = resultados, decisión rápida, **cómodo con conflicto y confrontación**, directo. NO es paciente ni cooperativo por defecto.
  - **I alto** = sociable, persuasivo, optimista, **maneja conflicto persuadiendo y suavizando**. NO es bueno con detalles ni con trabajo solitario largo.
  - **S alto** = paciente, estable, cooperativo, lealtad alta, sostiene procesos. ❌ **EL S NO MANEJA CONFLICTO — LO EVITA**, prefiere armonía. Nunca asocies "manejo de conflictos" o "asertividad directa" al S alto.
  - **C alto** = analítico, atención al detalle, sigue reglas, **resuelve conflicto con datos/procesos objetivos** (no emocionalmente). NO es rápido ni le gusta ambigüedad.
- Para roles tipo supervisor con equipo difícil / conflicto activo: NO uses S alto. Usá D + C balanceado (D para asertividad, C para procesos), con I moderado si hay trato con gente.
- Reglas heurísticas: "líder con autoridad" → D alto + C medio. "Vendedor relacional" → I alto + D medio. "Operador minucioso" → C alto + S medio. "Coordinador empático con grupos estables" → S alto + I medio (sin conflicto).
- Cognitive level: 'basic' para roles operativos, 'mid' para profesionales, 'senior' para liderazgo o expertise.
- VELNA ideal (capacidad cognitiva): 50-70 para basic, 65-80 para mid, 75-90 para senior. Ajustar por sub-test según rol.
- Competencias: SOLO podés elegir IDs de la lista cerrada de abajo. NO inventes nombres custom. Elegí hasta 5 que mejor matcheen lo que el cliente mencionó como crítico. Devolvé el id (snake_case) en el campo "name". required_pct = 60-80 según importancia. Para cada competencia, escribí 1-2 frases en "que_evaluamos" describiendo qué evaluamos ESPECÍFICAMENTE PARA ESTE PUESTO (no genérico). Ejemplo para "liderazgo" en un Gerente: "Capacidad de dirigir equipos con firmeza, tomar decisiones bajo presión y mantener al equipo enfocado en resultados."

**CAMPOS OBLIGATORIOS — JAMÁS los dejes vacíos. Si el transcript no es explícito, INFERILOS razonablemente del rol/sector/empresa. Un draft con estos campos vacíos es inutilizable.**

PERFIL DE CARGO (lo que se le manda al cliente):
- "objetivo_cargo": OBLIGATORIO. 2-3 frases en lenguaje natural explicando qué hace esta persona (no jerga técnica). Inferí siempre.
- "responsabilidades": OBLIGATORIO. 5-10 bullets de responsabilidades principales como acciones ("Supervisar...", "Gestionar...", "Liderar..."). Mínimo 5 — inferí del rol si el cliente no las detalló.
- "tareas_especificas": OBLIGATORIO. 3-6 bullets concretos del día a día / semana a semana. Inferí del rol.
- "herramientas_conocimientos": OBLIGATORIO. 3-7 bullets de software, herramientas, idiomas, certificaciones requeridos. Inferí del rol.
- "formacion_requerida": OBLIGATORIO. 1-2 frases sobre formación académica esperada. Inferí del rol (ej. "Ingeniería Industrial, Administración o carrera afín. Graduado.").
- "experiencia_requerida": OBLIGATORIO. 1-2 frases sobre años + tipo de experiencia previa. Inferí del rol.
- "sector": OBLIGATORIO. Sector/industria de la empresa. Inferí del contexto.
- "modalidad": OBLIGATORIO. "Presencial" | "Híbrido" | "Remoto" + zona si aplica. Inferí si no es explícito.
- "viajes", "salario", "reporta_a", "a_cargo", "incorporacion": llenalos si el transcript los menciona; si no, dejá string vacío "".

TIPO DE PERSONA — traducción humana del DISC para el cliente (OBLIGATORIO, JAMÁS vacíos):
- "disc_perfil_descripcion": OBLIGATORIO. 2-3 frases en lenguaje natural describiendo qué TIPO de persona es la ideal según el DISC. Ej: "Buscamos una persona dominante y orientada a resultados (D alta), con disciplina y atención al detalle (C alta). Esa combinación le va a permitir liderar con firmeza pero también mantener el orden de los procesos."
- "disc_ventajas": OBLIGATORIO. 3-5 bullets de qué VA A PODER hacer bien esta persona gracias a su perfil. Ej: "Tomar decisiones rápidas sin esperar consenso", "Liderar a vendedores con metas claras". Mínimo 3.
- "disc_desventajas_potenciales": OBLIGATORIO. 2-4 bullets de qué cosas le pueden costar o áreas a observar. Ej: "Puede ser percibida como exigente por compañeros más colaborativos", "Su impaciencia puede chocar con procesos lentos del cliente final". Mínimo 2.

ANTES de devolver el JSON, verificá que TODOS los campos marcados OBLIGATORIO tengan contenido. Si alguno está vacío o es array vacío, COMPLETALO con inferencia razonable basada en el rol/sector. Es preferible un valor inferido a un campo vacío.

LISTA DE COMPETENCIAS VÁLIDAS (usá EXACTAMENTE estos IDs, ninguno fuera de esta lista):
${COMPETENCIAS_LIST_FOR_PROMPT}
- Highlights: marcar 3-5 fragmentos textuales del transcript que son clave (rol, salario, urgencia, contexto, preocupaciones).

Devolvé SOLO el JSON, sin texto adicional, sin markdown fences. Si falta información crítica, usá valores razonables y márcalo en context_summary.

Schema completo (incluí todos los campos):
{
  "title": string,
  "company": string,
  "sector": string,
  "modalidad": string,
  "viajes": string,
  "salario": string,
  "reporta_a": string,
  "a_cargo": string,
  "incorporacion": string,
  "objetivo_cargo": string,
  "responsabilidades": [string],
  "tareas_especificas": [string],
  "herramientas_conocimientos": [string],
  "formacion_requerida": string,
  "experiencia_requerida": string,
  "disc_perfil_descripcion": string,
  "disc_ventajas": [string],
  "disc_desventajas_potenciales": [string],
  "context_summary": string,
  "cognitive_level": "basic" | "mid" | "senior",
  "disc_ideal": { "d": 0-100, "i": 0-100, "s": 0-100, "c": 0-100, "description": [string] },
  "velna_ideal": { "verbal": 0-100, "espacial": 0-100, "logica": 0-100, "numerica": 0-100, "abstracta": 0-100 },
  "competencias": [{ "name": string, "required_pct": 0-100, "que_evaluamos": string }],
  "tech_prompt_seed": string,
  "salary_range_usd": { "min": number, "max": number },
  "tecnica_minimo_pct": 50-80,
  "highlights_from_transcript": [{ "type": "role"|"salary"|"urgency"|"context"|"concern", "text": string }]
}`;

const REFINE_SYSTEM_PROMPT = `Sos el mismo experto. Te paso un Job Profile Draft que generaste antes y feedback de la recruiter.
Aplicá el feedback y devolvé el JSON corregido (mismo schema). Si el feedback es vago o no aplica al schema, mantené el campo original.
Devolvé SOLO el JSON.`;

export async function generateDraft(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  await requireTenant(ctx);

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
  if (!transcript) throw new ValidationError('transcript is required');
  if (transcript.length < 100) throw new ValidationError('transcript too short (<100 chars)');
  if (transcript.length > 50_000) throw new ValidationError('transcript too long (>50k chars)');

  log.info('generating draft', { traceId: ctx.traceId, transcriptLength: transcript.length });

  const response = await anthropicMessage({
    system: [
      { type: 'text', text: DRAFT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: `Transcript de la reunión:\n\n${transcript}` }],
    maxTokens: 5000,
    temperature: 0.4,
  }, ctx.traceId);

  let draft: JobProfileDraft;
  try {
    draft = extractJson<JobProfileDraft>(response);
    // DEBUG: logear los keys que la IA realmente generó para diagnosticar problemas de prompt vs deploy
    log.info('IA generated draft keys', {
      traceId: ctx.traceId,
      keys: Object.keys(draft as unknown as Record<string, unknown>),
      has_objetivo_cargo: 'objetivo_cargo' in draft,
      has_responsabilidades: 'responsabilidades' in draft,
      has_disc_perfil_descripcion: 'disc_perfil_descripcion' in draft,
    });
  } catch (err) {
    logIaParseFailure(ctx, 'draft', response, err as Error);
    throw new UpstreamError('anthropic', 'IA returned malformed JSON for draft', {
      stop_reason: response.stop_reason,
      output_tokens: response.usage.output_tokens,
      preview: extractText(response).slice(0, 200),
    });
  }

  // Auto-corrección de la regla DISC suma = 200. Aunque el prompt lo pide,
  // la IA a veces se equivoca por 1-2 puntos. Normalizamos proporcionalmente
  // para que siempre se cumpla la invariante del sistema de scoring.
  if (draft.disc_ideal) {
    const { d, i, s, c } = draft.disc_ideal;
    const sum = (d ?? 0) + (i ?? 0) + (s ?? 0) + (c ?? 0);
    if (sum !== 200 && sum > 0) {
      const factor = 200 / sum;
      const scaled = {
        d: Math.round((d ?? 0) * factor),
        i: Math.round((i ?? 0) * factor),
        s: Math.round((s ?? 0) * factor),
        c: Math.round((c ?? 0) * factor),
      };
      // Ajuste fino por redondeo: empujar el delta al dimensión más alta
      const diff = 200 - (scaled.d + scaled.i + scaled.s + scaled.c);
      if (diff !== 0) {
        const entries = Object.entries(scaled) as Array<[keyof typeof scaled, number]>;
        entries.sort((a, b) => b[1] - a[1]);
        scaled[entries[0][0]] += diff;
      }
      log.info('DISC normalized to sum=200', {
        traceId: ctx.traceId, original_sum: sum,
        before: { d, i, s, c },
        after: scaled,
      });
      draft.disc_ideal = { ...draft.disc_ideal, ...scaled };
    }
  }

  // Filtrar competencias que la IA haya inventado fuera del catálogo cerrado.
  // Si vienen con nombre humano (ej. "Liderazgo"), intentar mapear al ID; si no
  // matchea, descartarla. Solo dejamos las que sí están en COMPETENCIAS.
  if (Array.isArray(draft.competencias)) {
    const validIds = new Set(COMPETENCIAS.map((c) => c.id));
    const idByLowerName = new Map<string, string>();
    for (const c of COMPETENCIAS) {
      idByLowerName.set(c.id.toLowerCase(), c.id);
      idByLowerName.set(c.nombre.toLowerCase(), c.id);
    }
    const dropped: string[] = [];
    const filtered = draft.competencias
      .map((c) => {
        const raw = (c.name ?? '').trim();
        if (!raw) return null;
        if (validIds.has(raw)) return c;
        const mapped = idByLowerName.get(raw.toLowerCase());
        if (mapped) return { ...c, name: mapped };
        dropped.push(raw);
        return null;
      })
      .filter((c): c is { name: string; required_pct: number } => c !== null);
    if (dropped.length > 0) {
      log.warn('IA proposed invalid competencias — filtered', {
        traceId: ctx.traceId, dropped, kept: filtered.map((c) => c.name),
      });
    }
    draft.competencias = filtered;
  }

  sendJson(ctx.res, 200, {
    draft,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read: response.usage.cache_read_input_tokens ?? 0,
    },
  });
}

function logIaParseFailure(ctx: RequestContext, op: string, response: AnthropicResponse, err: Error): void {
  log.error('IA returned unparseable JSON', {
    traceId: ctx.traceId,
    op,
    error: err.message,
    stop_reason: response.stop_reason,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    raw_preview: extractText(response).slice(0, 300),
  });
}

export async function refineDraft(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  await requireTenant(ctx);

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  const draft = body.draft as JobProfileDraft | undefined;
  const feedback = typeof body.feedback === 'string' ? body.feedback.trim() : '';
  if (!draft || typeof draft !== 'object') throw new ValidationError('draft is required');
  if (!feedback) throw new ValidationError('feedback is required');

  log.info('refining draft', { traceId: ctx.traceId, feedbackLength: feedback.length });

  const response = await anthropicMessage({
    system: REFINE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Draft actual:\n\`\`\`json\n${JSON.stringify(draft, null, 2)}\n\`\`\`\n\nFeedback de la recruiter:\n${feedback}`,
      },
    ],
    maxTokens: 5000,
    temperature: 0.3,
  }, ctx.traceId);

  let refined: JobProfileDraft;
  try {
    refined = extractJson<JobProfileDraft>(response);
  } catch (err) {
    logIaParseFailure(ctx, 'refine', response, err as Error);
    throw new UpstreamError('anthropic', 'IA returned malformed JSON for refine', {
      stop_reason: response.stop_reason,
      output_tokens: response.usage.output_tokens,
      preview: extractText(response).slice(0, 200),
    });
  }

  sendJson(ctx.res, 200, {
    draft: refined,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  });
}
