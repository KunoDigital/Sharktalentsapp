/**
 * Selección aleatoria de preguntas desde un banco — para tests donde solo se muestran
 * N preguntas al candidato de un banco más grande (ej: 20 de 40 en el test de inglés).
 *
 * Garantiza distribución equitativa por tipo cuando se especifica.
 *
 * **No usa randomness criptográfico** — Math.random alcanza para esto. Si en el futuro
 * fuera necesario seed determinístico (para repetir el mismo set en re-tests), agregamos
 * un parámetro `seed`.
 */

export type Question<T extends string = string> = {
  id: string;
  type?: T;
  [key: string]: unknown;
};

/**
 * Selecciona N preguntas al azar de un banco, sin reemplazo.
 *
 * @param bank el banco completo
 * @param count cantidad a seleccionar
 * @returns array de preguntas seleccionadas (orden mezclado)
 */
export function pickRandom<T extends Question>(bank: T[], count: number): T[] {
  if (count <= 0) return [];
  if (count >= bank.length) {
    // Devolver el banco entero, en orden mezclado
    return shuffle(bank);
  }
  const shuffled = shuffle(bank);
  return shuffled.slice(0, count);
}

/**
 * Selecciona preguntas del banco respetando una distribución por tipo.
 *
 * @example
 *   // Tomar 10 vocab + 10 grammar + 5 reading del banco english-b2 (40 questions total)
 *   const selected = pickStratified(b2Bank, { vocab: 10, grammar: 10, reading: 5 });
 *
 * @param bank el banco completo
 * @param distribution mapa de tipo → cantidad
 * @returns array con la distribución requerida (orden mezclado al final)
 */
export function pickStratified<T extends Question, K extends string>(
  bank: T[],
  distribution: Record<K, number>,
): T[] {
  const result: T[] = [];

  for (const type in distribution) {
    const count = distribution[type];
    const subset = bank.filter((q) => q.type === type);
    if (subset.length < count) {
      throw new Error(
        `pickStratified: bank has only ${subset.length} questions of type "${type}", needed ${count}`,
      );
    }
    result.push(...pickRandom(subset, count));
  }

  return shuffle(result);
}

/**
 * Fisher-Yates shuffle — devuelve copia del array, no muta el original.
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
 * Distribución estándar para los bancos de inglés (16 vocab + 16 grammar + 8 reading).
 * Se selecciona 8 vocab + 8 grammar + 4 reading = 20 preguntas (50% del banco).
 */
export const ENGLISH_DISTRIBUTION = {
  vocab: 8,
  grammar: 8,
  reading: 4,
} as const;
