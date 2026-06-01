/**
 * API client tipado para los 2 tests nuevos del candidato:
 *   - Test de Mentalidades (POST /test/<token>/mindset/submit)
 *   - Test de Inglés (POST /test/<token>/english/submit)
 *
 * Estos endpoints son públicos (token-signed), no requieren Clerk auth.
 *
 * Ver doc backend: functions/api/src/features/{mindsetTest,englishTest}.ts
 */

import { config } from '../config';

const API_BASE = config.apiBase;

// ===== Mindset =====

export type Mentalidad =
  | 'fija' | 'crecimiento'
  | 'experto' | 'curiosa'
  | 'reactiva' | 'creativa'
  | 'victima' | 'agente'
  | 'escasez' | 'abundancia'
  | 'certeza' | 'exploracion'
  | 'proteccion' | 'oportunidad';

export type MindsetAnswer = {
  question_id: string;
  chosen_mentalidad: Mentalidad;
};

export type MindsetSubmitResponse = {
  result_id: string;
  adaptability_score_pct: number;
  adaptability_pattern: 'adaptable' | 'mixto' | 'limitante';
  perfil: Record<Mentalidad, number>;
};

export async function submitMindsetTest(
  token: string,
  answers: MindsetAnswer[],
): Promise<MindsetSubmitResponse> {
  const url = `${API_BASE}/test/${encodeURIComponent(token)}/mindset/submit`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  });
  if (!res.ok) {
    throw new Error(`mindset submit failed: HTTP ${res.status}`);
  }
  return (await res.json()) as MindsetSubmitResponse;
}

// ===== English =====

export type CefrLevel = 'A2' | 'B1' | 'B2' | 'C1';

export type EnglishSubmitInput = {
  level: CefrLevel;
  mc_correct: number;
  mc_total: number;
  listening_correct: number;
  listening_total: number;
  writing_text: string;
  writing_word_count: number;
  writing_time_seconds: number;
  writing_paste_attempts?: number;
  writing_focus_lost_count?: number;
  audio_listening_id?: string;
};

export type EnglishSubmitResponse = {
  result_id: string;
  level: CefrLevel;
  total_score_pct: number;
  threshold_pct: number;
  passed: boolean;
};

export async function submitEnglishTest(
  token: string,
  input: EnglishSubmitInput,
): Promise<EnglishSubmitResponse> {
  const url = `${API_BASE}/test/${encodeURIComponent(token)}/english/submit`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`english submit failed: HTTP ${res.status}`);
  }
  return (await res.json()) as EnglishSubmitResponse;
}
