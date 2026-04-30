// Mock candidate test tokens y sesión.
// El candidato recibe un email con un link tipo:
//   https://sharktalents.kunodigital.com/#/test/<token>
// El token identifica al candidato + el job + la fase actual.

export type TestPhase = 'tecnica' | 'conductual' | 'integridad';

export type TestSession = {
  token: string;
  application_id: string;
  job_id: string;
  candidate_name: string;
  candidate_email: string;
  current_phase: TestPhase;
  // Estado de cada fase (los completados ya no se vuelven a presentar)
  tecnica_completed: boolean;
  conductual_completed: boolean;
  integridad_completed: boolean;
  // Greeting personalizado (opcional, generado por IA en backend real)
  greeting_text?: string;
};

export const MOCK_TEST_SESSIONS: Record<string, TestSession> = {
  'tok_carla_disc': {
    token: 'tok_carla_disc',
    application_id: 'app_1',
    job_id: 'job_1',
    candidate_name: 'Carla Méndez',
    candidate_email: 'carla.m@gmail.com',
    current_phase: 'conductual',
    tecnica_completed: true,
    conductual_completed: false,
    integridad_completed: false,
    greeting_text: 'Hola Carla, ya pasaste la prueba técnica con un score alto. Ahora vamos con la evaluación conductual: DISC + VELNA + emoción.',
  },
  'tok_diego_tecnica': {
    token: 'tok_diego_tecnica',
    application_id: 'app_2',
    job_id: 'job_1',
    candidate_name: 'Diego Salas',
    candidate_email: 'diego.salas@hotmail.com',
    current_phase: 'tecnica',
    tecnica_completed: false,
    conductual_completed: false,
    integridad_completed: false,
    greeting_text: 'Hola Diego, gracias por aplicar al puesto de Desarrollador Fullstack Senior en AcmeTech. Vamos a empezar con la prueba técnica.',
  },
  'tok_roberto_tecnica': {
    token: 'tok_roberto_tecnica',
    application_id: 'app_4',
    job_id: 'job_1',
    candidate_name: 'Roberto Wong',
    candidate_email: 'rwong@gmail.com',
    current_phase: 'tecnica',
    tecnica_completed: false,
    conductual_completed: false,
    integridad_completed: false,
  },
};

export function getTestSession(token: string): TestSession | undefined {
  return MOCK_TEST_SESSIONS[token];
}

// ============== Tecnica questions (IA-generated mock) ==============

export type TecnicaQuestionType = 'multiple_choice' | 'open_ended' | 'situational';

export type TecnicaQuestion = {
  id: string;
  type: TecnicaQuestionType;
  area: string;
  question: string;
  options?: { id: string; text: string }[];
  correct_option_id?: string;
  style_axis?: 'autonomy_vs_consult';
};

