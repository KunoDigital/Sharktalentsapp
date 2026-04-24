import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getTest, submitTest } from '../../services/api';
import type { CSSProperties } from 'react';

interface Question { id: string; text: string; options: string[]; svg?: string; options_svg?: string[]; risk_weights?: number[] }
interface Section { name: string; questions: Question[]; timer: number | null }

const SECTION_DESCRIPTIONS: Record<string, { desc: string; example: string; exampleAnswer: string }> = {
  'Verbal': {
    desc: 'Evalúa tu comprensión del lenguaje: analogías, sinónimos, antónimos y comprensión de textos.',
    example: 'AVIÓN es a HANGAR como BARCO es a: Puerto, Mar, Ancla, Capitán',
    exampleAnswer: 'Respuesta correcta: Puerto. Un avión se guarda en un hangar, un barco se guarda en un puerto.',
  },
  'Espacial': {
    desc: 'Evalúa tu capacidad para representar y organizar mentalmente el espacio: rotación de figuras, reflejos y orientación.',
    example: '¿Cuál figura muestra la misma forma rotada 90° a la derecha?',
    exampleAnswer: 'Debes imaginar la figura girando como las manecillas del reloj y elegir la opción que coincida.',
  },
  'Lógico': {
    desc: 'Evalúa tu capacidad para identificar causalidades y razonar de forma deductiva: silogismos, series y conclusiones.',
    example: 'Si todos los gerentes tienen acceso al sistema, y Laura tiene acceso, ¿qué concluimos?',
    exampleAnswer: 'Laura podría ser gerente o no. Tener acceso no garantiza ser gerente.',
  },
  'Numérico': {
    desc: 'Evalúa tu manejo de operaciones matemáticas mentales: series numéricas, porcentajes, proporciones y problemas aplicados.',
    example: '¿Cuál número completa la serie? 2, 6, 12, 20, ___, 42',
    exampleAnswer: 'Respuesta: 30. Las diferencias son 4, 6, 8, 10, 12... cada vez se suma 2 más.',
  },
  'Abstracto': {
    desc: 'Evalúa tu capacidad para identificar patrones con símbolos y figuras: series, matrices y transformaciones.',
    example: 'Secuencia: ● ○ ● ○ ● ?',
    exampleAnswer: 'Respuesta: ○. El patrón alterna entre círculo lleno y vacío.',
  },
};

