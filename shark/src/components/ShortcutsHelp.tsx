import './shortcuts-help.css';

const SHORTCUTS = [
  { keys: ['⌘', 'K'], desc: 'Búsqueda global' },
  { keys: ['/'], desc: 'Enfocar buscador de la página' },
  { keys: ['?'], desc: 'Mostrar/ocultar esta ayuda' },
  { keys: ['j'], desc: 'Siguiente fila de tabla', alt: '↓' },
  { keys: ['k'], desc: 'Fila anterior de tabla', alt: '↑' },
  { keys: ['Enter'], desc: 'Abrir fila activa' },
  { keys: ['Esc'], desc: 'Cerrar modales / desfocar' },
  { keys: ['g', 'd'], desc: 'Ir a Dashboard' },
  { keys: ['g', 'D'], desc: 'Ir a Drafts' },
  { keys: ['g', 'j'], desc: 'Ir a Jobs' },
  { keys: ['g', 'c'], desc: 'Ir a Candidatos' },
  { keys: ['g', 'b'], desc: 'Ir a Bot review' },
  { keys: ['g', 'r'], desc: 'Ir a Reportes' },
  { keys: ['g', 'i'], desc: 'Ir a Inbox' },
  { keys: ['g', 's'], desc: 'Ir a Settings' },
];

export default function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="sh-overlay" onClick={onClose} role="presentation">
      <div className="sh-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Atajos de teclado">
        <div className="sh-header">
          <h2>Atajos de teclado</h2>
          <button className="sh-close" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <div className="sh-list">
          {SHORTCUTS.map((s, i) => (
            <div key={i} className="sh-item">
              <div className="sh-keys">
                {s.keys.map((k, j) => (
                  <span key={j}>
                    <kbd>{k}</kbd>
                    {j < s.keys.length - 1 && <span className="sh-plus"> + </span>}
                  </span>
                ))}
                {s.alt && <span className="sh-alt">o <kbd>{s.alt}</kbd></span>}
              </div>
              <div className="sh-desc">{s.desc}</div>
            </div>
          ))}
        </div>
        <div className="sh-footer">
          Cuando estás en un campo de texto, los atajos se desactivan. Probá con <kbd>g</kbd>+<kbd>letra</kbd> para navegar rápido.
        </div>
      </div>
    </div>
  );
}
