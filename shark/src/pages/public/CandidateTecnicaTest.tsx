import { useState, useMemo, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { type TecnicaQuestion } from '../../data/mockCandidateTests';
import { useAntiCheat } from '../../hooks/useAntiCheat';
import { usePersistedState, hasPersistedState } from '../../hooks/usePersistedState';
import { shuffleOptions } from '../../lib/shuffle';
import { publicApi } from '../../lib/publicApi';
import { ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';
import './candidate-test.css';

/** Estado de carga del session desde backend. */
type SessionState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready';
      jobId: string;
      jobTitle: string;
      candidateName: string;
      tecnicaMinimoPct: number;
      questions: TecnicaQuestion[];
    };

const log = logger('TECNICA');

/** Hash simple para seed reproducible del shuffle por pregunta. */
function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

type Answer = {
  question_id: string;
  selected_option_id?: string; // multiple_choice / situational
  open_text?: string; // open_ended
};

export default function CandidateTecnicaTest() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [sessionState, setSessionState] = useState<SessionState>({ phase: 'loading' });
  // Si el candidato no completó salary_expectation o availability, mostramos formulario
  // de registro antes del test. Se persiste a `Candidates` vía POST /register.
  const [needsRegister, setNeedsRegister] = useState(false);
  const [regFullName, setRegFullName] = useState('');
  const [regSalary, setRegSalary] = useState('');
  const [regAvailability, setRegAvailability] = useState('');
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  // Cargar session + preguntas del backend (NO mock).
  useEffect(() => {
    if (!token) {
      setSessionState({ phase: 'error', message: 'Token faltante en la URL' });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const status = await publicApi.getTestStatus(token);
        if (cancelled) return;
        if (!status) {
          setSessionState({ phase: 'error', message: 'Modo mock (sin API) — no aplica para este flujo.' });
          return;
        }
        if (status.expired) {
          setSessionState({ phase: 'error', message: 'El link expiró. Pedí uno nuevo a Kuno Digital.' });
          return;
        }
        if (!status.job) {
          setSessionState({ phase: 'error', message: 'No se encontró el puesto asociado al test.' });
          return;
        }
        const tq = await publicApi.getTechQuestions(token);
        if (cancelled) return;
        if (!tq) {
          setSessionState({ phase: 'error', message: 'No se pudieron cargar las preguntas.' });
          return;
        }
        // Adaptar shape backend → shape que usan los componentes (heredado de mock).
        // Backend: { id, text, options: string[], kind? }
        // Componente: { id, question, type, options: [{id, text}] }
        const questions: TecnicaQuestion[] = (tq.questions ?? []).map((q) => ({
          id: q.id,
          question: q.text,
          area: '',
          type: q.type === 'open_ended'
            ? 'open_ended'
            : (q as { kind?: string }).kind === 'situational' ? 'situational' : 'multiple_choice',
          options: Array.isArray((q as { options?: unknown }).options)
            ? ((q as { options: Array<string | { id: string; text: string }> }).options).map((o, idx) =>
                typeof o === 'string'
                  ? { id: `${q.id}_opt_${idx}`, text: o }
                  : o,
              )
            : undefined,
        }));
        const job = status.job;
        const candidateAny = (status.candidate ?? {}) as { name?: string; salary_expectation?: number | null; availability?: string | null };
        // Decidir si necesitamos registro: faltan salary o availability.
        const missingRegister = !candidateAny.salary_expectation || !candidateAny.availability;
        if (missingRegister) {
          setRegFullName(candidateAny.name ?? '');
          setNeedsRegister(true);
        }
        setSessionState({
          phase: 'ready',
          jobId: job.ROWID ?? job.id ?? '',
          jobTitle: job.title,
          candidateName: candidateAny.name ?? 'Candidato',
          tecnicaMinimoPct: 60,
          questions,
        });
      } catch (err) {
        if (cancelled) return;
        const status = err instanceof ApiError ? err.status : null;
        if (status === 401 || status === 404) {
          setSessionState({ phase: 'error', message: 'Link inválido o expirado. Contactá a Kuno Digital.' });
        } else {
          setSessionState({ phase: 'error', message: `Error cargando el test: ${(err as Error).message}` });
          log.warn('failed to load test', { error: (err as Error).message, status });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const questions = sessionState.phase === 'ready' ? sessionState.questions : [];
  const storageKey = `tecnica_${token ?? 'anon'}`;
  const hadResume = hasPersistedState(`${storageKey}_answers`);
  const [answers, setAnswers, clearAnswers] = usePersistedState<Record<string, Answer>>(`${storageKey}_answers`, {});
  const [currentIdx, setCurrentIdx, clearIdx] = usePersistedState<number>(`${storageKey}_idx`, 0);
  const [submitted, setSubmitted] = useState(false);

  const currentQ = questions[currentIdx];

  const { count: antiCheatCount, events: antiCheatEvents } = useAntiCheat({
    enabled: !submitted && sessionState.phase === 'ready',
    current_question_id: currentQ?.id ?? null,
  });

  if (sessionState.phase === 'loading') {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks-big">
            <h1>Cargando…</h1>
            <p>Preparando tu prueba técnica</p>
          </div>
        </main>
      </div>
    );
  }
  if (sessionState.phase === 'error') {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks-big">
            <h1>Link inválido</h1>
            <p>{sessionState.message}</p>
            <p><Link to="/">Volver</Link></p>
          </div>
        </main>
      </div>
    );
  }
  if (questions.length === 0) {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks-big">
            <h1>Sin preguntas configuradas</h1>
            <p>Aún no se generaron preguntas técnicas para este puesto. Contactá a Kuno Digital.</p>
          </div>
        </main>
      </div>
    );
  }

  // FORM DE REGISTRO antes del test (solo si falta salary_expectation o availability)
  if (needsRegister && sessionState.phase === 'ready') {
    const handleRegisterSubmit = async () => {
      setRegError(null);
      if (!regFullName.trim()) { setRegError('Nombre completo es requerido'); return; }
      if (!regSalary.trim() || Number(regSalary) <= 0) { setRegError('Aspiración salarial es requerida'); return; }
      if (!regAvailability.trim()) { setRegError('Disponibilidad es requerida'); return; }
      setRegSubmitting(true);
      try {
        if (token) {
          await publicApi.registerCandidateInfo(token, {
            full_name: regFullName.trim(),
            salary_expectation: Number(regSalary),
            availability: regAvailability.trim(),
          });
        }
        setNeedsRegister(false);
      } catch (err) {
        setRegError((err as Error).message || 'No se pudo guardar');
      } finally {
        setRegSubmitting(false);
      }
    };
    return (
      <div className="ct-root">
        <main className="ct-main" style={{ maxWidth: 540, margin: '40px auto', padding: '0 20px' }}>
          <h1 style={{ marginBottom: 12 }}>Antes de empezar</h1>
          <p style={{ color: '#6b7280', marginBottom: 24 }}>
            Estás aplicando a <strong>{sessionState.jobTitle}</strong>. Necesitamos un par de datos antes de iniciar la prueba técnica.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 14, color: '#374151', fontWeight: 600 }}>Nombre completo *</span>
              <input
                type="text"
                value={regFullName}
                onChange={(e) => setRegFullName(e.target.value)}
                placeholder="Andrea Martínez Ruiz"
                style={{ padding: '12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 16 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 14, color: '#374151', fontWeight: 600 }}>Aspiración salarial mensual (USD) *</span>
              <input
                type="number"
                min="0"
                value={regSalary}
                onChange={(e) => setRegSalary(e.target.value)}
                placeholder="2000"
                style={{ padding: '12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 16 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 14, color: '#374151', fontWeight: 600 }}>Disponibilidad para empezar *</span>
              <select
                value={regAvailability}
                onChange={(e) => setRegAvailability(e.target.value)}
                style={{ padding: '12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 16, background: '#fff' }}
              >
                <option value="">— Elegir una opción —</option>
                <option value="Inmediata">Inmediata</option>
                <option value="Preaviso 15 días">Preaviso 15 días</option>
                <option value="Preaviso 1 mes">Preaviso 1 mes</option>
                <option value="Preaviso 2 meses">Preaviso 2 meses</option>
                <option value="Más de 2 meses">Más de 2 meses</option>
              </select>
            </label>
            {regError && (
              <div style={{ padding: '10px 14px', background: 'rgba(220,53,69,0.1)', border: '1px solid rgba(220,53,69,0.4)', borderRadius: 6, color: '#dc3545', fontSize: 14 }}>
                {regError}
              </div>
            )}
            <button
              type="button"
              onClick={handleRegisterSubmit}
              disabled={regSubmitting}
              style={{
                marginTop: 8, padding: '14px 28px', background: '#0e1218', color: '#dafd6f',
                border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer',
              }}
            >
              {regSubmitting ? 'Guardando…' : 'Empezar prueba técnica'}
            </button>
          </div>
        </main>
      </div>
    );
  }

  const isLast = currentIdx === questions.length - 1;
  const currentAnswer = answers[currentQ.id];
  const canAdvance =
    currentQ.type === 'open_ended'
      ? !!currentAnswer?.open_text && currentAnswer.open_text.length >= 30
      : !!currentAnswer?.selected_option_id;

  function setOption(optId: string) {
    setAnswers((curr) => ({
      ...curr,
      [currentQ.id]: { question_id: currentQ.id, selected_option_id: optId },
    }));
  }

  function setText(text: string) {
    setAnswers((curr) => ({
      ...curr,
      [currentQ.id]: { question_id: currentQ.id, open_text: text },
    }));
  }

  function next() {
    if (!isLast) {
      setCurrentIdx((i) => i + 1);
    } else {
      setSubmitted(true);
      clearAnswers();
      clearIdx();
      // Cálculo local SOLO para mostrar al candidato en la pantalla "done".
      // El scoring real (técnico + validez situacional + estilo + match con jefe) lo
      // calcula el backend a partir de `answers` — mismo cache de preguntas, fuente única.
      const scorable = questions.filter((q) => q.correct_option_id != null);
      const correct = scorable.filter((q) => answers[q.id]?.selected_option_id === q.correct_option_id).length;
      const pct = scorable.length > 0 ? Math.round((correct / scorable.length) * 100) : 0;

      // Submit al backend con `answers: { qid: index }` (Path 1 del doble eje).
      // Incluimos TODAS las preguntas respondidas (técnicas + situacionales), el backend
      // discrimina por `kind` del cache. Construimos el mapa qid → index_0_3 buscando
      // la posición de la opción seleccionada dentro de las options de cada pregunta.
      if (token) {
        const answersForBackend: Record<string, number> = {};
        for (const q of questions) {
          if (q.type === 'open_ended') continue; // open_ended no entra al scoring de doble eje
          const ans = answers[q.id];
          if (!ans?.selected_option_id) continue;
          if (!q.options || q.options.length === 0) continue;
          const idx = q.options.findIndex((o) => o.id === ans.selected_option_id);
          if (idx >= 0) answersForBackend[q.id] = idx;
        }

        if (Object.keys(answersForBackend).length > 0) {
          const minRequired = sessionState.phase === 'ready' ? sessionState.tecnicaMinimoPct : 60;
          publicApi.submitTest(token, {
            tecnica: {
              answers: answersForBackend,
              min_required: minRequired,
            },
            anti_cheat: antiCheatEvents.length > 0 ? {
              count: antiCheatEvents.length,
              events: antiCheatEvents.map((e) => ({ type: e.type, question_id: e.question_id, duration_ms: e.duration_ms })),
              phase: 'tecnica',
            } : undefined,
          }).catch((err: unknown) => {
            if (err instanceof ApiError) {
              log.warn('submit falló', { status: err.status, code: err.code, msg: err.message });
            } else {
              log.warn('submit error', { error: (err as Error).message });
            }
          });
        }
      }

      setTimeout(() => navigate(`/test/${token}/done?phase=tecnica`, {
        state: {
          score: {
            type: 'tecnica',
            data: { correct, total: scorable.length, pct },
          },
        },
      }), 1500);
    }
  }

  function prev() {
    if (currentIdx > 0) setCurrentIdx((i) => i - 1);
  }

  if (submitted) {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks">
            <h1>✓ Respuestas guardadas</h1>
            <p>Pasamos a la siguiente prueba en un momento…</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="ct-root">
      <header className="ct-test-header">
        <div className="ct-test-brand">SharkTalents.AI</div>
        <div className="ct-test-progress">
          <div className="ct-progress-bar">
            <div className="ct-progress-bar-fill" style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }} />
          </div>
          <span className="ct-progress-text">{currentIdx + 1}/{questions.length}</span>
        </div>
      </header>

      <main className="ct-main">
        <div className="ct-test-intro">
          <h1>Prueba técnica</h1>
          <p className="ct-instructions">
            Estas preguntas evalúan tu dominio técnico para el puesto. Si una pregunta tiene "Argumentar tu respuesta" abajo, escribe en tus palabras — eso vale más que la opción que marcaste.
          </p>
        </div>

        {hadResume && Object.keys(answers).length > 0 && (
          <div className="ct-resume-banner">
            ↩️ Continuamos donde quedaste — tienes {Object.keys(answers).length} respuestas guardadas.
            <button
              className="ct-resume-clear"
              onClick={() => {
                if (confirm('¿Empezar de cero?')) { clearAnswers(); clearIdx(); }
              }}
            >Empezar de cero</button>
          </div>
        )}

        {antiCheatCount > 0 && (
          <div className="ct-anticheat-warning">
            ⚠️ Detectamos {antiCheatCount} {antiCheatCount === 1 ? 'salida' : 'salidas'} de la pantalla. Quedaron registradas. Mantenete acá hasta terminar.
          </div>
        )}

        <section className="ct-question-card">
          <div className="ct-question-num">
            {currentIdx + 1}/{questions.length} · {currentQ.area}
            {currentQ.type === 'situational' && <span className="ct-tag-situational"> · Situacional</span>}
          </div>
          {currentQ.type === 'situational' ? (
            <p className="ct-situational-hint" style={{
              fontSize: '0.85rem',
              color: '#a5b4fc',
              padding: '0.5rem 0.75rem',
              background: 'rgba(99, 102, 241, 0.08)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: '6px',
              marginBottom: '0.75rem',
            }}>
              💡 No hay una respuesta única "correcta" — marcá la opción que <em>realmente harías</em> en este escenario.
              Más de una opción puede ser válida; lo que evaluamos es tu estilo de trabajo.
            </p>
          ) : null}
          <h2 className="ct-question-text">{currentQ.question}</h2>
          <QuestionInput
            q={currentQ}
            answer={currentAnswer}
            onOption={setOption}
            onText={setText}
          />
        </section>

        <div className="ct-test-actions">
          <button className="ct-test-back" onClick={prev} disabled={currentIdx === 0}>← Atrás</button>
          <div className="ct-test-status">{Object.keys(answers).length} de {questions.length} respondidas</div>
          <button className="ct-start-btn" onClick={next} disabled={!canAdvance}>
            {isLast ? 'Terminar →' : 'Siguiente →'}
          </button>
        </div>
      </main>
    </div>
  );
}

function QuestionInput({
  q,
  answer,
  onOption,
  onText,
}: {
  q: TecnicaQuestion;
  answer: Answer | undefined;
  onOption: (id: string) => void;
  onText: (text: string) => void;
}) {
  if (q.type === 'open_ended') {
    const len = answer?.open_text?.length ?? 0;
    return (
      <div>
        <textarea
          className="ct-open-textarea"
          rows={6}
          placeholder="Escribí tu respuesta acá. Mínimo 30 caracteres."
          value={answer?.open_text ?? ''}
          onChange={(e) => onText(e.target.value)}
        />
        <div className="ct-open-counter">{len} caracteres {len < 30 && <span className="muted">· (mínimo 30)</span>}</div>
      </div>
    );
  }

  // Shuffle: orden de opciones rota por pregunta para evitar sesgo de posición.
  // Seed = hash del id → mismo orden si el candidato refresca la página.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const shuffled = useMemo(() => {
    if (!q.options || q.options.length === 0) return [];
    return shuffleOptions(q.options, simpleHash(q.id)).shuffled;
  }, [q.id]);

  return (
    <div className="ct-mc-options">
      {shuffled.map((opt, displayIdx) => {
        const isSelected = answer?.selected_option_id === opt.id;
        const displayLetter = ['A', 'B', 'C', 'D', 'E'][displayIdx] ?? opt.id.toUpperCase();
        return (
          <button
            key={opt.id}
            className={`ct-mc-option ${isSelected ? 'is-selected' : ''}`}
            onClick={() => onOption(opt.id)}
          >
            <span className="ct-mc-letter">{displayLetter}</span>
            <span className="ct-mc-text">{opt.text}</span>
          </button>
        );
      })}
    </div>
  );
}
