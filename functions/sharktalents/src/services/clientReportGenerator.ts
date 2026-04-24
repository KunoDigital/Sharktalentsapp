import Anthropic from '@anthropic-ai/sdk';
import { CandidateAnalysis } from './candidateScoring';

const client = new Anthropic();

interface ReportInput {
  name: string;
  jobTitle: string;
  company: string;
  analysis: CandidateAnalysis;
  discProfile: string;
  emotionalProfile: string;
}

interface ProfileDescriptionInput {
  jobTitle: string;
  company: string;
  discIdealA: string;
  discIdealB?: string;
  competencias: { nombre: string; nivel: number }[];
  cognitiveIdeal: Record<string, number>;
  minTechnical: number;
}

export async function generateProfileDescription(data: ProfileDescriptionInput): Promise<{ text: Record<string, string>; usage: { input_tokens: number; output_tokens: number } }> {
  const compList = data.competencias.map(c => `${c.nombre} (nivel esperado: ${c.nivel})`).join(', ');
  const cogDesc = Object.entries(data.cognitiveIdeal).map(([k, v]) => `${k}: ${v}`).join(', ');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: `Eres un consultor senior de talento humano. Escribes en espanol directo y corto.
REGLA: Cada campo debe ser MAXIMO 4 frases cortas separadas por punto. Nada de parrafos largos.
Responde SOLO con JSON valido, sin markdown, sin backticks.`,
    messages: [{
      role: 'user',
      content: `Describe brevemente que buscamos para "${data.jobTitle}" en "${data.company}".

PERFIL CONDUCTUAL IDEAL A: ${data.discIdealA}
${data.discIdealB ? `PERFIL CONDUCTUAL IDEAL B: ${data.discIdealB}` : ''}
COMPETENCIAS CLAVE: ${compList || 'No definidas'}
PERFIL COGNITIVO IDEAL: ${cogDesc}
MINIMO TECNICO: ${data.minTechnical}%

IMPORTANTE: Cada campo debe ser 3-4 frases MUY cortas (max 10 palabras cada una) separadas por punto. Se usaran como bullets en tarjetas visuales.

JSON:
{
  "persona": "Frase corta 1. Frase corta 2. Frase corta 3. Frase corta 4.",
  "cognicion": "Frase corta sobre que capacidad cognitiva importa mas. Por que es necesaria.",
  "competencias": "Frase corta sobre competencias criticas. Por que se necesitan.",
  "tecnica": "Frase corta sobre nivel tecnico esperado."
}`
    }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text response');
  let raw = textBlock.text.trim();
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');

  return {
    text: JSON.parse(raw),
    usage: { input_tokens: response.usage?.input_tokens || 0, output_tokens: response.usage?.output_tokens || 0 },
  };
}

interface InterviewQuestionsInput {
  name: string;
  jobTitle: string;
  company: string;
  weaknesses: string[];
  integrityAlerts: string[];
  emotionalProfile: string;
  discProfile: string;
  companyContext?: string;
}

export async function generateInterviewQuestions(data: InterviewQuestionsInput): Promise<{ questions: { question: string; why: string }[]; usage: { input_tokens: number; output_tokens: number } }> {
  const weakList = data.weaknesses.map((w, i) => `${i + 1}. ${w}`).join('\n');
  const alertList = data.integrityAlerts.length > 0 ? data.integrityAlerts.join(', ') : 'Ninguna';

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    system: `Eres un reclutador senior experto en entrevistas conductuales. Generas preguntas de entrevista especificas para explorar areas de riesgo o debilidad de un candidato.

REGLAS:
- Preguntas abiertas, no de si/no
- Cada pregunta debe explorar un area de debilidad REAL del candidato
- Si hay alertas de integridad, preguntar de forma natural sin acusar
- Incluye POR QUE haces esa pregunta (que evalua)
- Maximo 5-7 preguntas
- Espanol profesional y directo
- Responde SOLO con JSON valido, sin markdown`,
    messages: [{
      role: 'user',
      content: `Genera preguntas de entrevista para "${data.name}", candidato a "${data.jobTitle}" en "${data.company}".

PERFIL: ${data.discProfile}
EMOCIONAL: ${data.emotionalProfile}
${data.companyContext ? `CONTEXTO DE LA EMPRESA: ${data.companyContext}` : ''}

DEBILIDADES DETECTADAS:
${weakList || 'Ninguna critica'}

ALERTAS DE INTEGRIDAD: ${alertList}

JSON (array de objetos con "question" y "why"):
[{"question":"pregunta abierta","why":"que evalua esta pregunta"}]`
    }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text response');
  let raw = textBlock.text.trim();
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');

  return {
    questions: JSON.parse(raw),
    usage: { input_tokens: response.usage?.input_tokens || 0, output_tokens: response.usage?.output_tokens || 0 },
  };
}

interface TranscriptAnalysisInput {
  name: string;
  jobTitle: string;
  company: string;
  transcript: string;
  weaknesses: string[];
  integrityAlerts: string[];
  interviewQuestions: { question: string; why: string }[];
  companyContext?: string;
}

export async function analyzeInterviewTranscript(data: TranscriptAnalysisInput): Promise<{ analysis: Record<string, string>; usage: { input_tokens: number; output_tokens: number } }> {
  const questionsCtx = data.interviewQuestions.map((q, i) => `${i + 1}. ${q.question} (evalúa: ${q.why})`).join('\n');
  const weakCtx = data.weaknesses.join(', ') || 'Ninguna';
  const alertCtx = data.integrityAlerts.join(', ') || 'Ninguna';

  const transcript = data.transcript.length > 20000 ? data.transcript.substring(0, 20000) + '...' : data.transcript;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: `Eres un reclutador senior analizando la transcripcion de una entrevista. Tu trabajo es evaluar las respuestas del candidato y dar tu opinion profesional.

REGLAS:
- Analiza lo que DIJO el candidato, no inventes
- Conecta sus respuestas con las debilidades y alertas detectadas en las pruebas
- Se directo y conciso
- Si el candidato evadio una pregunta, senalalo
- Si dio una respuesta solida, reconocelo
- Espanol profesional
- Responde SOLO con JSON valido, sin markdown

TIPO DE TRANSCRIPCION:
- Si el texto es una transcripcion REAL (grabacion o notas textuales de lo que dijo el candidato), analiza las palabras reales del candidato.
- Si el texto indica explicitamente que es una RECONSTRUCCION DE MEMORIA del entrevistador (frases como "recuerdo de", "no es transcripcion real", "basado en memoria", "no quedo grabacion"), entonces:
  * Ajusta tu nivel de confianza: las respuestas son interpretacion del entrevistador, no las palabras exactas del candidato
  * No penalices al candidato por respuestas "cortas" o "vagas" — puede ser que el entrevistador no recuerde el detalle completo
  * Indica claramente en el resumen que es un analisis basado en reconstruccion de memoria, no en transcripcion real
  * Evalua con lo que hay, pero señala que preguntas quedaron sin suficiente informacion para concluir
  * Tu recomendacion debe reflejar esta limitacion (ej: "basado en lo disponible, se recomienda X, pero se sugiere validar con segunda entrevista los puntos Y y Z")`,
    messages: [{
      role: 'user',
      content: `Analiza la entrevista de "${data.name}" para "${data.jobTitle}" en "${data.company}".

${data.companyContext ? `CONTEXTO: ${data.companyContext}\n` : ''}
DEBILIDADES DETECTADAS: ${weakCtx}
ALERTAS INTEGRIDAD: ${alertCtx}

PREGUNTAS QUE SE DEBIAN HACER:
${questionsCtx}

TRANSCRIPCION DE LA ENTREVISTA:
${transcript}

JSON:
{
  "resumen": "Resumen de como fue la entrevista en 2-3 oraciones. Fue convincente o no.",
  "puntos_fuertes": "Que respondio bien, donde fue convincente. 2-3 puntos separados por |",
  "puntos_debiles": "Que evadio, donde no convencio, respuestas vagas. 2-3 puntos separados por |",
  "alertas_resueltas": "Si tenia alertas de integridad o debilidades, se resolvieron con lo que dijo en la entrevista? Especificar cuales si o cuales no.",
  "recomendacion_final": "Basado en las pruebas + la entrevista, tu recomendacion: contratar, no contratar, o contratar con condiciones. Y por que en 1-2 oraciones."
}`
    }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text response');
  let raw = textBlock.text.trim();
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');

  return {
    analysis: JSON.parse(raw),
    usage: { input_tokens: response.usage?.input_tokens || 0, output_tokens: response.usage?.output_tokens || 0 },
  };
}

export async function generateClientExplanations(data: ReportInput): Promise<{ explanations: Record<string, string>; usage: { input_tokens: number; output_tokens: number } }> {
  const strengthsList = data.analysis.strengths.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const weaknessList = data.analysis.weaknesses.map((s, i) => `${i + 1}. ${s}`).join('\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: `Eres un reclutador senior con 15 anos de experiencia que acaba de entrevistar y evaluar a un candidato. Ahora le explicas a tu cliente (un CEO o gerente) quien es esta persona y por que deberia o no contratarla.

REGLAS ABSOLUTAS:
- Habla como un humano que CONOCE al candidato, no como una maquina que lee datos
- NUNCA menciones porcentajes ni numeros — las barras y graficos ya los muestran
- NUNCA uses jerga de RRHH (perfil conductual, razonamiento espacial, indice cognitivo)
- USA lenguaje de negocio: "cierra ventas", "maneja equipos", "resuelve problemas rapido"
- Conecta TODO con el puesto: no digas "destaca en verbal", di "se expresa bien con clientes"
- Cada campo debe ser CORTO: maximo 1-2 oraciones simples
- El estilo de trabajo debe ser 1 SOLA oracion corta por campo
- Fortalezas: di POR QUE le sirve al puesto, no repitas datos
- Debilidades: di QUE IMPLICA en el dia a dia, no nombres de tests
- Responde SOLO con JSON valido, sin markdown, sin backticks`,
    messages: [{
      role: 'user',
      content: `Candidato: "${data.name}"
Puesto: "${data.jobTitle}" en "${data.company}"
Perfil conductual: ${data.discProfile}
Perfil emocional: ${data.emotionalProfile}
Recomendacion del sistema: ${data.analysis.recommendation === 'recomendado' ? 'RECOMENDADO' : data.analysis.recommendation === 'con_observaciones' ? 'CON OBSERVACIONES' : 'NO RECOMENDADO'}

DATOS DUROS (no los menciones textualmente, solo interpretalos):
- Afinidad conductual: ${data.analysis.disc_match}% — ${data.analysis.disc_match >= 70 ? 'alta, encaja bien' : data.analysis.disc_match >= 50 ? 'moderada, algunas diferencias' : 'baja, perfil diferente al ideal'}
- Capacidad intelectual: ${data.analysis.cognitive_match}% — ${data.analysis.cognitive_match >= 70 ? 'por encima de lo esperado' : data.analysis.cognitive_match >= 50 ? 'cumple lo basico' : 'por debajo'}
- Tecnica: ${data.analysis.technical_score}% — ${data.analysis.technical_score >= 80 ? 'excelente, puede arrancar sin capacitacion' : data.analysis.technical_score >= 60 ? 'aprobada, conoce lo necesario' : 'debil, necesitara formacion'}
- Integridad: ${data.analysis.integrity_score >= 80 ? 'limpio, sin alertas' : data.analysis.integrity_score >= 50 ? 'algunas areas a indagar' : 'alertas importantes'}
- Equilibrio emocional: ${data.analysis.emotion_score >= 70 ? 'estable y equilibrado' : data.analysis.emotion_score >= 40 ? 'aceptable' : 'en los extremos, puede ser un riesgo'}

FORTALEZAS DEL SISTEMA:
${strengthsList || 'Ninguna destacable'}

DEBILIDADES DEL SISTEMA:
${weaknessList || 'Ninguna critica'}

GENERA este JSON (recuerda: CORTO, sin numeros, con valor para el negocio):
{
  "summary": "2 oraciones: quien es esta persona en terminos simples y tu opinion como reclutador sobre si es buena opcion.",
  "work_style_decisions": "1 oracion corta: como toma decisiones. Ejemplo: Analiza antes de actuar, necesita datos.",
  "work_style_team": "1 oracion corta: como es en equipo. Ejemplo: Prefiere roles claros y trabaja bien en grupos pequenos.",
  "work_style_pressure": "1 oracion corta: como reacciona bajo presion. Ejemplo: Mantiene la calma, pero se paraliza sin informacion.",
  "work_style_communication": "1 oracion corta: como se comunica. Ejemplo: Directa y basada en hechos, poco emocional.",
  "strengths": "3-4 frases cortas separadas por |. NO repitas numeros. Di POR QUE le sirve al puesto. Ejemplo: Puede arrancar sin capacitacion | Confiable, sin banderas rojas | Buena capacidad de analisis para reportes",
  "weaknesses": "2-3 frases cortas separadas por |. Di QUE IMPLICA, no nombres de tests. Ejemplo: Puede tardar en tomar decisiones urgentes | Necesitara apoyo con herramientas visuales",
  "emotion": "1 oracion: como es emocionalmente en el trabajo y que implica para el puesto.",
  "development_plan": "2-3 acciones concretas separadas por |. Ejemplo: Asignarle proyectos con entregables claros | Darle retroalimentacion con datos concretos | Involucrarlo en presentaciones gradualmente"
}`
    }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text response');
  let raw = textBlock.text.trim();
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');

  return {
    explanations: JSON.parse(raw),
    usage: { input_tokens: response.usage?.input_tokens || 0, output_tokens: response.usage?.output_tokens || 0 },
  };
}

interface ComparisonCandidate {
  name: string;
  discProfile: string;
  emotionalProfile: string;
  strengths: string[];
  weaknesses: string[];
  technicalScore: number | null;
  integrityAlerts: string[];
  interviewAnalysis: any | null;
}

interface ComparisonInput {
  jobTitle: string;
  company: string;
  candidates: ComparisonCandidate[];
  companyContext?: string;
}

export async function generateCandidateComparison(data: ComparisonInput): Promise<{ comparison: any; usage: { input_tokens: number; output_tokens: number } }> {
  const candidateDescriptions = data.candidates.map((c, i) => {
    const interview = c.interviewAnalysis;
    return `CANDIDATA ${i + 1}: ${c.name}
Perfil conductual: ${c.discProfile}
Perfil emocional: ${c.emotionalProfile}
Fortalezas: ${c.strengths.join(' | ')}
Debilidades: ${c.weaknesses.join(' | ')}
Tecnico: ${c.technicalScore != null ? c.technicalScore + '%' : 'No evaluado'}
Alertas de integridad: ${c.integrityAlerts.length > 0 ? c.integrityAlerts.join(', ') : 'Ninguna'}
Entrevista: ${interview ? `Resumen: ${interview.resumen || 'N/A'}. Fuertes: ${interview.puntos_fuertes || 'N/A'}. Debiles: ${interview.puntos_debiles || 'N/A'}. Recomendacion: ${interview.recomendacion_final || 'N/A'}` : 'Sin entrevista analizada'}`;
  }).join('\n\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: `Eres un reclutador senior presentando un analisis comparativo final a tu cliente. Tu cliente debe tomar una decision de contratacion y tu trabajo es darle la informacion para decidir.

REGLAS:
- Habla como un humano que CONOCIO a las candidatas, no como una maquina
- Se directo, concreto y honesto — no adornes ni suavices
- Si una candidata tiene una debilidad critica, dilo claro
- Si una es claramente mejor que otra en un aspecto, dilo
- No uses jerga de RRHH — usa lenguaje de negocio
- Espanol profesional y directo
- Responde SOLO con JSON valido, sin markdown ni backticks

REGLAS CRITICAS PARA LA CONCLUSION:
- NUNCA asumas potencial, crecimiento o capacidad futura sin evidencia concreta de las pruebas o la entrevista. Si no hay dato que lo respalde, NO lo digas.
- Cada recomendacion en la conclusion DEBE incluir CONTRASTE DIRECTO: "esta candidata porque [dato concreto], mientras que la otra [dato concreto que la diferencia]".
- Los datos concretos son: scores de pruebas (tecnico %, DISC, cognitivo), respuestas reales de la entrevista, alertas de integridad, comportamientos observados. NO son: nombre de empresas donde trabajo, suposiciones sobre "entornos complejos", ni interpretaciones de CV.
- Si dos candidatas son similares en un aspecto, dilo: "ambas son comparables en X, la diferencia real esta en Y".
- Si no hay suficiente evidencia para recomendar una sobre otra en alguna categoria, di "no hay evidencia suficiente para diferenciarlas en este aspecto".`,
    messages: [{
      role: 'user',
      content: `Compara estas ${data.candidates.length} candidatas para el puesto "${data.jobTitle}" en "${data.company}".
${data.companyContext ? `\nCONTEXTO DE LA EMPRESA: ${data.companyContext}\n` : ''}
${candidateDescriptions}

Genera un JSON con esta estructura:
{
  "candidatas": [
    {
      "nombre": "Nombre",
      "resumen_entrevista": "2-3 oraciones sobre como fue la entrevista: que demostro, que evadio, que impresion dejo. Si no tiene entrevista, decir 'Sin entrevista analizada'.",
      "que_esperar": "2-3 oraciones: como seria como colaboradora los primeros 3-6 meses. Que tipo de persona es en el dia a dia laboral.",
      "en_que_soltarla": "2-3 tareas o areas donde probablemente sea autonoma desde el dia 1.",
      "en_que_ensenarle": "2-3 areas donde necesita mentoria o acompanamiento cercano.",
      "riesgo_principal": "1 oracion: que podria salir mal si no se gestiona."
    }
  ],
  "conclusion": {
    "si_prioridad_autonomia": "Nombre — porque [dato concreto de pruebas o entrevista]. En contraste, [otra candidata] necesita [que exactamente] basado en [dato concreto]. La diferencia real: [en que se nota].",
    "si_prioridad_crecimiento": "Nombre — porque [dato concreto]. A diferencia de [otra candidata] que [dato concreto]. SOLO si hay evidencia real de capacidad de aprendizaje en pruebas o entrevista, NO por nombre de empresa en CV.",
    "menor_riesgo": "Nombre — porque [datos concretos: integridad, estabilidad emocional, consistencia entre pruebas y entrevista]. En comparacion, [otra candidata] presenta [riesgo especifico con dato].",
    "mayor_potencial": "Nombre — basado UNICAMENTE en evidencia de pruebas o entrevista: [que dato concreto lo demuestra]. Si no hay evidencia clara, decir: ambas muestran potencial similar segun los datos disponibles.",
    "recomendacion_final": "2-3 oraciones con la recomendacion directa. Quien contratar y POR QUE con datos. Si ninguna es ideal, decirlo. Si son muy parejas, decirlo y explicar que las diferencia realmente."
  }
}`
    }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text response');
  let raw = textBlock.text.trim();
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');

  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { parsed = { error: 'Failed to parse comparison', raw: raw.substring(0, 500) }; }

  return {
    comparison: parsed,
    usage: { input_tokens: response.usage?.input_tokens || 0, output_tokens: response.usage?.output_tokens || 0 },
  };
}

export async function translateToEnglish(jsonData: any): Promise<{ translated: any; usage: { input_tokens: number; output_tokens: number } }> {
  const input = JSON.stringify(jsonData, null, 0);
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: `You are a professional translator. Translate the JSON values from Spanish to English. Keep ALL JSON keys exactly as they are (do not translate keys). Translate only the string values. Maintain professional recruitment/HR tone. Keep proper names (people, companies) untranslated. Respond ONLY with valid JSON, no markdown, no backticks.`,
    messages: [{ role: 'user', content: `Translate this JSON to English:\n${input}` }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text response');
  let raw = textBlock.text.trim();
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');

  let translated: any;
  try { translated = JSON.parse(raw); } catch { translated = jsonData; }

  return {
    translated,
    usage: { input_tokens: response.usage?.input_tokens || 0, output_tokens: response.usage?.output_tokens || 0 },
  };
}
