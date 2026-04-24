export interface PKProfile {
  id: string;
  name: string;
  traits: string[];
  description: string;
  D: number; I: number; S: number; C: number;
}

export const PK_PROFILES: PKProfile[] = [
  { id: 'PK-01', name: 'Flexible - Independiente - Cooperativo/a', traits: ['Adapta su estilo según la situación', 'Valora la planificación cuidadosa', 'Prefiere grupos pequeños'], description: 'La persona con alta D y S tiene la facilidad de adaptar su estilo dependiendo de cada situación social. Valora la planificación cuidadosa y prefiere seguir estos planes para resolver tareas y alcanzar sus objetivos. Generalmente, disfruta trabajar solo/a o en grupos pequeños, donde puede relacionarse persona a persona.', D: 80, I: 20, S: 80, C: 20 },
  { id: 'PK-02', name: 'Empático/a - Brinda apoyo - Escucha', traits: ['Orientado/a a comprender emociones', 'Brinda apoyo y empatía', 'Buena disposición para escuchar'], description: 'Persona orientada a la comprensión de sentimientos y emociones de las personas. Suele ser alguien que brinda apoyo, se comporta de manera empática y es reconocida por los demás como alguien con buena disposición para escuchar y ayudar siempre que sea posible.', D: 20, I: 80, S: 80, C: 20 },
  { id: 'PK-03', name: 'Sociable - Persuasivo/a - Analítico/a', traits: ['Sociable y abierto/a', 'Persuade mediante explicación lógica', 'Alterna entre detallista y social'], description: 'Su comportamiento varía dependiendo de la circunstancia. Tiende a ser sociable y a poseer una actividad abierta, aunque también puede adoptar un comportamiento más detallista y analítico. Suele persuadir a las personas para involucrarlas en el trabajo mediante una explicación lógica de las actividades propuestas.', D: 20, I: 80, S: 20, C: 80 },
  { id: 'PK-04', name: 'Perfeccionista - Planificado/a - Resultados', traits: ['Deseo de obtener resultados tangibles', 'Perfeccionista y planificado/a', 'Directo/a al expresarse'], description: 'Se caracteriza por la versatilidad de su comportamiento. Por un lado, existe su deseo por obtener resultados tangibles y, por otro, su empuje por ser perfeccionista. Le gusta hacer las cosas bien, de manera planificada, y suele expresar lo que piensa de manera sólida y directa. Piensa y reacciona rápidamente, pero a veces se contiene antes de tomar una decisión por su anhelo de explorar todas las opciones posibles.', D: 80, I: 20, S: 20, C: 80 },
  { id: 'PK-05', name: 'Decidido/a - Tenaz - Competitivo/a', traits: ['Prioriza los resultados', 'Busca nuevos retos constantemente', 'Orientado/a a superar estándares'], description: 'Se caracteriza por actuar con tenacidad y dar prioridad a los resultados. Con frecuencia, busca oportunidades para nuevos retos por su orientación a dejar una marca. Aprecia el sentido de competencia, por lo que se podrá notar su tendencia a superar estándares.', D: 100, I: 35, S: 30, C: 35 },
  { id: 'PK-06', name: 'Determinado/a - Directo/a - Persuasivo/a', traits: ['Objetivos claros con determinación', 'Usa persuasión para orientar a otros', 'Prefiere tener el control'], description: 'Persona capaz de mostrarse directa o socialmente encantadora, dependiendo de la situación. Suele plantearse objetivos claros y muestra determinación para alcanzarlos. Prefiere tener el control, y para esto tiende a utilizar su habilidad persuasiva para orientar el comportamiento de los demás hacia un fin determinado.', D: 80, I: 80, S: 20, C: 20 },
  { id: 'PK-07', name: 'Cauteloso/a - Planificado/a - Estructurado/a', traits: ['Piensa detenidamente antes de actuar', 'Prefiere ambientes estructurados', 'Aporta fiabilidad y estabilidad'], description: 'Tiende a pensar las cosas detenidamente y suele premeditar cuidadosamente sus palabras y acciones. Prefiere desenvolverse en ambientes estructurados, por lo que se siente cómodo/a trabajando en privacidad y de forma planificada, situaciones en las que aporta fiabilidad y estabilidad en su trabajo.', D: 50, I: 10, S: 90, C: 50 },
  { id: 'PK-08', name: 'Preciso/a - Analítico/a - Calidad', traits: ['Valora datos y precisión', 'Analiza toda la información antes de decidir', 'Prefiere seguir reglas y procedimientos'], description: 'Persona que valora los datos y la precisión. Generalmente, trata de analizar minuciosamente toda la información y opciones disponibles antes de tomar una decisión. Le gusta trabajar en ambientes apacibles, y prefiere seguir reglas y procedimientos para alcanzar objetivos.', D: 35, I: 30, S: 35, C: 100 },
  { id: 'PK-09', name: 'Preciso/a - Cauteloso/a - Paciente', traits: ['Trabaja de forma sistemática y precisa', 'Valora condiciones estables', 'Se esfuerza por resultados de calidad'], description: 'Suele trabajar y pensar de forma sistemática y precisa, combinando la precisión con la paciencia para resolver un problema. Tiende a mostrar interés por realizar trabajos de calidad y hará todo lo posible para garantizar que los resultados sean lo mejor que puede lograr. Valora condiciones estables y actividades predecibles.', D: 20, I: 20, S: 80, C: 80 },
  { id: 'PK-10', name: 'Extrovertido/a - Entusiasta - Flexible', traits: ['Abierto/a y extrovertido/a', 'Fuente de motivación para otros', 'Flexible entre orden y riesgo'], description: 'Persona que tiende a ser abierta y extrovertida, cuyo estilo animado y entusiasta suele ser una fuente de motivación para los demás. El balance de sus factores le facilitan inclinarse a seguir pasos ordenados para obtener resultados, o bien, a tomar riesgos, dependiendo de las circunstancias.', D: 50, I: 90, S: 10, C: 50 },
  { id: 'PK-11', name: 'Minucioso/a - Diplomático/a - Calidad', traits: ['Desarrolla experticia en su área', 'Estilo relajado y diplomático', 'Altos estándares de desempeño'], description: 'Se caracteriza por su deseo de desarrollar experticia en su área, por lo que controla cuidadosamente su desempeño y aprecia que los demás sean competentes y autodisciplinados. Su equilibrio de factores le permiten mostrar un estilo relajado y diplomático, sin dejar de lado su interés por alcanzar altos estándares de desempeño.', D: 0, I: 70, S: 50, C: 80 },
  { id: 'PK-12', name: 'Cauteloso/a - Persuasivo/a - Cooperativo/a', traits: ['Estilo cauteloso y tranquilo', 'Busca relaciones cercanas y duraderas', 'Amigable y cooperativo/a en equipo'], description: 'Muestra una combinación de factores que le permiten mantener un estilo cauteloso y tranquilo, y al mismo tiempo, esforzarse por lograr objetivos a través de sus habilidades de persuasión. Busca entablar relaciones cercanas y duraderas, y generalmente disfruta formar parte de un equipo, donde muestra un estilo amigable y cooperativo.', D: 0, I: 65, S: 70, C: 65 },
  { id: 'PK-13', name: 'Moderado/a - Amigable - Persistente', traits: ['Comportamiento moderado y adaptable', 'Se lleva bien con diferentes estilos', 'Persistente en tareas repetitivas'], description: 'Tiende a mostrar un comportamiento moderado, lo que le facilita trabajar y llevarse bien con personas que tienen diferentes estilos conductuales. Prefiere mantener un ritmo de trabajo pausado, y esto le permite desempeñarse en actividades que otros encontrarían aburridas o repetitivas.', D: 10, I: 50, S: 90, C: 50 },
  { id: 'PK-14', name: 'Persuasivo/a - Acción - Disfruta retos', traits: ['Orientado/a a la acción constante', 'Disfruta tareas retadoras', 'Persuade para obtener apoyo'], description: 'La clave para entender este perfil es la acción. La mayor parte del tiempo, prefiere estar involucrada en alguna actividad que ponga a prueba y desarrolle sus habilidades, de manera que disfruta realizar tareas retadoras y ejercer cargos de alta responsabilidad. Aunque se orienta a trabajar de manera independiente, tiene la habilidad de persuadir a otras personas para que apoyen sus esfuerzos.', D: 90, I: 50, S: 10, C: 50 },
  { id: 'PK-15', name: 'Comunicativo/a - Amigable - Multitarea', traits: ['Extrovertido/a y sociable', 'Entabla amistades con facilidad', 'Se desenvuelve en entornos multitarea'], description: 'La comunicación es el elemento clave para comprender este perfil. Tiende a comportarse de manera extrovertida y a entablar amistades con facilidad. Generalmente, prefiere involucrarse en actividades que impliquen interactuar con otras personas y hacer vida social. En tareas repetitivas se distrae con facilidad, por lo que se desenvuelve mejor en entornos multitarea.', D: 10, I: 90, S: 50, C: 50 },
  { id: 'PK-16', name: 'Independiente - Arriesgado/a - Resultados', traits: ['Plantea objetivos y metas propias', 'Prefiere pocas regulaciones', 'Toma decisiones de manera autónoma'], description: 'Persona que tiende a plantearse objetivos y metas propias. Prefiere desempeñarse en posiciones con pocas regulaciones o influencia de terceros, donde pueda emprender proyectos nuevos y tomar decisiones de manera autónoma.', D: 90, I: 50, S: 50, C: 10 },
  { id: 'PK-17', name: 'Directo/a - Analítico/a - Arriesgado/a', traits: ['Eficiente, directo/a y asertivo/a', 'Visión objetiva basada en datos', 'Disfruta situaciones desafiantes'], description: 'Persona que suele mostrarse eficiente, directa y asertiva. Prefiere desarrollar una visión objetiva y analítica de las cosas, por lo que se interesa más en los hechos y en los datos. Se preocupa por conseguir resultados lo antes posible y disfruta involucrarse en situaciones que representen un desafío personal.', D: 90, I: 10, S: 50, C: 50 },
  { id: 'PK-18', name: 'Independiente - Sociable - Determinado/a', traits: ['Independiente con objetivos claros', 'Interactúa hábilmente con otros', 'En presión se torna directivo/a'], description: 'El elemento clave es la independencia. Suele plantearse objetivos claros y trabaja con determinación para alcanzarlos. Se muestra confiada en sí misma, y le resulta fácil interactuar hábilmente con otras personas. Si bien se caracteriza por ser sociable, en situaciones de presión tiende a tornarse más directiva y exigente.', D: 60, I: 80, S: 60, C: 0 },
  { id: 'PK-19', name: 'Socialmente hábil - Considerado/a - Rápido/a', traits: ['Rapidez de respuesta y urgencia', 'Combina meticulosidad con habilidades sociales', 'Sensible frente a necesidades de otros'], description: 'Las principales características son la rapidez de respuesta y el sentido de urgencia. Sin embargo, combina un estilo meticuloso con fuertes habilidades sociales, que surgen con mayor frecuencia en contextos informales y relajados. Se muestra sensible frente a las necesidades de los demás, lo que le permite actuar de forma más precavida en comparación con otros perfiles extrovertidos.', D: 60, I: 80, S: 0, C: 60 },
  { id: 'PK-20', name: 'Pragmático/a - Cauteloso/a - Paciente', traits: ['Practicidad y pensamiento racional', 'Cauteloso/a con información personal', 'Paciente pero toma control bajo presión'], description: 'Se caracteriza por un estilo basado en la practicidad y el pensamiento racional, más que en las emociones. Es cauteloso/a cuando se trata de revelar información personal, ideas o sentimientos. Tiende a mostrar un estilo cauteloso y paciente en circunstancias favorables, pero en situaciones de presión puede tomar la iniciativa y tener el control.', D: 60, I: 0, S: 80, C: 60 },
  { id: 'PK-21', name: 'Sociable - Rápido/a - Confianza en sí mismo/a', traits: ['Seguridad en sí mismo/a', 'Cómodo/a en cualquier situación social', 'Toma decisiones con rapidez'], description: 'Se caracteriza por la seguridad que muestra en sí misma. Suele sentirse a gusto en casi cualquier situación social y son pocas las veces que muestra indecisión. Tiene la facilidad de relacionarse con extraños y se siente cómoda iniciando cualquier tipo de contacto social. Debido a su autoconfianza, tiende a dar respuestas y tomar decisiones con más velocidad que otros perfiles.', D: 50, I: 90, S: 50, C: 10 },
  { id: 'PK-22', name: 'Persistente - Estabilidad - Flexible', traits: ['Persistente y conserva estabilidad', 'Permanece unido/a a su entorno', 'Prefiere ambientes sin trabas'], description: 'Se caracteriza por ser persistente y una de sus prioridades suele ser conservar la estabilidad. Tiende a permanecer unida a su entorno y círculo social, por lo que procura mantener el equilibrio, incluso en situaciones de presión. Prefiere desenvolverse en ambientes libres de trabas o estructuras.', D: 50, I: 50, S: 90, C: 10 },
  { id: 'PK-23', name: 'Minucioso/a - Detalles - Multitarea', traits: ['Atención a los detalles', 'Nota puntos sutiles que otros pasan por alto', 'Trabaja en varias tareas simultáneamente'], description: 'Persona que tiende a prestar atención a los detalles y a estar alerta de los cambios que pueden surgir en su entorno. Suele notar puntos sutiles que a otras personas les resultan difíciles de advertir o frecuentemente pasan por alto. Puede trabajar en varias tareas al mismo tiempo y esto le resulta estimulante.', D: 50, I: 50, S: 10, C: 90 },
  { id: 'PK-24', name: 'Minucioso/a - Cauteloso/a - Estructurado/a', traits: ['Revisa y verifica minuciosamente', 'Cómodo/a en ambientes estructurados', 'Se comunica en base a datos'], description: 'Tiende a revisar y verificar minuciosamente su trabajo y el de sus compañeros para evitar cometer errores. Se siente cómoda en ambientes estructurados y predecibles, tiende a mostrar un estilo cauteloso y se comunica en base a datos, en lugar de información personal.', D: 50, I: 10, S: 50, C: 90 },
  { id: 'PK-25', name: 'Paciente - Estabilidad - Calmado/a', traits: ['Paciente, calmado/a y abierto/a', 'Amable y afectuoso/a', 'Feliz trabajando largo tiempo en una tarea'], description: 'Se caracteriza por ser paciente, calmada y abierta con los demás. Generalmente, se comporta de manera amable y afectuosa, simpatiza con los puntos de vista ajenos y aprecia interactuar con otras personas. En su interacción interpersonal, prefiere que otras personas tomen la iniciativa. Le gustan los ambientes calmados, y suele sentirse feliz trabajando largos períodos de tiempo en una misma tarea.', D: 35, I: 30, S: 100, C: 35 },
  { id: 'PK-26', name: 'Metódico/a - Estabilidad - Relaciones positivas', traits: ['Orientado/a a las reglas', 'Sigue reglamentos y procedimientos', 'Busca mantener relaciones laborales positivas'], description: 'Persona orientada a las reglas, que valora sentirse segura de su posición y tiende a seguir los reglamentos y procedimientos establecidos para alcanzar objetivos. Necesita apoyo práctico por parte de gerentes, colegas y amigos, por lo que suele buscar mantener relaciones laborales positivas.', D: 10, I: 50, S: 50, C: 90 },
  { id: 'PK-27', name: 'Amigable - Comunicativo/a - Extrovertido/a', traits: ['Se comunica con soltura', 'Extrovertido/a y seguro/a de sí mismo/a', 'Se preocupa por mantener unido al grupo'], description: 'Se caracteriza por representar un estilo que se comunica con soltura. Se muestra como una persona extrovertida y segura de sí misma, que valora estar en contacto con otras personas y entablar relaciones positivas. Tiene facilidad para exponer sus puntos de vista, y la habilidad de comprender las perspectivas de los demás para adaptarse a nuevas situaciones. Por su naturaleza sociable, suele preocuparse por mantener unido al grupo.', D: 30, I: 100, S: 35, C: 35 },
];

