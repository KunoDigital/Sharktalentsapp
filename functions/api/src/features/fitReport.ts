/**
 * Fit Report editor — camino A finalista.
 *
 * Cuando Chris marca "Reunión hecha" en Prospectos, la card pasa a "Esperando reporte".
 * Chris entra al editor `/marketing/fit-report/:leadId`, pega la transcripción de la
 * reunión con el cliente + sus notas de fit, la IA genera un reporte estructurado,
 * ella revisa/edita, y clickea "Enviar reporte".
 *
 * Al enviar:
 *   - Formatea el reporte como HTML y lo manda al cliente por ZeptoMail
 *   - Marca finalist_status='reporte_enviado' + report_sent_by='manual_chris'
 *   - Ejecuta round-robin → card aparece en Ventas del vendedor asignado
 *
 * Endpoints:
 *   POST /api/marketing/fit-report/:leadId/generate  → IA arma el reporte JSON
 *   POST /api/marketing/fit-report/:leadId/send      → envía + handoff a vendedor
 *
 * Persistencia: por ahora no persistimos el JSON del reporte. El email queda como
 * registro. Si más adelante Chris quiere ver reportes históricos, agregamos
 * columna `fit_report_json` a MarketingLeads (Text 20k).
 */

import type { RequestContext } from '../lib/context';
import { AppError, NotFoundError, UpstreamError, ValidationError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { anthropicMessage, extractJson, type AnthropicResponse } from '../lib/anthropic';
import { signToken, expiresIn, DAY_SEC } from '../lib/urlSigning';
import { env } from '../lib/env';
import { publishAndProcessEvent } from './outbox';

// ============================================================================
// Helper: genera URL firmado del reporte demo del candidato (30 días).
// El email del fit report incluye este link para que el cliente pueda ver los
// datos duros (DISC visual, cognitiva, competencias, etc).
// ============================================================================
function buildDemoReportUrl(evalResultId: string | null | undefined): string | null {
  if (!evalResultId) return null;
  const token = signToken({ kind: 'report', ref: evalResultId, exp: expiresIn(30 * DAY_SEC) });
  const base = env().APP_BASE_URL.replace(/\/$/, '');
  return `${base}/app/index.html#/demo-report/${token}`;
}

function buildFitReportViewUrl(leadId: string): string {
  const token = signToken({ kind: 'fit_report', ref: leadId, exp: expiresIn(30 * DAY_SEC) });
  const base = env().APP_BASE_URL.replace(/\/$/, '');
  return `${base}/app/index.html#/fit-report-view/${token}`;
}

// ============================================================================
// GET /api/marketing/fit-report/view/:token — endpoint público
// ============================================================================
//
// Endpoint sin autenticación Clerk. La única auth es el token firmado en el
// path. Le sirve al frontend público de la página del fit report (que Diego
// abre al clickear el link del email) para obtener el JSON del reporte.
//
// Errores:
//   - 401 invalid_token → token corrupto o kind incorrecto
//   - 410 token_expired → pasaron 30 días desde el envío
//   - 404 report_not_found → el reporte fue borrado o nunca se guardó
export async function viewFitReport(ctx: RequestContext): Promise<void> {
  const m = ctx.req.url?.match(/^\/api\/marketing\/fit-report\/view\/([^/]+)\/?$/);
  const token = m?.[1];
  if (!token) throw new ValidationError('token missing in path');

  const { verifyToken, TokenError } = await import('../lib/urlSigning.js');
  let leadId: string;
  try {
    const claims = verifyToken(token, 'fit_report');
    leadId = String(claims.ref ?? '');
    if (!leadId) throw new AppError(401, 'invalid_token', 'Token sin ref');
  } catch (err) {
    if (err instanceof TokenError) {
      if (err.reason === 'expired') throw new AppError(410, 'token_expired', 'El link expiró');
      throw new AppError(401, 'invalid_token', 'Token inválido');
    }
    throw err;
  }

  const { lead, candidate, scores } = await loadLeadContext(ctx.req, leadId);

  if (!lead.fit_report_json) {
    throw new NotFoundError('fit report not yet generated');
  }

  let report: FitReport;
  try {
    report = JSON.parse(lead.fit_report_json) as FitReport;
  } catch (err) {
    log.warn('failed to parse saved fit_report_json', { leadId, error: (err as Error).message });
    throw new AppError(500, 'invalid_report', 'Error leyendo el reporte guardado');
  }

  const demoReportUrl = buildDemoReportUrl(lead.eval_result_id);

  // Datos duros que renderiza la UI (DISC bars, VELNA rows, competencias, ejes
  // integridad). La IA no los produce — vienen del backend.
  const integrityDimensions = lead.eval_result_id
    ? await loadIntegrityDimensions(ctx.req, lead.eval_result_id)
    : [];

  // Extracto compacto de scores para la UI — solo los que se muestran directo
  // (evitamos filtrar PII innecesaria; scores no es sensible pero es limpieza).
  const s = (scores ?? {}) as Record<string, unknown>;
  const numOrNull = (v: unknown): number | null => {
    if (typeof v === 'number' && !isNaN(v)) return v;
    const p = parseFloat(String(v ?? ''));
    return isNaN(p) ? null : p;
  };
  const scoresPublic = {
    disc: {
      d: numOrNull(s.disc_norm_d),
      i: numOrNull(s.disc_norm_i),
      s: numOrNull(s.disc_norm_s),
      c: numOrNull(s.disc_norm_c),
      perfil_dominante: (typeof s.disc_perfil_dominante === 'string' ? s.disc_perfil_dominante : null),
    },
    velna: {
      verbal: numOrNull(s.velna_verbal),
      logica: numOrNull(s.velna_logica),
      numerica: numOrNull(s.velna_numerica),
      abstracta: numOrNull(s.velna_abstracta),
      espacial: numOrNull(s.velna_espacial),
      indice: numOrNull(s.velna_indice ?? s.velna_total),
    },
    integridad: {
      overall_nivel: (typeof s.int_overall === 'string' ? s.int_overall.toLowerCase() : null),
      overall_pct: numOrNull(s.int_overall_pct),
      buena_impresion_pct: numOrNull(s.int_buena_impresion_pct),
      dimensiones: integrityDimensions,
    },
  };

  sendJson(ctx.res, 200, {
    ok: true,
    report,
    scores: scoresPublic,
    demo_report_url: demoReportUrl,
    lead: {
      email: lead.email,
      contact_name: lead.contact_name,
      company: lead.company,
      puesto: lead.puesto,
    },
    candidate: candidate ? { name: candidate.name } : null,
  });
}

const log = logger('FIT_REPORT');
const TABLE_LEADS = 'MarketingLeads';

// ============================================================================
// FitReport type — estructura del reporte que devuelve la IA
// ============================================================================
// El schema calza 1:1 con el mockup mockup-reporte-completo-fit-psicometrico.html.
// La IA rellena narrativa + disc_alineacion_score. El backend calcula fit_pct
// después de recibir la respuesta.

export type FitSello = 'recomendado' | 'recomendado_con_reservas' | 'no_recomendado' | 'pendiente_evaluacion';
export type FitLevel = 'alto' | 'medio' | 'bajo' | 'pendiente';
export type MatchEstado = 'engrana' | 'a_validar';

export type FitReport = {
  // Cabecera
  cliente_empresa: string;
  cliente_contacto: string;
  puesto: string;
  candidato_nombre: string;

  // 1. Veredicto (portada + banner)
  veredicto: {
    sello: FitSello;
    titulo: string;                          // "Natalie es recomendada" — máx 8 palabras, en positivo
    parrafo: string;                         // máx 60 palabras
    fit_pct: number | null;                  // 0-100 — lo calcula el backend, la IA NO
  };

  // 2. Matches — expectativas vs evidencia
  matches: Array<{
    expectativa: string;                     // máx 16 palabras, palabras del empleador
    estado: MatchEstado;                     // engrana | a_validar (NO hay "no engrana" ni "no evaluable")
    evidencias: string[];                    // 2 bullets citando el dato
  }>;

  // 3. Cómo es (2 columnas)
  como_es: {
    fuertes: string[];                       // 3-4 puntos
    debiles: string[];                       // 3-4 puntos con formato rasgo + consecuencia
  };

  // 4. Fit cultural
  fit_cultural: {
    nivel: FitLevel;
    parrafo: string;                         // máx 70 palabras
  };

  // 5. Cómo aprovechar este perfil (management post-hire — NO guía de entrevista)
  como_aprovechar: Array<{
    titulo: string;                          // la fortaleza que se aprovecha
    texto: string;                           // máx 35 palabras, imperativo suave al empleador
  }>;

  // 6. Conducta (DISC — la IA solo redacta narrativa, los números los muestra la UI)
  conducta: {
    perfil_pk: string;                       // del insumo, tal cual
    perfil_nombre: string;                   // del insumo, tal cual
    dominante_titulo: string;                // 3 descriptores separados por " · "
    dominante_parrafo: string;               // máx 60 palabras
    como_trabaja: {
      decisiones: string;                    // según derivación D + C
      equipo: string;                        // según derivación I + S
      presion: string;                       // según derivación D + S
      comunicacion: string;                  // según derivación I + C
    };
  };

  // 7. Pensamiento (VELNA — la IA solo redacta el "qué significa para ti")
  pensamiento: {
    que_significa: string;                   // máx 45 palabras
  };

  // 8. Integridad
  integridad: {
    parrafo: string;                         // máx 45 palabras incluyendo lectura del detector
    nota_medios: string | null;              // línea que aclare que ejes medios son observar, no alertas
  };

  // 9. Score que la IA propone (único número que produce)
  disc_alineacion_score: number;             // 0-100

  // 10. Faltantes (insumos ausentes)
  faltantes: string[];
};

// ============================================================================
// FIT_REPORT_SYSTEM_PROMPT v2.0 — system prompt para la IA
// ============================================================================
// Integración: Brand Book Cowork Claude (voz, alcance, ejemplos §6) + metodología
// técnica (formatos exactos, umbrales, fórmula fit_pct, derivaciones DISC, mapeo
// permitido). Schema calzado 1:1 con mockup-reporte-completo-fit-psicometrico.html.
// El "como_aprovechar" es management POST-hire, NO guía de entrevista.
// Versiones anteriores (v1-v4) en git history.

const FIT_REPORT_SYSTEM_PROMPT = `[PROMPT_VERSION:v2.0-fit-master-2026-07-16]

Eres el redactor senior de reportes de SharkTalents, una evaluadora de finalistas. Tu trabajo: convertir los resultados de las pruebas de un candidato y la transcripción de la llamada con el empleador en el contenido de su reporte.

Escribes para un dueño de empresa que decidirá una contratación con este documento. No es un psicólogo ni un reclutador. Es un empresario que necesita saber: qué tipo de persona tiene enfrente, qué tan bien engrana con lo que busca, cuáles son sus fortalezas y sus riesgos reales, cómo aprovecharla si la contrata.

Todo el reporte responde una sola pregunta:
¿Qué tan bien engrana este candidato con lo que el empleador realmente necesita?

Respondes ÚNICAMENTE con el JSON de la sección ESTRUCTURA DE SALIDA. Sin preámbulos, sin notas, sin markdown alrededor.

## INSUMOS

Recibirás cinco objetos:
1. transcripcion_llamada — texto plano de la conversación con el empleador. Fuente para extraer expectativas, cultura, estilo de liderazgo, problema del cargo y deal-breakers.
2. resultados_disc — con D/I/S/C (cada eje 0-100 INDEPENDIENTE, NO suman 100), perfil_pk (viene calculado, no lo inventes) y perfil_nombre. Categorías DISC: muy bajo <25, bajo 25-45, moderado 46-65, alto 66-80, muy alto >80.
3. resultados_velna — 5 sub-pruebas (verbal, logica, numerica, abstracta, espacial) + indice_global. Rangos: bajo <40, promedio 40-60, promedio_alto 61-75, alto 76-85, muy_alto >85.
4. resultados_integridad — overall (pct_riesgo INVERSO: 12% = MUY POCO riesgo, bueno; 80% = MUCHO riesgo, malo). Categorías: bajo 0-30, medio 31-60, alto 61-100. Buena impresión: normal 0-40, alto >40 (posible sesgo de deseabilidad social, NO significa engaño). Los 9 ejes vienen con dimension/nivel/pct cada uno.
5. datos_puesto — candidato_nombre, empleador_nombre, empresa, puesto. No trae CV. No asumas experiencia ni historial.

## LA VOZ (no negociable)

- Hablas como un asesor senior que ya revisó los datos y le dice la verdad al dueño, de tú a tú.
- Frases cortas. Una idea por frase. Si una frase necesita releerse, reescríbela.
- Cero exclamaciones. Cero emojis. Cero preguntas retóricas en el cuerpo.
- Lenguaje de negocio, nunca psicológico: "decide rápido cuando otros dudan", NO "alta dominancia". "Puede paralizarse si faltan datos", NO "baja tolerancia a la ambigüedad".
- Cada afirmación nace de un dato concreto (una prueba o una frase del empleador). Prohibido el elogio genérico y el adjetivo vacío.
- Honesto en ambas direcciones: los puntos débiles se escriben claros y específicos, sin crueldad y sin eufemismos. Un reporte que solo dice cosas buenas no se cree.
- Titulares y veredictos en positivo. El contenido puede señalar riesgos, pero nunca titules con una negación.
- El fit empareja, no descalifica. Fórmula de conclusión: "¿Buscas X? [Nombre] es ese perfil. ¿Tu operación necesita Y? Entonces [complemento o no es tu contratación]."
- Español neutral LatAm. "Tú", nunca "vos".

Palabras PROHIBIDAS: talento, capital humano, cinco dimensiones, a ciegas, cazar, presa, radar, sonar, garantizado, 100%, siempre, innovador, disruptivo, soluciones integrales, sinergia, holístico, excelente candidato, extraordinario, definitivamente, sin duda, altamente recomendado, infalible.

Palabras de la casa: evidencia, fit, engranar, detectar, señal, expectativas, alineación, criterio, consistencia.

## REGLAS DE ALCANCE (la marca nunca miente)

SOLO puedes afirmar lo que las pruebas y la llamada revelan: conducta (DISC), pensamiento (VELNA), integridad, y match entre eso y lo que el empleador dijo.

PROHIBIDO opinar sobre: experiencia previa, CV, historial laboral, rotación, idiomas, referencias, desempeño futuro, permanencia, salario, disponibilidad, industria, personalidad fuera del trabajo, diagnóstico psicológico, conocimientos técnicos.

Aunque el empleador lo mencione en la llamada, NO lo conviertas en match ni en hallazgo — esas validaciones son suyas, en su entrevista. Existe un campo "alcance" en la UI (texto fijo) que ya le recuerda al empleador qué le toca a él.

Nunca inventes números, porcentajes ni resultados. Si un insumo falta, deja su sección en null y agrégalo al array "faltantes".

Los valores numéricos crudos (D=72, verbal=78%, riesgo=15%) NUNCA aparecen en tus textos. La UI los muestra directo. Tú razonas con categorías (alto, moderado, bajo), no con números.
✓ "Tu candidata muestra un empuje comercial fuerte y una preferencia clara por decisiones rápidas."
✗ "Con D=72 y S=38, tu candidata..."

## METODOLOGÍA — DERIVACIONES DISC

Se leen del vector DISC COMPLETO, nunca solo del eje dominante.

Toma de decisiones (D + C):
- D alto + C bajo → decide rápido con la información disponible, prefiere avanzar antes que esperar certeza.
- D bajo + C alto → valida antes de actuar, minimiza errores, necesita evidencia.
- D alto + C alto → decide rápido pero fundamenta, equilibra velocidad y análisis.
- D bajo + C bajo → busca consenso, se apoya en otras personas antes de decidir.

Trabajo en equipo (I + S):
- I alto + S alto → construye relaciones, cuida el ambiente, genera estabilidad.
- I alto + S bajo → sociable pero orientada a acción, genera movimiento.
- I bajo + S alto → trabaja con constancia, aporta estabilidad, no busca protagonismo.
- I bajo + S bajo → independiente, marca su ritmo, no necesita interacción constante.

Bajo presión (D + S):
- D alto + S bajo → acelera, se vuelve directa, prioriza resolver.
- S alto → mantiene la calma, tolera bien la presión.
- D bajo + S bajo → puede detenerse, busca apoyo, necesita recuperar claridad.

Comunicación (I + C):
- I alto + C bajo → directa, expresiva, va al punto.
- I alto + C alto → cercana, estructurada, ordenada.
- I bajo + C alto → técnica, precisa, cuida detalles.
- I bajo + C bajo → breve, muy directa, sin exceso de contexto.

conducta.dominante_titulo: EXACTAMENTE 3 descriptores separados por " · ". Ej: "Persuasiva · Acción · Disfruta los retos". No más, no frases largas.

## METODOLOGÍA — VELNA

Interpreta cada sub-prueba EN FUNCIÓN DEL PUESTO, no en abstracto.
- Verbal → comprensión y comunicación de ideas. No implica "es buen comunicador" — la comunicación observable depende de DISC.
- Lógica → estructura de problemas, causa-efecto, decisiones fundamentadas.
- Numérica → información cuantitativa. No implica que pueda desempeñar un cargo financiero por sí sola.
- Abstracta → velocidad de aprendizaje, adaptación a lo desconocido.
- Espacial → visualización. Menciónala solo si el puesto la usa.

Si una sub-prueba baja es IRRELEVANTE para el puesto, DILO — ayuda al empleador.

En pensamiento.que_significa (máx 45 palabras): qué puede hacer el empleador con esta capacidad + qué área baja es irrelevante para ESTE puesto (si aplica).

## METODOLOGÍA — INTEGRIDAD

Es indicador PROBABILÍSTICO de riesgo, no diagnóstico ni acusación.
- Bajo → perfil consistente con prácticas laborales confiables.
- Medio → señales que justifican validar. No rechazo automático.
- Alto → alerta importante. Debe reflejarse en el veredicto.

Detector de buena impresión alto: posible deseabilidad social. Los resultados del resto se interpretan con cautela. NUNCA escribas "mintió", "manipuló la prueba", "engañó al sistema".

Ejes sensibles según el puesto (activa reservas si están en medio o alto):
- Comercial / finanzas → Uso de recursos, Transparencia en reportes, Manejo de excepciones.
- Operativo / técnico → Cumplimiento de normas, Conducta sin supervisión.
- Liderazgo → Relación con la autoridad, Manejo de información confidencial.

Menciona solo los ejes que aporten a la decisión. No enumeres los 9 si no suman.

integridad.parrafo (máx 45 palabras): incluye la lectura del detector de buena impresión.
integridad.nota_medios: si hay ejes en riesgo medio, una línea que aclare que son zonas para observar, no alertas. Si no hay ejes medios, deja este campo en null.

## EXTRACCIÓN Y MAPEO DE EXPECTATIVAS

De la transcripción extrae 3-6 expectativas concretas. Fuentes: estilo de dirección declarado, cultura del equipo, problema del cargo, preferencias fuertes y deal-breakers.

Cada expectativa debe: ser concreta ("empujar proyectos sin esperar instrucciones" ✓, "buen liderazgo" ✗); usar palabras similares a las del empleador; representar una necesidad real.

Solo entran en "matches" las expectativas EVALUABLES por las pruebas. Las NO evaluables (experiencia, idiomas, carrera, salario, disponibilidad, industria, portafolio, conocimientos técnicos, referencias, historial laboral) NO se listan. El texto fijo "alcance" en la UI ya le recuerda al empleador que esas las valida él.

Tabla de mapeo permitido (expectativa → dimensión que la respalda):
- Autonomía, no espera instrucciones → DISC (D moderado-alto, S bajo-moderado) + match con estilo hands-off.
- Empuje comercial, orientación a resultados → DISC (D alto) + VELNA lógica.
- Defender ideas con datos, debate → DISC (I moderado-alto) + VELNA verbal.
- Aprender rápido negocio nuevo → VELNA abstracta + lógica.
- Resolver problemas complejos → VELNA lógica + abstracta.
- Organización, método → DISC (C alto, opc. S alto).
- Trabajo colaborativo → DISC (I + S).
- Confiabilidad, honestidad, transparencia, cumplimiento → Integridad. Nunca DISC ni VELNA.
- Aguante a cuestionamiento → DISC (D con S bajo) + Integridad (transparencia).

Cada match tiene estado "engrana" o "a_validar". No hay "no engrana" — un desajuste frontal se refleja en el veredicto, no en un match negativo.

## LÓGICA DEL VEREDICTO — UMBRALES EXACTOS

sello = "recomendado" (todo debe cumplirse):
- Todas las expectativas evaluables engranan
- Integridad overall = bajo (<30% pct_riesgo)
- Buena impresión = normal (<40%)
- Ningún eje de integridad en alto

sello = "recomendado_con_reservas" (basta con UNO):
- 1-2 expectativas centrales en "a_validar"
- Integridad overall = medio (30-60%)
- Al menos 1 eje de integridad en riesgo medio (aunque overall sea bajo)
- Buena impresión = alto
- Desajuste conductual claro con una expectativa

Reservas se nombran con precisión. Nunca genéricas.

sello = "no_recomendado" (basta con UNO):
- Integridad overall = alto (>60%)
- Detector de buena impresión fuera de rango → respuestas no creíbles
- Al menos 1 eje de integridad en alto
- Recomendación del sistema = "no_apto"
- Desajuste frontal entre perfil y expectativas centrales

Se escribe con el mismo respeto: el candidato no es malo — no es para ESTE puesto.

sello = "pendiente_evaluacion" — SOLO cuando el input te avisa que las pruebas del candidato no están completas. En ese caso:
- veredicto.titulo: "Evaluación en curso"
- veredicto.parrafo: "El contexto del cliente quedó capturado. El análisis del candidato se completará cuando termine las evaluaciones."
- matches: array vacío []
- como_es, fit_cultural, como_aprovechar, conducta, pensamiento, integridad: usa strings vacías o null donde el schema lo permita
- disc_alineacion_score: 0
- faltantes: lista los insumos que faltan

## disc_alineacion_score — el ÚNICO número que produces

1. A partir de las expectativas del empleador, infiere un vector DISC ideal (D_ideal, I_ideal, S_ideal, C_ideal, cada uno 0-100).
2. Similitud por eje = min(candidato, ideal) / max(candidato, ideal). Si ambos son 0 usa 1.
3. Promedia las 4 similitudes.
4. Multiplica por 100. Redondea a entero. Ese es disc_alineacion_score.

No expliques la fórmula. No muestres el vector ideal. Solo devuelve el número.

## fit_pct — la calcula el BACKEND, tú NO

Deja veredicto.fit_pct = null. El backend rellena.

## ESTRUCTURA DE SALIDA (JSON estricto)

Responde ÚNICAMENTE con este objeto. Todos los textos en español neutral LatAm. Sin markdown alrededor. La respuesta empieza con { y termina con }.

{
  "cliente_empresa": "string",
  "cliente_contacto": "string",
  "puesto": "string",
  "candidato_nombre": "string",
  "veredicto": {
    "sello": "recomendado | recomendado_con_reservas | no_recomendado | pendiente_evaluacion",
    "titulo": "string (máx 8 palabras, positivo)",
    "parrafo": "string (máx 60 palabras)",
    "fit_pct": null
  },
  "matches": [
    { "expectativa": "string (máx 16 palabras)", "estado": "engrana | a_validar", "evidencias": ["string", "string"] }
  ],
  "como_es": {
    "fuertes": ["string", "string", "string"],
    "debiles": ["string (rasgo + consecuencia práctica)", "string", "string"]
  },
  "fit_cultural": {
    "nivel": "alto | medio | bajo | pendiente",
    "parrafo": "string (máx 70 palabras)"
  },
  "como_aprovechar": [
    { "titulo": "string", "texto": "string (máx 35 palabras, imperativo suave, gestión POST-HIRE)" }
  ],
  "conducta": {
    "perfil_pk": "string (del insumo, tal cual)",
    "perfil_nombre": "string (del insumo, tal cual)",
    "dominante_titulo": "3 descriptores separados por ' · '",
    "dominante_parrafo": "string (máx 60 palabras)",
    "como_trabaja": {
      "decisiones": "string (según derivación D + C)",
      "equipo": "string (según derivación I + S)",
      "presion": "string (según derivación D + S)",
      "comunicacion": "string (según derivación I + C)"
    }
  },
  "pensamiento": {
    "que_significa": "string (máx 45 palabras)"
  },
  "integridad": {
    "parrafo": "string (máx 45 palabras incluyendo lectura del detector)",
    "nota_medios": "string o null"
  },
  "disc_alineacion_score": 0,
  "faltantes": []
}

## EJEMPLOS DEL ESTÁNDAR

Un match bien escrito:
- Expectativa: "Una estratega que empuje lo comercial — no otra ejecutora como tu agencia anterior"
- Estado: "engrana"
- Evidencias:
  - "Perfil orientado a resultados que decide rápido: empuja proyectos hasta cerrarlos, no espera instrucciones."
  - "Razonamiento lógico alto: piensa en causa-efecto — puede construir el funnel y medir impacto, no solo publicar contenido."

Un punto débil bien escrito:
- "La rutina sin reto la apaga: necesita proyectos que la exijan o empieza a mirar la puerta."

Un "qué significa" bien escrito:
- "Aprende rápido y razona por encima del promedio en las áreas que tu rol usa a diario: verbal y lógico. Puedes darle problemas nuevos sin manual. Su área más baja (espacial) es irrelevante para un rol de marca y funnel."

Un "como_aprovechar" bien escrito:
- titulo: "Dale problemas, no tareas"
- texto: "Cuando le encargues algo, dale el problema a resolver, no la lista de pasos. Se apaga con la rutina y se enciende con el reto — usá eso a tu favor."

Una conclusión estilo fit bien escrita (donde [Nombre] es placeholder — reemplázalo por el candidato_nombre real que te llega en los insumos):
- "¿Buscas a alguien que empuje, decida rápido y disfrute los retos? [Nombre] es ese perfil. ¿Tu operación necesita método fino y paciencia con los detalles? Entonces necesita a su lado un perfil preciso que lo complemente — o no es tu contratación. Persuasiva y de acción, sí. Meticulosa, no."

REGLA DE NOMBRES: Los nombres en los ejemplos anteriores ("Natalie", "Chris", cualquier otro) son placeholders ilustrativos. En tu respuesta usa SIEMPRE el candidato_nombre real que te llega en datos_puesto. Nunca copies un nombre de los ejemplos.

## CONTROL DE CALIDAD (autoverifica antes de responder)

- JSON válido, sin texto alrededor, sin markdown.
- Cero palabras prohibidas, cero exclamaciones, cero emojis.
- Cada afirmación tiene su dato (prueba o llamada).
- Cero juicios sobre CV, experiencia, idiomas, historial, salario.
- Los débiles son específicos y con consecuencia práctica.
- como_aprovechar es gestión POST-HIRE, NO guía de entrevista. Verifica: si un texto dice "validar", "profundizá", "preguntá en la entrevista" → NO va acá.
- Ningún valor numérico crudo (D=72, 78%, 15%) aparece en los textos.
- veredicto.fit_pct = null (siempre).
- disc_alineacion_score es entero 0-100.
- Longitudes máximas respetadas.
- Veredicto coherente con integridad + fit + DISC + VELNA + expectativas.
- La respuesta empieza con { y termina con }.

# END OF PROMPT — la respuesta empieza abajo directo con el JSON.
`;

// ============================================================================
// Helper: formatea los scores crudos de la DB a lenguaje humano para la IA.
// Los scores crudos tienen nombres técnicos (int_overall_pct, disc_norm_d) que
// la IA puede malinterpretar. Ejemplo: int_overall_pct=12 significa "12% de
// riesgo" (bueno) pero se puede leer como "percentil 12" (malo). Este helper
// convierte scores a categorías + traducciones listas para usar.
// ============================================================================
// Categorización cualitativa de scores. La IA NUNCA ve el número crudo — solo
// la categoría. Así es imposible que exponga "D=30" o "verbal 75" al cliente.
function discCat(v: unknown): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  if (isNaN(n)) return 'sin dato';
  if (n < 25) return 'muy bajo (trait ausente o casi no expresado)';
  if (n < 45) return 'bajo (trait presente pero no domina)';
  if (n < 65) return 'moderado (trait balanceado)';
  if (n < 80) return 'alto (trait consistentemente expresado)';
  return 'muy alto (trait muy dominante en el estilo)';
}

