/**
 * Test de Mentalidades del candidato — flow durante la evaluación.
 *
 * IMPORTANTE: el candidato NO ve la palabra "Mentalidades" ni "Adaptabilidad".
 * El framing es "Sección 2 — Preguntas extras" para evitar deseabilidad social
 * (ver doc 26_TEST_MENTALIDADES.md).
 *
 * 10 preguntas situacionales con 6 opciones cada una. Orden de opciones randomizado
 * por candidato (Fisher-Yates con seed del id de pregunta para consistencia entre reloads).
 */
import { useState, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getTestSession } from '../../data/mockCandidateTests';
import { usePersistedState, hasPersistedState } from '../../hooks/usePersistedState';
import { shuffleOptions } from '../../lib/shuffle';
import mindsetBank from '../../data/questions/mindset.json';
import { submitMindsetTest, type Mentalidad, type MindsetAnswer } from '../../lib/testApi';
import { logger } from '../../lib/logger';
import './candidate-test.css';

const log = logger('CANDIDATE_MINDSET');

type MindsetQuestion = {
  id: string;
  category: string;
  text: string;
  options: string[];
  dimension: string[];
};

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

export default function CandidateMindsetTest() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const session = token ? getTestSession(token) : undefined;

  const questions: MindsetQuestion[] = useMemo(() => mindsetBank as MindsetQuestion[], []);

  const storageKey = `mindset_${token ?? 'anon'}`;
  void hasPersistedState(`${storageKey}_answers`);
  const [answers, setAnswers, clearAnswers] = usePersistedState<Record<string, string>>(`${storageKey}_answers`, {});
  const [currentIdx, setCurrentIdx, clearIdx] = usePersistedState<number>(`${storageKey}_idx`, 0);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const currentQ = questions[currentIdx];
  const isLast = currentIdx === questions.length - 1;
  const completed = Object.keys(answers).length;

  // Randomizar orden de las 6 opciones por pregunta (consistencia entre reloads via seed)
  const { shuffled, reverseMap } = useMemo(() => {
    if (!currentQ) return { shuffled: [], reverseMap: [] };
    return shuffleOptions(currentQ.options, simpleHash(currentQ.id));
  }, [currentQ?.id]);

  if (!session) {
    return <p>Link inválido. <Link to="/">Volver</Link></p>;
  }

  const currentSelection = currentQ ? answers[currentQ.id] : undefined; // mentalidad elegida
  const canAdvance = currentSelection != null;

  function selectOption(displayIdx: number) {
    if (!currentQ) return;
    const originalIdx = reverseMap[displayIdx];
    const mentalidad = currentQ.dimension[originalIdx];
    setAnswers((curr) => ({ ...curr, [currentQ.id]: mentalidad }));
  }

  async function next() {
    if (!isLast) {
      setCurrentIdx((i) => i + 1);
      return;
    }
    setSubmitting(true);

    const payload: MindsetAnswer[] = Object.entries(answers).map(([qid, mentalidad]) => ({
      question_id: qid,
      chosen_mentalidad: mentalidad as Mentalidad,
    }));

    if (token) {
      try {
        const result = await submitMindsetTest(token, payload);
        log.info('mindset submitted', {
          score: result.adaptability_score_pct,
          pattern: result.adaptability_pattern,
        });
      } catch (err) {
        // No bloqueamos al candidato si falla el submit — el flow sigue
        log.warn('mindset submit failed', { error: (err as Error).message });
      }
    }

    setSubmitted(true);
    clearAnswers();
    clearIdx();
    setTimeout(() => navigate(`/test/${token}/done?phase=seccion2`), 1200);
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
            <p>Pasamos a la siguiente sección en un momento…</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="ct-root">
      <main className="ct-main">
        <header className="ct-header">
          <h1>Sección 2 — Preguntas extras</h1>
          <p className="ct-subtitle">
            Sobre cómo abordas situaciones cotidianas. No hay respuestas correctas — elige la opción
            que más te represente.
          </p>
          <div className="ct-progress">
            <div className="ct-progress-bar" style={{ width: `${(completed / questions.length) * 100}%` }} />
          </div>
          <div className="ct-progress-label">
            Pregunta {currentIdx + 1} de {questions.length}
          </div>
        </header>

        {currentQ && (
          <section className="ct-question">
            <p className="ct-question-text" style={{ marginBottom: '1.25rem' }}>{currentQ.text}</p>

            <div className="ct-options" role="radiogroup">
              {shuffled.map((opt, displayIdx) => {
                const originalIdx = reverseMap[displayIdx];
                const mentalidad = currentQ.dimension[originalIdx];
                const isSelected = currentSelection === mentalidad;
                return (
                  <button
                    key={displayIdx}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    className={`ct-option ${isSelected ? 'ct-option-selected' : ''}`}
                    onClick={() => selectOption(displayIdx)}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <div className="ct-actions">
          <button
            type="button"
            className="ct-btn-secondary"
            onClick={prev}
            disabled={currentIdx === 0}
          >
            ← Anterior
          </button>
          <button
            type="button"
            className="ct-btn-primary"
            onClick={next}
            disabled={!canAdvance || submitting}
          >
            {submitting ? 'Enviando...' : isLast ? 'Finalizar sección' : 'Siguiente →'}
          </button>
        </div>
      </main>
    </div>
  );
}