export default function TestQuestions() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const locState = location.state as { email?: string; savedAnswers?: Record<string, number>; resuming?: boolean } || {};
  const email = locState.email || '';

  const [sections, setSections] = useState<Section[]>([]);
  const [isKudert, setIsKudert] = useState(false);
  const [currentSectionIdx, setCurrentSectionIdx] = useState(0);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [instructionsAccepted, setInstructionsAccepted] = useState(false);
  const [showTransition, setShowTransition] = useState(false);

  // Timer
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  // Anti-cheat: screen exits (visibility + mouse leave + window blur)
  const screenExitsRef = useRef(0);
  const exitLogRef = useRef<{ section: string; questionIdx: number; questionId: string; type: string; leftAt: number; returnedAt?: number; duration?: number }[]>([]);
  const exitPendingRef = useRef<{ section: string; questionIdx: number; questionId: string; type: string; leftAt: number; returnedAt?: number; duration?: number } | null>(null);
  const [exitWarning, setExitWarning] = useState('');

  // Option shuffling for integrity questions
  const [testType, setTestType] = useState('');
  // shuffleMap: { questionId: [originalIndex0, originalIndex1, ...] } — maps display position to original index
  const shuffleMapRef = useRef<Record<string, number[]>>({});

  // ── Load test data ──
  useEffect(() => {
    if (!token) return;
    getTest(token).then(data => {
      setTestType(data.type || '');
      if (data.sections) {
        const secs: Section[] = data.sections.filter((s: Section) => s.questions.length > 0);
        setSections(secs);
        setIsKudert(true);
        if (secs[0]?.timer && SECTION_DESCRIPTIONS[secs[0].name]) {
          setShowInstructions(true);
        }
      } else {
        // For integrity: shuffle options
        const questions = data.questions as Question[];
        if (data.type === 'integrity') {
          for (const q of questions) {
            const indices = [0, 1, 2, 3];
            // Fisher-Yates shuffle
            for (let i = indices.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [indices[i], indices[j]] = [indices[j], indices[i]];
            }
            shuffleMapRef.current[q.id] = indices;
            q.options = indices.map(i => q.options[i]);
          }
        }
        setSections([{ name: '', questions, timer: null }]);
      }
      // Resume from saved answers
      if (locState.resuming && locState.savedAnswers) {
        setAnswers(locState.savedAnswers);
        answersRef.current = locState.savedAnswers;
      }

      setLoading(false);
    });
  }, [token]);

  // Resume: find the first unanswered question after loading sections
  useEffect(() => {
    if (loading || sections.length === 0 || !locState.resuming || !locState.savedAnswers) return;
    const saved = locState.savedAnswers;
    const allQs = sections.flatMap(s => s.questions);
    const firstUnanswered = allQs.findIndex(q => saved[q.id] === undefined);
    if (firstUnanswered <= 0) return;

    // Find which section and question index
    let offset = 0;
    for (let si = 0; si < sections.length; si++) {
      const secLen = sections[si].questions.length;
      if (firstUnanswered < offset + secLen) {
        setCurrentSectionIdx(si);
        setCurrentQ(firstUnanswered - offset);
        break;
      }
      offset += secLen;
    }
  }, [loading, sections]);

  // Auto-save every 5 answers
  const lastSaveCount = useRef(0);
  useEffect(() => {
    const count = Object.keys(answers).length;
    if (count > 0 && count % 5 === 0 && count !== lastSaveCount.current && token && email) {
      lastSaveCount.current = count;
      import('../../services/api').then(({ savePartialAnswers }) => {
        savePartialAnswers(token, { email, answers }).catch(() => {});
      });
    }
  }, [answers, token, email]);

  // ── Anti-cheat: visibility change + window blur + mouse leave ──
  // Uses refs for section/question to avoid stale closures
  const sectionIdxRef = useRef(currentSectionIdx);
  const questionIdxRef = useRef(currentQ);
  sectionIdxRef.current = currentSectionIdx;
  questionIdxRef.current = currentQ;
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  useEffect(() => {
    const getContext = () => {
      const sec = sectionsRef.current[sectionIdxRef.current];
      const q = sec?.questions[questionIdxRef.current];
      return { section: sec?.name || '', questionIdx: questionIdxRef.current + 1, questionId: q?.id || '' };
    };

    const triggerExit = (type: string, reason: string) => {
      screenExitsRef.current++;
      const ctx = getContext();
      exitPendingRef.current = { ...ctx, type, leftAt: Date.now() };
      const count = screenExitsRef.current;
      if (count === 1) {
        setExitWarning(`${reason}. Esto queda registrado.`);
      } else if (count === 2) {
        setExitWarning(`${reason}. Esta es la segunda vez. Queda registrado.`);
      } else {
        setExitWarning(`${reason}. Van ${count} veces. Esto afectará la validez de tu evaluación.`);
      }
    };

    const triggerReturn = () => {
      if (exitPendingRef.current) {
        const entry = exitPendingRef.current;
        entry.returnedAt = Date.now();
        entry.duration = Math.round((entry.returnedAt - entry.leftAt) / 1000);
        exitLogRef.current.push(entry as any);
        exitPendingRef.current = null;
      }
    };

    const handleVisibility = () => {
      if (document.hidden) triggerExit('tab', 'Detectamos que cambiaste de pestaña');
      else triggerReturn();
    };

    const handleBlur = () => {
      if (!document.hidden) triggerExit('window', 'Detectamos que saliste de la ventana');
    };

    const handleFocus = () => {
      triggerReturn();
    };

    const handleMouseLeave = (e: MouseEvent) => {
      if (e.clientY <= 0 || e.clientX <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        triggerExit('cursor', 'Detectamos que el cursor salió de la pantalla de evaluación');
      }
    };

    const handleMouseEnter = () => {
      triggerReturn();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.documentElement.addEventListener('mouseleave', handleMouseLeave);
    document.documentElement.addEventListener('mouseenter', handleMouseEnter);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.documentElement.removeEventListener('mouseleave', handleMouseLeave);
      document.documentElement.removeEventListener('mouseenter', handleMouseEnter);
    };
  }, []);

  const currentSection = sections[currentSectionIdx];
  const question = currentSection?.questions[currentQ];

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const startTimer = useCallback((seconds: number) => {
    stopTimer();
    setTimeLeft(seconds);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev === null || prev <= 1) { stopTimer(); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, [stopTimer]);

  useEffect(() => {
    if (timeLeft !== 0) return;
    stopTimer();
    advanceToNextSection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft]);

  useEffect(() => {
    if (!showInstructions && !showTransition && currentSection?.timer) {
      startTimer(currentSection.timer);
    }
    return () => stopTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSectionIdx, showInstructions, showTransition]);

  const advanceToNextSection = useCallback(async () => {
    stopTimer();
    setTimeLeft(null);

    if (currentSectionIdx >= sections.length - 1) {
      setSubmitting(true);
      try {
        await submitTest(token!, { email, answers: answersRef.current, screen_exits: screenExitsRef.current, screen_exit_log: exitLogRef.current });
        navigate(`/test/${token}/done`);
      } catch { alert('Error al enviar'); setSubmitting(false); }
      return;
    }

    const nextIdx = currentSectionIdx + 1;
    const nextSec = sections[nextIdx];
    setCurrentSectionIdx(nextIdx);
    setCurrentQ(0);
    setSelected(null);

    if (nextSec?.timer && SECTION_DESCRIPTIONS[nextSec.name]) {
      setInstructionsAccepted(false);
      setShowInstructions(true);
    } else {
      setShowTransition(true);
    }
  }, [currentSectionIdx, sections, token, email, navigate, stopTimer]);

  const handleSelect = (index: number) => setSelected(index);

  const handleNext = async () => {
    if (selected === null) return;
    // For integrity: map shuffled display index back to original index
    const originalIndex = shuffleMapRef.current[question.id]
      ? shuffleMapRef.current[question.id][selected]
      : selected;
    const newAnswers = { ...answers, [question.id]: originalIndex };
    setAnswers(newAnswers);
    answersRef.current = newAnswers;

    if (currentQ >= currentSection.questions.length - 1) {
      await advanceToNextSection();
      return;
    }

    setCurrentQ(currentQ + 1);
    setSelected(newAnswers[currentSection.questions[currentQ + 1]?.id] ?? null);
  };

  if (loading) return <div style={pageStyle}><p style={{ color: 'var(--kuno-text-muted)', marginTop: 80 }}>Cargando...</p></div>;

  if (!currentSection || currentSection.questions.length === 0) {
    return <div style={pageStyle}><header style={hdrStyle}><span style={logoStyle}>SharkTalents</span></header><div style={cardStyle}><p style={{ color: 'var(--kuno-text-muted)', textAlign: 'center' }}>Esta prueba no tiene preguntas disponibles.</p></div></div>;
  }

  // ── Warning banner (requires dismiss) ──
  const warningOverlay = exitWarning ? (
    <div style={warningBanner}>
      <div style={warningContent}>
        <span style={{ fontSize: 20, marginRight: 10 }}>{screenExitsRef.current >= 3 ? '\u{1F6A8}' : '\u{26A0}\u{FE0F}'}</span>
        <span style={{ flex: 1 }}>{exitWarning}</span>
        <button onClick={() => setExitWarning('')} style={warningDismiss}>Entendido</button>
      </div>
    </div>
  ) : null;

  // ── Instructions screen ──
  if (showInstructions) {
    const info = SECTION_DESCRIPTIONS[currentSection.name];
    const mins = currentSection.timer ? Math.round(currentSection.timer / 60) : 0;

    return (
      <div style={pageStyle}>
        {warningOverlay}
        <header style={hdrStyle}><span style={logoStyle}>SharkTalents</span></header>
        <div style={{ ...cardStyle, maxWidth: 520 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--kuno-lime)', marginBottom: 16 }}>Sección: {currentSection.name}</h2>
          <p style={{ fontSize: 14, color: 'var(--kuno-cream)', lineHeight: 1.6, marginBottom: 16 }}>{info?.desc}</p>
          <div style={exampleBox}>
            <p style={{ fontSize: 13, color: 'var(--kuno-text-muted)', marginBottom: 6 }}>Ejemplo:</p>
            <p style={{ fontSize: 14, color: 'var(--kuno-cream)', marginBottom: 8 }}>{info?.example}</p>
            <p style={{ fontSize: 13, color: 'var(--kuno-lime)' }}>{info?.exampleAnswer}</p>
          </div>
          <div style={{ background: 'var(--kuno-dark-2)', borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: 16, border: '1px solid var(--kuno-border)' }}>
            <p style={{ fontSize: 14, color: '#f39c12', fontWeight: 600 }}>Tienes {mins} minutos para completar esta sección.</p>
            <p style={{ fontSize: 13, color: 'var(--kuno-text-muted)', marginTop: 4 }}>Las preguntas no respondidas a tiempo se marcarán como nulas.</p>
          </div>
          <label style={checkboxRow}>
            <input type="checkbox" checked={instructionsAccepted} onChange={e => setInstructionsAccepted(e.target.checked)} style={checkboxInput} />
            <span style={{ fontSize: 14, color: 'var(--kuno-cream)' }}>He comprendido las instrucciones</span>
          </label>
          <button onClick={() => setShowInstructions(false)} disabled={!instructionsAccepted} style={instructionsAccepted ? btnPrimary : btnDisabled}>
            Iniciar sección
          </button>
        </div>
      </div>
    );
  }

  // ── Transition screen ──
  if (showTransition) {
    return (
      <div style={pageStyle}>
        {warningOverlay}
        <header style={hdrStyle}><span style={logoStyle}>SharkTalents</span></header>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--kuno-text-muted)', marginBottom: 8 }}>Siguiente sección</p>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--kuno-lime)', marginBottom: 24 }}>{currentSection.name}</h2>
          <button onClick={() => setShowTransition(false)} style={btnPrimary}>Continuar</button>
        </div>
      </div>
    );
  }

  // ── Question screen ──
  const sectionTotal = currentSection.questions.length;
  const allQuestions = sections.flatMap(s => s.questions);
  const globalIdx = sections.slice(0, currentSectionIdx).reduce((s, sec) => s + sec.questions.length, 0) + currentQ;
  const globalProgress = ((globalIdx + 1) / allQuestions.length) * 100;
  const isLastOverall = currentSectionIdx === sections.length - 1 && currentQ === sectionTotal - 1;
  const timerColor = timeLeft !== null && timeLeft <= 30 ? 'var(--kuno-danger)' : timeLeft !== null && timeLeft <= 60 ? '#f39c12' : 'var(--kuno-lime)';
  const timerPct = timeLeft !== null && currentSection.timer ? (timeLeft / currentSection.timer) * 100 : 100;

  return (
    <div style={pageStyle}>
      {warningOverlay}
      <header style={hdrStyle}><span style={logoStyle}>SharkTalents</span></header>

      <div style={progressContainer}><div style={{ ...progressBar, width: `${globalProgress}%` }} /></div>
      {timeLeft !== null && <div style={{ ...timerBarContainer, marginTop: 4 }}><div style={{ ...timerBarFill, width: `${timerPct}%`, background: timerColor }} /></div>}

      <p style={progressText}>
        {isKudert ? `${currentSection.name} ${currentQ + 1}/${sectionTotal}` : `Pregunta ${currentQ + 1} de ${sectionTotal}`}
        {timeLeft !== null && <span style={{ marginLeft: 12, color: timerColor, fontWeight: 600 }}>{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}</span>}
      </p>

      <div style={cardStyle}>
        {question.svg && <div style={svgContainer} dangerouslySetInnerHTML={{ __html: question.svg }} />}
        <h2 style={questionTextStyle}>{question.text}</h2>

        <div style={question.options_svg ? optionsGridContainer : optionsContainer}>
          {question.options.map((opt, i) => (
            <button key={i} onClick={() => handleSelect(i)} style={question.options_svg ? (selected === i ? optSvgSel : optSvgNorm) : (selected === i ? optSel : optNorm)}>
              {question.options_svg ? (
                <div>
                  <div style={svgOptionInner} dangerouslySetInnerHTML={{ __html: question.options_svg[i] }} />
                  <span style={{ fontSize: 11, color: 'var(--kuno-text-muted)' }}>{String.fromCharCode(65 + i)}</span>
                </div>
              ) : (
                <>
                  <span style={selected === i ? optLetSel : optLet}>{String.fromCharCode(65 + i)}</span>
                  {opt}
                </>
              )}
            </button>
          ))}
        </div>

        <button onClick={handleNext} disabled={selected === null || submitting} style={selected !== null && !submitting ? btnPrimary : btnDisabled}>
          {submitting ? 'Enviando...' : isLastOverall ? 'Enviar' : 'Siguiente'}
        </button>
      </div>
    </div>
  );
}

