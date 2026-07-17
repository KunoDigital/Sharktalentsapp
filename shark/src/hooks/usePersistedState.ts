import { useState, useEffect, useCallback } from 'react';

/**
 * Hook para persistir state en localStorage.
 * Si el candidato refresca la pestaña, recupera donde quedó.
 *
 * @param key - clave de localStorage (debe ser único por test+token)
 * @param defaultValue - valor inicial si no hay nada guardado
 * @returns [value, setValue, clear] — clear elimina la clave
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const [value, setValueState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) return defaultValue;
      return JSON.parse(stored) as T;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // localStorage lleno o bloqueado; ignorar silenciosamente
    }
  }, [key, value]);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
    setValueState(defaultValue);
  }, [key, defaultValue]);

  return [value, setValueState, clear];
}

/**
 * Versión que devuelve si el state recuperado es "no vacío" — útil para
 * mostrar banner "continúa donde dejaste".
 */
export function hasPersistedState(key: string): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return false;
    const parsed = JSON.parse(stored);
    if (parsed == null) return false;
    if (Array.isArray(parsed)) return parsed.length > 0;
    if (typeof parsed === 'object') return Object.keys(parsed).length > 0;
    return true;
  } catch {
    return false;
  }
}
