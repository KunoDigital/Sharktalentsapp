import { useState, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getTestSession } from '../../data/mockCandidateTests';
import { useAntiCheat } from '../../hooks/useAntiCheat';
import { usePersistedState, hasPersistedState } from '../../hooks/usePersistedState';
import { scoreIntegrity } from '../../lib/scoring';
import { shuffleOptions } from '../../lib/shuffle';
import { getRealIntegrityQuestions } from '../../data/realQuestionsAdapter';
import { publicApi } from '../../lib/publicApi';
import { ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';
import './candidate-test.css';

const log = logger('INTEGRIDAD');

/**
 * Integridad v2 con preguntas reales del v1 (90 preguntas, 13 dimensiones).
 *
 * Formato:
 *   - Cada pregunta es situacional o autopercepción
 *   - 4 opciones, cada una con un risk_weight (0-3)
 *   - El candidato elige UNA opción
 *   - El score por dimensión se calcula con sum(risk_weights elegidos) / max_risk
 *   - Las dimensiones se clasifican como bajo/medio/alto con thresholds calibrados v1
 *
 * Shuffle: las opciones se barajean (con reverseMap para mantener risk_weight correcto).
 *
 * Anti-trampa: el componente acumula eventos y los flag al admin.
 */
export default function CandidateIntegridadTest() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  void getTestSession; // se mantiene importado para tests/mocks; session no se usa en este flow

  const questions = useMemo(() => getRealIntegrityQuestions(), []);

  const storageKey = `integridad_${token ?? 'anon'}`;
  const hadResume = hasPersistedState(`${storageKey}_answers`);
  const [answers, setAnswers, clearAnswers] = usePersistedState<Record<string, number>>(`${storageKey}_answers`, {});
  const [currentIdx, setCurrentIdx, clearIdx] = usePersistedState<number>(`${storageKey}_idx`, 0);
  const [submitted, setSubmitted] = useState(false);

  const currentQ = questions[currentIdx];
  const isLast = currentIdx === questions.length - 1;
  const completed = Object.keys(answers).length;

  const { events, count: antiCheatCount } = useAntiCheat({
    enabled: !submitted,
    current_question_id: currentQ?.id ?? null,
  });

  const { shuffled, reverseMap } = useMemo(() => {
    if (!currentQ) return { shuffled: [], reverseMap: [] };
    return shuffleOptions(currentQ.options, simpleHash(currentQ.id));
  }, [currentQ?.id]);

  // Si no hay session en mock, aceptamos si hay token — el backend valida en submit.
  if (!token) {
    return <p>Link inválido. <Link to="/">Volver</Link></p>;
  }

  const currentSelection = currentQ ? answers[currentQ.id] : undefined;
  const canAdvance = currentSelection != null;

  function selectOption(displayIdx: number) {
    if (!currentQ) return;
    const originalIdx = reverseMap[displayIdx];
    setAnswers((curr) => ({ ...curr, [currentQ.id]: originalIdx }));
  }

  function next() {
    if (!isLast) {
      setCurrentIdx((i) => i + 1);
    } else {
      setSubmitted(true);
      const result = scoreIntegrity(questions, answers);

      // Submit al backend (skip silently si useApi=false)
      if (token) {
        publicApi.submitTest(token, {
          integridad: {
            dimensions: result.dimensiones.map((d) => ({ dimension: d.dimension, pct: d.pct })),
          },
          anti_cheat: events.length > 0 ? {
            count: events.length,
            events: events.map((e) => ({ type: e.type, question_id: e.question_id, duration_ms: e.duration_ms })),
            phase: 'integridad',
          } : undefined,
        }).catch((err: unknown) => {
          if (err instanceof ApiError) {
            log.warn('submit falló', { status: err.status, code: err.code, msg: err.message });
          } else {
            log.warn('submit error', { error: (err as Error).message });
          }
        });
      }

      log.info('submitted', {
        overall: result.overall,
        overall_pct: result.overall_pct,
        antiCheatCount: events.length,
      });
      clearAnswers();
      clearIdx();
      setTimeout(() => navigate(`/test/${token}/done?phase=integridad`, {
        state: {
          score: {
            type: 'integridad',
            data: {
              overall: result.overall,
              overall_pct: result.overall_pct,
              recomendacion: result.recomendacion,
              buena_impresion: result.buena_impresion,
              dimensiones: result.dimensiones,
            },
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
            <p>Procesando resultados…</p>
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
          <h1>Evaluación de integridad</h1>
          <p className="ct-instructions">
            Pensá cómo actuarías en cada situación y elegí la respuesta más cercana a tu forma real de proceder. No hay tiempo límite, pero respondé con tu primera reacción honesta.
          </p>
        </div>

        {hadResume && Object.keys(answers).length > 0 && (
          <div className="ct-resume-banner">
            ↩️ Continuamos donde quedaste — tienes {completed} respuestas guardadas.
            <button
              className="ct-resume-clear"
              onClick={() => {
                if (confirm('¿Empezar de cero? Se borran las respuestas guardadas.')) {
                  clearAnswers();
                  clearIdx();
                }
              }}
            >
              Empezar de cero
            </button>
          </div>
        )}

        {antiCheatCount > 0 && (
          <div className="ct-anticheat-warning">
            ⚠️ Detectamos {antiCheatCount} {antiCheatCount === 1 ? 'salida' : 'salidas'} de la pantalla. Quedaron registradas.
          </div>
        )}

        <section className="ct-question-card">
          <div className="ct-question-num">Pregunta {currentIdx + 1}/{questions.length}</div>
          <h2 className="ct-question-text">{currentQ?.text}</h2>
          <div className="ct-mc-options">
            {shuffled.map((optText, displayIdx) => {
              const originalIdx = reverseMap[displayIdx];
              const isSelected = currentSelection === originalIdx;
              const displayLetter = ['A', 'B', 'C', 'D', 'E'][displayIdx] ?? '';
              return (
                <button
                  key={displayIdx}
                  className={`ct-mc-option ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => selectOption(displayIdx)}
                >
                  <span className="ct-mc-letter">{displayLetter}</span>
                  <span className="ct-mc-text">{optText}</span>
                </button>
              );
            })}
          </div>
        </section>

        <div className="ct-test-actions">
          <button className="ct-test-back" onClick={prev} disabled={currentIdx === 0}>
            ← Atrás
          </button>
          <div className="ct-test-status">
            {completed} de {questions.length} respondidas
          </div>
          <button className="ct-start-btn" onClick={next} disabled={!canAdvance}>
            {isLast ? 'Terminar →' : 'Siguiente →'}
          </button>
        </div>
      </main>
    </div>
  );
}

/** Hash simple para seed reproducible del shuffle por pregunta. */
function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
