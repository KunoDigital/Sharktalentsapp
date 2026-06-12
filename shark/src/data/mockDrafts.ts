// Mock Job Profile Drafts — pendientes de revisión por Cris.
// Flujo: reunión cliente → Zia/Whisper transcribe → IA arma draft → Cris revisa
// (esta pantalla) → manda al cliente → cliente aprueba (mockClientPortals) → job se publica.

export type DraftStatus =
  | 'transcript_pending'   // Reunión terminó, transcript aún procesando
  | 'transcript_ready'     // Transcript listo, IA aún no generó draft
  | 'draft_generated'      // IA generó draft, Cris no lo revisó
  | 'in_review'            // Cris está revisando / editando
  | 'sent_to_client'       // Cris aprobó, mandado al cliente
  | 'client_approved'      // Cliente aprobó, job ready to publish
  | 'client_requested_changes' // Cliente pidió ajustes
  | 'archived';            // Descartado o reagendado

export type TranscriptHighlight = {
  type: 'role' | 'salary' | 'urgency' | 'context' | 'concern';
  text: string;
  position_in_transcript: number; // 0-100, dónde está en la transcripción
};

export type DraftPayload = {
  title: string;
  context: string;
  disc_ideal_text: string; // descripción humana
  disc_ideal_d: number;
  disc_ideal_i: number;
  disc_ideal_s: number;
  disc_ideal_c: number;
  pk_profile_code: string;
  pk_profile_name: string;
  velna_ideal: {
    verbal: number;
    espacial: number;
    logica: number;
    numerica: number;
    abstracta: number;
  };
  competencias: { name: string; required_pct: number }[];
  salary_range_min_usd: number;
  salary_range_max_usd: number;
  modalidad: 'Presencial' | 'Híbrido' | 'Remoto';
  ubicacion: string;
  tecnica_minimo_pct: number;
  fee_usd?: number;
};

export type Draft = {
  id: string;
  client_name: string;
  client_email: string;
  client_company: string;
  meeting_date: string;
  meeting_duration_min: number;
  transcript_source: 'zia' | 'whisper_fallback';
  transcript: string; // texto completo de la reunión
  highlights: TranscriptHighlight[]; // IA marca partes clave
  status: DraftStatus;
  draft?: DraftPayload; // null si transcript aún no generó draft
  created_at: string;
  ia_summary_meeting: string; // 1 párrafo: "qué pasó en la reunión"
  ia_concerns?: string[]; // cosas raras que la IA detectó (ej: rango salarial confuso)
};

