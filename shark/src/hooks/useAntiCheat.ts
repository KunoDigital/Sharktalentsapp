import { useEffect, useRef, useState } from 'react';

export type AntiCheatEvent = {
  type: 'cursor_out' | 'window_blur' | 'paste';
  at: number; // unix ms
  question_id?: string;
  duration_ms?: number;
};

export type AntiCheatState = {
  events: AntiCheatEvent[];
  current_question_id: string | null;
};

type Options = {
  enabled: boolean;
  current_question_id: string | null;
};

export function useAntiCheat({ enabled, current_question_id }: Options) {
  const [events, setEvents] = useState<AntiCheatEvent[]>([]);
  const blurStartRef = useRef<number | null>(null);
  const cursorOutStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function recordEvent(ev: AntiCheatEvent) {
      setEvents((curr) => [...curr, ev]);
    }

    function onMouseLeave() {
      cursorOutStartRef.current = Date.now();
    }

    function onMouseEnter() {
      if (cursorOutStartRef.current !== null) {
        const duration = Date.now() - cursorOutStartRef.current;
        if (duration > 500) {
          recordEvent({
            type: 'cursor_out',
            at: cursorOutStartRef.current,
            duration_ms: duration,
            question_id: current_question_id ?? undefined,
          });
        }
        cursorOutStartRef.current = null;
      }
    }

    function onBlur() {
      blurStartRef.current = Date.now();
    }

    function onFocus() {
      if (blurStartRef.current !== null) {
        const duration = Date.now() - blurStartRef.current;
        if (duration > 500) {
          recordEvent({
            type: 'window_blur',
            at: blurStartRef.current,
            duration_ms: duration,
            question_id: current_question_id ?? undefined,
          });
        }
        blurStartRef.current = null;
      }
    }

    function onPaste(e: ClipboardEvent) {
      recordEvent({
        type: 'paste',
        at: Date.now(),
        question_id: current_question_id ?? undefined,
      });
      // Permitimos paste pero lo registramos. En backend evaluamos riesgo.
      void e;
    }

    document.addEventListener('mouseleave', onMouseLeave);
    document.addEventListener('mouseenter', onMouseEnter);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('paste', onPaste);

    return () => {
      document.removeEventListener('mouseleave', onMouseLeave);
      document.removeEventListener('mouseenter', onMouseEnter);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('paste', onPaste);
    };
  }, [enabled, current_question_id]);

  return { events, count: events.length };
}
