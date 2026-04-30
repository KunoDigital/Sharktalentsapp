// Mock outreach campaigns + inbox unificado de respuestas.
// En producción esto viene del HeyReach API + email + posibles otras fuentes.

export type OutreachCampaignStatus = 'active' | 'paused' | 'closed' | 'draft';

export type OutreachCampaign = {
  id: string;
  name: string;
  job_id?: string;
  provider: 'heyreach' | 'internal';
  status: OutreachCampaignStatus;
  invites_sent: number;
  accepted: number;
  replied: number;
  meeting_booked: number;
  started_at: string;
};

export type OutreachMessageDirection = 'in' | 'out';

export type OutreachMessage = {
  id: string;
  campaign_id: string;
  contact_name: string;
  contact_linkedin?: string;
  contact_company?: string;
  contact_role?: string;
  channel: 'linkedin_dm' | 'email';
  direction: OutreachMessageDirection;
  body: string;
  sent_at: string;
  read: boolean;
  needs_response: boolean;
};

export const MOCK_CAMPAIGNS: OutreachCampaign[] = [
  {
    id: 'camp_1',
    name: 'Banca PyME — México y Colombia',
    job_id: 'job_2',
    provider: 'heyreach',
    status: 'active',
    invites_sent: 28,
    accepted: 14,
    replied: 9,
    meeting_booked: 3,
    started_at: '2026-04-18',
  },
  {
    id: 'camp_2',
    name: 'Fullstack Senior — LATAM',
    job_id: 'job_1',
    provider: 'heyreach',
    status: 'active',
    invites_sent: 35,
    accepted: 21,
    replied: 12,
    meeting_booked: 5,
    started_at: '2026-04-12',
  },
  {
    id: 'camp_3',
    name: 'Pool interno — RRHH hospitalidad',
    provider: 'internal',
    status: 'draft',
    invites_sent: 0,
    accepted: 0,
    replied: 0,
    meeting_booked: 0,
    started_at: '2026-04-29',
  },
];

export const MOCK_MESSAGES: OutreachMessage[] = [
  {
    id: 'msg_1',
    campaign_id: 'camp_1',
    contact_name: 'Patricia Núñez',
    contact_linkedin: 'linkedin.com/in/patricianunez',
    contact_company: 'Banco Andes',
    contact_role: 'Gerente de Cartera Comercial',
    channel: 'linkedin_dm',
    direction: 'in',
    body: 'Hola Cris! Me interesa la oportunidad. Tengo 15 años en banca PyME, dirigía cartera de $80M en mi último rol. ¿Puedes contarme un poco más del puesto?',
    sent_at: '2026-04-19T11:30:00Z',
    read: true,
    needs_response: false,
  },
  {
    id: 'msg_2',
    campaign_id: 'camp_2',
    contact_name: 'Andrés Vivanco',
    contact_linkedin: 'linkedin.com/in/avivanco',
    contact_company: 'TechStartup MX',
    contact_role: 'Senior Fullstack Engineer',
    channel: 'linkedin_dm',
    direction: 'in',
    body: 'Hola, gracias por escribirme. ¿Qué stack usan? ¿Tienen política de remoto LATAM?',
    sent_at: '2026-04-22T14:18:00Z',
    read: false,
    needs_response: true,
  },
  {
    id: 'msg_3',
    campaign_id: 'camp_2',
    contact_name: 'María Lozano',
    contact_linkedin: 'linkedin.com/in/marialozano',
    contact_company: 'Globant',
    contact_role: 'Engineering Lead',
    channel: 'linkedin_dm',
    direction: 'in',
    body: 'No estoy en búsqueda activa pero podría considerar algo bien específico. Cuál es el rango salarial?',
    sent_at: '2026-04-23T10:05:00Z',
    read: false,
    needs_response: true,
  },
  {
    id: 'msg_4',
    campaign_id: 'camp_1',
    contact_name: 'Roberto Salgado',
    contact_company: 'Banco Atlántico',
    channel: 'linkedin_dm',
    direction: 'in',
    body: 'No me interesa por ahora, pero gracias.',
    sent_at: '2026-04-24T09:00:00Z',
    read: true,
    needs_response: false,
  },
  {
    id: 'msg_5',
    campaign_id: 'camp_2',
    contact_name: 'Camila Torres',
    contact_company: 'Independiente',
    contact_role: 'Senior Engineer freelance',
    channel: 'linkedin_dm',
    direction: 'in',
    body: 'Hola Cris! Me interesa pero solo si es 100% remoto y full time. Tienes detalles?',
    sent_at: '2026-04-28T16:42:00Z',
    read: false,
    needs_response: true,
  },
];