function cogCat(v: unknown): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  if (isNaN(n)) return 'sin dato';
  if (n < 40) return 'bajo el promedio (posible dificultad en esta dimensión)';
  if (n < 60) return 'promedio (dentro de rango esperado)';
  if (n < 75) return 'promedio alto (arriba del rango esperado)';
  if (n < 85) return 'alto (fortaleza clara)';
  return 'muy alto (fortaleza excepcional)';
}

function formatScoresForAI(s: Record<string, unknown>): string {
  const has = (k: string) => s[k] !== null && s[k] !== undefined && s[k] !== '';
  const parts: string[] = [];

  // ─── DISC ───
  if (has('disc_completed_at')) {
    const d = discCat(s.disc_norm_d);
    const i = discCat(s.disc_norm_i);
    const sc = discCat(s.disc_norm_s);
    const c = discCat(s.disc_norm_c);

    // Detectar patrón general
    const nums = [s.disc_norm_d, s.disc_norm_i, s.disc_norm_s, s.disc_norm_c].map((v) => typeof v === 'number' ? v : parseFloat(String(v ?? 0)));
    const maxVal = Math.max(...nums.filter((n) => !isNaN(n)));
    const patternDesc = maxVal < 45
      ? 'ADAPTABLE / CAMALEÓNICO — ningún eje se expresa fuertemente. La persona no tiene un modo dominante; se ajusta al contexto. Puede ser fortaleza (flexibilidad) o riesgo (falta de empuje propio) según el rol.'
      : maxVal < 65
        ? 'MODERADO — un eje se distingue pero sin ser característico dominante.'
        : 'MARCADO — el eje dominante está claramente expresado.';

    parts.push(`PERFIL CONDUCTUAL DEL CANDIDATO:
Patrón general: ${patternDesc}
Eje que asoma más (RELATIVO): ${String(s.disc_perfil_dominante ?? 'sin dato claro')}

Cómo se expresa cada dimensión:
- Orientación a resultados / empuje / decisión rápida: ${d}
- Comunicación / persuasión / carisma social: ${i}
- Estabilidad / paciencia / tolerancia a rutina: ${sc}
- Análisis / atención al detalle / seguimiento de procesos: ${c}

TRADUCCIONES LISTAS PARA USAR AL ESCRIBIR AL CLIENTE (no las copies literal, adaptalas al contexto — SOLO no inventes categorías distintas a las que dice arriba):
- Orientación a resultados baja/muy baja → "estilo colaborativo, prefiere consenso antes que empujar"
- Orientación a resultados moderada → "empuja cuando el contexto lo pide, no como default"
- Orientación a resultados alta → "orientada a resultados, decide rápido"
- Persuasión/carisma bajo/muy bajo → "más analítica que influenciadora; convence con datos, no con carisma"
- Persuasión/carisma moderado → "comunicativa cuando el contexto lo requiere"
- Persuasión/carisma alto → "comunicativa, entusiasta, persuasiva"
- Estabilidad baja/muy baja → "orientada al cambio y la variedad, menos cómoda con rutina"
- Estabilidad moderada → "balance entre cambio y consistencia"
- Estabilidad alta → "estable, paciente, buena para roles operacionales"
- Análisis/procesos bajo → "flexible, orientada a resultados por sobre procesos"
- Análisis/procesos moderado → "sigue procesos que aporten valor, sin rigidez"
- Análisis/procesos alto → "atenta al detalle, metódica"`);
  }

  // ─── COGNITIVO ───
  if (has('velna_completed_at')) {
    const verbal = cogCat(s.velna_verbal);
    const logica = cogCat(s.velna_logica);
    const num = cogCat(s.velna_numerica);
    const esp = cogCat(s.velna_espacial);
    const abs = cogCat(s.velna_abstracta);
    const idx = cogCat(s.velna_indice ?? s.velna_total);

    parts.push(`CAPACIDAD COGNITIVA DEL CANDIDATO:
Nivel general: ${idx}

Por dimensión:
- Comunicación verbal (estructurar ideas, comunicar con claridad): ${verbal}
- Razonamiento lógico (sistemas, causa-efecto, planificación): ${logica}
- Razonamiento numérico (métricas, cálculos, presupuestos): ${num}
- Visión espacial (visualización de escenarios complejos): ${esp}
- Razonamiento abstracto (patrones, conceptos): ${abs}

TRADUCCIONES LISTAS PARA USAR:
- Verbal alto/muy alto → "comunica ideas con claridad y estructura argumentos con precisión"
- Verbal bajo → "puede tener dificultad para articular estrategias complejas verbalmente"
- Lógica alto/muy alto → "razona bien con datos y sistemas, buena para planificar y medir"
- Lógica bajo → "posible dificultad para pensar en causa-efecto o construir funnels"
- Numérica alto → "maneja bien números, métricas y presupuestos"
- Espacial alto → "visualiza bien escenarios complejos y estructuras"
- Abstracta alto → "capta patrones y conceptos abstractos con facilidad"
- Nivel general "bajo el promedio" → "posible dificultad en tareas cognitivas complejas del rol"
- Nivel general "promedio" → "capacidad de análisis suficiente para el rol"
- Nivel general "promedio alto" → "capacidad de análisis por encima del promedio"
- Nivel general "alto" → "capacidad analítica destacable, encaja con roles estratégicos"`);
  }

  // ─── INTEGRIDAD ───
  if (has('int_completed_at')) {
    const riesgo = String(s.int_overall ?? '').toLowerCase();
    const rec = String(s.int_recomendacion ?? '').toLowerCase();
    const imgPct = typeof s.int_buena_impresion_pct === 'number' ? s.int_buena_impresion_pct : parseFloat(String(s.int_buena_impresion_pct ?? 0));

    let integrityDesc: string;
    if (riesgo === 'bajo') integrityDesc = 'PERFIL ÍNTEGRO Y CONFIABLE — baja probabilidad de conductas problemáticas (deshonestidad, ocultamiento, incumplimiento). RESULTADO POSITIVO.';
    else if (riesgo === 'medio') integrityDesc = 'REQUIERE ATENCIÓN — algunas dimensiones muestran señales que conviene validar.';
    else if (riesgo === 'alto') integrityDesc = 'MÚLTIPLES SEÑALES DE ALERTA — el sistema no recomienda avanzar sin validación profunda.';
    else integrityDesc = 'sin evaluación completada';

    let recDesc: string;
    if (rec === 'apto') recDesc = 'las pruebas RECOMIENDAN avanzar con este candidato.';
    else if (rec === 'duda_cv' || rec === 'duda') recDesc = 'las pruebas piden VALIDAR en entrevista antes de decidir.';
    else if (rec === 'no_apto') recDesc = 'las pruebas NO recomiendan avanzar.';
    else recDesc = 'sin recomendación clara.';

    let imgDesc: string;
    if (imgPct < 40) imgDesc = 'Respuestas espontáneas y creíbles — no intentó proyectar imagen mejor de la real.';
    else if (imgPct < 60) imgDesc = 'Respuestas creíbles con leve tendencia a proyectar imagen positiva.';
    else imgDesc = 'ALERTA — el candidato intentó proyectar imagen mejor de la real (sesgo sospechoso). Cuestiona la credibilidad del resto de las respuestas.';

    parts.push(`INTEGRIDAD DEL CANDIDATO:
${integrityDesc}
Recomendación de las pruebas: ${recDesc}
Manejo de imagen: ${imgDesc}

TRADUCCIONES LISTAS PARA USAR:
- Perfil íntegro y confiable → "perfil íntegro y confiable — reporta con honestidad, sin inflar"
- Requiere atención → "hay señales que ameritan validar en entrevista antes de avanzar"
- Alerta múltiple → "requiere validación profunda antes de considerar avance"
- Apto → "recomendado según las pruebas de integridad"
- Duda → "las pruebas piden confirmar en entrevista si su discurso es consistente con su historial"
- Imagen positiva sesgada → "tendió a mostrarse mejor de lo real — considerar sesgo al leer el reporte"`);
  }

  return parts.length > 0 ? parts.join('\n\n') : 'Sin resultados en las pruebas.';
}

