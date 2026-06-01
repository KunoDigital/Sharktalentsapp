import { useCallback, useEffect, useRef, useState } from 'react';

type Options = {
  maxHistory?: number;
  // Si dos updates ocurren en menos de este tiempo, se colapsan en uno (debounce típico para typing).
  debounceMs?: number;
};

export type UndoableApi<T> = {
  state: T;
  set: (next: T | ((prev: T) => T)) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reset: (next: T) => void;
};

/**
 * Hook de estado con historial undo/redo.
 * - Cmd/Ctrl+Z deshace; Cmd/Ctrl+Shift+Z (o Cmd/Ctrl+Y) rehace.
 * - Coalesce de updates rápidos en una sola entrada del historial (typing).
 */
export function useUndoableState<T>(initial: T, options: Options = {}): UndoableApi<T> {
  const { maxHistory = 50, debounceMs = 400 } = options;
  const [history, setHistory] = useState<T[]>([initial]);
  const [pointer, setPointer] = useState(0);
  const lastChangeRef = useRef<number>(0);

  const state = history[pointer];

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const now = Date.now();
      const elapsed = now - lastChangeRef.current;
      lastChangeRef.current = now;

      setHistory((curr) => {
        const truncated = curr.slice(0, pointer + 1);
        const computed = typeof next === 'function' ? (next as (p: T) => T)(truncated[truncated.length - 1]) : next;
        // Coalesce: si el último update fue hace poco, reemplazar la entrada en lugar de pushear
        if (elapsed < debounceMs && truncated.length > 1) {
          const replaced = [...truncated.slice(0, -1), computed];
          return replaced;
        }
        const pushed = [...truncated, computed];
        if (pushed.length > maxHistory) pushed.shift();
        return pushed;
      });
      setPointer((p) => {
        if (elapsed < debounceMs) return p; // mantener pointer en mismo slot
        return Math.min(p + 1, maxHistory - 1);
      });
    },
    [pointer, maxHistory, debounceMs],
  );

  const undo = useCallback(() => {
    setPointer((p) => Math.max(0, p - 1));
  }, []);

  const redo = useCallback(() => {
    setPointer((p) => Math.min(history.length - 1, p + 1));
  }, [history.length]);

  const reset = useCallback((next: T) => {
    setHistory([next]);
    setPointer(0);
    lastChangeRef.current = 0;
  }, []);

  // Atajos globales Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      // No interceptar undo de inputs nativos: solo cuando el target NO es un input/textarea
      // (los inputs ya tienen su propio undo). Sin embargo, queremos undo del FORM, así que
      // preferimos siempre interceptar y hacer undo del estado.
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  return {
    state,
    set,
    undo,
    redo,
    canUndo: pointer > 0,
    canRedo: pointer < history.length - 1,
    reset,
  };
}
