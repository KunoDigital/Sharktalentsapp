export interface Competencia {
  id: string;
  nombre: string;
  factores: string[];
  /**
   * Si está presente, este ID es un alias deprecado del ID indicado. Los IDs viejos
   * NO se eliminan del catálogo (mantienen factores para scoring de datos históricos),
   * pero la UI de selección los oculta y la persistencia normaliza al canónico.
   * Ver memory/project_competencias_catalogo_cerrado.md.
   */
  alias_of?: string;
}

// --- Consolidaciones 2026-06-16 ---
// El manual Kudert tiene varios pares con factores idénticos. Se conserva el ID viejo
// como alias por retro-compat de drafts/reportes históricos. Mapeo:
//   colaboracion         → trabajo_equipo
//   manejo_ambiguedad    → orientacion_cliente
//   aprendizaje_vuelo    → aprendizaje_activo
//   habilidad_analitica  → pensamiento_critico
//   resiliencia          → adaptabilidad
// 'resolucion_problemas' aparece duplicado en el PDF pero en código siempre hubo
// un solo entry — no hace falta alias.

export const COMPETENCIAS: Competencia[] = [
  { id: 'comunicacion_digital', nombre: 'Comunicación digital', factores: ['cog_verbal', 'disc_I', 'disc_S', 'emocion_mesura'] },
  { id: 'colaboracion', nombre: 'Colaboración', factores: ['disc_I', 'disc_S', 'disc_C', 'emocion_mesura'], alias_of: 'trabajo_equipo' },
  { id: 'adaptabilidad', nombre: 'Adaptabilidad', factores: ['disc_D', 'disc_I', 'cog_indice', 'emocion_mesura'] },
  { id: 'iniciativa', nombre: 'Iniciativa', factores: ['disc_D', 'disc_I', 'emocion_reflexividad', 'cog_logico', 'cog_abstracto'] },
  { id: 'planificacion', nombre: 'Planificación', factores: ['disc_C', 'cog_espacial', 'emocion_reflexividad'] },
  { id: 'manejo_ambiguedad', nombre: 'Manejo de la ambigüedad', factores: ['disc_D', 'disc_C', 'cog_indice', 'emocion_mesura'], alias_of: 'orientacion_cliente' },
  { id: 'trabajo_equipo', nombre: 'Trabajo en equipo y colaboración', factores: ['disc_D', 'disc_S', 'cog_indice', 'emocion_mesura'] },
  { id: 'retroalimentacion', nombre: 'Retroalimentación y monitoreo', factores: ['disc_D', 'disc_C', 'cog_logico', 'cog_verbal', 'emocion_mesura'] },
  { id: 'orientacion_cliente', nombre: 'Orientación al cliente', factores: ['disc_D', 'disc_C', 'cog_indice', 'emocion_mesura'] },
  { id: 'aprendizaje_vuelo', nombre: 'Aprendizaje al vuelo', factores: ['disc_D', 'disc_I', 'cog_logico'], alias_of: 'aprendizaje_activo' },
  { id: 'aprendizaje_activo', nombre: 'Aprendizaje activo y estrategias de aprendizaje', factores: ['disc_D', 'disc_I', 'cog_logico'] },
  { id: 'resolucion_problemas', nombre: 'Resolución de problemas complejos', factores: ['cog_indice', 'emocion_mesura'] },
  { id: 'inteligencia_emocional', nombre: 'Inteligencia emocional', factores: ['emocion_mesura', 'cog_indice'] },
  { id: 'creatividad_innovacion', nombre: 'Creatividad e innovación', factores: ['disc_D', 'disc_I', 'disc_S_inv', 'disc_C', 'emocion_espontaneidad'] },
  { id: 'liderazgo', nombre: 'Liderazgo', factores: ['disc_D', 'disc_I', 'disc_S', 'cog_indice', 'emocion_mesura'] },
  { id: 'orientacion_logro', nombre: 'Orientación al logro', factores: ['disc_D', 'cog_espacial', 'cog_logico', 'cog_numerico', 'emocion_mesura'] },
  { id: 'persuasion_negociacion', nombre: 'Persuasión y negociación', factores: ['disc_I', 'cog_verbal', 'cog_logico', 'emocion_mesura'] },
  { id: 'mentalidad_digital', nombre: 'Mentalidad digital', factores: ['disc_I', 'disc_D', 'disc_C', 'cog_espacial', 'cog_logico', 'cog_abstracto'] },
  { id: 'foco_data', nombre: 'Foco en data', factores: ['disc_C', 'disc_D', 'cog_espacial', 'cog_logico', 'cog_numerico', 'emocion_reflexividad'] },
  { id: 'impacto_influencia', nombre: 'Impacto e influencia', factores: ['disc_I'] },
  { id: 'autoconfianza', nombre: 'Autoconfianza', factores: ['disc_D', 'disc_I'] },
  { id: 'comprension_interpersonal', nombre: 'Comprensión interpersonal', factores: ['disc_S', 'disc_I', 'emocion_mesura'] },
  { id: 'desarrollo_interrelaciones', nombre: 'Desarrollo de interrelaciones', factores: ['disc_I', 'disc_S'] },
  { id: 'orden_calidad', nombre: 'Orden y calidad', factores: ['disc_C'] },
  { id: 'asertividad', nombre: 'Asertividad', factores: ['disc_D', 'emocion_mesura'] },
  { id: 'dinamismo_energia', nombre: 'Dinamismo y energía', factores: ['disc_I', 'disc_D', 'emocion_mesura'] },
  { id: 'habilidad_analitica', nombre: 'Habilidad analítica', factores: ['cog_logico', 'cog_espacial', 'disc_C'], alias_of: 'pensamiento_critico' },
  { id: 'perseverancia', nombre: 'Perseverancia', factores: ['disc_D', 'disc_S', 'emocion_reflexividad'] },
  { id: 'orientacion_accion', nombre: 'Orientación a la acción', factores: ['disc_D', 'disc_I', 'emocion_espontaneidad'] },
  { id: 'compromiso_organizacional', nombre: 'Compromiso organizacional', factores: ['disc_S', 'disc_C'] },
  { id: 'actitud_servicio', nombre: 'Actitud de servicio', factores: ['disc_S', 'disc_I'] },
  { id: 'manejo_conflictos', nombre: 'Manejo de conflictos', factores: ['disc_D', 'disc_I', 'emocion_mesura'] },
  { id: 'toma_decisiones_oportuna', nombre: 'Toma de decisiones oportuna', factores: ['disc_D', 'cog_indice', 'emocion_espontaneidad'] },
  { id: 'calidad_decisiones', nombre: 'Calidad de las decisiones', factores: ['cog_indice', 'emocion_reflexividad', 'disc_S', 'disc_C'] },
  { id: 'capacidad_intelectual', nombre: 'Capacidad intelectual', factores: ['cog_indice'] },
  { id: 'capacidad_escuchar', nombre: 'Capacidad para escuchar', factores: ['disc_S', 'emocion_reflexividad'] },
  { id: 'paciencia', nombre: 'Paciencia', factores: ['disc_S', 'emocion_reflexividad'] },
  { id: 'comunicacion_escrita', nombre: 'Comunicación escrita', factores: ['cog_verbal'] },
  { id: 'gestion_riesgo', nombre: 'Gestión del riesgo', factores: ['disc_S', 'disc_C', 'cog_verbal', 'cog_espacial', 'cog_logico', 'emocion_mesura'] },
  { id: 'pensamiento_critico', nombre: 'Pensamiento crítico y análisis', factores: ['cog_logico', 'cog_espacial', 'disc_C'] },
  { id: 'resiliencia', nombre: 'Resiliencia, tolerancia al estrés y flexibilidad', factores: ['disc_D', 'disc_I', 'cog_indice', 'emocion_mesura'], alias_of: 'adaptabilidad' },
];

