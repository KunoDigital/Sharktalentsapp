export type VelnaSubtest = 'verbal' | 'espacial' | 'logica' | 'numerica' | 'abstracta';

export interface VelnaCompetencia {
  key: VelnaSubtest;
  label: string;
  mide: string;
  utilidad: string;
}

export const VELNA_COMPETENCIAS: VelnaCompetencia[] = [
  {
    key: 'verbal',
    label: 'Razonamiento verbal',
    mide: 'Comprensión de textos, vocabulario, capacidad para identificar relaciones entre palabras y deducir significados a partir del contexto.',
    utilidad: 'Bueno para roles que requieren leer instrucciones complejas, redactar comunicaciones claras, atender clientes, o explicar procesos a otras personas.',
  },
  {
    key: 'espacial',
    label: 'Razonamiento espacial',
    mide: 'Capacidad para visualizar objetos en el espacio, rotarlos mentalmente y entender relaciones entre formas.',
    utilidad: 'Útil para roles operativos, de logística, de diseño, ingeniería, o cualquier puesto donde sea importante interpretar planos, mapas o esquemas.',
  },
  {
    key: 'logica',
    label: 'Razonamiento lógico',
    mide: 'Capacidad para identificar patrones, llegar a conclusiones a partir de premisas y resolver problemas de forma deductiva.',
    utilidad: 'Bueno para roles que requieren tomar decisiones bajo reglas, resolver problemas, análisis de datos, programación o cualquier puesto donde haga falta pensar de manera estructurada.',
  },
  {
    key: 'numerica',
    label: 'Razonamiento numérico',
    mide: 'Manejo de cálculos, proporciones, porcentajes, interpretación de tablas y datos cuantitativos.',
    utilidad: 'Útil para roles administrativos, contables, comerciales con metas, análisis financiero o cualquier puesto donde se trabaje con números todos los días.',
  },
  {
    key: 'abstracta',
    label: 'Razonamiento abstracto',
    mide: 'Capacidad para identificar patrones visuales nuevos, aprender reglas sin instrucción previa y adaptarse a problemas no familiares.',
    utilidad: 'Es la mejor predicción de qué tan rápido alguien aprende cosas nuevas. Útil para roles con curva de aprendizaje, cambios frecuentes o tecnologías nuevas.',
  },
];

export function interpretVelnaLevel(pct: number): { level: 'alto' | 'medio' | 'bajo'; label: string; note: string } {
  if (pct >= 70) return { level: 'alto', label: 'Alto', note: 'Por encima del promedio. Es una fortaleza clara.' };
  if (pct >= 50) return { level: 'medio', label: 'Medio', note: 'Dentro del promedio esperado. Funciona bien en situaciones del día a día.' };
  if (pct >= 30) return { level: 'bajo', label: 'Bajo', note: 'Por debajo del promedio. Funciona mejor con apoyo o tareas guiadas en esta área.' };
  return { level: 'bajo', label: 'Muy bajo', note: 'Requiere acompañamiento cercano en esta área.' };
}
