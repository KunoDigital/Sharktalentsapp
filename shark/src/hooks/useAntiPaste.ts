/**
 * Hook reusable para el textarea del writing test (inglés).
 *
 * Bloquea pegado/copiado y trackea eventos sospechosos (focus loss, ratio
 * keystroke/word). Diseñado específicamente para el bloque de writing donde
 * el candidato no debería poder pegar texto desde otra fuente (ej: ChatGPT).
 *
 * Uso:
 *
 *   const { textareaProps, stats } = useAntiPaste({ enabled: true });
 *   <textarea {...textareaProps} value={text} onChange={(e) => setText(e.target.value)} />
 *
 *   // Al submit, mandar stats al backend para que se guarde en EnglishTestSessions:
 *   //   stats.paste_attempts, stats.focus_lost_count, stats.keystroke_count, etc.
 *
 * NOTA: anti-paste no detiene a un cheater determinado (puede dictar a otro IA en
 * su celular). Detiene casuales (Ctrl+V) y deja flags en el reporte.
 */

import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent, MouseEvent, TextareaHTMLAttributes } from 'react';

export type AntiPasteStats = {
  /** Veces que el candidato intentó pegar (Ctrl+V o menú). */
  paste_attempts: number;
  /** Veces que el tab/ventana perdió foco. */
  focus_lost_count: number;
  /** Tiempo total con la ventana fuera de foco (ms). */
  focus_lost_total_ms: number;
  /** Cantidad total de keystrokes en el textarea. */
  keystroke_count: number;
  /** Veces que intentó copiar contenido. */
  copy_attempts: number;
  /** Veces que abrió click derecho (context menu). */
  context_menu_attempts: number;
};

type Options = {
  /** Si está habilitado el anti-paste. Para development se puede desactivar. */
  enabled?: boolean;
  /** Callback opcional cuando se detecta un intento de paste. */
  onPasteAttempt?: () => void;
};

const initialStats: AntiPasteStats = {
  paste_attempts: 0,
  focus_lost_count: 0,
  focus_lost_total_ms: 0,
  keystroke_count: 0,
  copy_attempts: 0,
  context_menu_attempts: 0,
};

export function useAntiPaste({ enabled = true, onPasteAttempt }: Options = {}) {
  const [stats, setStats] = useState<AntiPasteStats>(initialStats);
  const focusLostStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        focusLostStartRef.current = Date.now();
        setStats((s) => ({ ...s, focus_lost_count: s.focus_lost_count + 1 }));
      } else if (focusLostStartRef.current !== null) {
        const duration = Date.now() - focusLostStartRef.current;
        focusLostStartRef.current = null;
        setStats((s) => ({ ...s, focus_lost_total_ms: s.focus_lost_total_ms + duration }));
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [enabled]);

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!enabled) return;
    e.preventDefault();
    setStats((s) => ({ ...s, paste_attempts: s.paste_attempts + 1 }));
    onPasteAttempt?.();
  };

  const onCopy = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!enabled) return;
    e.preventDefault();
    setStats((s) => ({ ...s, copy_attempts: s.copy_attempts + 1 }));
  };

  const onContextMenu = (e: MouseEvent<HTMLTextAreaElement>) => {
    if (!enabled) return;
    e.preventDefault();
    setStats((s) => ({ ...s, context_menu_attempts: s.context_menu_attempts + 1 }));
  };

  const onKeyDown = (_e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!enabled) return;
    setStats((s) => ({ ...s, keystroke_count: s.keystroke_count + 1 }));
  };

  const textareaProps: Pick<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    'onPaste' | 'onCopy' | 'onContextMenu' | 'onKeyDown' | 'autoComplete' | 'spellCheck'
  > = {
    onPaste,
    onCopy,
    onContextMenu,
    onKeyDown,
    autoComplete: 'off',
    spellCheck: false,
  };

  function reset() {
    setStats(initialStats);
    focusLostStartRef.current = null;
  }

  return {
    /** Props para spread en el `<textarea>`. */
    textareaProps,
    /** Estadísticas en vivo — al submit, mandarlas al backend. */
    stats,
    /** Reset manual de las stats (ej: al re-iniciar el test). */
    reset,
  };
}
