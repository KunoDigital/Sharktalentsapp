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