/**
 * Mapa de aliases: ID viejo (deprecado) → ID canónico (oficial).
 * Lookups O(1). Sincronizado en backend con `functions/api/src/data/competencias.ts`.
 */
export const COMPETENCIA_ALIASES: Readonly<Record<string, string>> = Object.freeze(
  COMPETENCIAS.reduce<Record<string, string>>((acc, c) => {
    if (c.alias_of) acc[c.id] = c.alias_of;
    return acc;
  }, {}),
);

/**
 * Resuelve un ID al canónico. Si no está en aliases, lo devuelve tal cual.
 * Idempotente.
 */
export function resolveCompetenciaId(id: string): string {
  return COMPETENCIA_ALIASES[id] ?? id;
}

/** Lista de competencias canónicas (sin aliases). Útil para UI de selección. */
export const COMPETENCIAS_CANONICAS: Competencia[] = COMPETENCIAS.filter((c) => !c.alias_of);

export const COMPETENCIA_DESCRIPCIONES: Record<string, string> = {
  comunicacion_digital: 'Capacidad de comunicarse con claridad por canales digitales (chat, email, video). Útil en cualquier rol que trabaje a distancia o con clientes vía mensajería.',
  colaboracion: 'Habilidad para trabajar con otros, escuchar opiniones distintas y construir resultados conjuntos sin imponer.',
  adaptabilidad: 'Capacidad para ajustar su forma de trabajar cuando cambian las reglas, prioridades o el equipo.',
  iniciativa: 'Tendencia a tomar acción sin que se lo pidan. Detecta cosas por hacer y arranca antes que esperar instrucciones.',
  planificacion: 'Capacidad de organizar tareas, anticipar pasos y trabajar con un plan claro en lugar de reaccionar.',
  manejo_ambiguedad: 'Capacidad de avanzar incluso cuando no hay reglas claras o falta información. Útil en startups y proyectos nuevos.',
  trabajo_equipo: 'Aporta al grupo, comparte información y prioriza el resultado colectivo sobre el individual.',
  retroalimentacion: 'Da y recibe feedback de forma constructiva. Sabe corregir el rumbo sin tomarse las críticas como ataque personal.',
  orientacion_cliente: 'Entiende qué necesita el cliente y orienta su trabajo a resolverlo. Mantiene foco en la experiencia del cliente, no solo en el proceso interno.',
  aprendizaje_vuelo: 'Aprende cosas nuevas rápido, sobre la marcha, sin necesidad de capacitación formal previa.',
  aprendizaje_activo: 'Aprende cosas nuevas rápido y aplica estrategias propias para incorporar conocimiento, sin depender de capacitación formal.',
  resolucion_problemas: 'Capacidad de descomponer un problema complejo, identificar la causa raíz y encontrar una solución viable.',
  inteligencia_emocional: 'Entiende sus propias emociones y las de los demás. Maneja situaciones tensas sin perder el control.',
  creatividad_innovacion: 'Propone ideas nuevas, ve oportunidades donde otros ven obstáculos. Útil en roles que requieren innovar.',
  liderazgo: 'Capacidad de marcar dirección y mover a otros hacia un objetivo común. Inspira confianza y compromiso.',
  orientacion_logro: 'Foco en obtener resultados concretos y medibles. Le importa cumplir metas, no solo "estar trabajando".',
  persuasion_negociacion: 'Capacidad de convencer, alinear puntos de vista y llegar a acuerdos. Útil en ventas, gerencia y trato con clientes.',
  mentalidad_digital: 'Cómoda con herramientas digitales, automatización y nuevas tecnologías. Aprende plataformas rápido.',
  foco_data: 'Toma decisiones con base en datos, no en intuición. Lee reportes, identifica tendencias y mide resultados.',
  impacto_influencia: 'Genera efecto en los demás. Su opinión pesa, no pasa desapercibida en reuniones.',
  autoconfianza: 'Cree en sus capacidades, defiende sus ideas y no necesita aprobación externa constante para avanzar.',
  comprension_interpersonal: 'Capta cómo se sienten los demás, qué motiva a cada persona y cómo abordarlos según su estilo.',
  desarrollo_interrelaciones: 'Construye y mantiene relaciones de trabajo positivas. Tiene buen capital social dentro del equipo.',
  orden_calidad: 'Trabaja con método, prolijidad y altos estándares de terminación. Detesta lo improvisado.',
  asertividad: 'Dice lo que piensa con claridad y respeto. Pone límites cuando hace falta sin ser agresiva ni pasiva.',
  dinamismo_energia: 'Trabaja a buen ritmo, mantiene energía durante el día y no se desinfla en jornadas largas.',
  habilidad_analitica: 'Capacidad de analizar información, identificar patrones y sacar conclusiones lógicas.',
  perseverancia: 'No abandona ante obstáculos. Insiste, busca caminos alternativos y termina lo que empieza.',
  orientacion_accion: 'Prefiere actuar sobre analizar indefinidamente. Hace que las cosas pasen.',
  compromiso_organizacional: 'Lealtad con la empresa. Tiende a quedarse y a defender los intereses del equipo y la organización.',
  actitud_servicio: 'Disposición genuina para ayudar a clientes y compañeros, más allá de lo que pide su rol formal.',
  manejo_conflictos: 'Resuelve fricciones entre personas sin huir del problema ni escalarlo innecesariamente.',
  toma_decisiones_oportuna: 'Decide a tiempo. No se queda paralizada esperando información perfecta cuando hay que actuar.',
  calidad_decisiones: 'Las decisiones que toma suelen estar bien fundamentadas y dar resultados que se sostienen.',
  capacidad_intelectual: 'Razonamiento general. Capacidad para procesar información, aprender y resolver problemas.',
  capacidad_escuchar: 'Escucha activamente, sin interrumpir. Capta el mensaje completo antes de responder.',
  paciencia: 'Mantiene la calma con personas, procesos lentos o tareas repetitivas. No se desespera fácil.',
  comunicacion_escrita: 'Redacta con claridad, sin errores, y transmite ideas complejas de forma simple.',
  gestion_riesgo: 'Identifica qué puede salir mal y prepara contingencias. Útil en roles financieros, operativos o de cumplimiento.',
  pensamiento_critico: 'Cuestiona supuestos, separa hechos de opiniones y evalúa la calidad de la evidencia antes de aceptarla.',
  resiliencia: 'Se recupera rápido de situaciones difíciles, mantiene foco bajo presión y aprende de los reveses.',
};

