export type NotifType =
  | 'drafts'
  | 'bot_review'
  | 'finalists'
  | 'inbox'
  | 'feedback'
  | 'auto_rejected'
  | 'mindset_flag'
  | 'english_failed'
  | 'cheating_flag'
  | 'lead_captured';

export type NotifPrefs = Record<NotifType, boolean>;

export const ALL_TYPES: NotifType[] = [
  'drafts',
  'bot_review',
  'finalists',
  'inbox',
  'feedback',
  'auto_rejected',
  'mindset_flag',
  'english_failed',
  'cheating_flag',
  'lead_captured',
];

export const TYPE_LABELS: Record<NotifType, string> = {
  drafts: 'Drafts pendientes de revisar',
  bot_review: 'Decisiones del bot con baja confianza',
  finalists: 'Finalistas listos para entrevista',
  inbox: 'Mensajes outbound sin responder',
  feedback: 'Feedback nuevo de clientes',
  auto_rejected: 'Candidato auto-rechazado por reglas del puesto',
  mindset_flag: 'Candidato con mentalidades predominantemente limitantes',
  english_failed: 'Candidato no alcanzó el nivel de inglés requerido',
  cheating_flag: 'Posible cheating detectado (paste, focus loss, IA-like text)',
  lead_captured: 'Nuevo lead capturado en marketing landing',
};

const PREFS_KEY = 'notif_prefs';
const READ_KEY = 'notif_read_ids';

export function getNotifPrefs(): NotifPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaultPrefs();
    const parsed = JSON.parse(raw) as Partial<NotifPrefs>;
    return { ...defaultPrefs(), ...parsed };
  } catch {
    return defaultPrefs();
  }
}

export function setNotifPrefs(prefs: NotifPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function defaultPrefs(): NotifPrefs {
  return {
    drafts: true,
    bot_review: true,
    finalists: true,
    inbox: true,
    feedback: true,
    auto_rejected: true,
    mindset_flag: false,  // off por default — solo flag, no urgente
    english_failed: false, // off por default — Cris decide en reporte
    cheating_flag: true,   // on por default — siempre saber si hay sospecha
    lead_captured: true,
  };
}

export function getReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function markAsRead(id: string): void {
  const ids = getReadIds();
  ids.add(id);
  localStorage.setItem(READ_KEY, JSON.stringify([...ids]));
}

export function markAllAsRead(ids: string[]): void {
  const set = getReadIds();
  ids.forEach((id) => set.add(id));
  localStorage.setItem(READ_KEY, JSON.stringify([...set]));
}

export function clearReadIds(): void {
  localStorage.removeItem(READ_KEY);
}
