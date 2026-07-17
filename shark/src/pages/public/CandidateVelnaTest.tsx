import { useState, useEffect, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getTestSession, type VelnaSubtest } from '../../data/mockCandidateTests';
import { getJobById } from '../../data/mockJobs';
import { useAntiCheat } from '../../hooks/useAntiCheat';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useTestTokenGuard, renderTokenGuardError } from '../../hooks/useTestTokenGuard';
import { calculateVelnaResult } from '../../lib/scoring';
import { shuffleOptions } from '../../lib/shuffle';
import { buildVelnaSubtestsFromReal } from '../../data/realQuestionsAdapter';
import type { CognitiveLevel } from '../../data/questionLoader';
import { publicApi } from '../../lib/publicApi';
import { ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';
import './candidate-test.css';

const log = logger('VELNA');

type Phase = 'intro' | 'subtest_intro' | 'subtest_running' | 'done';

export default function CandidateVelnaTest() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const session = token ? getTestSession(token) : undefined;

  const storageKey = `velna_${token ?? 'anon'}_answers`;
  const [phase, setPhase] = useState<Phase>('intro');
  const [subtestIdx, setSubtestIdx] = useState(0);
  const [questionIdx, setQuestionIdx] = useState(0);
  const [answers, setAnswers, clearAnswers] = usePersistedState<Record<string, string>>(storageKey, {});
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const guard = useTestTokenGuard(token);

  // Cognitive level: viene del job. Mock no lo tiene aún, default 'mid' (100 preguntas).
  // Cuando el frontend hable con backend real, se lee de ApiJob.cognitive_level.
  const cognitiveLevel: CognitiveLevel = 'mid';

  // VELNA_SUBTESTS se carga async (lazy import del JSON correspondiente al level).
  // Esto saca ~500KB del bundle inicial y los carga solo cuando el candidato hace este test.
  const [VELNA_SUBTESTS, setVelnaSubtests] = useState<VelnaSubtest[]>([]);
  useEffect(() => {
    let cancelled = false;
    buildVelnaSubtestsFromReal(cognitiveLevel).then((subs) => {
      if (!cancelled) setVelnaSubtests(subs);
    });
    return () => { cancelled = true; };
  }, [cognitiveLevel]);

  const subtest = VELNA_SUBTESTS[subtestIdx];
  const currentQ = subtest?.questions[questionIdx];

  // Shuffle: pre-calculamos un orden aleatorio de opciones por pregunta y lo cacheamos
  // (con `useMemo` el mismo orden persiste mientras el componente esté vivo).
  // Sin shuffle, las preguntas con la respuesta correcta siempre en posición B sesgan el resultado.
  const shuffledOptionsByQuestionId = useMemo(() => {
    const map: Record<string, typeof currentQ['options']> = {};
    if (!subtest) return map;
    for (const q of subtest.questions) {
      // Seed = hash simple del id de la pregunta. Da reproducibilidad si el candidato
      // recarga la página dentro de la misma sesión (no le cambia el orden).
      const seed = simpleHash(q.id);
      const { shuffled } = shuffleOptions(q.options, seed);
      map[q.id] = shuffled;
    }
    return map;
  }, [subtest]);

  const displayedOptions = currentQ ? shuffledOptionsByQuestionId[currentQ.id] : undefined;

  const { count: antiCheatCount, events: antiCheatEvents } = useAntiCheat({
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

  // Si no hay session (mock no encuentra el token), aceptamos si hay token real:
  // el backend valida el token en el submit.
  if (!token) return <p>Link inválido. <Link to="/">Volver</Link></p>;

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
      // Si no hay job (caso del demo marketing — no hay perfil ideal definido), usamos
      // un ideal neutro (50/50/50/50/50). Esto permite que el cálculo de scores raw
      // funcione igual y se persistan en backend. El similarity_with_ideal no es
      // informativo en este caso, pero los scores por subtest sí.
      const ideal = job?.velna_ideal ?? { verbal: 50, espacial: 50, logica: 50, numerica: 50, abstracta: 50 };
      const result = calculateVelnaResult(VELNA_SUBTESTS, answers, ideal);

      const navigateOnSuccess = () => {
        clearAnswers();
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
      };

      if (token) {
        const subtestPcts = result.per_subtest;
        const get = (k: string) => subtestPcts.find((s) => s.key === k)?.pct ?? 0;
        publicApi.submitTest(token, {
          velna: {
            verbal: get('verbal'),
            espacial: get('espacial'),
            logica: get('logica'),
            numerica: get('numerica'),
            abstracta: get('abstracta'),
            total: subtestPcts.reduce((s, x) => s + x.correct, 0),
            max: subtestPcts.reduce((s, x) => s + x.total, 0),
          },
          anti_cheat: antiCheatEvents.length > 0 ? {
            count: antiCheatEvents.length,
            events: antiCheatEvents.map((e) => ({ type: e.type, question_id: e.question_id, duration_ms: e.duration_ms })),
            phase: 'conductual',
          } : undefined,
        }).then(navigateOnSuccess).catch((err: unknown) => {
          const msg = err instanceof ApiError ? err.message : (err as Error).message;
          log.warn('submit failed', { error: msg, status: err instanceof ApiError ? err.status : undefined });
          setSubmitError(msg || 'No pudimos guardar tus respuestas. Probá de nuevo en un momento.');
        });
      } else {
        navigateOnSuccess();
      }
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

  const guardError = renderTokenGuardError(guard);
  if (guardError) return guardError;

  if (submitError) {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks">
            <h1>No pudimos guardar tus respuestas</h1>
            <p>{submitError}</p>
            <p style={{ marginTop: 16 }}>
              Tus respuestas están seguras en este navegador. Recarga la página y vuelve a enviar.
              Si sigue fallando, escríbenos a <a href="mailto:proyectos@kunodigital.com">proyectos@kunodigital.com</a>.
            </p>
            <button className="ct-btn-primary" style={{ marginTop: 24 }} onClick={() => { setSubmitError(null); setPhase('done'); }}>
              Reintentar
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (phase === 'intro') {
    // Las preguntas cognitivas se cargan async (dynamic import del JSON del level
    // correspondiente). Si el candidato cliquea "Empezar" antes de que la carga termine,
    // startSubtest(0) crashea porque VELNA_SUBTESTS[0] es undefined. Por eso disabled
    // el botón mientras length===0.
    const subtestsReady = VELNA_SUBTESTS.length > 0;
    return (
      <div className="ct-root">
        <header className="ct-header">
          <div className="ct-brand">SharkTalents.AI</div>
          <div className="ct-brand-tag">VELNA — Cognitiva</div>
        </header>
        <main className="ct-main">
          <h1>Evaluación cognitiva (VELNA)</h1>
          <p className="ct-instructions">
            Esta evaluación tiene <strong>5 sub-pruebas con tiempo</strong>. Cada una mide una habilidad distinta. No te preocupes si no terminas todas las preguntas — la velocidad y la precisión cuentan parejo.
          </p>
          {subtestsReady ? (
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
          ) : (
            <p className="muted" style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              Cargando preguntas…
            </p>
          )}
          <button
            className="ct-start-btn"
            onClick={() => setPhase('subtest_intro')}
            disabled={!subtestsReady}
            style={!subtestsReady ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            {subtestsReady ? 'Empezar →' : 'Cargando…'}
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
          {currentQ?.question_svg && (
            <div
              className="ct-question-svg"
              style={{
                background: '#fff',
                borderRadius: 8,
                padding: 24,
                margin: '12px 0',
                textAlign: 'center',
                maxWidth: 560,
                marginLeft: 'auto',
                marginRight: 'auto',
              }}
              // Width 100% del contenedor para tablas/numéricas (ancho > alto).
              // Max-height generoso para que figuras cuadradas también se vean bien.
              dangerouslySetInnerHTML={{ __html: currentQ.question_svg.replace('<svg ', '<svg style="width:100%; max-height:400px; height:auto" ') }}
            />
          )}
          <div className="ct-mc-options">
            {(displayedOptions ?? currentQ?.options ?? []).map((opt, displayIdx) => {
              const isSelected = answers[currentQ?.id ?? ''] === opt.id;
              const displayLetter = ['A', 'B', 'C', 'D', 'E'][displayIdx] ?? opt.id.toUpperCase();
              return (
                <button
                  key={opt.id}
                  className={`ct-mc-option ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => {
                    answer(opt.id);
                    // Auto-advance con delay suficiente para evitar double-click accidental
                    // que registra el segundo click en la pregunta siguiente.
                    setTimeout(nextQuestion, 500);
                  }}
                >
                  <span className="ct-mc-letter">{displayLetter}</span>
                  {opt.svg ? (
                    <span
                      className="ct-mc-svg"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#fff',
                        borderRadius: 6,
                        padding: 8,
                        marginLeft: 12,
                        width: 80,
                        height: 80,
                        flexShrink: 0,
                      }}
                      // Inyectamos width/height en el SVG para que ocupe el contenedor.
                      // Sin esto, el browser le da dimensiones default minúsculas (~20px).
                      dangerouslySetInnerHTML={{ __html: opt.svg.replace('<svg ', '<svg width="64" height="64" ') }}
                    />
                  ) : (
                    <span className="ct-mc-text">{opt.text}</span>
                  )}
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

/** Hash simple para seed reproducible del shuffle por pregunta. */
function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