// ============================================================================
// Helper: leer datos del candidato + scores
// ============================================================================

async function loadLeadContext(req: RequestContext['req'], leadId: string): Promise<{
  lead: { ROWID: string; email: string; contact_name: string | null; company: string | null; puesto: string | null; eval_result_id: string | null; assigned_to: string | null; fit_choice: string | null; finalist_status: string | null; fit_report_json: string | null };
  candidate: { name: string; email: string } | null;
  scores: Record<string, unknown> | null;
}> {
  let leads: Array<{ ROWID: string; email: string; contact_name: string | null; company: string | null; puesto: string | null; eval_result_id: string | null; assigned_to: string | null; fit_choice: string | null; finalist_status: string | null; fit_report_json: string | null }> = [];
  try {
    leads = unwrapRows<{ ROWID: string; email: string; contact_name: string | null; company: string | null; puesto: string | null; eval_result_id: string | null; assigned_to: string | null; fit_choice: string | null; finalist_status: string | null; fit_report_json: string | null }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID, email, contact_name, company, puesto, eval_result_id, assigned_to, fit_choice, finalist_status, fit_report_json FROM ${TABLE_LEADS} WHERE ROWID = '${escapeSql(leadId)}' LIMIT 1`,
      )) as unknown[],
      TABLE_LEADS,
    );
  } catch (err) {
    // Fallback si fit_report_json no existe todavía en Catalyst
    log.warn('loadLeadContext full query failed — retrying without fit_report_json', { leadId, error: (err as Error).message });
    const partial = unwrapRows<{ ROWID: string; email: string; contact_name: string | null; company: string | null; puesto: string | null; eval_result_id: string | null; assigned_to: string | null; fit_choice: string | null; finalist_status: string | null }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT ROWID, email, contact_name, company, puesto, eval_result_id, assigned_to, fit_choice, finalist_status FROM ${TABLE_LEADS} WHERE ROWID = '${escapeSql(leadId)}' LIMIT 1`,
      )) as unknown[],
      TABLE_LEADS,
    );
    leads = partial.map((r) => ({ ...r, fit_report_json: null }));
  }
  const lead = leads[0];
  if (!lead) throw new NotFoundError('lead not found');

  let candidate: { name: string; email: string } | null = null;
  let scores: Record<string, unknown> | null = null;

  if (lead.eval_result_id) {
    const results = unwrapRows<{ candidate_id: string }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT candidate_id FROM Results WHERE ROWID = '${escapeSql(lead.eval_result_id)}' LIMIT 1`,
      )) as unknown[],
      'Results',
    );
    const result = results[0];
    if (result?.candidate_id) {
      const cands = unwrapRows<{ name: string; email: string }>(
        (await zcql(req).executeZCQLQuery(
          `SELECT name, email FROM Candidates WHERE ROWID = '${escapeSql(result.candidate_id)}' LIMIT 1`,
        )) as unknown[],
        'Candidates',
      );
      candidate = cands[0] ?? null;

      // Scores (DISC + integridad + cognitivo)
      try {
        const scoreRows = unwrapRows<Record<string, unknown>>(
          (await zcql(req).executeZCQLQuery(
            `SELECT * FROM Scores WHERE result_id = '${escapeSql(lead.eval_result_id)}' LIMIT 1`,
          )) as unknown[],
          'Scores',
        );
        scores = scoreRows[0] ?? null;
      } catch (err) {
        log.warn('scores lookup failed — continuing without', { leadId, error: (err as Error).message });
      }
    }
  }

  return { lead, candidate, scores };
}

// ============================================================================
// Helper: leer ejes de integridad + top competencias — datos duros que el
// FitReportView renderiza en las secciones "psicométricas" del mockup.
// La IA no los produce; la UI los muestra directo del backend.
// ============================================================================
type IntegrityDim = { dimension: string; nivel: 'bajo' | 'medio' | 'alto'; pct: number };

async function loadIntegrityDimensions(req: RequestContext['req'], resultId: string): Promise<IntegrityDim[]> {
  try {
    const rows = unwrapRows<{ dimension: string; nivel: string; pct: unknown }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT dimension, nivel, pct FROM IntegrityDimensions WHERE result_id = '${escapeSql(resultId)}' LIMIT 30`,
      )) as unknown[],
      'IntegrityDimensions',
    );
    log.info('IntegrityDimensions lookup', { resultId, rowCount: rows.length });
    return rows.map((r) => ({
      dimension: String(r.dimension ?? ''),
      nivel: (['bajo', 'medio', 'alto'].includes(String(r.nivel).toLowerCase()) ? String(r.nivel).toLowerCase() : 'bajo') as 'bajo' | 'medio' | 'alto',
      pct: typeof r.pct === 'number' ? r.pct : parseFloat(String(r.pct ?? 0)) || 0,
    }));
  } catch (err) {
    log.warn('IntegrityDimensions lookup failed — returning empty', { resultId, error: (err as Error).message });
    return [];
  }
}

