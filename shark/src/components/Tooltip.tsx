import { useState, useRef, useEffect } from 'react';
import './tooltip.css';

type Props = {
  content: React.ReactNode;
  children: React.ReactNode;
  position?: 'top' | 'bottom';
};

export default function Tooltip({ content, children, position = 'top' }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span
      ref={ref}
      className="tt-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
      role="button"
      aria-describedby="tt-content"
    >
      {children}
      {open && (
        <span className={`tt-bubble tt-${position}`} id="tt-content" role="tooltip">
          {content}
        </span>
      )}
    </span>
  );
}

/**
 * Glosario inline para términos técnicos. Usá <Term name="DISC">DISC</Term>.
 */
const GLOSSARY: Record<string, React.ReactNode> = {
  DISC: (
    <>
      <strong>DISC</strong> mide 4 dimensiones del comportamiento:
      <ul>
        <li><strong>D</strong>ominante: orientado a resultados</li>
        <li><strong>I</strong>nfluyente: persuasivo, social</li>
        <li><strong>S</strong>ólido: estable, paciente</li>
        <li><strong>C</strong>umplidor: detallista, analítico</li>
      </ul>
    </>
  ),
  VELNA: (
    <>
      <strong>VELNA</strong> evalúa capacidad cognitiva en 5 áreas:
      <strong> V</strong>erbal, <strong>E</strong>spacial, <strong>L</strong>ógica, <strong>N</strong>umérica, <strong>A</strong>bstracta.
      Cada una se mide con preguntas timed.
    </>
  ),
  PK: (
    <>
      <strong>PK profile</strong> = arquetipo derivado del DISC. 27 perfiles
      definidos (PK-01 a PK-27) que combinan las dimensiones en patrones
      accionables. Ej: PK-08 = Preciso/a, Analítico/a, Calidad.
    </>
  ),
  similitud: (
    <>
      <strong>Similitud</strong> con el perfil ideal: distancia euclidiana
      entre los scores del candidato y los del perfil ideal del puesto.
      100% = match exacto. 70%+ se considera fuerte.
    </>
  ),
  'anti-trampa': (
    <>
      <strong>Anti-trampa</strong> detecta cuando el candidato pierde foco
      durante el test (cursor fuera, ventana perdida, paste). Más de 5
      eventos en una fase sugiere posible asistencia externa.
    </>
  ),
  integridad: (
    <>
      <strong>Integridad</strong> evalúa 15 dimensiones con escala Likert
      1-5. Algunas preguntas son detectoras de "buena impresión": si todas
      se responden con extremos consistentes, levanta flag.
    </>
  ),
  'buena impresión': (
    <>
      <strong>Buena impresión alta</strong> = el candidato respondió todas
      las preguntas de deseabilidad social con el extremo "socialmente
      aceptable". Patrón típico de quien intenta caer bien al evaluador,
      no necesariamente deshonestidad — pero amerita revisar CV y
      entrevistar antes de decidir.
    </>
  ),
};

export function Term({ name, children }: { name: keyof typeof GLOSSARY | string; children: React.ReactNode }) {
  const content = GLOSSARY[name] ?? <em>Sin definición.</em>;
  return (
    <Tooltip content={content}>
      <span className="tt-term">{children}</span>
    </Tooltip>
  );
}
