/**
 * Catálogo cerrado de 54 competencias (Manual Kudert).
 *
 * Tanto la IA cuando arma un draft del puesto como el admin cuando edita un perfil
 * ideal deben elegir IDs de esta lista — NO inventar nombres custom. Ver
 * memory/project_competencias_catalogo_cerrado.md.
 */
export interface Competencia {
  id: string;
  nombre: string;
}

export const COMPETENCIAS: Competencia[] = [
  { id: 'comunicacion_digital', nombre: 'Comunicación digital' },
  { id: 'colaboracion', nombre: 'Colaboración' },
  { id: 'adaptabilidad', nombre: 'Adaptabilidad' },
  { id: 'iniciativa', nombre: 'Iniciativa' },
  { id: 'planificacion', nombre: 'Planificación' },
  { id: 'manejo_ambiguedad', nombre: 'Manejo de la ambigüedad' },
  { id: 'trabajo_equipo', nombre: 'Trabajo en equipo y colaboración' },
  { id: 'retroalimentacion', nombre: 'Retroalimentación y monitoreo' },
  { id: 'orientacion_cliente', nombre: 'Orientación al cliente' },
  { id: 'aprendizaje_vuelo', nombre: 'Aprendizaje al vuelo' },
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
  { id: 'habilidad_analitica', nombre: 'Habilidad analítica' },
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
  { id: 'resiliencia', nombre: 'Resiliencia, tolerancia al estrés y flexibilidad' },
];
