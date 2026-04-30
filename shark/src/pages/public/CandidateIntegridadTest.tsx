import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getTestSession, INTEGRITY_QUESTIONS } from '../../data/mockCandidateTests';
import { useAntiCheat } from '../../hooks/useAntiCheat';
import './candidate-test.css';

const LIKERT_LABELS = [
  { value: 1, label: 'Totalmente en desacuerdo' },
  { value: 2, label: 'En desacuerdo' },
  { value: 3, label: 'Neutral' },
  { value: 4, label: 'De acuerdo' },
  { value: 5, label: 'Totalmente de acuerdo' },
];

export default function CandidateIntegridadTest() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const session = token ? getTestSession(token) : undefined;

  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const { count: antiCheatCount } = useAntiCheat({
    enabled: !submitted,
    current_question_id: null, // todo en una sola pantalla
  });

  if (!session) return <p>Link inválido. <Link to="/">Volver</Link></p>;

  const completedCount = Object.keys(answers).length;
  const totalCount = INTEGRITY_QUESTIONS.length;
  const allAnswered = completedCount === totalCount;

  function setAnswer(qid: string, value: number) {
    setAnswers((curr) => ({ ...curr, [qid]: value }));
  }

  function submit() {
    if (!allAnswered) return;
    setSubmitted(true);
    setTimeout(() => navigate(`/test/${token}/done?phase=integridad`), 1500);
  }

  if (submitted) {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks">
            <h1>✓ Respuestas guardadas</h1>
            <p>Última prueba completa. Te llevamos a la pantalla final…</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="ct-root">
      <header className="ct-test-header">
        <div className="ct-test-brand">SharkTalents.AI · Integridad</div>
        <div className="ct-test-progress">
          <div className="ct-progress-bar">
            <div className="ct-progress-bar-fill" style={{ width: `${(completedCount / totalCount) * 100}%` }} />
          </div>
          <span className="ct-progress-text">{completedCount}/{totalCount}</span>
        </div>
      </header>

      <main className="ct-main">
        <div className="ct-test-intro">
          <h1>Prueba de integridad</h1>
          <p className="ct-instructions">
            Marcá qué tan de acuerdo estás con cada afirmación. <strong>No hay respuestas correctas</strong> — buscamos honestidad, no agradar. Las respuestas extremas en todas las preguntas pueden levantar alertas.
          </p>
        </div>

        {antiCheatCount > 0 && (
          <div className="ct-anticheat-warning">
            ⚠️ {antiCheatCount} {antiCheatCount === 1 ? 'salida detectada' : 'salidas detectadas'}.
          </div>
        )}

        <div className="ct-integrity-questions">
          {INTEGRITY_QUESTIONS.map((q, idx) => {
            const selected = answers[q.id];
            return (
              <div key={q.id} className="ct-integrity-row">
                <div className="ct-integrity-text">
                  <span className="ct-integrity-num">{idx + 1}.</span>
                  {q.text}
                </div>
                <div className="ct-likert-scale">
                  {LIKERT_LABELS.map((l) => (
                    <button
                      key={l.value}
                      className={`ct-likert-btn ${selected === l.value ? 'is-selected' : ''}`}
                      onClick={() => setAnswer(q.id, l.value)}
                      title={l.label}
                    >
                      {l.value}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="ct-likert-legend">
          <span>1 = Totalmente en desacuerdo</span>
          <span>5 = Totalmente de acuerdo</span>
        </div>

        <div className="ct-test-actions" style={{ justifyContent: 'space-between' }}>
          <div className="ct-test-status">
            {completedCount} de {totalCount} respondidas
          </div>
          <button className="ct-start-btn" onClick={submit} disabled={!allAnswered}>
            Terminar prueba →
          </button>
        </div>
      </main>
    </div>
  );
}
