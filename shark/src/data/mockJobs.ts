export type JobStatus = 'draft' | 'active' | 'paused' | 'closed';

export type Job = {
  id: string;
  slug: string;
  title: string;
  client_company: string;
  location: string;
  status: JobStatus;
  created_at: string;
  applications_count: number;
  applications_in_progress: number;
  finalists_count: number;
  fee_usd: number;
};

export const MOCK_JOBS: Job[] = [
  {
    id: 'job_1',
    slug: 'desarrollador-fullstack-senior',
    title: 'Desarrollador Fullstack Senior',
    client_company: 'AcmeTech Panamá',
    location: 'Ciudad de Panamá (híbrido)',
    status: 'active',
    created_at: '2026-04-12',
    applications_count: 23,
    applications_in_progress: 8,
    finalists_count: 0,
    fee_usd: 4500,
  },
  {
    id: 'job_2',
    slug: 'gerente-comercial-banca',
    title: 'Gerente Comercial — Banca PyME',
    client_company: 'Banco Pacífico',
    location: 'Ciudad de Panamá (presencial)',
    status: 'active',
    created_at: '2026-04-18',
    applications_count: 14,
    applications_in_progress: 5,
    finalists_count: 3,
    fee_usd: 6800,
  },
  {
    id: 'job_3',
    slug: 'data-engineer-mid',
    title: 'Data Engineer (mid-level)',
    client_company: 'Fintech Caribe',
    location: 'Remoto LATAM',
    status: 'paused',
    created_at: '2026-03-30',
    applications_count: 31,
    applications_in_progress: 0,
    finalists_count: 0,
    fee_usd: 3800,
  },
  {
    id: 'job_4',
    slug: 'jefe-rrhh',
    title: 'Jefe de Recursos Humanos',
    client_company: 'Hotel Pacifica Resort',
    location: 'Bocas del Toro',
    status: 'draft',
    created_at: '2026-04-25',
    applications_count: 0,
    applications_in_progress: 0,
    finalists_count: 0,
    fee_usd: 5200,
  },
];

export function getJobById(id: string): Job | undefined {
  return MOCK_JOBS.find((j) => j.id === id);
}