export interface CompetenciaScore {
  id: string;
  nombre: string;
  score: number;
}

function emocionalContribucion(score: number, tipo: 'mesura' | 'espontaneidad' | 'reflexividad'): number {
  if (tipo === 'mesura') {
    if (score >= 31 && score <= 70) return 100;
    if (score <= 30) return (score / 30) * 50;
    return ((100 - score) / 30) * 50;
  }
  if (tipo === 'reflexividad') {
    if (score >= 71) return 100;
    if (score >= 31) return ((score - 31) / 39) * 70;
    return (score / 30) * 30;
  }
  if (score <= 30) return 100;
  if (score <= 70) return ((70 - score) / 39) * 70;
  return ((100 - score) / 30) * 30;
}

export function calculateCompetencias(
  disc: { D: number; I: number; S: number; C: number },
  cog: { verbal: number; espacial: number; logica: number; numerica: number; abstracta: number },
  emotionalVal: number = 50,
): CompetenciaScore[] {
  const cogIndice = Math.round((cog.verbal + cog.espacial + cog.logica + cog.numerica + cog.abstracta) / 5);

  const factorValues: Record<string, number> = {
    disc_D: disc.D, disc_I: disc.I, disc_S: disc.S, disc_C: disc.C,
    disc_S_inv: 100 - disc.S,
    cog_verbal: cog.verbal, cog_espacial: cog.espacial,
    cog_logico: cog.logica, cog_numerico: cog.numerica, cog_abstracto: cog.abstracta,
    cog_indice: cogIndice,
    emocion_mesura: emocionalContribucion(emotionalVal, 'mesura'),
    emocion_espontaneidad: emocionalContribucion(emotionalVal, 'espontaneidad'),
    emocion_reflexividad: emocionalContribucion(emotionalVal, 'reflexividad'),
  };

  // Solo computar canónicas para evitar duplicados en reportes/gráficos. Los aliases
  // tienen factores idénticos (o casi idénticos) al canónico, así que el score
  // sería redundante.
  return COMPETENCIAS_CANONICAS.map(comp => {
    const values = comp.factores.map(f => factorValues[f] ?? 50);
    const score = values.reduce((s, v) => s + v, 0) / values.length;
    return { id: comp.id, nombre: comp.nombre, score: Math.round(Math.min(100, Math.max(0, score))) };
  });
}
