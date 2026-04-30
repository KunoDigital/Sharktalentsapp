import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getTestSession, VELNA_SUBTESTS, type VelnaSubtest } from '../../data/mockCandidateTests';
import { getJobById } from '../../data/mockJobs';
import { useAntiCheat } from '../../hooks/useAntiCheat';
import { calculateVelnaResult } from '../../lib/scoring';
import './candidate-test.css';

type Phase = 'intro' | 'subtest_intro' | 'subtest_running' | 'done';

export default function CandidateVelnaTest() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const session = token ? getTestSession(token) : undefined;

  const [phase, setPhase] = useState<Phase>('intro');
  const [subtestIdx, setSubtestIdx] = useState(0);
  const [questionIdx, setQuestionIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({}); // qid -> optId
  const [secondsLeft, setSecondsLeft] = useState(0);

  const subtest = VELNA_SUBTESTS[subtestIdx];
  const currentQ = subtest?.questions[questionIdx];

  const { count: antiCheatCount } = useAntiCheat({
    enabled: phase === 'subtest_running',
    current_question_id: currentQ?.id ?? null,
  });

  // Timer
  useEffect(() => {
    if (phase !== 'subtest_running') return;
    if (secondsLeft <= 0) {
      handleSubtestEnd();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, secondsLeft]);

  if (!session) return <p>Link inválido. <Link to="/">Volver</Link></p>;

  function startSubtest(idx: number) {
    const st = VELNA_SUBTESTS[idx];
    setSubtestIdx(idx);
    setQuestionIdx(0);
    setSecondsLeft(st.duration_sec);
    setPhase('subtest_running');
  }

  function handleSubtestEnd() {
    if (subtestIdx < VELNA_SUBTESTS.length - 1) {
      setSubtestIdx(subtestIdx + 1);
      setQuestionIdx(0);
      setPhase('subtest_intro');
    } else {
      setPhase('done');
      const job = session ? getJobById(session.job_id) : undefined;
      const result = job
        ? calculateVelnaResult(VELNA_SUBTESTS, answers, job.velna_ideal)
        : null;
      setTimeout(() => navigate(`/test/${token}/disc`, result ? {
        state: {
          score: {
            type: 'velna',
            data: {
              aggregate: result.aggregate_pct,
              similarity: result.similarity_with_ideal_pct,
              per_subtest: result.per_subtest,
            },
          },
        },
      } : undefined), 1500);
    }
  }

  function answer(optId: string) {
    if (!currentQ) return;
    setAnswers((curr) => ({ ...curr, [currentQ.id]: optId }));
  }

  function nextQuestion() {
    if (!subtest) return;
    if (questionIdx < subtest.questions.length - 1) {
      setQuestionIdx((i) => i + 1);
    } else {
      handleSubtestEnd();
    }
  }

  if (phase === 'intro') {
    return (
      <div className="ct-root">
        <header className="ct-header">
          <div className="ct-brand">SharkTalents.AI</div>
          <div className="ct-brand-tag">VELNA — Cognitiva</div>
        </header>
        <main className="ct-main">
          <h1>Evaluación cognitiva (VELNA)</h1>
          <p className="ct-instructions">
            Esta evaluación tiene <strong>5 sub-pruebas con tiempo</strong>. Cada una mide una habilidad distinta. No te preocupes si no terminás todas las preguntas — la velocidad y la precisión cuentan parejo.
          </p>
          <div className="ct-subtests-list">
            {VELNA_SUBTESTS.map((st, i) => (
              <div key={st.key} className="ct-subtest-row">
                <div className="ct-subtest-num">{i + 1}</div>
                <div className="ct-subtest-info">
                  <div className="ct-subtest-label">{st.label}</div>
                  <div className="ct-subtest-desc">{st.description}</div>
                </div>
                <div className="ct-subtest-time">{Math.floor(st.duration_sec / 60)} min · {st.questions.length} preg.</div>
              </div>
            ))}
          </div>
          <button className="ct-start-btn" onClick={() => setPhase('subtest_intro')}>
            Empezar →
          </button>
        </main>
      </div>
    );
  }

  if (phase === 'subtest_intro') {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks-big">
            <div className="ct-current-tag">SUB-PRUEBA {subtestIdx + 1} DE {VELNA_SUBTESTS.length}</div>
            <h1>{subtest.label}</h1>
            <p>{subtest.description}</p>
            <p className="muted">
              Tenés <strong>{Math.floor(subtest.duration_sec / 60)} minutos</strong> para responder {subtest.questions.length} preguntas.
            </p>
            <button className="ct-start-btn" onClick={() => startSubtest(subtestIdx)}>
              Comenzar → ({Math.floor(subtest.duration_sec / 60)} min)
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks">
            <h1>✓ VELNA completa</h1>
            <p>Pasamos al siguiente test (DISC)…</p>
          </div>
        </main>
      </div>
    );
  }

  // phase === 'subtest_running'
  return (
    <div className="ct-root">
      <header className="ct-test-header">
        <div className="ct-test-brand">{subtest.label}</div>
        <div className="ct-test-progress">
          <div className="ct-progress-bar">
            <div className="ct-progress-bar-fill" style={{ width: `${((questionIdx + 1) / subtest.questions.length) * 100}%` }} />
          </div>
          <span className="ct-progress-text">{questionIdx + 1}/{subtest.questions.length}</span>
        </div>
        <Timer secondsLeft={secondsLeft} totalSeconds={subtest.duration_sec} />
      </header>

      <main className="ct-main">
        {antiCheatCount > 0 && (
          <div className="ct-anticheat-warning">
            ⚠️ {antiCheatCount} {antiCheatCount === 1 ? 'salida detectada' : 'salidas detectadas'}.
          </div>
        )}

        <section className="ct-question-card">
          <div className="ct-question-num">{subtest.label} · pregunta {questionIdx + 1}/{subtest.questions.length}</div>
          <h2 className="ct-question-text">{currentQ?.question}</h2>
          <div className="ct-mc-options">
            {currentQ?.options.map((opt) => {
              const isSelected = answers[currentQ.id] === opt.id;
              return (
                <button
                  key={opt.id}
                  className={`ct-mc-option ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => {
                    answer(opt.id);
                    setTimeout(nextQuestion, 200); // auto-advance en VELNA
                  }}
                >
                  <span className="ct-mc-letter">{opt.id.toUpperCase()}</span>
                  <span className="ct-mc-text">{opt.text}</span>
                </button>
              );
            })}
          </div>
        </section>

        <div className="ct-test-actions" style={{ justifyContent: 'flex-end' }}>
          <button className="ct-start-btn" onClick={nextQuestion}>
            {questionIdx < subtest.questions.length - 1 ? 'Saltar pregunta →' : 'Terminar sub-prueba →'}
          </button>
        </div>
      </main>
    </div>
  );
}

function Timer({ secondsLeft, totalSeconds }: { secondsLeft: number; totalSeconds: number }) {
  const min = Math.floor(secondsLeft / 60);
  const sec = secondsLeft % 60;
  const pct = (secondsLeft / totalSeconds) * 100;
  const isLow = pct < 25;
  return (
    <div className={`ct-timer ${isLow ? 'is-low' : ''}`}>
      ⏱ {min}:{sec.toString().padStart(2, '0')}
    </div>
  );
}

export function _placeholder(_st: VelnaSubtest) { return null; }