export const MOCK_DRAFTS: Draft[] = [
  {
    id: 'draft_1',
    client_name: 'Marisela Quintero',
    client_email: 'mquintero@hotelpacifica.com',
    client_company: 'Hotel Pacifica Resort',
    meeting_date: '2026-04-28',
    meeting_duration_min: 47,
    transcript_source: 'zia',
    status: 'draft_generated',
    created_at: '2026-04-28',
    ia_summary_meeting:
      'Marisela explicó que Hotel Pacifica Resort necesita un Jefe de RRHH para liderar todo el departamento en Bocas del Toro. El reto principal es la rotación alta de personal de temporada (60% en pico verano). Buscan a alguien empático, bilingüe español-inglés, con experiencia en manejo de equipos multiculturales. Modalidad presencial. Salario mencionado entre $2500-3500. Urgencia media: necesita estar contratado antes de junio.',
    ia_concerns: [
      'Marisela mencionó "no me convencen los CVs muy corporativos" — verificar si rechazaría candidatos de cadenas grandes',
      'Rango salarial $2500-3500: el extremo bajo puede ser apretado para alguien con experiencia bilingüe',
    ],
    transcript: `[00:00] Cris: Hola Marisela, gracias por agendar. Contame del puesto.
[00:23] Marisela: Hola Cris, mira, necesitamos un jefe de RRHH para Hotel Pacifica acá en Bocas. La situación es complicada porque manejamos 200 personas en temporada alta y la rotación nos está matando.
[01:10] Cris: ¿Qué tan alta?
[01:14] Marisela: Mira, en pico de verano subimos a 60% rotación en limpieza y alimentos. Es un drama. La persona anterior renunció hace 2 meses y desde entonces estoy yo cubriendo, pero ya no doy abasto.
[02:30] Cris: Entiendo. ¿Qué perfil estás buscando?
[02:35] Marisela: Necesito alguien empático, que sepa escuchar. Tenemos colaboradores indígenas locales y también expats europeos, son culturas distintas. La persona tiene que ser bilingüe español-inglés sí o sí, no negociable.
[04:15] Marisela: Lo que me preocupa es que los CVs típicos de hotelería corporativa no me funcionan. Vienen muy formateados, con esa cosa de "best practices" que no aplican acá. Acá es más artesanal, más humano.
[06:00] Cris: ¿Modalidad?
[06:02] Marisela: Presencial. Necesito alguien acá en Bocas. Eso reduce el pool, ya sé. A veces va a tener que viajar a Ciudad de Panamá una vez al mes.
[07:30] Cris: ¿Salario?
[07:35] Marisela: Entre 2500 y 3500. Más eso ya es mucho para nuestro tamaño.
[08:10] Cris: ¿Urgencia?
[08:13] Marisela: Antes de junio. Idealmente mayo. La temporada pega fuerte en junio.
[10:20] Marisela: Una cosa más: necesito que sepa de payroll variable. Por la temporada hay mucho contrato temporal.
[15:40] Marisela: Y resolución de conflictos. Tenemos el típico tema de roces entre el equipo de cocina vs el de servicio.
[22:10] Cris: ¿Algo más sobre el ambiente del hotel?
[22:14] Marisela: Mira, el dueño es muy exigente con la experiencia del huésped. Quiere que el equipo esté motivado, sienta el lugar. La persona de RRHH tiene que entender eso, no es solo administrar payroll.
[35:00] Cris: ¿Qué te frustró del anterior?
[35:05] Marisela: Era muy ejecutor, muy "checklist". Le faltaba lectura humana. Por eso me importa mucho lo empático.
[42:30] Cris: Bueno Marisela, te mando el draft del perfil esta semana.`,
    highlights: [
      { type: 'role', text: 'Jefe de RRHH para Hotel Pacifica, Bocas del Toro', position_in_transcript: 1 },
      { type: 'context', text: 'Rotación 60% en pico de verano', position_in_transcript: 8 },
      { type: 'context', text: 'Equipo multicultural: indígenas locales + expats europeos', position_in_transcript: 18 },
      { type: 'context', text: 'Bilingüe español-inglés OBLIGATORIO', position_in_transcript: 22 },
      { type: 'concern', text: 'No quiere "CVs corporativos" — más artesanal/humano', position_in_transcript: 30 },
      { type: 'context', text: 'Modalidad presencial en Bocas + 1 viaje/mes a Panamá', position_in_transcript: 40 },
      { type: 'salary', text: '$2500–$3500/mes', position_in_transcript: 48 },
      { type: 'urgency', text: 'Antes de junio, idealmente mayo', position_in_transcript: 52 },
      { type: 'context', text: 'Necesita conocer payroll variable', position_in_transcript: 60 },
      { type: 'context', text: 'Anterior era muy "checklist" — falta lectura humana', position_in_transcript: 85 },
    ],
    draft: {
      title: 'Jefe de Recursos Humanos',
      context:
        'Hotel Pacifica Resort, 200 colaboradores en temporada alta, ubicado en Bocas del Toro. Necesitan jefe de RRHH para liderar todo el departamento. Reto principal: rotación 60% en pico verano. El dueño exige equipos motivados que transmitan la experiencia del huésped. La persona anterior fue muy "checklist", faltó lectura humana — Marisela busca empatía y sensibilidad cultural.',
      disc_ideal_text:
        'Persona empática y coordinadora (PK-12: Empático/a — Coordinador/a). Combinación I-S balanceada, capaz de escuchar activamente y resolver conflictos con calma. Maneja equipos multiculturales (colaboradores indígenas locales + expats europeos). Necesita lectura humana, no solo cumplir checklists.',
      disc_ideal_d: 50,
      disc_ideal_i: 70,
      disc_ideal_s: 70,
      disc_ideal_c: 40,
      pk_profile_code: 'PK-12',
      pk_profile_name: 'Empático/a — Coordinador/a',
      velna_ideal: { verbal: 85, espacial: 60, logica: 70, numerica: 60, abstracta: 70 },
      competencias: [
        { name: 'Resolución de conflictos en ambientes multiculturales', required_pct: 80 },
        { name: 'Gestión de rotación de temporada (60% pico)', required_pct: 75 },
        { name: 'Comunicación bilingüe español-inglés', required_pct: 90 },
        { name: 'Planificación de payroll variable', required_pct: 70 },
        { name: 'Liderazgo empático con equipos no-corporativos', required_pct: 80 },
      ],
      salary_range_min_usd: 2500,
      salary_range_max_usd: 3500,
      modalidad: 'Presencial',
      ubicacion: 'Bocas del Toro, Panamá (con viajes mensuales a Ciudad de Panamá)',
      tecnica_minimo_pct: 50,
    },
  },
  {
    id: 'draft_2',
    client_name: 'Roberto Salazar',
    client_email: 'rsalazar@startuplatam.com',
    client_company: 'Startup LATAM',
    meeting_date: '2026-04-29',
    meeting_duration_min: 32,
    transcript_source: 'whisper_fallback',
    status: 'transcript_ready',
    created_at: '2026-04-29',
    ia_summary_meeting:
      'Roberto, fundador de Startup LATAM (e-commerce regional), busca un Head of Growth. Empresa Series A, 25 personas, crecimiento agresivo. Salario hasta $5500. Quiere alguien con experiencia LATAM, no solo USA. Modalidad híbrida CDMX o remota LATAM. Urgencia alta: mes de mayo idealmente.',
    ia_concerns: [
      'Roberto mencionó "performance marketing" varias veces — el rol parece más marketing que growth product',
      'Salario tope $5500 puede ser bajo para Head of Growth con experiencia LATAM senior',
    ],
    transcript: `[00:00] Cris: Roberto, contame de la búsqueda.
[00:18] Roberto: Hola Cris. Necesito un Head of Growth. Estamos en Series A, 25 personas, e-commerce regional, principal mercado México y Colombia.
[01:30] Roberto: La persona que me convence es alguien que ya creció una startup LATAM antes. No me sirven candidatos de USA puro porque el contexto LATAM es muy distinto.
[03:00] Roberto: Las áreas que quiero que dominen: performance marketing, paid ads, SEO, conversion rate optimization. También que sepa de retention y email marketing.
[08:00] Cris: ¿Modalidad?
[08:03] Roberto: Híbrido si es México DF, o remoto LATAM. No buscamos en otros continentes.
[10:00] Cris: Salario?
[10:04] Roberto: Hasta 5500 USD/mes. Más de eso no llegamos.
[15:30] Roberto: La urgencia es alta. Necesito que arranque en mayo, idealmente.
[20:00] Roberto: Quiero a alguien que ya haya manejado presupuestos de paid ads de medio millón mensual.
[28:00] Roberto: Y que sepa hablar el idioma de los founders. No quiero alguien corporativo con powerpoints largos.`,
    highlights: [
      { type: 'role', text: 'Head of Growth para e-commerce LATAM', position_in_transcript: 1 },
      { type: 'context', text: 'Series A, 25 personas', position_in_transcript: 4 },
      { type: 'context', text: 'Mercados: México y Colombia', position_in_transcript: 6 },
      { type: 'context', text: 'Experiencia LATAM obligatoria, NO USA puro', position_in_transcript: 10 },
      { type: 'context', text: 'Performance marketing, paid ads, SEO, CRO', position_in_transcript: 18 },
      { type: 'context', text: 'Híbrido CDMX o remoto LATAM', position_in_transcript: 30 },
      { type: 'salary', text: 'Hasta $5500/mes', position_in_transcript: 38 },
      { type: 'urgency', text: 'Mayo 2026', position_in_transcript: 50 },
      { type: 'context', text: 'Manejado presupuestos $500K+ paid ads', position_in_transcript: 65 },
    ],
    // status = transcript_ready means IA hasn't generated draft yet
  },
  {
    id: 'draft_3',
    client_name: 'Isabel Mata',
    client_email: 'imata@logisticabocas.com',
    client_company: 'Logística Bocas',
    meeting_date: '2026-04-26',
    meeting_duration_min: 28,
    transcript_source: 'zia',
    status: 'sent_to_client',
    created_at: '2026-04-26',
    ia_summary_meeting:
      'Isabel busca Coordinador de Operaciones Logísticas para sucursal Bocas. Empresa familiar, 40 empleados. Salario $1500-2200. Modalidad presencial. Urgencia media. Cris ya generó y envió draft al cliente, esperando aprobación.',
    transcript: '[Transcripción guardada — 28 minutos. Ver detalle si necesitás revisar.]',
    highlights: [],
    draft: {
      title: 'Coordinador de Operaciones Logísticas',
      context: 'Logística Bocas, empresa familiar, 40 colaboradores. Necesitan coordinador para sucursal Bocas del Toro. Maneja recepción, inventario y despacho. Reporta a Isabel directamente.',
      disc_ideal_text: 'Persona organizada, sólida bajo presión (PK-08: Preciso/a — Analítico/a — Calidad).',
      disc_ideal_d: 40,
      disc_ideal_i: 30,
      disc_ideal_s: 60,
      disc_ideal_c: 80,
      pk_profile_code: 'PK-08',
      pk_profile_name: 'Preciso/a — Analítico/a — Calidad',
      velna_ideal: { verbal: 60, espacial: 70, logica: 80, numerica: 85, abstracta: 65 },
      competencias: [
        { name: 'Gestión de inventario', required_pct: 75 },
        { name: 'Coordinación logística', required_pct: 70 },
        { name: 'Atención al detalle', required_pct: 80 },
        { name: 'Resolución bajo presión', required_pct: 70 },
        { name: 'Comunicación con proveedores', required_pct: 65 },
      ],
      salary_range_min_usd: 1500,
      salary_range_max_usd: 2200,
      modalidad: 'Presencial',
      ubicacion: 'Bocas del Toro',
      tecnica_minimo_pct: 60,
    },
  },
];

export function getDraftById(id: string): Draft | undefined {
  return MOCK_DRAFTS.find((d) => d.id === id);
}

export const STATUS_LABELS: Record<DraftStatus, string> = {
  transcript_pending: 'Transcribiendo reunión…',
  transcript_ready: 'Transcript listo — IA generando draft',
  draft_generated: 'Draft listo para revisar',
  in_review: 'En revisión',
  sent_to_client: 'Enviado al cliente',
  client_approved: 'Aprobado por cliente',
  client_requested_changes: 'Cliente pidió ajustes',
  archived: 'Archivado',
};

export const STATUS_COLOR: Record<DraftStatus, 'warn' | 'good' | 'mid' | 'muted' | 'danger'> = {
  transcript_pending: 'mid',
  transcript_ready: 'mid',
  draft_generated: 'warn',
  in_review: 'warn',
  sent_to_client: 'mid',
  client_approved: 'good',
  client_requested_changes: 'danger',
  archived: 'muted',
};