// Pattern-based PK identification following the guide:
// 1. Classify each dim as alto(>=70)/medio(40-69)/bajo(0-39)
// 2. Identify peaks, valleys, mids, and floor (<=10)
// 3. Match pattern first, then use distance as tiebreaker
export function identifyPK(disc: Record<string, number>): PKProfile | null {
  if (!disc) return null;
  const dims = ['D', 'I', 'S', 'C'] as const;

  function getLevel(v: number): 'alto' | 'medio' | 'bajo' {
    if (v >= 70) return 'alto';
    if (v >= 40) return 'medio';
    return 'bajo';
  }

  function analyze(values: Record<string, number>) {
    const levels: Record<string, string> = {};
    const peaks: string[] = [];
    const valleys: string[] = [];
    let hasPiso = false;
    for (const d of dims) {
      const v = values[d] || 0;
      const level = getLevel(v);
      levels[d] = level;
      if (level === 'alto') peaks.push(d);
      if (level === 'bajo') valleys.push(d);
      if (v <= 10) hasPiso = true;
    }
    return { levels, peaks, valleys, hasPiso };
  }

  const input = analyze(disc);

  let bestMatch: PKProfile | null = null;
  let bestScore = -Infinity;

  for (const pk of PK_PROFILES) {
    const pkVals = { D: pk.D, I: pk.I, S: pk.S, C: pk.C };
    const pkP = analyze(pkVals);

    // Pattern score: same level classification per dimension
    let patternScore = 0;
    for (const d of dims) {
      if (input.levels[d] === pkP.levels[d]) patternScore += 25;
    }

    // Bonus: same peaks
    patternScore += input.peaks.filter(d => pkP.peaks.includes(d)).length * 15;

    // Bonus: same valleys
    patternScore += input.valleys.filter(d => pkP.valleys.includes(d)).length * 15;

    // Bonus: piso match
    if (input.hasPiso === pkP.hasPiso) patternScore += 10;

    // Manhattan distance as tiebreaker (smaller = better)
    let dist = 0;
    for (const d of dims) dist += Math.abs((disc[d] || 0) - pkVals[d]);

    // Pattern is 100x more important than exact distance
    const score = patternScore * 100 - dist;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = pk;
    }
  }

  return bestMatch;
}

// For candidate raw scores: normalize to PK scale (0-100 per dim, ×5, cap 100)
export function normalizeDisc(disc: Record<string, number>): Record<string, number> {
  const dims = ['D', 'I', 'S', 'C'];
  const sum = dims.reduce((s, d) => s + (disc?.[d] || 0), 0);
  if (sum === 0) return { D: 0, I: 0, S: 0, C: 0 };
  if (sum > 100) return disc;
  const result: Record<string, number> = {};
  for (const d of dims) result[d] = Math.min(100, Math.round((disc?.[d] || 0) * 5));
  return result;
}
