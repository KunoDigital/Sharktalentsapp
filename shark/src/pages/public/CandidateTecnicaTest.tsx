import { useState, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getTestSession, TECNICA_QUESTIONS, type TecnicaQuestion } from '../../data/mockCandidateTests';
import { getJobById } from '../../data/mockJobs';
import { useAntiCheat } from '../../hooks/useAntiCheat';
import { usePersistedState, hasPersistedState } from '../../hooks/usePersistedState';
import { shuffleOptions } from '../../lib/shuffle';
import { publicApi } from '../../lib/publicApi';
import { ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';
import './candidate-test.css';

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
  const session = token ? getTestSession(token) : undefined;
  const questions = session ? TECNICA_QUESTIONS[session.job_id] ?? [] : [];

  const storageKey = `tecnica_${token ?? 'anon'}`;
  const hadResume = hasPersistedState(`${storageKey}_answers`);
  const [answers, setAnswers, clearAnswers] = usePersistedState<Record<string, Answer>>(`${storageKey}_answers`, {});
  const [currentIdx, setCurrentIdx, clearIdx] = usePersistedState<number>(`${storageKey}_idx`, 0);
  const [submitted, setSubmitted] = useState(false);

  const currentQ = questions[currentIdx];

  const { count: antiCheatCount, events: antiCheatEvents } = useAntiCheat({
    enabled: !submitted,
    current_question_id: currentQ?.id ?? null,
  });

  if (!session) return <p>Link inválido. <Link to="/">Volver</Link></p>;
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
      // Score solo cuenta multiple_choice con correct_option_id
      const scorable = questions.filter((q) => q.correct_option_id != null);
      const correct = scorable.filter((q) => answers[q.id]?.selected_option_id === q.correct_option_id).length;
      const pct = scorable.length > 0 ? Math.round((correct / scorable.length) * 100) : 0;

      // Submit al backend
      if (token && scorable.length > 0) {
        const job = session ? getJobById(session.job_id) : undefined;
        const minRequired = job?.tecnica_minimo_pct ?? 60;
        publicApi.submitTest(token, {
          tecnica: {
            total_questions: scorable.length,
            total_correct: correct,
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
            Estas preguntas evalúan tu dominio técnico para el puesto. Si una pregunta tiene "Argumentar tu respuesta" abajo, escribí en tus palabras — eso vale más que la opción que marcaste.
          </p>
        </div>

        {hadResume && Object.keys(answers).length > 0 && (
          <div className="ct-resume-banner">
            ↩️ Continuamos donde quedaste — tenés {Object.keys(answers).length} respuestas guardadas.
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