export const TECNICA_QUESTIONS: Record<string, TecnicaQuestion[]> = {
  job_1: [
    {
      id: 't1',
      type: 'multiple_choice',
      area: 'JavaScript',
      question: '¿Cuál es la diferencia principal entre `let` y `const` en JavaScript?',
      options: [
        { id: 'a', text: '`let` permite reasignar la variable, `const` no (pero el contenido de objetos/arrays sí puede mutar)' },
        { id: 'b', text: '`const` solo se puede usar para números, `let` para cualquier tipo' },
        { id: 'c', text: 'No hay diferencia, son sinónimos' },
        { id: 'd', text: '`let` es más rápido en runtime' },
      ],
      correct_option_id: 'a',
    },
    {
      id: 't2',
      type: 'multiple_choice',
      area: 'React',
      question: 'Tenés un componente que re-renderiza demasiado seguido. ¿Cuál es la primera herramienta que usarías para diagnosticar?',
      options: [
        { id: 'a', text: 'console.log dentro del componente' },
        { id: 'b', text: 'React DevTools Profiler' },
        { id: 'c', text: 'Reescribir el componente con clases' },
        { id: 'd', text: 'Cambiar el estado a Redux' },
      ],
      correct_option_id: 'b',
    },
    {
      id: 't3',
      type: 'multiple_choice',
      area: 'Bases de datos',
      question: 'Una query SQL está corriendo a 5 segundos cuando antes corría a 50ms. ¿Cuál sería tu primer paso?',
      options: [
        { id: 'a', text: 'Reescribirla desde cero' },
        { id: 'b', text: 'Pedirle al DBA que revise' },
        { id: 'c', text: 'Correr EXPLAIN/EXPLAIN ANALYZE para ver el query plan' },
        { id: 'd', text: 'Agregar más recursos al servidor' },
      ],
      correct_option_id: 'c',
    },
    {
      id: 't4',
      type: 'situational',
      area: 'Toma de decisiones técnicas',
      question: 'Tenés que elegir entre dos librerías. La opción A es popular pero el equipo no la conoce. La opción B es menos popular pero el equipo ya tiene experiencia. El tiempo es ajustado. ¿Qué hacés?',
      options: [
        { id: 'a', text: 'Voy con A porque es la industry standard y vale la pena aprender' },
        { id: 'b', text: 'Voy con B porque ahorramos tiempo y el equipo ejecuta más rápido' },
        { id: 'c', text: 'Hago un PoC corto de cada una con el equipo y decidimos juntos' },
        { id: 'd', text: 'Le pregunto al CTO qué prefiere' },
      ],
      style_axis: 'autonomy_vs_consult',
    },
    {
      id: 't5',
      type: 'open_ended',
      area: 'Arquitectura',
      question: 'Describí en 3-4 líneas cómo diseñarías el endpoint para que un usuario pueda ver "todos sus pedidos del último mes" en una app de e-commerce con 1M de usuarios.',
    },
    {
      id: 't6',
      type: 'multiple_choice',
      area: 'Performance',
      question: 'Una página tarda 4 segundos en cargar. El bundle JS es de 2.5MB. ¿Qué optimización tendría más impacto inmediato?',
      options: [
        { id: 'a', text: 'Code splitting + lazy loading de rutas' },
        { id: 'b', text: 'Cambiar de React a Vue' },
        { id: 'c', text: 'Usar minify + gzip (ya están)' },
        { id: 'd', text: 'Comprimir imágenes' },
      ],
      correct_option_id: 'a',
    },
  ],
};

// ============== VELNA questions ==============
// 5 sub-tests timed: Verbal / Espacial / Lógica / Numérica / Abstracta.

export type VelnaSubtestKey = 'verbal' | 'espacial' | 'logica' | 'numerica' | 'abstracta';

export type VelnaQuestion = {
  id: string;
  question: string;
  options: { id: string; text: string }[];
  correct_option_id: string;
};

export type VelnaSubtest = {
  key: VelnaSubtestKey;
  label: string;
  description: string;
  duration_sec: number;
  questions: VelnaQuestion[];
};

