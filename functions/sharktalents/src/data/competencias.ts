export interface Competencia {
  id: string;
  nombre: string;
  factores: string[]; // factor names — all weighted equally (promedio simple)
}

export const COMPETENCIAS: Competencia[] = [
  // Manual de Competencias Kudert — 54 competencias
  { id: 'comunicacion_digital', nombre: 'Comunicación digital', factores: ['cog_verbal', 'disc_I', 'disc_S', 'emocion_mesura'] },
  { id: 'colaboracion', nombre: 'Colaboración', factores: ['disc_I', 'disc_S', 'disc_C', 'emocion_mesura'] },
  { id: 'adaptabilidad', nombre: 'Adaptabilidad', factores: ['disc_D', 'disc_I', 'cog_indice', 'emocion_mesura'] },
  { id: 'iniciativa', nombre: 'Iniciativa', factores: ['disc_D', 'disc_I', 'emocion_reflexividad', 'cog_logico', 'cog_abstracto'] },
  { id: 'planificacion', nombre: 'Planificación', factores: ['disc_C', 'cog_espacial', 'emocion_reflexividad'] },
  { id: 'manejo_ambiguedad', nombre: 'Manejo de la ambigüedad', factores: ['disc_D', 'disc_C', 'cog_indice', 'emocion_mesura'] },
  { id: 'trabajo_equipo', nombre: 'Trabajo en equipo y colaboración', factores: ['disc_D', 'disc_S', 'cog_indice', 'emocion_mesura'] },
  { id: 'retroalimentacion', nombre: 'Retroalimentación y monitoreo', factores: ['disc_D', 'disc_C', 'cog_logico', 'cog_verbal', 'emocion_mesura'] },
  { id: 'orientacion_cliente', nombre: 'Orientación al cliente', factores: ['disc_D', 'disc_C', 'cog_indice', 'emocion_mesura'] },
  { id: 'aprendizaje_vuelo', nombre: 'Aprendizaje al vuelo', factores: ['disc_D', 'disc_I', 'cog_logico'] },
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
  { id: 'comprension_organizacion', nombre: 'Comprensión de la organización', factores: ['disc_I'] },
  { id: 'desarrollo_interrelaciones', nombre: 'Desarrollo de interrelaciones', factores: ['disc_I', 'disc_S'] },
  { id: 'desarrollo_personas', nombre: 'Desarrollo de personas', factores: ['disc_D'] },
  { id: 'orden_calidad', nombre: 'Orden y calidad', factores: ['disc_C'] },
  { id: 'direccion_personas', nombre: 'Dirección de personas', factores: ['disc_D'] },
  { id: 'asertividad', nombre: 'Asertividad', factores: ['disc_D', 'emocion_mesura'] },
  { id: 'dinamismo_energia', nombre: 'Dinamismo y energía', factores: ['disc_I', 'disc_D', 'emocion_mesura'] },
  { id: 'habilidad_analitica', nombre: 'Habilidad analítica', factores: ['cog_logico', 'cog_espacial', 'disc_C'] },
  { id: 'perseverancia', nombre: 'Perseverancia', factores: ['disc_D', 'disc_S', 'emocion_reflexividad'] },
  { id: 'orientacion_accion', nombre: 'Orientación a la acción', factores: ['disc_D', 'disc_I', 'emocion_espontaneidad'] },
  { id: 'habilidades_mando', nombre: 'Habilidades de mando', factores: ['disc_D', 'disc_I', 'emocion_espontaneidad'] },
  { id: 'compromiso_organizacional', nombre: 'Compromiso organizacional', factores: ['disc_S', 'disc_C'] },
  { id: 'actitud_servicio', nombre: 'Actitud de servicio', factores: ['disc_S', 'disc_I'] },
  { id: 'manejo_conflictos', nombre: 'Manejo de conflictos', factores: ['disc_D', 'disc_I', 'emocion_mesura'] },
  { id: 'toma_decisiones_oportuna', nombre: 'Toma de decisiones oportuna', factores: ['disc_D', 'cog_indice', 'emocion_espontaneidad'] },
  { id: 'calidad_decisiones', nombre: 'Calidad de las decisiones', factores: ['cog_indice', 'emocion_reflexividad', 'disc_S', 'disc_C'] },
  { id: 'delegacion', nombre: 'Delegación', factores: ['disc_I', 'disc_S', 'emocion_mesura'] },
  { id: 'habilidad_informar', nombre: 'Habilidad de informar', factores: ['disc_I', 'disc_S'] },
  { id: 'capacidad_intelectual', nombre: 'Capacidad intelectual', factores: ['cog_indice'] },
  { id: 'capacidad_escuchar', nombre: 'Capacidad para escuchar', factores: ['disc_S', 'emocion_reflexividad'] },
  { id: 'valentía_gerencial', nombre: 'Valentía gerencial', factores: ['disc_D', 'disc_I', 'emocion_espontaneidad'] },
  { id: 'administracion_supervision', nombre: 'Administración y supervisión del trabajo', factores: ['disc_D', 'disc_C', 'cog_espacial', 'cog_logico'] },
  { id: 'habilidad_motivar', nombre: 'Habilidad de motivar a personas', factores: ['disc_I', 'disc_S', 'disc_C', 'emocion_mesura'] },
  { id: 'paciencia', nombre: 'Paciencia', factores: ['disc_S', 'emocion_reflexividad'] },
  { id: 'administracion_procesos', nombre: 'Administración de procesos', factores: ['cog_logico', 'cog_espacial', 'disc_C'] },
  { id: 'manejo_vision_proposito', nombre: 'Manejo de visión y propósito', factores: ['disc_I', 'disc_S', 'disc_C', 'emocion_mesura'] },
  { id: 'comunicacion_escrita', nombre: 'Comunicación escrita', factores: ['cog_verbal'] },
  { id: 'gestion_riesgo', nombre: 'Gestión del riesgo', factores: ['disc_S', 'disc_C', 'cog_verbal', 'cog_espacial', 'cog_logico', 'emocion_mesura'] },
  { id: 'pensamiento_analitico_innovacion', nombre: 'Pensamiento analítico e innovación', factores: ['cog_logico', 'cog_espacial', 'cog_abstracto', 'disc_C', 'emocion_espontaneidad'] },
  { id: 'aprendizaje_activo', nombre: 'Aprendizaje activo y estrategias de aprendizaje', factores: ['disc_D', 'disc_I', 'cog_logico'] },
  { id: 'pensamiento_critico', nombre: 'Pensamiento crítico y análisis', factores: ['cog_logico', 'cog_espacial', 'disc_C'] },
  { id: 'creatividad_originalidad_iniciativa', nombre: 'Creatividad, originalidad e iniciativa', factores: ['disc_D', 'disc_I', 'cog_indice', 'emocion_mesura'] },
  { id: 'liderazgo_influencia_social', nombre: 'Liderazgo e influencia social', factores: ['disc_I', 'disc_S', 'disc_D', 'cog_indice', 'emocion_mesura'] },
  { id: 'resiliencia', nombre: 'Resiliencia, tolerancia al estrés y flexibilidad', factores: ['disc_D', 'disc_I', 'cog_indice', 'emocion_mesura'] },
];

