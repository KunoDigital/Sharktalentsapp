import { useState, useEffect } from 'react';
import './onboarding-tour.css';

const TOUR_KEY = 'onboarding_completed';

type Step = {
  selector: string;
  title: string;
  body: string;
  position?: 'top' | 'bottom' | 'right' | 'left';
};

const STEPS: Step[] = [
  {
    selector: '.action-queue',
    title: '👋 Acá empezás cada día',
    body: 'En el dashboard tenés "Tu cola": lo que requiere tu atención hoy. Drafts pendientes, decisiones del bot que necesitan tu input, finalistas listos. Click en cada uno te lleva al lugar correcto.',
    position: 'bottom',
  },
  {
    selector: '.admin-nav',
    title: 'Tu sidebar',
    body: 'Drafts (clientes nuevos), Jobs (puestos), Candidatos, Bot review (cuando el bot duda), Reportes a clientes, Inbox outbound (LinkedIn/email), Settings.',
    position: 'right',
  },
  {
    selector: '.notif-bell',
    title: '🔔 Notificaciones en vivo',
    body: 'El bell muestra cuántas notifs nuevas tenés. Click abre el panel. Podés silenciar tipos en Settings → Notificaciones.',
    position: 'bottom',
  },
  {
    selector: '.admin-cmdk-hint',
    title: '⌨️ Atajos',
    body: '⌘+K abre búsqueda global (jobs, candidatos, drafts, páginas). ? muestra todos los atajos. j/k navega tablas. g+letra navega entre páginas.',
    position: 'right',
  },
  {
    selector: '.dashboard-charts-grid',
    title: '📊 Charts',
    body: 'Funnel de conversión, distribución DISC, origen de candidatos. Si pasás el mouse sobre los términos técnicos (DISC, VELNA), aparecen tooltips con definiciones.',
    position: 'top',
  },
];

export default function OnboardingTour() {
  const [stepIdx, setStepIdx] = useState(0);
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(TOUR_KEY) !== 'true';
    } catch {
      return false;
    }
  });
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);

  const step = STEPS[stepIdx];

  useEffect(() => {
    if (!open || !step) return;

    function updateHighlight() {
      const el = document.querySelector(step.selector);
      if (el) {
        const rect = el.getBoundingClientRect();
        setHighlightRect(rect);
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else {
        setHighlightRect(null);
      }
    }

    updateHighlight();
    const observer = new ResizeObserver(updateHighlight);
    observer.observe(document.body);
    window.addEventListener('resize', updateHighlight);
    window.addEventListener('scroll', updateHighlight, true);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateHighlight);
      window.removeEventListener('scroll', updateHighlight, true);
    };
  }, [open, stepIdx, step]);

  function next() {
    if (stepIdx < STEPS.length - 1) {
      setStepIdx(stepIdx + 1);
    } else {
      complete();
    }
  }

  function back() {
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  }

  function complete() {
    try {
      localStorage.setItem(TOUR_KEY, 'true');
    } catch {
      // ignore
    }
    setOpen(false);
  }

  function skip() {
    complete();
  }

  if (!open || !step) return null;

  // Compute tooltip position from highlightRect
  let tooltipStyle: React.CSSProperties = {};
  if (highlightRect) {
    const padding = 12;
    const tooltipWidth = 360;
    const tooltipHeight = 180;

    if (step.position === 'right') {
      tooltipStyle = {
        top: highlightRect.top + highlightRect.height / 2,
        left: highlightRect.right + padding,
        transform: 'translateY(-50%)',
      };
    } else if (step.position === 'left') {
      tooltipStyle = {
        top: highlightRect.top + highlightRect.height / 2,
        left: highlightRect.left - tooltipWidth - padding,
        transform: 'translateY(-50%)',
      };
    } else if (step.position === 'top') {
      tooltipStyle = {
        top: highlightRect.top - tooltipHeight - padding,
        left: highlightRect.left + highlightRect.width / 2,
        transform: 'translateX(-50%)',
      };
    } else {
      // bottom (default)
      tooltipStyle = {
        top: highlightRect.bottom + padding,
        left: highlightRect.left + highlightRect.width / 2,
        transform: 'translateX(-50%)',
      };
    }
  }

  return (
    <>
      <div className="tour-overlay" />
      {highlightRect && (
        <div
          className="tour-highlight"
          style={{
            top: highlightRect.top - 4,
            left: highlightRect.left - 4,
            width: highlightRect.width + 8,
            height: highlightRect.height + 8,
          }}
        />
      )}
      <div className="tour-tooltip" style={tooltipStyle} role="dialog" aria-label="Tour de bienvenida">
        <div className="tour-progress-dots">
          {STEPS.map((_, i) => (
            <span key={i} className={`tour-dot ${i === stepIdx ? 'is-active' : ''} ${i < stepIdx ? 'is-done' : ''}`} />
          ))}
          <span className="tour-progress-text">{stepIdx + 1}/{STEPS.length}</span>
        </div>
        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        <div className="tour-actions">
          <button className="tour-skip" onClick={skip}>Saltar tour</button>
          <div className="tour-nav-buttons">
            {stepIdx > 0 && <button className="cd-btn-ghost" onClick={back}>← Atrás</button>}
            <button className="btn-primary" onClick={next}>
              {stepIdx === STEPS.length - 1 ? '¡Empezar!' : 'Siguiente →'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
