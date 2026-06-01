/**
 * Selección aleatoria de preguntas para tests del candidato (frontend).
 *
 * Mirror del backend `lib/questionSelector.ts`. Permite que el frontend pueda
 * elegir N preguntas aleatorias de un banco JSON estático sin pegarle al backend.
 */

export type Question<T extends string = string> = {
  id: string;
  type?: T;
  [key: string]: unknown;
};

/**
 * Fisher-Yates shuffle — devuelve copia del array.
 */
export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Selecciona N preguntas al azar del banco (sin reemplazo).
 */
export function pickRandomFrontend<T extends Question>(bank: T[], count: number): T[] {
  if (count <= 0) return [];
  if (count >= bank.length) return shuffle(bank);
  return shuffle(bank).slice(0, count);
}

/**
 * Selecciona preguntas respetando una distribución por tipo.
 *
 * @example
 *   pickStratifiedFrontend(b2Bank, { vocab: 8, grammar: 8, reading: 4 });
 */
export function pickStratifiedFrontend<T extends Question, K extends string>(
  bank: T[],
  distribution: Record<K, number>,
): T[] {
  const result: T[] = [];
  for (const type in distribution) {
    const count = distribution[type];
    const subset = bank.filter((q) => q.type === type);
    if (subset.length < count) {
      // Fallback graceful: tomar todas las que haya, no throw
      result.push(...subset);
      continue;
    }
    result.push(...pickRandomFrontend(subset, count));
  }
  return shuffle(result);
}
