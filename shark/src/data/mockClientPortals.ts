// Mock portals de cliente. Token-based access (sin Clerk auth).
// El cliente recibe link tipo: sharktalents.ai/#/portal/<token>
// Cada portal tiene N jobs (puestos) en distintos stages del flujo end-to-end.

export type PortalJobStage =
  | 'profile_pending'    // IA armó draft, cliente debe aprobar
  | 'profile_approved'   // Cliente aprobó, Cris está iniciando búsqueda
  | 'search_started'     // Búsqueda activa, sin candidatos aún
  | 'funnel_active'      // Funnel con candidatos en evaluación
  | 'finalists_ready'    // Finalistas listos, hay reporte
  | 'closed';            // Cerrado (contratado o cancelado)

export type PortalDraftPayload = {
  title: string;
  context_summary: string; // resumen del contexto
  disc_ideal_text: string; // descripción humana del perfil ideal
  competencias_clave: string[];
  salary_range_text: string;
  modalidad: string;
  ubicacion: string;
};

export type PortalFunnelStats = {
  applied: number;
  prefilter_passed: number;
  tecnica_done: number;
  conductual_done: number;
  integridad_done: number;
  finalists: number;
  estimated_finalists_ready: string; // human "en 3-5 días"
};

export type PortalMilestone = {
  key: 'profile_ready' | 'search_started' | 'funnel_active' | 'finalists_ready';
  label: string;
  completed_at: string | null; // null si aún no completado
};

export type PortalJob = {
  id: string;
  job_id: string; // referencia al Job real (mockJobs)
  display_title: string; // título sencillo para el cliente
  stage: PortalJobStage;
  created_at: string;
  // Para profile_pending: el draft que el cliente debe aprobar
  draft?: PortalDraftPayload;
  // Para search_started / funnel_active: stats
  funnel?: PortalFunnelStats;
  // Para finalists_ready: token del reporte
  report_token?: string;
  // Milestones (siempre 4 — los completados tienen completed_at)
  milestones: PortalMilestone[];
};

export type ClientPortal = {
  token: string;
  client_name: string;     // ej: "Carolina Aguilar"
  client_email: string;
  client_company: string;  // ej: "Banco Pacífico"
  agency_name: string;     // ej: "Kuno Digital"
  jobs: PortalJob[];
};

const MILESTONES_TEMPLATE: PortalMilestone[] = [
  { key: 'profile_ready', label: 'Perfil del puesto listo', completed_at: null },
  { key: 'search_started', label: 'Búsqueda iniciada', completed_at: null },
  { key: 'funnel_active', label: 'Candidatos en evaluación', completed_at: null },
  { key: 'finalists_ready', label: 'Finalistas listos', completed_at: null },
];

function withMilestones(updates: Partial<Record<PortalMilestone['key'], string>>): PortalMilestone[] {
  return MILESTONES_TEMPLATE.map((m) => ({ ...m, completed_at: updates[m.key] ?? null }));
}

export const MOCK_PORTALS: Record<string, ClientPortal> = {
  'prt_banco_pacifico': {
    token: 'prt_banco_pacifico',
    client_name: 'Carolina Aguilar',
    client_email: 'caguilar@bancopacifico.com',
    client_company: 'Banco Pacífico',
    agency_name: 'Kuno Digital',
    jobs: [
      {
        id: 'pj_1',
        job_id: 'job_2',
        display_title: 'Gerente Comercial — Banca PyME',
        stage: 'finalists_ready',
        created_at: '2026-04-15',
        report_token: 'rpt_banca_2026_04',
        milestones: withMilestones({
          profile_ready: '2026-04-16',
          search_started: '2026-04-17',
          funnel_active: '2026-04-19',
          finalists_ready: '2026-04-25',
        }),
      },
    ],
  },

  'prt_acmetech': {
    token: 'prt_acmetech',
    client_name: 'Diego Rivera',
    client_email: 'drivera@acmetech.pa',
    client_company: 'AcmeTech Panamá',
    agency_name: 'Kuno Digital',
    jobs: [
      {
        id: 'pj_2',
        job_id: 'job_1',
        display_title: 'Desarrollador Fullstack Senior',
        stage: 'funnel_active',
        created_at: '2026-04-10',
        funnel: {
          applied: 23,
          prefilter_passed: 18,
          tecnica_done: 12,
          conductual_done: 5,
          integridad_done: 2,
          finalists: 0,
          estimated_finalists_ready: 'en 5-7 días',
        },
        milestones: withMilestones({
          profile_ready: '2026-04-11',
          search_started: '2026-04-12',
          funnel_active: '2026-04-15',
        }),
      },
    ],
  },

  'prt_hotel_pacifica': {
    token: 'prt_hotel_pacifica',
    client_name: 'Marisela Quintero',
    client_email: 'mquintero@hotelpacifica.com',
    client_company: 'Hotel Pacifica Resort',
    agency_name: 'Kuno Digital',
    jobs: [
      {
        id: 'pj_3',
        job_id: 'job_4',
        display_title: 'Jefe de Recursos Humanos',
        stage: 'profile_pending',
        created_at: '2026-04-28',
        draft: {
          title: 'Jefe de Recursos Humanos',
          context_summary:
            'Hotel Pacifica Resort, 200 colaboradores en temporada alta, ubicado en Bocas del Toro. Necesitan jefe de RRHH para liderar todo el departamento. Reto principal: rotación alta de personal de temporada (limpieza, alimentos, recepción) que sube a 60% en pico de verano.',
          disc_ideal_text:
            'Persona con perfil empático y coordinador (PK-12: Empático/a — Coordinador/a). Combinación I-S balanceada. Capaz de gestionar conflictos con calma, escuchar activamente y coordinar equipos multiculturales (incluye colaboradores indígenas locales y expats europeos).',
          competencias_clave: [
            'Resolución de conflictos en ambientes multiculturales',
            'Gestión de rotación de temporada (capacidad 60% rotación pico)',
            'Comunicación bilingüe español-inglés',
            'Planificación de payroll variable',
            'Liderazgo empático con equipos no-corporativos',
          ],
          salary_range_text: 'USD $2.500 – $3.500 / mes',
          modalidad: 'Presencial',
          ubicacion: 'Bocas del Toro, Panamá (con viajes mensuales a Ciudad de Panamá)',
        },
        milestones: withMilestones({}),
      },
      {
        id: 'pj_4',
        job_id: 'job_4',
        display_title: 'Recepcionista bilingüe (temporada)',
        stage: 'search_started',
        created_at: '2026-04-22',
        funnel: {
          applied: 4,
          prefilter_passed: 2,
          tecnica_done: 0,
          conductual_done: 0,
          integridad_done: 0,
          finalists: 0,
          estimated_finalists_ready: 'en 10-14 días (puesto recién publicado)',
        },
        milestones: withMilestones({
          profile_ready: '2026-04-23',
          search_started: '2026-04-24',
        }),
      },
    ],
  },
};

export function getPortalByToken(token: string): ClientPortal | undefined {
  return MOCK_PORTALS[token];
}

export function getPortalJob(token: string, jobId: string): { portal: ClientPortal; job: PortalJob } | undefined {
  const portal = getPortalByToken(token);
  if (!portal) return undefined;
  const job = portal.jobs.find((j) => j.id === jobId);
  if (!job) return undefined;
  return { portal, job };
}
