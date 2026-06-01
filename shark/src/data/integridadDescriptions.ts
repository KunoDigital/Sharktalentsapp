export interface IntegridadDimensionInfo {
  key: string;
  label: string;
  mide: string;
  bajo: string;
  medio: string;
  alto: string;
}

export const INTEGRIDAD_DIMENSIONES: IntegridadDimensionInfo[] = [
  {
    key: 'honestidad',
    label: 'Honestidad',
    mide: 'Tendencia a decir la verdad y reconocer errores, incluso cuando es incómodo.',
    bajo: 'Persona transparente, dice la verdad incluso cuando perjudica su imagen. Reconoce errores.',
    medio: 'Suele ser honesta, pero puede omitir información o suavizar la verdad bajo presión social o laboral.',
    alto: 'Mayor probabilidad de mentir, ocultar información o presentar versiones distorsionadas. Requiere supervisión cercana.',
  },
  {
    key: 'confiabilidad',
    label: 'Confiabilidad',
    mide: 'Probabilidad de cumplir compromisos, llegar a tiempo y respetar lo acordado sin que haya que recordárselo.',
    bajo: 'Cumple lo que promete. Se le puede delegar sin tener que hacerle seguimiento constante.',
    medio: 'Cumple la mayoría de las veces, pero puede tener inconsistencias. Conviene definir expectativas claras.',
    alto: 'Patrón de incumplimientos, postergaciones o promesas no cumplidas. Necesita estructura externa y seguimiento estricto.',
  },
  {
    key: 'dominio_personal',
    label: 'Dominio personal',
    mide: 'Capacidad de controlar impulsos, manejar la frustración y no reaccionar agresivamente.',
    bajo: 'Maneja bien la frustración y conflictos. No reacciona impulsivamente bajo estrés.',
    medio: 'En general se controla, pero puede tener reacciones impulsivas en momentos de alta tensión.',
    alto: 'Riesgo de reacciones impulsivas, discusiones acaloradas o pérdida de control con clientes/compañeros.',
  },
  {
    key: 'autenticidad',
    label: 'Autenticidad',
    mide: 'Coherencia entre lo que dice, lo que siente y lo que hace. Bajo riesgo de doble cara.',
    bajo: 'Coherente entre discurso y acción. Lo que dice frente a la gerencia coincide con lo que dice en el equipo.',
    medio: 'En general coherente, aunque puede adaptar su discurso según la audiencia.',
    alto: 'Tendencia a actuar diferente según con quién esté. Riesgo de doble discurso o de tener "dos caras".',
  },
  {
    key: 'imparcialidad',
    label: 'Imparcialidad',
    mide: 'Capacidad de juzgar situaciones sin favoritismos ni prejuicios.',
    bajo: 'Trata a todos por igual, evalúa situaciones objetivamente sin dejarse llevar por simpatías.',
    medio: 'Generalmente justa, pero puede inclinarse hacia personas que le caen mejor.',
    alto: 'Riesgo de favoritismo, prejuicios o trato desigual hacia compañeros, clientes o subordinados.',
  },
  {
    key: 'sencillez',
    label: 'Sencillez',
    mide: 'Ausencia de soberbia o necesidad de figurar. Trabaja sin necesidad de protagonismo.',
    bajo: 'Trabaja sin buscar reconocimiento constante. No necesita ser el centro de atención.',
    medio: 'Aprecia el reconocimiento, pero no es su principal motor.',
    alto: 'Búsqueda excesiva de protagonismo o reconocimiento. Puede generar fricciones con compañeros.',
  },
  {
    key: 'inteligencia_social',
    label: 'Inteligencia social',
    mide: 'Capacidad de leer situaciones sociales y comportarse de forma adecuada al contexto.',
    bajo: 'Lee bien el contexto social. Sabe cómo comportarse con clientes, compañeros y jefes.',
    medio: 'En general capta el contexto, aunque a veces puede ser inoportuna o desubicada.',
    alto: 'Dificultad para leer el contexto social. Puede generar incomodidad con clientes o compañeros.',
  },
  {
    key: 'buena_impresion',
    label: 'Buena impresión',
    mide: 'Indicador de validez: mide si la persona respondió tratando de "verse bien" en lugar de honestamente.',
    bajo: 'Respondió de forma honesta y consistente. El reporte es confiable.',
    medio: 'Hubo cierta tendencia a responder lo socialmente esperado. Interpretar el reporte con esto en cuenta.',
    alto: 'Respondió tratando de causar buena impresión más que honestamente. El reporte completo puede estar subestimando riesgos.',
  },
  {
    key: 'alcohol',
    label: 'Alcohol',
    mide: 'Probabilidad de problemas con consumo de alcohol que afecten el desempeño laboral.',
    bajo: 'Sin indicadores de consumo problemático.',
    medio: 'Algunos indicadores de consumo regular. Conviene observar comportamiento en reuniones de empresa o post-jornada.',
    alto: 'Indicadores claros de consumo problemático. Riesgo de impuntualidad, ausentismo o errores asociados.',
  },
  {
    key: 'drogas',
    label: 'Drogas',
    mide: 'Probabilidad de consumo de sustancias que afecten el desempeño laboral.',
    bajo: 'Sin indicadores de consumo de sustancias.',
    medio: 'Algunos indicadores ambiguos. Conviene profundizar en entrevista.',
    alto: 'Indicadores fuertes de consumo. Riesgo significativo para roles que requieren atención sostenida o manejo de bienes/dinero.',
  },
  {
    key: 'apuestas',
    label: 'Apuestas',
    mide: 'Probabilidad de problemas con juego/apuestas que generen presión financiera.',
    bajo: 'Sin indicadores de problemas con apuestas.',
    medio: 'Algunos indicadores leves. Conviene observar especialmente si el rol maneja dinero.',
    alto: 'Indicadores fuertes. Riesgo en roles que manejan dinero, caja o información financiera sensible.',
  },
  {
    key: 'hurto',
    label: 'Hurto',
    mide: 'Probabilidad de apropiación indebida de bienes de la empresa o de compañeros.',
    bajo: 'Sin indicadores. Respeto por la propiedad ajena y los bienes de la empresa.',
    medio: 'Algunos indicadores menores (apropiarse de cosas pequeñas, materiales de oficina). Vigilar especialmente en roles con acceso a inventario.',
    alto: 'Indicadores significativos. Alto riesgo para roles con acceso a inventario, caja o bienes de la empresa.',
  },
  {
    key: 'soborno',
    label: 'Soborno',
    mide: 'Disposición a aceptar pagos, regalos o favores a cambio de decisiones laborales.',
    bajo: 'Sin indicadores. Rechaza ofertas indebidas y mantiene independencia de criterio.',
    medio: 'Tolerancia moderada a "favores" o "atenciones". Conviene reforzar política de cumplimiento.',
    alto: 'Riesgo alto. Especialmente crítico en roles de compras, proveedores, ventas o atención a clientes.',
  },
];

export function getDimensionInfo(key: string): IntegridadDimensionInfo | null {
  return INTEGRIDAD_DIMENSIONES.find((d) => d.key === key) ?? null;
}