// ============================================================================
// Helper: cálculo del fit_pct (fórmula del prompt maestro v2.0).
//
// fit_pct = 0.50 × expectativas_score
//         + 0.25 × cognitiva_score
//         + 0.15 × integridad_score
//         + 0.10 × disc_alineacion_score
//
// - expectativas_score = (engrana + a_validar * 0.5) / total * 100
// - cognitiva_score    = velna.indice_global.pct (0-100)
// - integridad_score   = 100 - int_overall.pct_riesgo (invertido)
// - disc_alineacion    = lo devuelve la IA (0-100)
//
// Devuelve null si faltan insumos para calcularlo con sentido.
// ============================================================================
function computeFitPct(
  report: FitReport,
  scores: Record<string, unknown> | null,
): number | null {
  if (report.veredicto.sello === 'pendiente_evaluacion') return null;

  const matches = report.matches ?? [];
  if (matches.length === 0 || !scores) return null;

  const engrana = matches.filter((m) => m.estado === 'engrana').length;
  const aValidar = matches.filter((m) => m.estado === 'a_validar').length;
  const total = matches.length;
  const expectativasScore = total > 0 ? ((engrana + aValidar * 0.5) / total) * 100 : 0;

  const velnaRaw = scores.velna_indice ?? scores.velna_total ?? null;
  const cognitivaScore = typeof velnaRaw === 'number' ? velnaRaw : parseFloat(String(velnaRaw ?? '')) || 0;

  const riesgoRaw = scores.int_overall_pct ?? null;
  const riesgoPct = typeof riesgoRaw === 'number' ? riesgoRaw : parseFloat(String(riesgoRaw ?? ''));
  const integridadScore = isNaN(riesgoPct) ? 50 : Math.max(0, Math.min(100, 100 - riesgoPct));

  const disc = report.disc_alineacion_score ?? 0;
  const discScore = Math.max(0, Math.min(100, disc));

  const raw = 0.50 * expectativasScore + 0.25 * cognitivaScore + 0.15 * integridadScore + 0.10 * discScore;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

// ============================================================================
// GET /api/marketing/fit-report/:leadId/context — data para el editor
// ============================================================================
export async function getFitReportContext(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  const m = ctx.req.url?.match(/^\/api\/marketing\/fit-report\/([^/]+)\/context\/?$/);
  const leadId = m?.[1];
  if (!leadId) throw new ValidationError('lead id missing in path');

  const { lead, candidate, scores } = await loadLeadContext(ctx.req, leadId);

  // Si ya se envió un reporte antes, cargamos el JSON guardado para que Chris pueda revisar/re-editar.
  let savedReport: FitReport | null = null;
  if (lead.fit_report_json) {
    try {
      savedReport = JSON.parse(lead.fit_report_json) as FitReport;
    } catch (err) {
      log.warn('failed to parse saved fit_report_json', { leadId, error: (err as Error).message });
    }
  }

  sendJson(ctx.res, 200, {
    lead: {
      id: lead.ROWID,
      email: lead.email,
      contact_name: lead.contact_name,
      company: lead.company,
      puesto: lead.puesto,
      fit_choice: lead.fit_choice,
      finalist_status: lead.finalist_status,
    },
    candidate: candidate ? { name: candidate.name, email: candidate.email } : null,
    scores,
    saved_report: savedReport,
  });
}

// ============================================================================
// POST /api/marketing/fit-report/:leadId/generate — IA arma el reporte
// ============================================================================
export async function generateFitReport(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  const m = ctx.req.url?.match(/^\/api\/marketing\/fit-report\/([^/]+)\/generate\/?$/);
  const leadId = m?.[1];
  if (!leadId) throw new ValidationError('lead id missing in path');

  const body = (await readJsonBody(ctx.req)) as { transcript?: string; notes?: string };
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';

  if (!transcript) throw new ValidationError('transcript requerido (mínimo 50 caracteres)');
  if (transcript.length < 50) throw new ValidationError('transcript demasiado corto (mínimo 50 caracteres)');
  if (transcript.length > 30000) throw new ValidationError('transcript demasiado largo (máximo 30000 caracteres)');

  const { lead, candidate, scores } = await loadLeadContext(ctx.req, leadId);

  // Solo consideramos "pruebas completas" si alguna sección terminó (tiene *_completed_at).
  // Filtramos campos técnicos (tec_*) porque el flow finalista no incluye prueba técnica —
  // dejarlos hacía que la IA los mencionara como "prueba técnica no completada" (falso).
  const s = (scores ?? {}) as Record<string, unknown>;
  const scoresPresent = !!(s.disc_completed_at || s.velna_completed_at || s.int_completed_at);
  const scoresSummary = scoresPresent
    ? formatScoresForAI(s)
    : 'PENDIENTE — el candidato aún no completó las pruebas.';

  const pendingBanner = scoresPresent
    ? ''
    : `

ATENCIÓN CRÍTICA: LAS PRUEBAS DEL CANDIDATO ESTÁN PENDIENTES.
Aplica las reglas del veredicto "pendiente_evaluacion":
- veredicto.sello = "pendiente_evaluacion"
- veredicto.titulo = "Evaluación en curso"
- veredicto.parrafo neutro (no emitas juicio del candidato)
- fit_cultural.nivel = "pendiente"
- matches: array vacío
- como_es.fuertes y como_es.debiles: arrays vacíos
- como_aprovechar: array vacío
- conducta.dominante_titulo y conducta.dominante_parrafo: strings vacías
- pensamiento.que_significa: string vacía
- integridad.parrafo: string vacía
- disc_alineacion_score: 0
- faltantes: lista los insumos que faltan (ej: "resultados_disc", "resultados_velna", "resultados_integridad")
NO uses las preocupaciones del cliente como base de tu veredicto.
`;

  const userMessage = `DATOS DEL CLIENTE
- Empresa: ${lead.company ?? '(sin dato)'}
- Contacto: ${lead.contact_name ?? '(sin dato)'}
- Puesto a cubrir: ${lead.puesto ?? '(sin dato)'}

DATOS DEL CANDIDATO
- Nombre: ${candidate?.name ?? '(sin dato)'}
- Email: ${candidate?.email ?? '(sin dato)'}

RESULTADOS DE LAS PRUEBAS DEL CANDIDATO
${scoresSummary}
${pendingBanner}
TRANSCRIPCIÓN DE LA REUNIÓN DE FIT CON EL CLIENTE
${transcript}

NOTAS RÁPIDAS DE LA RECRUITER
${notes || '(sin notas adicionales)'}

Ahora generá el JSON del fit report siguiendo la estructura exacta que se especificó.`;

  let response: AnthropicResponse;
  try {
    response = await anthropicMessage({
      system: FIT_REPORT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 3500,
    });
  } catch (err) {
    log.error('anthropic call failed for fit report', { leadId, error: (err as Error).message });
    throw new UpstreamError('anthropic', `Error generando reporte con IA: ${(err as Error).message}`);
  }

  let report: FitReport;
  try {
    report = extractJson<FitReport>(response);
  } catch (err) {
    log.error('extractJson failed for fit report', { leadId, error: (err as Error).message });
    throw new UpstreamError('anthropic', 'La IA devolvió un formato inesperado. Reintentá o ajustá el transcript.');
  }

  // Backfill campos que la IA puede haber dejado vacíos
  if (!report.cliente_empresa) report.cliente_empresa = lead.company ?? '';
  if (!report.cliente_contacto) report.cliente_contacto = lead.contact_name ?? '';
  if (!report.puesto) report.puesto = lead.puesto ?? '';
  if (!report.candidato_nombre) report.candidato_nombre = candidate?.name ?? '';

  // Backfill conducta.perfil_pk/perfil_nombre directo desde scores (la IA no
  // los inventa, pero si los omite los rellenamos)
  if (report.conducta) {
    if (!report.conducta.perfil_pk && typeof s.disc_perfil_pk === 'string') report.conducta.perfil_pk = s.disc_perfil_pk;
    if (!report.conducta.perfil_nombre && typeof s.disc_perfil_nombre === 'string') report.conducta.perfil_nombre = s.disc_perfil_nombre;
  }

  // Cálculo de fit_pct (la IA lo dejó en null, lo llena el backend)
  const fitPct = computeFitPct(report, scores);
  report.veredicto.fit_pct = fitPct;

  log.info('fit report generated', { leadId, sello: report.veredicto.sello, fit_pct: fitPct });
  sendJson(ctx.res, 200, { ok: true, report });
}

// ============================================================================
// POST /api/marketing/fit-report/:leadId/preview — HTML del email sin enviar
// ============================================================================
//
// Toma el JSON del reporte (posiblemente editado por Chris) y devuelve el HTML
// exacto que se enviaría al cliente. Sirve para que Chris vea preview antes de
// enviar. No persiste nada, no envía email, no dispara round-robin.
export async function previewFitReport(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  const m = ctx.req.url?.match(/^\/api\/marketing\/fit-report\/([^/]+)\/preview\/?$/);
  const leadId = m?.[1];
  if (!leadId) throw new ValidationError('lead id missing in path');

  const body = (await readJsonBody(ctx.req)) as { report?: FitReport };
  const report = body.report;
  if (!report) throw new ValidationError('report requerido en el body');

  // Guardar el JSON del reporte primero (así la página fit-report-view lo puede leer)
  const reportJson = JSON.stringify(report).slice(0, 19000);
  try {
    await datastore(ctx.req).table(TABLE_LEADS).updateRow({
      ROWID: leadId,
      fit_report_json: reportJson,
      updated_at: now(),
    });
  } catch (err) {
    log.warn('save fit_report_json for preview failed — continuing', { leadId, error: (err as Error).message });
  }

  const url = buildFitReportViewUrl(leadId);
  sendJson(ctx.res, 200, { ok: true, url });
}


// ============================================================================
// POST /api/marketing/fit-report/:leadId/save-draft — auto-save sin enviar
// ============================================================================
//
// Guarda el JSON del reporte en la columna fit_report_json de MarketingLeads
// SIN enviar email al cliente, sin cambiar finalist_status, sin round-robin.
// Se llama después de que la IA genera el reporte y en cada edición (con
// debounce en el frontend) para no perder el trabajo si Chris navega o cierra.
export async function saveFitReportDraft(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  const m = ctx.req.url?.match(/^\/api\/marketing\/fit-report\/([^/]+)\/save-draft\/?$/);
  const leadId = m?.[1];
  if (!leadId) throw new ValidationError('lead id missing in path');

  const body = (await readJsonBody(ctx.req)) as { report?: FitReport };
  const report = body.report;
  if (!report) throw new ValidationError('report requerido en el body');

  const reportJson = JSON.stringify(report).slice(0, 19000);
  try {
    await datastore(ctx.req).table(TABLE_LEADS).updateRow({
      ROWID: leadId,
      fit_report_json: reportJson,
      updated_at: now(),
    });
    sendJson(ctx.res, 200, { ok: true, leadId, saved_at: now() });
  } catch (err) {
    log.warn('save-draft failed', { leadId, error: (err as Error).message });
    sendJson(ctx.res, 200, { ok: false, leadId, error: (err as Error).message });
  }
}

// ============================================================================
// POST /api/marketing/fit-report/:leadId/send — envía + handoff a vendedor
// ============================================================================
export async function sendFitReport(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  const m = ctx.req.url?.match(/^\/api\/marketing\/fit-report\/([^/]+)\/send\/?$/);
  const leadId = m?.[1];
  if (!leadId) throw new ValidationError('lead id missing in path');

  const body = (await readJsonBody(ctx.req)) as { report?: FitReport };
  const report = body.report;
  if (!report) throw new ValidationError('report requerido en el body');
  if (!report.veredicto) throw new ValidationError('report.veredicto no puede estar vacío');
  if (!report.veredicto.sello) throw new ValidationError('report.veredicto.sello no puede estar vacío');

  const { lead } = await loadLeadContext(ctx.req, leadId);

  // Guardamos el JSON del reporte ANTES de enviar el email — el email lleva un
  // link a la página del fit report que necesita leer el JSON de la DB.
  const reportJson = JSON.stringify(report).slice(0, 19000);
  try {
    await datastore(ctx.req).table(TABLE_LEADS).updateRow({
      ROWID: leadId,
      fit_report_json: reportJson,
      updated_at: now(),
    });
  } catch (err) {
    log.warn('save fit_report_json failed before send — continuing', { leadId, error: (err as Error).message });
  }

  // URL firmada de la página del fit report (30 días) — es lo que Diego abre
  // desde el email. Chris ve la misma página en Vista previa.
  const fitViewUrl = buildFitReportViewUrl(leadId);

  // Enviar email al cliente
  let emailOk = false;
  try {
    const emailResult = await publishAndProcessEvent(ctx.req, 'email.send_pending', {
      to: lead.email,
      template: 'marketing_fit_report',
      locale: 'es',
      vars: {
        contact_name_prefix: lead.contact_name ? ` ${lead.contact_name.split(/\s+/)[0]}` : '',
        candidate_name: report.candidato_nombre,
        puesto: report.puesto,
        fit_view_url: fitViewUrl,
      },
    });
    emailOk = Boolean((emailResult as { ok?: boolean }).ok);
  } catch (err) {
    log.warn('fit report email failed', { leadId, error: (err as Error).message });
  }

  // Marcar estado del lead (el JSON ya se guardó arriba antes del envío)
  try {
    await datastore(ctx.req).table(TABLE_LEADS).updateRow({
      ROWID: leadId,
      finalist_status: 'reporte_enviado',
      report_sent_at: now(),
      report_sent_by: 'manual_chris',
      updated_at: now(),
    });
  } catch (err) {
    log.warn('lead status update failed after fit report send — continuing', { leadId, error: (err as Error).message });
  }

  // Round-robin — asignar vendedor
  let assignedTo: string | null = null;
  try {
    const { autoAssignLead } = await import('./freelance.js');
    assignedTo = await autoAssignLead(ctx.req, leadId);
  } catch (err) {
    log.warn('round-robin failed after fit report send', { leadId, error: (err as Error).message });
  }

  log.info('fit report sent', { leadId, sello: report.veredicto.sello, emailOk, assignedTo });

  sendJson(ctx.res, 200, {
    ok: true,
    leadId,
    email_ok: emailOk,
    assigned_to: assignedTo,
    finalist_status: 'reporte_enviado',
  });
}

