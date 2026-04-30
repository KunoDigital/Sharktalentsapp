import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getTestSession, TECNICA_QUESTIONS, type TecnicaQuestion } from '../../data/mockCandidateTests';
import { useAntiCheat } from '../../hooks/useAntiCheat';
import { usePersistedState, hasPersistedState } from '../../hooks/usePersistedState';
import './candidate-test.css';

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

  const { count: antiCheatCount } = useAntiCheat({
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

  return (
    <div className="ct-mc-options">
      {(q.options ?? []).map((opt) => {
        const isSelected = answer?.selected_option_id === opt.id;
        return (
          <button
            key={opt.id}
            className={`ct-mc-option ${isSelected ? 'is-selected' : ''}`}
            onClick={() => onOption(opt.id)}
          >
            <span className="ct-mc-letter">{opt.id.toUpperCase()}</span>
            <span className="ct-mc-text">{opt.text}</span>
          </button>
        );
      })}
    </div>
  );
}
