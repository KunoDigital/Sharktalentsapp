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
  afinidad: (
    <>
      <strong>Afinidad</strong> = qué tanto encaja el candidato con el
      perfil ideal que definimos para tu puesto. Promedia conducta,
      cognición, técnica, integridad y manejo emocional. 70%+ = match
      fuerte para entrevistar primero.
    </>
  ),
  mindset: (
    <>
      <strong>Mindset</strong> mide cómo aborda situaciones cotidianas
      (marco McKinsey Forward):
      <ul>
        <li><strong>Adaptable</strong>: aprende rápido, busca cambios</li>
        <li><strong>Mixto</strong>: depende de la situación</li>
        <li><strong>Rígido</strong>: cómodo en lo conocido, evita cambios</li>
      </ul>
      Útil para roles que viven en entornos cambiantes.
    </>
  ),
  'estilo profesional': (
    <>
      <strong>Estilo profesional</strong> mide cómo decide en su día a día:
      <ul>
        <li><strong>Autonomía</strong>: decide solo y avanza</li>
        <li><strong>Consulta</strong>: prefiere alinearse antes de decidir</li>
      </ul>
      No es bueno ni malo — depende de qué necesitas para el rol. Un jefe
      ocupado quiere autonomía. Un rol regulado quiere consulta.
    </>
  ),
  'match con jefe': (
    <>
      <strong>Match con el estilo del jefe</strong> = qué tanto el estilo
      profesional del candidato encaja con el del jefe que lo va a
      gestionar. 75%+ = alineado (poca fricción). Menos = posible roce
      por ritmo de decisiones.
    </>
  ),
  'validez situacional': (
    <>
      <strong>Validez situacional</strong> = en cuántas situaciones de
      prueba el candidato eligió una opción profesionalmente cuestionable
      (cortar atajos, evadir responsabilidad, mentir bajo presión). Bajo
      75% sugiere revisar en entrevista — no es rechazo automático.
    </>
  ),
  'perfil emocional': (
    <>
      <strong>Perfil emocional</strong> describe cómo el candidato
      experimenta y procesa emociones bajo presión (calma, tensión,
      proactividad emocional). Útil para roles con exposición a quejas,
      conflictos o alta carga.
    </>
  ),
  CEFR: (
    <>
      <strong>CEFR</strong> es el estándar europeo de nivel de inglés:
      <ul>
        <li><strong>A1-A2</strong>: básico</li>
        <li><strong>B1-B2</strong>: intermedio (puede sostener una reunión)</li>
        <li><strong>C1-C2</strong>: avanzado (puede negociar y presentar)</li>
      </ul>
      Combinamos comprensión escrita, audio y producción escrita.
    </>
  ),
  'capacidad intelectual': (
    <>
      <strong>Capacidad intelectual</strong> = qué tan rápido procesa
      información en distintas áreas (verbal, espacial, lógica, numérica
      y abstracta). Es la base cognitiva, no la experiencia. Mide
      <em> potencial</em>, no <em>conocimiento</em>.
    </>
  ),
  'duda CV': (
    <>
      <strong>Duda CV</strong> = el candidato pasa el filtro automático
      pero alguna respuesta sugiere revisar la entrevista con cuidado
      (inglés bajo lo declarado, validez situacional baja, buena
      impresión alta, etc.). No es rechazo — es señal de "preguntale
      esto".
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
