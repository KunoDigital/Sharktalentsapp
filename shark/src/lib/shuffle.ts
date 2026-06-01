/**
 * Fisher-Yates shuffle determinista (con seed opcional para reproducibilidad).
 * Devuelve el array shuffled + un "reverse map" para traducir índices de display → original.
 *
 * Uso típico — al cargar preguntas:
 *   const { shuffled, reverseMap } = shuffleOptions(question.options);
 *   // mostrar shuffled al usuario
 *
 * Cuando el usuario responde con índice de display:
 *   const originalIdx = reverseMap[displayIdx];
 *   // usar originalIdx para scoring (matchea contra correct/risk_weights/dimension)
 */

export type ShuffleResult<T> = {
  shuffled: T[];
  /** reverseMap[displayIdx] = originalIdx */
  reverseMap: number[];
};

export function shuffleOptions<T>(options: T[], seed?: number): ShuffleResult<T> {
  const indices = options.map((_, i) => i);
  const rand = seed != null ? seededRandom(seed) : Math.random;

  // Fisher-Yates
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  return {
    shuffled: indices.map((origIdx) => options[origIdx]),
    reverseMap: indices,
  };
}

/**
 * Helper: traduce respuesta del usuario (índice de display) al índice original.
 * Si el reverseMap está mal armado o el índice está fuera de rango, devuelve el índice tal cual.
 */
export function originalIndex(reverseMap: number[], displayIdx: number): number {
  if (displayIdx < 0 || displayIdx >= reverseMap.length) return displayIdx;
  return reverseMap[displayIdx];
}

// ---- Seeded RNG (opcional) ----
// Para reproducibilidad: misma seed → mismo orden. Útil en tests.

function seededRandom(seed: number): () => number {
  // Mulberry32 — simple PRNG estable
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