export const VELNA_SUBTESTS: VelnaSubtest[] = [
  {
    key: 'verbal',
    label: 'Verbal',
    description: 'Comprensión lectora, sinónimos y vocabulario.',
    duration_sec: 300,
    questions: [
      { id: 'v1', question: '¿Cuál es el sinónimo más cercano de "perspicaz"?', options: [{ id: 'a', text: 'Lento' }, { id: 'b', text: 'Astuto' }, { id: 'c', text: 'Confuso' }, { id: 'd', text: 'Distraído' }], correct_option_id: 'b' },
      { id: 'v2', question: 'Si "todos los gatos son mamíferos" y "Mishi es un gato", entonces:', options: [{ id: 'a', text: 'Mishi puede ser un mamífero' }, { id: 'b', text: 'Mishi es un mamífero' }, { id: 'c', text: 'Mishi no es un mamífero' }, { id: 'd', text: 'Falta información' }], correct_option_id: 'b' },
      { id: 'v3', question: '"Su discurso fue conciso pero contundente." ¿Qué significa "conciso"?', options: [{ id: 'a', text: 'Largo y elaborado' }, { id: 'b', text: 'Confuso' }, { id: 'c', text: 'Breve y al punto' }, { id: 'd', text: 'Apasionado' }], correct_option_id: 'c' },
    ],
  },
  {
    key: 'espacial',
    label: 'Espacial',
    description: 'Razonamiento con formas, rotación y distancias.',
    duration_sec: 300,
    questions: [
      { id: 'e1', question: 'Si rotás un cuadrado 90° en sentido horario, ¿qué obtenés?', options: [{ id: 'a', text: 'Un cuadrado (igual)' }, { id: 'b', text: 'Un círculo' }, { id: 'c', text: 'Un triángulo' }, { id: 'd', text: 'Un rectángulo' }], correct_option_id: 'a' },
      { id: 'e2', question: 'Imaginá un cubo. ¿Cuántas caras tiene?', options: [{ id: 'a', text: '4' }, { id: 'b', text: '6' }, { id: 'c', text: '8' }, { id: 'd', text: '12' }], correct_option_id: 'b' },
      { id: 'e3', question: 'Si caminás 100m al norte, después 50m al este, después 100m al sur, ¿a qué distancia estás del punto de partida?', options: [{ id: 'a', text: '0m' }, { id: 'b', text: '50m' }, { id: 'c', text: '150m' }, { id: 'd', text: '250m' }], correct_option_id: 'b' },
    ],
  },
  {
    key: 'logica',
    label: 'Lógica',
    description: 'Patrones, secuencias y razonamiento deductivo.',
    duration_sec: 300,
    questions: [
      { id: 'l1', question: '¿Qué número sigue en la secuencia: 2, 4, 8, 16, ?', options: [{ id: 'a', text: '24' }, { id: 'b', text: '32' }, { id: 'c', text: '20' }, { id: 'd', text: '64' }], correct_option_id: 'b' },
      { id: 'l2', question: 'Si "ningún A es B" y "todo C es A", entonces:', options: [{ id: 'a', text: 'Algún C es B' }, { id: 'b', text: 'Ningún C es B' }, { id: 'c', text: 'Todo C es B' }, { id: 'd', text: 'No se puede determinar' }], correct_option_id: 'b' },
      { id: 'l3', question: 'Tres amigos comen pizza. Ana come 2 porciones, Bea el doble que Ana, y Carlos 1 menos que Bea. ¿Cuántas come Carlos?', options: [{ id: 'a', text: '2' }, { id: 'b', text: '3' }, { id: 'c', text: '4' }, { id: 'd', text: '5' }], correct_option_id: 'b' },
    ],
  },
  {
    key: 'numerica',
    label: 'Numérica',
    description: 'Cálculo, porcentajes y razonamiento cuantitativo.',
    duration_sec: 300,
    questions: [
      { id: 'n1', question: '¿Cuál es el 15% de 240?', options: [{ id: 'a', text: '24' }, { id: 'b', text: '36' }, { id: 'c', text: '40' }, { id: 'd', text: '48' }], correct_option_id: 'b' },
      { id: 'n2', question: 'Una camisa cuesta $80 con 20% descuento. ¿Cuál era el precio original?', options: [{ id: 'a', text: '$96' }, { id: 'b', text: '$100' }, { id: 'c', text: '$108' }, { id: 'd', text: '$120' }], correct_option_id: 'b' },
      { id: 'n3', question: 'Si un auto recorre 360km en 4 horas, ¿cuántos km recorre en 6 horas a la misma velocidad?', options: [{ id: 'a', text: '480km' }, { id: 'b', text: '540km' }, { id: 'c', text: '600km' }, { id: 'd', text: '720km' }], correct_option_id: 'b' },
    ],
  },
  {
    key: 'abstracta',
    label: 'Abstracta',
    description: 'Reconocimiento de patrones y razonamiento abstracto.',
    duration_sec: 300,
    questions: [
      { id: 'a1', question: 'Si en una serie A=1, B=2, C=3..., ¿cuánto es Z?', options: [{ id: 'a', text: '20' }, { id: 'b', text: '24' }, { id: 'c', text: '26' }, { id: 'd', text: '28' }], correct_option_id: 'c' },
      { id: 'a2', question: '¿Qué letra completa el patrón: A, C, E, G, ?', options: [{ id: 'a', text: 'H' }, { id: 'b', text: 'I' }, { id: 'c', text: 'J' }, { id: 'd', text: 'K' }], correct_option_id: 'b' },
      { id: 'a3', question: 'Si △ + △ = ◇, y ◇ + ◇ = ☆, entonces ☆ equivale a:', options: [{ id: 'a', text: '2 △' }, { id: 'b', text: '3 △' }, { id: 'c', text: '4 △' }, { id: 'd', text: '6 △' }], correct_option_id: 'c' },
    ],
  },
];

