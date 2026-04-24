import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export interface TechnicalQuestion {
  id: string;
  text: string;
  options: string[];
  dimension?: string;
  correct: number;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

type QuestionKind = 'technical' | 'situational' | 'mixed';

function buildKindInstruction(kind: QuestionKind, count: number): string {
  if (kind === 'technical') {
    return `Genera ${count} preguntas EXCLUSIVAMENTE de TIPO A (conocimiento técnico concreto).
Cada una evalúa si la persona sabe cómo funciona una herramienta, fórmula, concepto o procedimiento específico del puesto.
Una sola respuesta técnicamente correcta. Distractores son confusiones plausibles de alguien con conocimiento parcial.
No uses trade-offs ni dilemas de criterio: eso es tipo B.
Cubre de forma balanceada los temas técnicos del puesto (hoja de cálculo, análisis de datos, uso de IA, mapeo de procesos, indicadores, documentación, etc.).`;
  }
  if (kind === 'situational') {
    return `Genera ${count} preguntas EXCLUSIVAMENTE de TIPO B (situacionales / criterio profesional).
Cada una plantea una situación del día a día del puesto con datos concretos (cantidades, tiempos, personas, herramientas) y 2 presiones legítimas en conflicto.
Las 4 opciones son decisiones defendibles por un colega senior; la correcta depende del trade-off específico.
Si el contexto del puesto sugiere distribución de temas situacionales (lectura de procesos, mejora continua, coordinación, etc.), respétala.`;
  }
  return `Genera ${count} preguntas mezclando tipo A (técnicas) y tipo B (situacionales) según la distribución del contexto del puesto.`;
}

export async function generateTechnicalQuestions(
  techPrompt: string,
  jobTitle: string,
  opts: { count?: number; kind?: QuestionKind; idPrefix?: string } = {}
): Promise<{ questions: TechnicalQuestion[]; usage: TokenUsage }> {
  const count = opts.count ?? 25;
  const kind = opts.kind ?? 'mixed';
  const idPrefix = opts.idPrefix ?? 't';
  const kindInstruction = buildKindInstruction(kind, count);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8000,
    system: `Eres un psicómetra industrial experto en diseño de evaluaciones técnicas. Diseñas pruebas que combinan preguntas de CONOCIMIENTO TÉCNICO (la persona sabe o no sabe usar una herramienta/disciplina) con preguntas SITUACIONALES (la persona tiene criterio profesional para decidir bajo trade-offs reales).

DOS TIPOS DE PREGUNTAS — REGLAS DISTINTAS PARA CADA UNA:

═══ TIPO A: PREGUNTAS TÉCNICAS (conocimiento concreto) ═══

OBJETIVO: verificar si la persona sabe cómo funciona una herramienta, concepto o técnica específica. Aquí SÍ hay una respuesta correcta porque es cómo funciona la realidad.

REGLAS TIPO A:
A1. La pregunta evalúa un skill concreto del puesto: una fórmula, una función, un concepto técnico, un procedimiento, una propiedad de una herramienta.
A2. 3 distractores son errores PLAUSIBLES: cosas que alguien con conocimiento parcial elegiría. No son absurdos — son confusiones reales (ej. elegir BUSCARV cuando lo correcto es SUMAR.SI, o confundir promedio con mediana).
A3. Las 4 opciones son del mismo tipo: si la correcta es una función de Excel, las otras 3 también son funciones de Excel. Si la correcta es un concepto, las otras 3 son conceptos relacionados.
A4. Sin trade-offs defendibles: solo una es técnicamente correcta.
A5. Largo similar entre opciones: 4-15 palabras.

EJEMPLO TÉCNICA BIEN DISEÑADA:
"Tienes un Excel con columnas: cliente, producto, precio, cantidad, fecha. Quieres el total vendido por cliente. ¿Qué usas?"
A) BUSCARV con rango dinámico
B) SUMAR.SI agrupando por cliente
C) Tabla dinámica con cliente como fila y precio*cantidad como valor
D) CONTAR.SI filtrando por cliente
Correcta: C. Los 3 distractores son confusiones reales (BUSCARV es para buscar no para sumar; SUMAR.SI suma sin multiplicar; CONTAR.SI cuenta no suma).

═══ TIPO B: PREGUNTAS SITUACIONALES (criterio profesional) ═══

OBJETIVO: evaluar juicio bajo tensión. Las 4 opciones son decisiones defendibles; la diferencia es qué criterio priorizan.

REGLAS TIPO B:
B1. Plantea una situación con DOS presiones legítimas en conflicto (rapidez vs exhaustividad, cliente vs proceso, autonomía vs pedir permiso, arreglar vs documentar).
B2. Las 4 opciones pasan el test del "colega razonable": cada una la defendería un senior distinto. Si una opción suena indefendible, está mal diseñada — REESCRÍBELA.
B3. La correcta no es "la más profesional y completa" — es la que mejor equilibra el trade-off específico.
B4. PARIDAD DE LARGO: opciones de 10-22 palabras; la correcta NO puede ser la más larga.
B5. LISTA NEGRA de verbos prohibidos en cualquier opción: ignorar, ocultar, mentir, culpar, esperar a que empeore, procrastinar, dilatar, "no es mi problema", forzar sin justificación, implementar en silencio, engañar. Si detectas uno, REESCRIBE esa opción como una decisión defendible.

EJEMPLO SITUACIONAL BIEN DISEÑADA:
"El reporte del mes tiene 12 facturas con cálculo de impuestos incorrecto. El cierre contable es en 4 días."
A) Reemitir las 12 facturas hoy mismo y notificar al cliente con la corrección antes del cierre
B) Documentar el error, proponer al gerente reemitir solo las de mayor monto y ajustar el resto en el siguiente mes
C) Corregir en el sistema y enviar una nota agregada al reporte explicando el ajuste realizado
D) Convocar a finanzas para decidir criterio de reemisión antes de tocar ninguna factura
Las 4 son defendibles; se diferencian en velocidad vs exhaustividad vs stakeholders involucrados.

═══ REGLAS COMUNES A AMBOS TIPOS ═══

C1. Las opciones empiezan con un verbo o estructura distinta entre sí. No todas iguales.
C2. DISTRIBUCIÓN DE LA RESPUESTA CORRECTA: de las 25 preguntas, aproximadamente 6-7 con correct=0, 6-7 con correct=1, 6 con correct=2, 5-6 con correct=3. Mezcla las posiciones. Nunca más de 3 correctas seguidas en la misma posición.
C3. Cada pregunta incluye datos específicos (cantidades, tiempos, actores, herramientas) — no enunciados genéricos.
C4. NO clasifiques por nivel de dificultad (básico/intermedio/avanzado).

Responde SOLO con un array JSON válido. Sin texto fuera del JSON, sin markdown, sin backticks.`,
    messages: [
      {
        role: 'user',
        content: `Puesto: ${jobTitle}.

Contexto del puesto:
${techPrompt}

INSTRUCCIÓN DE ESTA GENERACIÓN:
${kindInstruction}

ANTES DE DEVOLVER EL JSON, VERIFICA MENTALMENTE:
□ ¿Hay exactamente ${count} preguntas?
□ ¿La posición de la correcta está distribuida (~25% por posición entre las 4)? Nunca más de 3 seguidas iguales.
□ En las tipo A: ¿los distractores son confusiones técnicas plausibles (no absurdos)?
□ En las tipo B: ¿las 4 opciones las defendería un colega senior? ¿La correcta NO es la más larga?
□ ¿Ninguna opción contiene verbos de la lista negra (ignorar, ocultar, mentir, culpar, procrastinar, dilatar)?

Formato: texto de 1-3 oraciones con datos concretos. Opciones de 4-22 palabras.

Devuelve únicamente un array JSON con ${count} objetos. Usa ids "${idPrefix}1", "${idPrefix}2", ... "${idPrefix}${count}":
[{"id":"${idPrefix}1","text":"enunciado","options":["a","b","c","d"],"correct":2}, ...]`,
      },
    ],
  });

  const usage: TokenUsage = {
    input_tokens: response.usage?.input_tokens || 0,
    output_tokens: response.usage?.output_tokens || 0,
  };

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Anthropic');
  }

  let raw = textBlock.text.trim();
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  const questions: TechnicalQuestion[] = JSON.parse(raw);
  return {
    questions: questions.map(q => ({
      id: q.id,
      text: q.text,
      options: q.options,
      correct: q.correct,
    })),
    usage,
  };
}
