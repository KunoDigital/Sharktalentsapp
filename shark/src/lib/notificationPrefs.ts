export type NotifType = 'drafts' | 'bot_review' | 'finalists' | 'inbox' | 'feedback';

export type NotifPrefs = Record<NotifType, boolean>;

export const ALL_TYPES: NotifType[] = ['drafts', 'bot_review', 'finalists', 'inbox', 'feedback'];

export const TYPE_LABELS: Record<NotifType, string> = {
  drafts: 'Drafts pendientes de revisar',
  bot_review: 'Decisiones del bot con baja confianza',
  finalists: 'Finalistas listos para entrevista',
  inbox: 'Mensajes outbound sin responder',
  feedback: 'Feedback nuevo de clientes',
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
  return { drafts: true, bot_review: true, finalists: true, inbox: true, feedback: true };
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