/* ── Styles ── */
const pageStyle: CSSProperties = { minHeight: '100vh', background: 'var(--kuno-dark-2)', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' };
const hdrStyle: CSSProperties = { padding: '24px 0 16px', textAlign: 'center' };
const logoStyle: CSSProperties = { fontSize: 22, fontWeight: 700, color: 'var(--kuno-lime)' };
const progressContainer: CSSProperties = { width: '100%', maxWidth: 520, height: 4, background: 'var(--kuno-border)', borderRadius: 2 };
const progressBar: CSSProperties = { height: '100%', background: 'var(--kuno-lime)', borderRadius: 2, transition: 'width 0.3s' };
const timerBarContainer: CSSProperties = { width: '100%', maxWidth: 520, height: 3, background: 'var(--kuno-border)', borderRadius: 2 };
const timerBarFill: CSSProperties = { height: '100%', borderRadius: 2, transition: 'width 1s linear' };
const progressText: CSSProperties = { fontSize: 13, color: 'var(--kuno-text-muted)', marginTop: 10, marginBottom: 20, display: 'flex', alignItems: 'center' };
const cardStyle: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 36, width: '100%', maxWidth: 520 };
const questionTextStyle: CSSProperties = { fontSize: 18, fontWeight: 600, color: 'var(--kuno-cream)', marginBottom: 24, lineHeight: 1.5 };
const optionsContainer: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 };
const optB: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 16px', borderRadius: 'var(--radius)', fontSize: 14, color: 'var(--kuno-cream)', textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s' };
const optNorm: CSSProperties = { ...optB, background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)' };
const optSel: CSSProperties = { ...optB, background: 'rgba(218,253,111,0.1)', border: '1px solid var(--kuno-lime)' };
const optLetB: CSSProperties = { width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 };
const optLet: CSSProperties = { ...optLetB, background: 'var(--kuno-dark-2)', border: '1px solid var(--kuno-border)' };
const optLetSel: CSSProperties = { ...optLetB, background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', border: '1px solid var(--kuno-lime)' };
const btnPrimary: CSSProperties = { width: '100%', background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontWeight: 600, fontSize: 14, padding: '12px 24px', borderRadius: 'var(--radius)', border: 'none' };
const btnDisabled: CSSProperties = { ...btnPrimary, opacity: 0.4, cursor: 'not-allowed' };
const svgContainer: CSSProperties = { display: 'flex', justifyContent: 'center', marginBottom: 20, padding: 12, background: 'white', borderRadius: 8, border: '1px solid var(--kuno-border)', maxWidth: '100%', overflow: 'hidden' };
const optionsGridContainer: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 28 };
const optSvgB: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 8px', borderRadius: 'var(--radius)', cursor: 'pointer', transition: 'all 0.15s' };
const optSvgNorm: CSSProperties = { ...optSvgB, background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)' };
const optSvgSel: CSSProperties = { ...optSvgB, background: 'rgba(218,253,111,0.1)', border: '1px solid var(--kuno-lime)' };
const svgOptionInner: CSSProperties = { width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'white', borderRadius: 8, padding: 12 };
const exampleBox: CSSProperties = { background: 'var(--kuno-dark-2)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 16 };
const checkboxRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, cursor: 'pointer' };
const checkboxInput: CSSProperties = { width: 18, height: 18, accentColor: 'var(--kuno-lime)' };
const warningBanner: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, background: 'rgba(231,76,60,0.97)', color: '#fff', padding: 0, zIndex: 9999 };
const warningContent: CSSProperties = { display: 'flex', alignItems: 'center', padding: '14px 20px', maxWidth: 600, margin: '0 auto' };
const warningDismiss: CSSProperties = { background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', fontSize: 13, fontWeight: 600, padding: '6px 16px', borderRadius: 'var(--radius)', cursor: 'pointer', marginLeft: 12, whiteSpace: 'nowrap' };
