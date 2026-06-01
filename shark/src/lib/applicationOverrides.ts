/**
 * Persiste cambios manuales de phase state (drag & drop kanban) en localStorage.
 * Cuando exista backend, esta lógica se reemplaza por PATCH /applications/:id.
 */

import type { Application } from '../data/mockApplications';

type PhaseStateOverride = Partial<{
  tecnica_state: Application['tecnica_state'];
  conductual_state: Application['conductual_state'];
  integridad_state: Application['integridad_state'];
}>;

const STORAGE_KEY = 'app_phase_overrides';

function readAll(): Record<string, PhaseStateOverride> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PhaseStateOverride>) : {};
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, PhaseStateOverride>): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function applyPhaseOverrides(apps: Application[]): Application[] {
  const overrides = readAll();
  return apps.map((app) => {
    const o = overrides[app.id];
    return o ? { ...app, ...o } : app;
  });
}

export function setPhaseState(
  appId: string,
  phase: 'tecnica' | 'conductual' | 'integridad',
  newState: string,
): void {
  const all = readAll();
  const current = all[appId] ?? {};
  const key = `${phase}_state` as 'tecnica_state' | 'conductual_state' | 'integridad_state';
  all[appId] = { ...current, [key]: newState as Application['tecnica_state'] };
  writeAll(all);
}

export function clearPhaseOverrides(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
