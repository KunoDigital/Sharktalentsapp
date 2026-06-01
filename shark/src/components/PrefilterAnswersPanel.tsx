import { useEffect, useState } from 'react';
import { useApi } from '../lib/api';
import { config } from '../config';

type Answer = {
  ROWID: string;
  question_id: string;
  answer_value: string;
  is_match: boolean;
  created_at: string;
  question_text: string;
  type: string;
  expected_answer: string | null;
  is_disqualifier: boolean;
};

type Props = {
  applicationId: string;
};

/**
 * Panel read-only que muestra las respuestas del candidato al prefilter del puesto.
 * Útil cuando Cris revisa por qué un candidato fue rechazado en prefilter o se prepara
 * para entrevistarlo.
 */
export default function PrefilterAnswersPanel({ applicationId }: Props) {
  const api = useApi();
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableReady, setTableReady] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config.useApi || !applicationId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    api.applications.listPrefilterAnswers(applicationId)
      .then((r) => {
        if (cancelled) return;
        setAnswers(r.answers);
        setTableReady(r.table_ready);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, applicationId]);

  if (loading) return null;
  if (!tableReady) return null;  // tabla no creada → no mostrar (no hay nada que ver)
  if (answers.length === 0) return null;  // sin prefilter en este puesto

  const failedDisqualifiers = answers.filter((a) => a.is_disqualifier && !a.is_match);

  return (
    <section style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem 1.25rem', marginBottom: '1rem' }}>
      <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--st-fg-muted)', marginBottom: '0.5rem' }}>
        Prefilter — respuestas iniciales
      </div>

      {error && (
        <p className="muted small" style={{ color: 'var(--st-warn-fg)' }}>
          ⚠️ {error}
        </p>
      )}

      {failedDisqualifiers.length > 0 && (
        <div style={{ background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.25)', borderRadius: '6px', padding: '0.5rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          ⚠️ <strong>{failedDisqualifiers.length}</strong> respuesta(s) fallaron criterio descalificador.
        </div>
      )}

      <ol style={{ paddingLeft: '1.25rem', listStyle: 'decimal' }}>
        {answers.map((a) => {
          const isProblem = a.is_disqualifier && !a.is_match;
          return (
            <li key={a.ROWID} style={{ marginBottom: '0.6rem', paddingLeft: '0.25rem' }}>
              <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.75)', marginBottom: '0.15rem' }}>
                {a.question_text}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                <strong style={{ color: isProblem ? 'var(--st-warn-fg)' : 'var(--st-fg)' }}>
                  {a.answer_value || <em>sin respuesta</em>}
                </strong>
                {a.expected_answer && (
                  <span className="muted small">
                    (esperado: <code>{a.expected_answer}</code>)
                  </span>
                )}
                {a.is_match ? (
                  <span style={{ color: 'var(--st-ok)', fontSize: '0.7rem', fontWeight: 700 }}>✓ MATCH</span>
                ) : a.is_disqualifier ? (
                  <span style={{ color: 'var(--st-warn-fg)', fontSize: '0.7rem', fontWeight: 700 }}>✕ DESCALIFICADO</span>
                ) : (
                  <span className="muted small">no match</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
