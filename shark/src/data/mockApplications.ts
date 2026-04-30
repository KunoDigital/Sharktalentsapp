export type ApplicationState =
  | 'prefilter_pending'
  | 'prefilter_passed'
  | 'salary_out_of_range'
  | 'disc_completed'
  | 'technical_completed'
  | 'videos_completed'
  | 'bot_decision_advance'
  | 'finalist'
  | 'offered'
  | 'hired'
  | 'auto_rejected_low_score'
  | 'rejected_by_admin';

export type ApplicationSource =
  | 'recruit_free'
  | 'linkedin_paid'
  | 'outbound_heyreach'
  | 'outbound_internal'
  | 'direct';

export type Application = {
  id: string;
  job_id: string;
  candidate_name: string;
  candidate_email: string;
  source: ApplicationSource;
  state: ApplicationState;
  applied_at: string;
  disc_summary?: string;
  technical_score?: number;
  integrity_score?: number;
  bot_confidence?: number;
};

const PIPELINE_AcmeTech: Application[] = [
  {
    id: 'app_1',
    job_id: 'job_1',
    candidate_name: 'Carla Méndez',
    candidate_email: 'carla.m@gmail.com',
    source: 'linkedin_paid',
    state: 'finalist',
    applied_at: '2026-04-15',
    disc_summary: 'D-alto / I-medio',
    technical_score: 87,
    integrity_score: 92,
    bot_confidence: 0.89,
  },
  {
    id: 'app_2',
    job_id: 'job_1',
    candidate_name: 'Diego Salas',
    candidate_email: 'diego.salas@hotmail.com',
    source: 'recruit_free',
    state: 'technical_completed',
    applied_at: '2026-04-17',
    disc_summary: 'C-alto / S-medio',
    technical_score: 78,
    integrity_score: 85,
    bot_confidence: 0.71,
  },
  {
    id: 'app_3',
    job_id: 'job_1',
    candidate_name: 'Fernanda Ortiz',
    candidate_email: 'forti@protonmail.com',
    source: 'outbound_heyreach',
    state: 'disc_completed',
    applied_at: '2026-04-19',
    disc_summary: 'I-alto / D-medio',
    technical_score: undefined,
    integrity_score: undefined,
  },
  {
    id: 'app_4',
    job_id: 'job_1',
    candidate_name: 'Roberto Wong',
    candidate_email: 'rwong@gmail.com',
    source: 'recruit_free',
    state: 'prefilter_passed',
    applied_at: '2026-04-21',
  },
  {
    id: 'app_5',
    job_id: 'job_1',
    candidate_name: 'Marta Linares',
    candidate_email: 'mlinares@yahoo.com',
    source: 'direct',
    state: 'auto_rejected_low_score',
    applied_at: '2026-04-14',
    disc_summary: 'C-bajo / S-bajo',
    technical_score: 42,
  },
];

const PIPELINE_BancoPacifico: Application[] = [
  {
    id: 'app_10',
    job_id: 'job_2',
    candidate_name: 'Luis Tejada',
    candidate_email: 'ltejada@gmail.com',
    source: 'linkedin_paid',
    state: 'finalist',
    applied_at: '2026-04-19',
    disc_summary: 'D-alto / I-alto',
    technical_score: 91,
    integrity_score: 88,
    bot_confidence: 0.93,
  },
  {
    id: 'app_11',
    job_id: 'job_2',
    candidate_name: 'Patricia Núñez',
    candidate_email: 'pnunez@outlook.com',
    source: 'outbound_internal',
    state: 'finalist',
    applied_at: '2026-04-20',
    disc_summary: 'I-alto / D-medio',
    technical_score: 84,
    integrity_score: 95,
    bot_confidence: 0.86,
  },
  {
    id: 'app_12',
    job_id: 'job_2',
    candidate_name: 'Alejandro Vega',
    candidate_email: 'alejov@gmail.com',
    source: 'recruit_free',
    state: 'finalist',
    applied_at: '2026-04-21',
    disc_summary: 'D-alto / C-medio',
    technical_score: 79,
    integrity_score: 90,
    bot_confidence: 0.81,
  },
];

export const MOCK_APPLICATIONS: Application[] = [...PIPELINE_AcmeTech, ...PIPELINE_BancoPacifico];

export function getApplicationsByJobId(jobId: string): Application[] {
  return MOCK_APPLICATIONS.filter((a) => a.job_id === jobId);
}

export const STATE_LABELS: Record<ApplicationState, string> = {
  prefilter_pending: 'Prefiltro pendiente',
  prefilter_passed: 'Prefiltro OK',
  salary_out_of_range: 'Salario fuera de rango',
  disc_completed: 'DISC completo',
  technical_completed: 'Técnica completa',
  videos_completed: 'Videos completos',
  bot_decision_advance: 'Bot recomienda avanzar',
  finalist: 'Finalista',
  offered: 'Oferta enviada',
  hired: 'Contratado',
  auto_rejected_low_score: 'Auto-rechazado (score bajo)',
  rejected_by_admin: 'Rechazado',
};

export const SOURCE_LABELS: Record<ApplicationSource, string> = {
  recruit_free: 'Recruit (hub gratis)',
  linkedin_paid: 'LinkedIn (Apply pago)',
  outbound_heyreach: 'Outbound HeyReach',
  outbound_internal: 'Pool interno',
  direct: 'Directo (web)',
};
