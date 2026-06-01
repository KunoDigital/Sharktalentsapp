/**
 * Prefiltro del candidato — cuestionario corto inicial antes del test completo.
 *
 * El recruiter configura preguntas eliminatorias por puesto (ej: "¿tenés visa de
 * trabajo?", "¿hablás español nativo?"). Si el candidato responde mal y la pregunta
 * tiene `is_disqualifier=true`, el flow termina sin pasar al test.
 *
 * Las preguntas vienen del backend (`GET /test/:token/prefilter`) — no del repo.
 * Si el job no tiene preguntas configuradas, este paso se salta automáticamente.
 *
 * Spec: docs/master-plan/18_PIPELINE_OPERATIVO.md (sección Prefilter)
 */
import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import './candidate-test.css';

const log = logger('CANDIDATE_PREFILTER');

type PrefilterQuestion = {
  id: string;
  question_text: string;
  type: 'yes_no' | 'multi_choice' | 'number' | 'text';
  options: string[] | null;
  is_disqualifier: boolean;
  order_index: number;
};

type Section = 'loading' | 'questions' | 'submitting' | 'rejected' | 'done';

export default function CandidatePrefilter() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [questions, setQuestions] = useState<PrefilterQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [section, setSection] = useState<Section>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`${config.apiBase}/test/${encodeURIComponent(token)}/prefilter`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          // Si tabla no existe o token inválido → saltar prefilter, ir al test directo
          log.info('prefilter unavailable, skipping', { status: res.status });
          navigate(`/test/${token}/disc`, { replace: true });
          return;
        }
        const data = await res.json();
        const list = (data.questions ?? []) as PrefilterQuestion[];
        if (list.length === 0) {
          // Job sin preguntas configuradas → saltar
          navigate(`/test/${token}/disc`, { replace: true });
          return;
        }
        setQuestions(list.sort((a, b) => a.order_index - b.order_index));
        setSection('questions');
      })
      .catch((err) => {
        if (cancelled) return;
        log.warn('prefilter load failed', { error: err.message });
        // Fallback: saltar el prefilter
        navigate(`/test/${token}/disc`, { replace: true });
      });
    return () => { cancelled = true; };
  }, [token, navigate]);

  function setAnswer(qid: string, value: string) {
    setAnswers((curr) => ({ ...curr, [qid]: value }));
  }

  async function submit() {
    if (!token) return;
    setSection('submitting');
    setError(null);

    const payload = questions.map((q) => ({
      question_id: q.id,
      answer_value: answers[q.id] ?? '',
    }));

    try {
      const res = await fetch(`${config.apiBase}/test/${encodeURIComponent(token)}/prefilter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: payload }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.disqualified) {
        log.info('candidate disqualified by prefilter', { reasons: data.reasons });
        setSection('rejected');
        return;
      }

      setSection('done');
      setTimeout(() => navigate(`/test/${token}/disc`), 1000);
    } catch (err) {
      setError((err as Error).message);
      setSection('questions');
    }
  }

  if (section === 'loading') {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks">
            <h1>Cargando preguntas iniciales...</h1>
          </div>
        </main>
      </div>
    );
  }

  if (section === 'submitting') {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks">
            <h1>Procesando...</h1>
          </div>
        </main>
      </div>
    );
  }

  if (section === 'rejected') {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks" style={{ textAlign: 'center' }}>
            <h1>Gracias por tu interés</h1>
            <p>
              En base a tus respuestas, este puesto no es la mejor opción para tu perfil.
              Te avisaremos cuando aparezca uno que sí encaje.
            </p>
            <p className="muted small" style={{ marginTop: '1rem' }}>
              Podés cerrar esta pestaña.
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (section === 'done') {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks">
            <h1>✓ Preguntas iniciales completadas</h1>
            <p>Pasamos al test principal en un momento…</p>
          </div>
        </main>
      </div>
    );
  }

  // section === 'questions'
  const allAnswered = questions.every((q) => {
    const a = answers[q.id];
    return typeof a === 'string' && a.trim().length > 0;
  });

  return (
    <div className="ct-root">
      <main className="ct-main">
        <header className="ct-header">
          <h1>Preguntas iniciales</h1>
          <p className="ct-subtitle">
            Antes de empezar el test completo, necesitamos confirmar algunos puntos básicos.
          </p>
        </header>

        {questions.map((q, qi) => (
          <section key={q.id} className="ct-question" style={{ marginBottom: '1.5rem' }}>
            <p className="ct-question-text">
              {qi + 1}. {q.question_text}
            </p>

            {q.type === 'yes_no' && (
              <div className="ct-options" role="radiogroup">
                {['Sí', 'No'].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    role="radio"
                    aria-checked={answers[q.id] === opt}
                    className={`ct-option ${answers[q.id] === opt ? 'ct-option-selected' : ''}`}
                    onClick={() => setAnswer(q.id, opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {q.type === 'multi_choice' && (
              <div className="ct-options" role="radiogroup">
                {(q.options ?? []).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    role="radio"
                    aria-checked={answers[q.id] === opt}
                    className={`ct-option ${answers[q.id] === opt ? 'ct-option-selected' : ''}`}
                    onClick={() => setAnswer(q.id, opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {q.type === 'number' && (
              <input
                type="number"
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswer(q.id, e.target.value)}
                placeholder="Tu respuesta"
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '6px' }}
              />
            )}

            {q.type === 'text' && (
              <input
                type="text"
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswer(q.id, e.target.value)}
                placeholder="Tu respuesta"
                maxLength={500}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '6px' }}
              />
            )}
          </section>
        ))}

        {error && <p style={{ color: '#ef4444', marginBottom: '1rem' }}>{error}</p>}

        <div className="ct-actions">
          <Link to="/" className="ct-btn-secondary">Cancelar</Link>
          <button
            type="button"
            className="ct-btn-primary"
            onClick={submit}
            disabled={!allAnswered}
          >
            Continuar al test →
          </button>
        </div>
      </main>
    </div>
  );
}
