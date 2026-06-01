export type DiscDim = 'D' | 'I' | 'S' | 'C';

export interface WorkStyle {
  decisiones: string;
  equipo: string;
  presion: string;
  comunicacion: string;
}

export const DISC_WORK_STYLE: Record<DiscDim, WorkStyle> = {
  D: {
    decisiones: 'Toma decisiones rápidas y directas. Prefiere actuar antes que esperar. Funciona bien con autonomía y objetivos claros.',
    equipo: 'Le gusta liderar y marcar el rumbo. Aporta empuje y dirección. Necesita compañeros que ejecuten sin requerir mucho seguimiento.',
    presion: 'Bajo presión se vuelve más directiva y se enfoca en resolver. Puede ser exigente con quienes no avanzan al mismo ritmo.',
    comunicacion: 'Directa y al grano. Va al punto sin rodeos. Aprecia que le hablen de la misma manera.',
  },
  I: {
    decisiones: 'Decide guiada por la intuición, las relaciones y el optimismo. Suele consultar primero con otros antes de cerrar.',
    equipo: 'Energiza al grupo, motiva e involucra. Genera buen clima. Su mejor aporte es la conexión humana y entusiasmo.',
    presion: 'Bajo presión busca apoyo y conversación. Puede dispersarse si pierde foco; funciona mejor con cierta estructura externa.',
    comunicacion: 'Expresiva, cálida y persuasiva. Se conecta con las personas, escucha y hace que se sientan escuchadas.',
  },
  S: {
    decisiones: 'Decide con calma, prefiere consultar y construir consenso. Evita movimientos bruscos y valora la estabilidad.',
    equipo: 'Es el pegamento del grupo. Coopera, apoya y mantiene el ritmo sin protagonismo. Excelente para sostener procesos.',
    presion: 'Bajo presión se mantiene tranquila externamente, pero puede acumular estrés sin avisar. Necesita espacios para procesar.',
    comunicacion: 'Calmada, atenta y diplomática. Escucha más de lo que habla. Evita conflicto, prefiere acuerdos.',
  },
  C: {
    decisiones: 'Decide con base en datos, reglas y análisis previo. Prefiere tomar tiempo y revisar todas las opciones.',
    equipo: 'Aporta calidad y rigurosidad. Es la persona que detecta errores antes de que pasen. Mejor en roles especializados que masivos.',
    presion: 'Bajo presión se vuelve más cuidadosa y minuciosa. Puede paralizarse si faltan datos o si tiene que improvisar.',
    comunicacion: 'Precisa y basada en hechos. Prefiere comunicar por escrito o con datos. Evita conversaciones puramente emocionales.',
  },
};

export function getDominantDim(scores: { D: number; I: number; S: number; C: number }): DiscDim {
  const entries: Array<[DiscDim, number]> = [['D', scores.D], ['I', scores.I], ['S', scores.S], ['C', scores.C]];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

export interface DiscFortalezas {
  fortalezas: string[];
  considerar: string[];
}

export const DISC_FORTALEZAS: Record<DiscDim, DiscFortalezas> = {
  D: {
    fortalezas: [
      'Empuje fuerte hacia resultados, no se detiene fácil',
      'Toma decisiones rápido cuando otros dudan',
      'Resuelve problemas en lugar de quedarse trabado',
      'Cómoda con responsabilidad y autonomía',
    ],
    considerar: [
      'Puede ser percibida como impaciente o brusca',
      'Tiende a saltarse detalles si quiere avanzar rápido',
      'Necesita roles con autonomía real, no le va bien con micromanagement',
      'Su estilo directo puede chocar con perfiles más sensibles',
    ],
  },
  I: {
    fortalezas: [
      'Excelente conexión con clientes y compañeros',
      'Genera entusiasmo y buen clima en el equipo',
      'Buena para vender ideas y persuadir',
      'Se adapta a situaciones sociales nuevas',
    ],
    considerar: [
      'Puede perder foco en tareas repetitivas o solitarias',
      'A veces se compromete con más de lo que puede cumplir',
      'Necesita estructura externa para llegar a metas concretas',
      'Tiende a dispersarse si el ambiente no le aporta estímulo social',
    ],
  },
  S: {
    fortalezas: [
      'Confiable, constante y predecible en su trabajo',
      'Buena para sostener procesos en el largo plazo',
      'Crea relaciones cercanas con clientes y equipo',
      'Aporta calma en momentos de tensión',
    ],
    considerar: [
      'Le cuesta adaptarse a cambios bruscos o reorganizaciones',
      'Evita conflicto, lo que puede demorar decisiones difíciles',
      'Puede acumular estrés sin avisar al equipo',
      'Necesita tiempo para procesar nuevas instrucciones, no responde bien a la urgencia',
    ],
  },
  C: {
    fortalezas: [
      'Atención al detalle y altos estándares de calidad',
      'Trabaja con datos y reglas claras, evita improvisar',
      'Detecta errores que otros pasan por alto',
      'Confiable para tareas que requieren precisión',
    ],
    considerar: [
      'Puede demorar decisiones esperando más información',
      'Le incomoda la ambigüedad y los procesos sin reglas claras',
      'Prefiere especializarse antes que abarcar varias áreas',
      'Su perfeccionismo puede frenar el ritmo del equipo',
    ],
  },
};
