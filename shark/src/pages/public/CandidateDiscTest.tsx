import { useState, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getTestSession } from '../../data/mockCandidateTests';
import { getJobById } from '../../data/mockJobs';
import { useAntiCheat } from '../../hooks/useAntiCheat';
import { usePersistedState, hasPersistedState } from '../../hooks/usePersistedState';
import { scoreDisc, normalizeDiscRaw, calculateDiscSimilarity, discDominantLabel } from '../../lib/scoring';
import { shuffleOptions } from '../../lib/shuffle';
import { getRealDiscQuestions } from '../../data/realQuestionsAdapter';
import { publicApi } from '../../lib/publicApi';
import { ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';
import './candidate-test.css';

const log = logger('DISC');

/**
 * DISC v2 con preguntas reales del v1 (40 forced-choice).
 *
 * Formato:
 *   - Cada pregunta es situacional ("¿Qué harías si...?")
 *   - 4 opciones, cada una representa una dimensión D/I/S/C distinta
 *   - El candidato elige UNA opción (no most/least como antes)
 *   - El score es el conteo de cuántas veces eligió cada dimensión
 *
 * Shuffle: las opciones se muestran en orden aleatorio (estable por candidato),
 * y la dimensión asociada se traduce con el reverseMap.
 */
export default function CandidateDiscTest() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const session = token ? getTestSession(token) : undefined;

  const questions = useMemo(() => getRealDiscQuestions(), []);

  const storageKey = `disc_${token ?? 'anon'}`;
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

  // Shuffle de opciones (con reverseMap para traducir display → original al guardar)
  const { shuffled, reverseMap } = useMemo(() => {
    if (!currentQ) return { shuffled: [], reverseMap: [] };
    return shuffleOptions(currentQ.options, simpleHash(currentQ.id));
  }, [currentQ?.id]);

  // Si no hay session en mock, aceptamos si hay token — el backend valida en submit.
  if (!token) {
    return <p>Link inválido. <Link to="/">Volver</Link></p>;
  }

  const currentSelection = currentQ ? answers[currentQ.id] : undefined; // índice ORIGINAL
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
      const result = scoreDisc(questions, answers);
      const normalized = normalizeDiscRaw(result, result.total_questions);
      const dominant = discDominantLabel(normalized);
      const job = session ? getJobById(session.job_id) : undefined;
      const similarity = job ? calculateDiscSimilarity(normalized, {
        d: job.disc_ideal_a.d, i: job.disc_ideal_a.i, s: job.disc_ideal_a.s, c: job.disc_ideal_a.c,
      }) : undefined;

      // Submit al backend (skip silently si useApi=false)
      if (token) {
        publicApi.submitTest(token, {
          disc: {
            raw_d: result.d,
            raw_i: result.i,
            raw_s: result.s,
            raw_c: result.c,
            total_questions: result.total_questions,
          },
          anti_cheat: events.length > 0 ? {
            count: events.length,
            events: events.map((e) => ({ type: e.type, question_id: e.question_id, duration_ms: e.duration_ms })),
            phase: 'conductual',
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
        d: result.d, i: result.i, s: result.s, c: result.c,
        dominant: dominant.label,
        similarity,
        antiCheatCount: events.length,
      });
      clearAnswers();
      clearIdx();
      setTimeout(() => navigate(`/test/${token}/done?phase=conductual`, {
        state: {
          score: {
            type: 'disc',
            data: {
              d: normalized.d, i: normalized.i, s: normalized.s, c: normalized.c,
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
            <div className="ct-progress-bar-fill" style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }} />
          </div>
          <span className="ct-progress-text">{currentIdx + 1}/{questions.length}</span>
        </div>
      </header>

      <main className="ct-main">
        <div className="ct-test-intro">
          <h1>Evaluación conductual — DISC</h1>
          <p className="ct-instructions">
            En cada situación, elegí <strong>la respuesta que mejor te describe</strong>. No hay respuestas buenas ni malas — usá tu intuición.
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
            ⚠️ Detectamos {antiCheatCount} {antiCheatCount === 1 ? 'salida' : 'salidas'} de la pantalla. Quedaron registradas. Mantenete en esta ventana hasta terminar.
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
