/**
 * Catálogo cerrado de 54 competencias (Manual Kudert).
 *
 * Tanto la IA cuando arma un draft del puesto como el admin cuando edita un perfil
 * ideal deben elegir IDs de esta lista — NO inventar nombres custom. Ver
 * memory/project_competencias_catalogo_cerrado.md.
 *
 * --- Aliases (2026-06-16) ---
 * El manual Kudert tiene varios pares casi-clones con factores idénticos. Para
 * evitar diluir la elección manteniendo retro-compat con drafts/reportes históricos,
 * los IDs duplicados se marcan como `alias_of` apuntando al canónico. Cualquier lectura
 * del catálogo debe pasar por `resolveCompetenciaId()` para mapear alias → canónico.
 * Los IDs viejos NO se eliminan — siguen siendo válidos como entrada.
 */
export interface Competencia {
  id: string;
  nombre: string;
  /** Si está presente, este ID es un alias deprecado del ID indicado. */
  alias_of?: string;
}

export const COMPETENCIAS: Competencia[] = [
  { id: 'comunicacion_digital', nombre: 'Comunicación digital' },
  { id: 'colaboracion', nombre: 'Colaboración', alias_of: 'trabajo_equipo' },
  { id: 'adaptabilidad', nombre: 'Adaptabilidad' },
  { id: 'iniciativa', nombre: 'Iniciativa' },
  { id: 'planificacion', nombre: 'Planificación' },
  { id: 'manejo_ambiguedad', nombre: 'Manejo de la ambigüedad', alias_of: 'orientacion_cliente' },
  { id: 'trabajo_equipo', nombre: 'Trabajo en equipo y colaboración' },
  { id: 'retroalimentacion', nombre: 'Retroalimentación y monitoreo' },
  { id: 'orientacion_cliente', nombre: 'Orientación al cliente' },
  { id: 'aprendizaje_vuelo', nombre: 'Aprendizaje al vuelo', alias_of: 'aprendizaje_activo' },
  { id: 'resolucion_problemas', nombre: 'Resolución de problemas complejos' },
  { id: 'inteligencia_emocional', nombre: 'Inteligencia emocional' },
  { id: 'creatividad_innovacion', nombre: 'Creatividad e innovación' },
  { id: 'liderazgo', nombre: 'Liderazgo' },
  { id: 'orientacion_logro', nombre: 'Orientación al logro' },
  { id: 'persuasion_negociacion', nombre: 'Persuasión y negociación' },
  { id: 'mentalidad_digital', nombre: 'Mentalidad digital' },
  { id: 'foco_data', nombre: 'Foco en data' },
  { id: 'impacto_influencia', nombre: 'Impacto e influencia' },
  { id: 'autoconfianza', nombre: 'Autoconfianza' },
  { id: 'comprension_interpersonal', nombre: 'Comprensión interpersonal' },
  { id: 'comprension_organizacion', nombre: 'Comprensión de la organización' },
  { id: 'desarrollo_interrelaciones', nombre: 'Desarrollo de interrelaciones' },
  { id: 'desarrollo_personas', nombre: 'Desarrollo de personas' },
  { id: 'orden_calidad', nombre: 'Orden y calidad' },
  { id: 'direccion_personas', nombre: 'Dirección de personas' },
  { id: 'asertividad', nombre: 'Asertividad' },
  { id: 'dinamismo_energia', nombre: 'Dinamismo y energía' },
  { id: 'habilidad_analitica', nombre: 'Habilidad analítica', alias_of: 'pensamiento_critico' },
  { id: 'perseverancia', nombre: 'Perseverancia' },
  { id: 'orientacion_accion', nombre: 'Orientación a la acción' },
  { id: 'habilidades_mando', nombre: 'Habilidades de mando' },
  { id: 'compromiso_organizacional', nombre: 'Compromiso organizacional' },
  { id: 'actitud_servicio', nombre: 'Actitud de servicio' },
  { id: 'manejo_conflictos', nombre: 'Manejo de conflictos' },
  { id: 'toma_decisiones_oportuna', nombre: 'Toma de decisiones oportuna' },
  { id: 'calidad_decisiones', nombre: 'Calidad de las decisiones' },
  { id: 'delegacion', nombre: 'Delegación' },
  { id: 'habilidad_informar', nombre: 'Habilidad de informar' },
  { id: 'capacidad_intelectual', nombre: 'Capacidad intelectual' },
  { id: 'capacidad_escuchar', nombre: 'Capacidad para escuchar' },
  { id: 'valentia_gerencial', nombre: 'Valentía gerencial' },
  { id: 'administracion_supervision', nombre: 'Administración y supervisión del trabajo' },
  { id: 'habilidad_motivar', nombre: 'Habilidad de motivar a personas' },
  { id: 'paciencia', nombre: 'Paciencia' },
  { id: 'administracion_procesos', nombre: 'Administración de procesos' },
  { id: 'manejo_vision_proposito', nombre: 'Manejo de visión y propósito' },
  { id: 'comunicacion_escrita', nombre: 'Comunicación escrita' },
  { id: 'gestion_riesgo', nombre: 'Gestión del riesgo' },
  { id: 'pensamiento_analitico_innovacion', nombre: 'Pensamiento analítico e innovación' },
  { id: 'aprendizaje_activo', nombre: 'Aprendizaje activo y estrategias de aprendizaje' },
  { id: 'pensamiento_critico', nombre: 'Pensamiento crítico y análisis' },
  { id: 'creatividad_originalidad_iniciativa', nombre: 'Creatividad, originalidad e iniciativa' },
  { id: 'liderazgo_influencia_social', nombre: 'Liderazgo e influencia social' },
  { id: 'resiliencia', nombre: 'Resiliencia, tolerancia al estrés y flexibilidad', alias_of: 'adaptabilidad' },
];

/**
 * Mapa de aliases: ID viejo (deprecado) → ID canónico (oficial).
 *
 * Derivado de los entries del catálogo con `alias_of`. Mantener este mapa para
 * lookups O(1) sin necesidad de iterar COMPETENCIAS.
 *
 * Los IDs viejos siguen siendo válidos como entrada (no se rechazan en
 * validación). Cualquier consumidor que necesite "el ID definitivo" debe pasar
 * el valor por `resolveCompetenciaId()`.
 *
 * Nota sobre 'resolucion_problemas': el manual Kudert lo lista dos veces, pero
 * en código siempre hubo un solo entry. No hay alias que crear.
 */
export const COMPETENCIA_ALIASES: Readonly<Record<string, string>> = Object.freeze(
  COMPETENCIAS.reduce<Record<string, string>>((acc, c) => {
    if (c.alias_of) acc[c.id] = c.alias_of;
    return acc;
  }, {}),
);

/**
 * Resuelve un ID al canónico. Si no está en aliases, lo devuelve tal cual.
 * Idempotente: resolveCompetenciaId(resolveCompetenciaId(x)) === resolveCompetenciaId(x).
 */
export function resolveCompetenciaId(id: string): string {
  return COMPETENCIA_ALIASES[id] ?? id;
}

/** Lista de IDs canónicos (sin aliases). Útil para UI de selección. */
export const COMPETENCIAS_CANONICAS: Competencia[] = COMPETENCIAS.filter((c) => !c.alias_of);
