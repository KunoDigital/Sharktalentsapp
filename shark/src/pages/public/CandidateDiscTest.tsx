import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getTestSession, DISC_QUESTIONS, type DiscOption } from '../../data/mockCandidateTests';
import { getJobById } from '../../data/mockJobs';
import { useAntiCheat } from '../../hooks/useAntiCheat';
import { calculateDiscRaw, calculateDiscSimilarity, discDominantLabel } from '../../lib/scoring';
import './candidate-test.css';

type Answer = {
  question_id: string;
  most_axis: 'd' | 'i' | 's' | 'c';
  least_axis: 'd' | 'i' | 's' | 'c';
};

export default function CandidateDiscTest() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const session = token ? getTestSession(token) : undefined;

  const [answers, setAnswers] = useState<Record<string, Partial<Answer>>>({});
  const [currentIdx, setCurrentIdx] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  const currentQ = DISC_QUESTIONS[currentIdx];
  const isLast = currentIdx === DISC_QUESTIONS.length - 1;
  const completed = Object.values(answers).filter((a) => a.most_axis && a.least_axis).length;

  const { events, count: antiCheatCount } = useAntiCheat({
    enabled: !submitted,
    current_question_id: currentQ?.id ?? null,
  });

  if (!session) {
    return <p>Link inválido. <Link to="/">Volver</Link></p>;
  }

  const currentAnswer = currentQ ? answers[currentQ.id] ?? {} : {};
  const canAdvance = !!currentAnswer.most_axis && !!currentAnswer.least_axis && currentAnswer.most_axis !== currentAnswer.least_axis;

  function setMost(opt: DiscOption) {
    if (!currentQ) return;
    setAnswers((curr) => ({
      ...curr,
      [currentQ.id]: { ...curr[currentQ.id], question_id: currentQ.id, most_axis: opt.axis },
    }));
  }

  function setLeast(opt: DiscOption) {
    if (!currentQ) return;
    setAnswers((curr) => ({
      ...curr,
      [currentQ.id]: { ...curr[currentQ.id], question_id: currentQ.id, least_axis: opt.axis },
    }));
  }

  function next() {
    if (!isLast) {
      setCurrentIdx((i) => i + 1);
    } else {
      setSubmitted(true);
      // Calcular score real con la lógica local
      const validAnswers = Object.values(answers).filter(
        (a): a is { question_id: string; most_axis: 'd' | 'i' | 's' | 'c'; least_axis: 'd' | 'i' | 's' | 'c' } =>
          !!a.question_id && !!a.most_axis && !!a.least_axis,
      );
      const raw = calculateDiscRaw(DISC_QUESTIONS, validAnswers);
      const dominant = discDominantLabel(raw);
      const job = session ? getJobById(session.job_id) : undefined;
      const similarity = job ? calculateDiscSimilarity(raw, {
        d: job.disc_ideal_a.d, i: job.disc_ideal_a.i, s: job.disc_ideal_a.s, c: job.disc_ideal_a.c,
      }) : undefined;

      console.log('[DISC] submitted', { raw, dominant, similarity, antiCheatEvents: events });
      setTimeout(() => navigate(`/test/${token}/done?phase=conductual`, {
        state: {
          score: {
            type: 'disc',
            data: {
              d: Math.round(raw.d), i: Math.round(raw.i), s: Math.round(raw.s), c: Math.round(raw.c),
              dominant: dominant.label,
              similarity,
            },
          },
        },
      }), 1200);
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
            <div className="ct-progress-bar-fill" style={{ width: `${((currentIdx + 1) / DISC_QUESTIONS.length) * 100}%` }} />
          </div>
          <span className="ct-progress-text">{currentIdx + 1}/{DISC_QUESTIONS.length}</span>
        </div>
      </header>

      <main className="ct-main">
        <div className="ct-test-intro">
          <h1>Evaluación conductual — DISC</h1>
          <p className="ct-instructions">
            En cada grupo, marcá el adjetivo que <strong>más te describe</strong> (verde) y el que <strong>menos te describe</strong> (rojo).
            No hay respuestas buenas ni malas — usá tu intuición.
          </p>
        </div>

        {antiCheatCount > 0 && (
          <div className="ct-anticheat-warning">
            ⚠️ Detectamos {antiCheatCount} {antiCheatCount === 1 ? 'salida' : 'salidas'} de la pantalla. Quedaron registradas. Mantenete en esta ventana hasta terminar.
          </div>
        )}

        <section className="ct-question-card">
          <div className="ct-question-num">Pregunta {currentIdx + 1}</div>
          <div className="ct-question-options">
            {currentQ.options.map((opt) => {
              const isMost = currentAnswer.most_axis === opt.axis;
              const isLeast = currentAnswer.least_axis === opt.axis;
              return (
                <div key={opt.axis} className={`ct-option ${isMost ? 'is-most' : ''} ${isLeast ? 'is-least' : ''}`}>
                  <div className="ct-option-label">{opt.label}</div>
                  <div className="ct-option-buttons">
                    <button
                      className={`ct-opt-btn ct-opt-most ${isMost ? 'is-active' : ''}`}
                      onClick={() => setMost(opt)}
                      disabled={isLeast}
                    >
                      {isMost ? '✓ Más como yo' : 'Más como yo'}
                    </button>
                    <button
                      className={`ct-opt-btn ct-opt-least ${isLeast ? 'is-active' : ''}`}
                      onClick={() => setLeast(opt)}
                      disabled={isMost}
                    >
                      {isLeast ? '✓ Menos como yo' : 'Menos como yo'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="ct-test-actions">
          <button className="ct-test-back" onClick={prev} disabled={currentIdx === 0}>
            ← Atrás
          </button>
          <div className="ct-test-status">
            {completed} de {DISC_QUESTIONS.length} respondidas
          </div>
          <button className="ct-start-btn" onClick={next} disabled={!canAdvance}>
            {isLast ? 'Terminar →' : 'Siguiente →'}
          </button>
        </div>
      </main>
    </div>
  );
}
