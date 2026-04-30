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