// ============== Video questions ==============
// 7 preguntas dinámicas generadas por IA según los resultados previos del candidato.
// Categorías: technical, weakness_followup, situational, cv_claim_check, integrity_check, english_check.
// 2 intentos por pregunta. Máx 90 segundos por respuesta. 3 modalidades: video/audio/texto.

export type VideoCategory = 'technical' | 'weakness_followup' | 'situational' | 'cv_claim_check' | 'integrity_check' | 'english_check';

export type VideoQuestion = {
  id: string;
  order: number;
  category: VideoCategory;
  category_label: string;
  question: string;
  context_hint?: string;
  max_seconds: number;
};

export const VIDEO_QUESTIONS: VideoQuestion[] = [
  {
    id: 'vq1',
    order: 1,
    category: 'technical',
    category_label: 'Técnica',
    question: 'Contame de un proyecto donde tuviste que tomar decisiones de arquitectura. ¿Cuál fue el trade-off más difícil y cómo lo resolviste?',
    context_hint: 'Tu prueba técnica salió alta. Queremos ver cómo razonás en problemas reales.',
    max_seconds: 90,
  },
  {
    id: 'vq2',
    order: 2,
    category: 'weakness_followup',
    category_label: 'Profundización',
    question: 'En tu evaluación cognitiva, la sub-prueba de Numérica salió debajo del promedio. Contanos cómo manejás situaciones donde tenés que tomar decisiones con datos numéricos.',
    context_hint: 'No te preocupes, es una pregunta abierta. Queremos entender, no juzgar.',
    max_seconds: 90,
  },
  {
    id: 'vq3',
    order: 3,
    category: 'situational',
    category_label: 'Situacional',
    question: 'Imaginá: tu jefe te pide que hagas algo que vos creés que no es la mejor decisión técnica. ¿Cómo lo manejarías?',
    max_seconds: 90,
  },
  {
    id: 'vq4',
    order: 4,
    category: 'cv_claim_check',
    category_label: 'Verificación CV',
    question: 'En tu CV decís que lideraste un equipo de 5 personas en tu rol anterior. Contame del proyecto más complejo que dirigiste y cómo manejaste los conflictos del equipo.',
    context_hint: 'Esta pregunta valida lo que pusiste en tu CV — no necesitás citar al pie de la letra.',
    max_seconds: 90,
  },
  {
    id: 'vq5',
    order: 5,
    category: 'integrity_check',
    category_label: 'Coherencia',
    question: 'En la prueba de integridad respondiste que "siempre dirías la verdad sin importar las consecuencias". Contame de una vez en que la verdad te trajo una consecuencia incómoda en el trabajo.',
    context_hint: 'Profundizamos para ver consistencia entre lo que decís y lo que hacés.',
    max_seconds: 90,
  },
  {
    id: 'vq6',
    order: 6,
    category: 'situational',
    category_label: 'Situacional',
    question: 'Si tuvieras que aprender una tecnología totalmente nueva en 2 semanas para entregar un proyecto crítico, ¿cómo lo abordarías?',
    max_seconds: 90,
  },
  {
    id: 'vq7',
    order: 7,
    category: 'english_check',
    category_label: 'Inglés',
    question: 'Tell us briefly, in English, why you would be a good fit for this role.',
    context_hint: 'El puesto requiere inglés. Hablanos brevemente en inglés.',
    max_seconds: 60,
  },
];

// ============== Integridad questions ==============
// Likert-scale (1-5) sobre situaciones laborales y conductas.
// Algunas preguntas son detectores de "buena impresión" (deseabilidad social)
// — respuestas extremas en estas levantan flag.

export type IntegrityQuestion = {
  id: string;
  text: string;
  dimension: string; // ej: 'Honestidad', 'Hurto', 'Soborno', 'Buena impresión'
  is_social_desirability_check: boolean; // true = detector de buena impresión
};

