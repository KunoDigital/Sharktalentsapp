import { INTEGRIDAD_DIMENSIONES, getDimensionInfo } from './integridadDescriptions';

export interface IntegridadGrupo {
  id: string;
  nombre: string;
  descripcion: string;
  dimensiones: string[];
}

export const INTEGRIDAD_GRUPOS: IntegridadGrupo[] = [
  {
    id: 'veracidad',
    nombre: 'Honestidad y veracidad',
    descripcion: 'Tendencia a decir la verdad, reconocer errores y no manipular información para verse mejor.',
    dimensiones: ['honestidad', 'autenticidad'],
  },
  {
    id: 'confiabilidad_general',
    nombre: 'Confiabilidad y responsabilidad',
    descripcion: 'Probabilidad de cumplir lo prometido, llegar a tiempo y hacerse cargo sin supervisión constante.',
    dimensiones: ['confiabilidad', 'dominio_personal'],
  },
  {
    id: 'conductas_riesgo',
    nombre: 'Conductas de riesgo personal',
    descripcion: 'Probabilidad de consumo problemático o problemas con apuestas que afecten el trabajo.',
    dimensiones: ['alcohol', 'drogas', 'apuestas'],
  },
  {
    id: 'bienes_ajenos',
    nombre: 'Respeto por bienes y normas',
    descripcion: 'Probabilidad de apropiación indebida o de aceptar sobornos. Crítico en roles con acceso a inventario, dinero o decisiones de compra.',
    dimensiones: ['hurto', 'soborno'],
  },
  {
    id: 'interpersonal',
    nombre: 'Conducta interpersonal',
    descripcion: 'Cómo se comporta con otros: justa, prudente, sin protagonismo excesivo, leyendo bien el contexto.',
    dimensiones: ['imparcialidad', 'sencillez', 'inteligencia_social'],
  },
  {
    id: 'validez',
    nombre: 'Validez del test',
    descripcion: 'Indica si la persona respondió honestamente o tratando de "verse bien". Afecta la confianza en todo el reporte.',
    dimensiones: ['buena_impresion'],
  },
];

export interface DimensionResult { dimension: string; nivel: string; pct: number }

export function analizarPerfilIntegridad(dims: DimensionResult[]): {
  resumen: string;
  validezNota: string | null;
} {
  const alertas = dims.filter((d) => d.nivel === 'alto').map((d) => d.dimension);
  const observaciones = dims.filter((d) => d.nivel === 'medio').map((d) => d.dimension);
  const sinRiesgo = dims.filter((d) => d.nivel === 'bajo');

  const buenaImpresion = dims.find((d) => d.dimension === 'buena_impresion');
  let validezNota: string | null = null;
  if (buenaImpresion) {
    if (buenaImpresion.nivel === 'alto') {
      validezNota = 'La persona respondió tratando de causar buena impresión más que honestamente. El reporte completo puede estar subestimando riesgos — los scores bajos en otras dimensiones podrían no ser tan limpios como aparecen.';
    } else if (buenaImpresion.nivel === 'medio') {
      validezNota = 'Hubo cierta tendencia a responder lo socialmente esperado. Considerá el reporte como un piso (los riesgos no son menores a lo que muestra, pero podrían ser un poco mayores).';
    }
  }

  let resumen = '';
  if (alertas.length === 0 && observaciones.length === 0) {
    resumen = `Perfil de integridad limpio. ${sinRiesgo.length} de ${dims.length} dimensiones en nivel bajo. No se detectan riesgos significativos en ninguna área. Es un perfil sólido para roles que requieren confianza, manejo de dinero o trato con clientes.`;
  } else if (alertas.length === 0) {
    const obsLabels = observaciones.map((k) => getDimensionInfo(k)?.label).filter(Boolean).join(', ');
    resumen = `Perfil de integridad globalmente sano, con ${observaciones.length} dimensión(es) en nivel medio que conviene observar: ${obsLabels}. No son alertas, pero vale la pena profundizar en entrevista o validar con referencias laborales recientes.`;
  } else {
    const altoLabels = alertas.map((k) => getDimensionInfo(k)?.label).filter(Boolean).join(', ');
    resumen = `Se detectan ${alertas.length} alerta(s) en nivel alto: ${altoLabels}. Esto significa probabilidad significativa de comportamientos de riesgo en esa(s) área(s). Antes de avanzar con este candidato, conviene validar específicamente esos puntos en entrevista profunda y con referencias laborales verificables.`;
  }

  return { resumen, validezNota };
}

