import { useEffect, useState } from 'react';

/**
 * Atajos globales:
 *  - "/" → enfoca primer search box (input[type=search])
 *  - "j" / ArrowDown → navegar siguiente fila de tabla activa
 *  - "k" / ArrowUp → navegar fila anterior
 *  - Enter → click en fila activa
 *  - "?" → abre overlay de ayuda
 *  - "g d" → ir a Dashboard (gd)
 *  - "g j" → Jobs
 *  - "g c" → Candidatos
 *  - "g r" → Reportes
 *
 * No interfiere con inputs/textareas (skip si target es editable).
 */
export function useGlobalShortcuts(navigate: (to: string) => void) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [activeRow, setActiveRow] = useState<number>(-1);

  useEffect(() => {
    let lastG = false;
    let gTimer: number | null = null;

    function isInputTarget(t: EventTarget | null): boolean {
      if (!t || !(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
    }

    function getActiveRows(): NodeListOf<HTMLTableRowElement> | null {
      // Tablas visibles principales
      const table = document.querySelector('.data-table') as HTMLTableElement | null;
      if (!table) return null;
      return table.querySelectorAll('tbody tr');
    }

    function focusSearch() {
      const search = document.querySelector('input[type="search"]') as HTMLInputElement | null;
      if (search) {
        search.focus();
        search.select();
      }
    }

    function highlightRow(idx: number) {
      const rows = getActiveRows();
      if (!rows) return;
      rows.forEach((r, i) => {
        if (i === idx) {
          r.classList.add('row-keyboard-focus');
          r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
          r.classList.remove('row-keyboard-focus');
        }
      });
    }

    function clickActiveRow() {
      const rows = getActiveRows();
      if (!rows || activeRow < 0 || activeRow >= rows.length) return;
      const row = rows[activeRow];
      const link = row.querySelector('a') as HTMLAnchorElement | null;
      if (link) link.click();
    }

    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isInputTarget(e.target)) {
        // Solo cerrar con Escape
        if (e.key === 'Escape' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      // Sequence navigation: g + letter
      if (lastG) {
        lastG = false;
        if (gTimer) window.clearTimeout(gTimer);
        if (e.key === 'd') { navigate('/'); e.preventDefault(); return; }
        if (e.key === 'j') { navigate('/jobs'); e.preventDefault(); return; }
        if (e.key === 'c') { navigate('/candidates'); e.preventDefault(); return; }
        if (e.key === 'r') { navigate('/reports'); e.preventDefault(); return; }
        if (e.key === 'D') { navigate('/drafts'); e.preventDefault(); return; }
        if (e.key === 'i') { navigate('/inbox'); e.preventDefault(); return; }
        if (e.key === 'b') { navigate('/bot/review'); e.preventDefault(); return; }
        if (e.key === 's') { navigate('/settings'); e.preventDefault(); return; }
        return;
      }

      if (e.key === 'g') {
        lastG = true;
        gTimer = window.setTimeout(() => { lastG = false; }, 1500);
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        focusSearch();
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen((o) => !o);
        return;
      }

      if (e.key === 'j' || e.key === 'ArrowDown') {
        const rows = getActiveRows();
        if (!rows || rows.length === 0) return;
        e.preventDefault();
        setActiveRow((curr) => {
          const next = Math.min((curr < 0 ? -1 : curr) + 1, rows.length - 1);
          highlightRow(next);
          return next;
        });
        return;
      }

      if (e.key === 'k' || e.key === 'ArrowUp') {
        const rows = getActiveRows();
        if (!rows || rows.length === 0) return;
        e.preventDefault();
        setActiveRow((curr) => {
          const next = Math.max(curr - 1, 0);
          highlightRow(next);
          return next;
        });
        return;
      }

      if (e.key === 'Enter' && activeRow >= 0) {
        e.preventDefault();
        clickActiveRow();
      }
    }

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (gTimer) window.clearTimeout(gTimer);
    };
  }, [navigate, activeRow]);

  // Reset row on route change handled implicitly by re-mount

  return { helpOpen, setHelpOpen };
}