export interface CompetenciaScore {
  id: string;
  nombre: string;
  score: number;
}

// Emotional contribution by range
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
  // espontaneidad
  if (score <= 30) return 100;
  if (score <= 70) return ((70 - score) / 39) * 70;
  return ((100 - score) / 30) * 30;
}

export function calculateCompetencias(
  discScore: { D: number; I: number; S: number; C: number } | null,
  cogScore: { verbal: number; espacial: number; logica: number; numerica: number; abstracta: number; total: number; max: number } | null,
  emotionalScore: { score: number; perfil: string } | null
): CompetenciaScore[] {
  // DISC: normalize raw counts (0-40) to 0-100 scale (×5, cap 100)
  const disc = {
    D: discScore ? Math.min(100, discScore.D * 5) : 50,
    I: discScore ? Math.min(100, discScore.I * 5) : 50,
    S: discScore ? Math.min(100, discScore.S * 5) : 50,
    C: discScore ? Math.min(100, discScore.C * 5) : 50,
  };

  // Cognitive: normalize raw counts to 0-100 per dimension
  const maxPerDim = cogScore ? Math.max(1, Math.round(cogScore.max / 5)) : 20;
  const cog = {
    verbal: cogScore ? Math.min(100, Math.round((cogScore.verbal / maxPerDim) * 100)) : 50,
    espacial: cogScore ? Math.min(100, Math.round((cogScore.espacial / maxPerDim) * 100)) : 50,
    logico: cogScore ? Math.min(100, Math.round((cogScore.logica / maxPerDim) * 100)) : 50,
    numerico: cogScore ? Math.min(100, Math.round((cogScore.numerica / maxPerDim) * 100)) : 50,
    abstracto: cogScore ? Math.min(100, Math.round((cogScore.abstracta / maxPerDim) * 100)) : 50,
  };
  const cogIndice = Math.round((cog.verbal + cog.espacial + cog.logico + cog.numerico + cog.abstracto) / 5);

  // Emotional score
  const emotionalVal = emotionalScore?.score ?? 50;

  // Build factor lookup
  const factorValues: Record<string, number> = {
    disc_D: disc.D,
    disc_I: disc.I,
    disc_S: disc.S,
    disc_C: disc.C,
    disc_S_inv: 100 - disc.S, // Baja Solidez
    cog_verbal: cog.verbal,
    cog_espacial: cog.espacial,
    cog_logico: cog.logico,
    cog_numerico: cog.numerico,
    cog_abstracto: cog.abstracto,
    cog_indice: cogIndice,
    emocion_mesura: emocionalContribucion(emotionalVal, 'mesura'),
    emocion_espontaneidad: emocionalContribucion(emotionalVal, 'espontaneidad'),
    emocion_reflexividad: emocionalContribucion(emotionalVal, 'reflexividad'),
  };

  // Alias map: old IDs -> new IDs (for backwards compatibility with saved job profiles)
  const ALIASES: Record<string, string> = {
    'pensamiento_analitico': 'pensamiento_analitico_innovacion',
    'razonamiento_ideacion': 'pensamiento_analitico_innovacion',
  };

  // Calculate: promedio simple de todos los factores
  // Include aliased IDs so old job profiles still match
  const results = COMPETENCIAS.map(comp => {
    const values = comp.factores.map(f => factorValues[f] ?? 50);
    const score = values.reduce((s, v) => s + v, 0) / values.length;
    return { id: comp.id, nombre: comp.nombre, score: Math.round(Math.min(100, Math.max(0, score))) };
  });

  // Add aliased entries so old job profile IDs still find a match
  for (const [oldId, newId] of Object.entries(ALIASES)) {
    const existing = results.find(r => r.id === newId);
    if (existing && !results.find(r => r.id === oldId)) {
      results.push({ id: oldId, nombre: existing.nombre, score: existing.score });
    }
  }

  return results;
}