const PREGUNTAS_POR_DIMENSION: Record<string, string[]> = {
  honestidad: [
    'Contame de una situación en el trabajo anterior donde tuviste que reconocer un error que afectó al equipo. ¿Cómo lo manejaste?',
    'Si un compañero te pide que cubras una falta o un error, ¿qué hacés?',
  ],
  confiabilidad: [
    'En tu trabajo anterior, ¿qué porcentaje de las veces llegabas a tiempo? ¿Por qué crees que era así?',
    'Contame de un compromiso que asumiste y no pudiste cumplir. ¿Qué pasó?',
  ],
  dominio_personal: [
    'Contame de un conflicto reciente con un cliente o compañero. ¿Cómo reaccionaste?',
    '¿Cómo respondés cuando alguien te critica injustamente delante de otros?',
  ],
  autenticidad: [
    '¿Hay cosas que decís frente a tu jefe que no dirías frente a tus compañeros? ¿Por qué?',
  ],
  imparcialidad: [
    '¿Cómo tomás decisiones cuando tenés que elegir entre dos compañeros para un proyecto? ¿Influyen tus simpatías personales?',
  ],
  sencillez: [
    'Contame de un logro reciente del que estés orgulloso. ¿Cómo lo comunicaste al equipo?',
  ],
  inteligencia_social: [
    '¿Te pasó alguna vez decir algo en el trabajo que resultó inoportuno? Contame.',
  ],
  alcohol: [
    '¿Cómo manejás situaciones laborales que involucran alcohol (cierres de venta, eventos, after-office)?',
    'Validá con referencias: ¿hubo episodios de impuntualidad o ausentismo de lunes?',
  ],
  drogas: [
    'Validá con referencias laborales recientes y considerá test toxicológico si el rol lo justifica.',
  ],
  apuestas: [
    '¿El rol incluye manejo de caja, dinero o información financiera? Si sí, validá con referencias y considerá no asignar acceso a fondos hasta tener más historial.',
  ],
  hurto: [
    'Si el rol incluye acceso a inventario, productos o efectivo, validá referencias laborales específicas sobre esa función.',
    'Considerá controles periódicos de inventario los primeros meses.',
  ],
  soborno: [
    '¿El rol incluye decisiones sobre proveedores, compras o atención a clientes que dan regalos? Si sí, reforzá la política de cumplimiento desde el día 1.',
  ],
  buena_impresion: [
    'Profundizá con preguntas situacionales concretas en lugar de hipotéticas — pedile ejemplos puntuales de su trabajo anterior con nombres, fechas y resultados verificables.',
  ],
};

export function preguntasParaEntrevista(dims: DimensionResult[]): Array<{ dimension: string; label: string; preguntas: string[] }> {
  return dims
    .filter((d) => d.nivel !== 'bajo')
    .map((d) => {
      const preguntas = PREGUNTAS_POR_DIMENSION[d.dimension];
      if (!preguntas) return null;
      const info = getDimensionInfo(d.dimension);
      return info ? { dimension: d.dimension, label: info.label, preguntas } : null;
    })
    .filter((x): x is { dimension: string; label: string; preguntas: string[] } => x !== null);
}

export function dimensionesOrdenadasPorGrupo(dims: DimensionResult[]): Array<{ grupo: IntegridadGrupo; dims: DimensionResult[] }> {
  return INTEGRIDAD_GRUPOS.map((grupo) => ({
    grupo,
    dims: grupo.dimensiones
      .map((dimKey) => dims.find((d) => d.dimension === dimKey))
      .filter((d): d is DimensionResult => !!d),
  })).filter((g) => g.dims.length > 0);
}

export function grupoNivelGlobal(dims: DimensionResult[]): 'bajo' | 'medio' | 'alto' {
  if (dims.some((d) => d.nivel === 'alto')) return 'alto';
  if (dims.some((d) => d.nivel === 'medio')) return 'medio';
  return 'bajo';
}

void INTEGRIDAD_DIMENSIONES;