export const INTEGRITY_QUESTIONS: IntegrityQuestion[] = [
  { id: 'i1', text: 'Si encuentro una billetera con dinero en la oficina, la entregaría intacta a recursos humanos.', dimension: 'Honestidad', is_social_desirability_check: true },
  { id: 'i2', text: 'A veces uso recursos de la oficina (impresora, internet) para asuntos personales.', dimension: 'Honestidad', is_social_desirability_check: false },
  { id: 'i3', text: 'Nunca he llegado tarde al trabajo en mi vida.', dimension: 'Confiabilidad', is_social_desirability_check: true },
  { id: 'i4', text: 'Si veo que un compañero está cometiendo un error que afecta al cliente, le aviso aunque no sea mi responsabilidad.', dimension: 'Inteligencia social', is_social_desirability_check: false },
  { id: 'i5', text: 'Aceptaría un regalo significativo de un proveedor si nadie se entera.', dimension: 'Soborno', is_social_desirability_check: false },
  { id: 'i6', text: 'Siempre digo la verdad, sin importar las consecuencias.', dimension: 'Autenticidad', is_social_desirability_check: true },
  { id: 'i7', text: 'Si llego antes que mi jefe a la oficina, dedico ese tiempo extra a tareas personales.', dimension: 'Ética profesional', is_social_desirability_check: false },
  { id: 'i8', text: 'En el último año he consumido alcohol durante horas laborales.', dimension: 'Alcohol', is_social_desirability_check: false },
  { id: 'i9', text: 'Considero que las políticas de la empresa son guías que se pueden flexibilizar según el contexto.', dimension: 'Imparcialidad', is_social_desirability_check: false },
  { id: 'i10', text: 'Nunca he criticado a un colega por la espalda.', dimension: 'Sencillez', is_social_desirability_check: true },
  { id: 'i11', text: 'Si encuentro información confidencial fuera de lugar, la leería antes de devolverla.', dimension: 'Confiabilidad', is_social_desirability_check: false },
  { id: 'i12', text: 'En momentos de presión, mantengo la calma incluso cuando los demás no.', dimension: 'Dominio personal', is_social_desirability_check: true },
];

// ============== DISC questions ==============
// 24 preguntas típicas de DISC (forced choice). Cada pregunta tiene 4 adjetivos,
// uno por cada dimensión. Candidato elige "más como yo" y "menos como yo".
// Aquí mockeamos 8 representativas para el demo.

export type DiscOption = {
  label: string;
  axis: 'd' | 'i' | 's' | 'c';
};

export type DiscQuestion = {
  id: string;
  options: [DiscOption, DiscOption, DiscOption, DiscOption];
};

export const DISC_QUESTIONS: DiscQuestion[] = [
  {
    id: 'q1',
    options: [
      { label: 'Decidido', axis: 'd' },
      { label: 'Sociable', axis: 'i' },
      { label: 'Paciente', axis: 's' },
      { label: 'Preciso', axis: 'c' },
    ],
  },
  {
    id: 'q2',
    options: [
      { label: 'Competitivo', axis: 'd' },
      { label: 'Persuasivo', axis: 'i' },
      { label: 'Leal', axis: 's' },
      { label: 'Analítico', axis: 'c' },
    ],
  },
  {
    id: 'q3',
    options: [
      { label: 'Directo', axis: 'd' },
      { label: 'Optimista', axis: 'i' },
      { label: 'Calmado', axis: 's' },
      { label: 'Sistemático', axis: 'c' },
    ],
  },
  {
    id: 'q4',
    options: [
      { label: 'Audaz', axis: 'd' },
      { label: 'Entusiasta', axis: 'i' },
      { label: 'Estable', axis: 's' },
      { label: 'Cuidadoso', axis: 'c' },
    ],
  },
  {
    id: 'q5',
    options: [
      { label: 'Asertivo', axis: 'd' },
      { label: 'Animado', axis: 'i' },
      { label: 'Considerado', axis: 's' },
      { label: 'Lógico', axis: 'c' },
    ],
  },
  {
    id: 'q6',
    options: [
      { label: 'Independiente', axis: 'd' },
      { label: 'Carismático', axis: 'i' },
      { label: 'Constante', axis: 's' },
      { label: 'Detallista', axis: 'c' },
    ],
  },
  {
    id: 'q7',
    options: [
      { label: 'Resuelto', axis: 'd' },
      { label: 'Influyente', axis: 'i' },
      { label: 'Tolerante', axis: 's' },
      { label: 'Estructurado', axis: 'c' },
    ],
  },
  {
    id: 'q8',
    options: [
      { label: 'Pionero', axis: 'd' },
      { label: 'Comunicativo', axis: 'i' },
      { label: 'Servicial', axis: 's' },
      { label: 'Reflexivo', axis: 'c' },
    ],
  },
];
