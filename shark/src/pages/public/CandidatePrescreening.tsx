import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { publicApi } from '../../lib/publicApi';
import { ApiError } from '../../lib/api';
import { useTestTokenGuard, renderTokenGuardError } from '../../hooks/useTestTokenGuard';
import { logger } from '../../lib/logger';
import './candidate-test.css';

const log = logger('PRESCREENING');

type Question = {
  id: string;
  text: string;
  type: 'yes_no' | 'multiple_choice' | 'range_match';
  options: string[];
};

type LoadState =
  | { state: 'loading' }
  | { state: 'no_prescreening' }
  | { state: 'pending' }
  | { state: 'failed'; reason?: string }
  | { state: 'ready'; questions: Question[]; jobTitle?: string };

export default function CandidatePrescreening() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const guard = useTestTokenGuard(token);

  const [load, setLoad] = useState<LoadState>({ state: 'loading' });
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [verdict, setVerdict] = useState<{ passed: boolean; reason?: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (guard.state !== 'ok' || !token) return;
    let cancelled = false;
    publicApi.getPrescreening(token).then((res) => {
      if (cancelled) return;
      if (!res) {
        setLoad({ state: 'no_prescreening' });
        return;
      }
      if (res.status === 'ok' && res.questions.length > 0) {
        setLoad({ state: 'ready', questions: res.questions, jobTitle: res.job_title });
      } else if (res.status === 'pending') {
        setLoad({ state: 'pending' });
      } else if (res.status === 'failed') {
        setLoad({ state: 'failed' });
      } else {
        // 'no_cache' o 'job_not_found' — no hay prescreening configurado
        setLoad({ state: 'no_prescreening' });
      }
    }).catch((err) => {
      if (cancelled) return;
      log.warn('prescreening load failed', { error: (err as Error).message });
      setLoad({ state: 'failed', reason: 'No pudimos cargar las preguntas. Intentá refrescar.' });
    });
    return () => { cancelled = true; };
  }, [guard.state, token]);

  const guardError = renderTokenGuardError(guard);
  if (guardError) return guardError;

  if (load.state === 'loading') {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks">
            <h1>Cargando…</h1>
          </div>
        </main>
      </div>
    );
  }

  if (load.state === 'pending') {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks">
            <h1>Estamos preparando tus preguntas</h1>
            <p>Esto puede tomar 1-2 minutos. Refrescá la página en un momento.</p>
          </div>
        </main>
      </div>
    );
  }

  if (load.state === 'failed' || load.state === 'no_prescreening') {
    // Sin prescreening configurado → saltar directo a tecnica
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks">
            <h1>¡Listo!</h1>
            <p>No tenemos preguntas de prescreening para este puesto. Vamos directo a la prueba técnica.</p>
            <button className="ct-btn-primary" style={{ marginTop: 24 }} onClick={() => navigate(`/test/${token}/tecnica`)}>
              Continuar
            </button>
          </div>
        </main>
      </div>
    );
  }

  // verdict states
  if (verdict) {
    if (verdict.passed) {
      return (
        <div className="ct-root">
          <main className="ct-main">
            <div className="ct-thanks">
              <h1>✓ Pasaste el prescreening</h1>
              <p>Continuamos con la prueba técnica del puesto.</p>
              <button className="ct-btn-primary" style={{ marginTop: 24 }} onClick={() => navigate(`/test/${token}/tecnica`)}>
                Empezar prueba técnica
              </button>
            </div>
          </main>
        </div>
      );
    }
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks">
            <h1>Gracias por tu interés</h1>
            <p>{verdict.reason ?? 'No cumplís con uno de los criterios del puesto.'}</p>
            <p style={{ marginTop: 16, color: '#6b7280', fontSize: 14 }}>
              Te dejamos en nuestra base — si abrimos puestos donde encajes, te contactamos.
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (submitError) {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks">
            <h1>No pudimos guardar tus respuestas</h1>
            <p>{submitError}</p>
            <button className="ct-btn-primary" style={{ marginTop: 24 }} onClick={() => setSubmitError(null)}>
              Reintentar
            </button>
          </div>
        </main>
      </div>
    );
  }

  const { questions, jobTitle } = load as Extract<LoadState, { state: 'ready' }>;
  const q = questions[currentIdx];
  const isLast = currentIdx === questions.length - 1;
  const selected = answers[q.id];
  const canAdvance = selected != null;

  function selectOption(idx: number) {
    setAnswers((curr) => ({ ...curr, [q.id]: idx }));
  }

  async function next() {
    if (!isLast) {
      setCurrentIdx((i) => i + 1);
      return;
    }
    // Submit
    if (!token) return;
    setSubmitting(true);
    try {
      const payload = questions.map((qq) => ({
        question_id: qq.id,
        selected_index: answers[qq.id] ?? -1,
      }));
      const res = await publicApi.submitPrescreening(token, payload);
      if (!res) throw new Error('No respuesta del servidor');
      setVerdict({ passed: res.passed, reason: res.reason });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      log.warn('prescreening submit failed', { error: msg });
      setSubmitError(msg || 'Error al guardar. Intentá de nuevo.');
    } finally {
      setSubmitting(false);
    }
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
          <h1>Prescreening{jobTitle ? ` — ${jobTitle}` : ''}</h1>
          <p className="ct-instructions">
            Antes de las pruebas, unas preguntas rápidas para confirmar que estás en línea con el puesto.
          </p>
        </div>

        <div className="ct-question-card">
          <h2 className="ct-question-text">{q.text}</h2>
          <div className="ct-options">
            {q.options.map((opt, idx) => (
              <button
                key={idx}
                className={`ct-option${selected === idx ? ' is-selected' : ''}`}
                onClick={() => selectOption(idx)}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        <div className="ct-nav">
          {currentIdx > 0 && (
            <button className="ct-btn-secondary" onClick={() => setCurrentIdx((i) => i - 1)}>
              ← Anterior
            </button>
          )}
          <button
            className="ct-btn-primary"
            disabled={!canAdvance || submitting}
            onClick={next}
          >
            {submitting ? 'Guardando…' : isLast ? 'Enviar' : 'Siguiente →'}
          </button>
        </div>
      </main>

      <footer className="ct-footer">
        <Link to="/" style={{ fontSize: 12, color: '#9ca3af' }}>Volver</Link>
      </footer>
    </div>
  );
}
