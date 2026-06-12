/**
 * Panel de resumen del Test de Inglés del candidato (vista del recruiter).
 *
 * Hace fetch a `/api/applications/:id/english` y renderiza:
 * - Nivel solicitado vs nivel alcanzado
 * - Score total + scores parciales (MC, listening, writing)
 * - Passed: true/false (con color)
 * - Texto del candidato (writing) en collapsible
 * - Flags de anti-cheat si los hay
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { config } from '../config';

type EnglishSession = {
  ROWID: string;
  result_id: string;
  level_required: 'A2' | 'B1' | 'B2' | 'C1';
  mc_score_pct: number | null;
  listening_score_pct: number | null;
  writing_score_pct: number | null;
  total_score_pct: number | null;
  passed: boolean | null;
  writing_text: string | null;
  writing_word_count: number | null;
  writing_time_seconds: number | null;
  writing_paste_attempts: number | null;
  writing_focus_lost_count: number | null;
  writing_analysis_json: string | null;
  completed_at: string | null;
};

export default function CandidateEnglishPanel({ applicationId }: { applicationId: string }) {
  const { getToken } = useAuth();
  const [data, setData] = useState<EnglishSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [showWriting, setShowWriting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const token = await getToken();
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (token) headers['X-Clerk-Token'] = token;
      return fetch(`${config.apiBase}/api/applications/${encodeURIComponent(applicationId)}/english`, {
        credentials: 'include',
        headers,
      });
    })()
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setData(null);
        } else if (res.status === 503) {
          setTableMissing(true);
        } else if (!res.ok) {
          setError(`HTTP ${res.status}`);
        } else {
          const body = await res.json();
          setData(body.english_session);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? 'fetch failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  if (loading) return <section className="cd-stat-card"><div className="muted">Cargando inglés...</div></section>;

  if (tableMissing) {
    return (
      <section className="cd-stat-card">
        <h3>Test de Inglés</h3>
        <div className="muted small">
          Tabla EnglishTestSessions no creada en Catalyst. Ver <code>docs/PUNCH_LIST.md</code>.
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="cd-stat-card">
        <h3>Test de Inglés</h3>
        <div className="muted small">Error: {error}</div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="cd-stat-card">
        <h3>Test de Inglés</h3>
        <div className="cd-stat-pending">
          Pendiente — el candidato no completó el test todavía o el puesto no requería inglés.
        </div>
      </section>
    );
  }

  const passedColor = data.passed ? '#10b981' : '#ef4444';
  const passedLabel = data.passed ? '✓ APROBADO' : '✕ NO APROBADO';
  const hasAntiCheatFlags =
    (data.writing_paste_attempts ?? 0) > 0 || (data.writing_focus_lost_count ?? 0) > 2;

  return (
    <section className="cd-stat-card">
      <h3>Test de Inglés ({data.level_required})</h3>

      <div style={{ marginBottom: '0.5rem' }}>
        <span style={{ color: passedColor, fontWeight: 700 }}>
          {passedLabel} — {data.total_score_pct ?? 0}% al nivel {data.level_required}
        </span>
      </div>

      <div className="muted small" style={{ marginBottom: '0.75rem' }}>
        Scores parciales:
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.875rem' }}>
        <li>Multiple-choice (vocab + grammar + reading): {data.mc_score_pct ?? 0}%</li>
        <li>Listening (audio + 2 preguntas): {data.listening_score_pct ?? 0}%</li>
        <li>Writing (analizado por IA): {data.writing_score_pct ?? 0}%</li>
      </ul>

      {hasAntiCheatFlags && (
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.5rem 0.75rem',
            background: '#fef3c7',
            borderLeft: '3px solid #f59e0b',
            borderRadius: '4px',
            fontSize: '0.8125rem',
          }}
        >
          ⚠️ Anti-cheat flags:
          {data.writing_paste_attempts ? ` ${data.writing_paste_attempts} intentos de pegar.` : ''}
          {(data.writing_focus_lost_count ?? 0) > 2
            ? ` ${data.writing_focus_lost_count} veces fuera de foco.`
            : ''}
        </div>
      )}

      {data.writing_text && (
        <div style={{ marginTop: '0.75rem' }}>
          <button
            onClick={() => setShowWriting(!showWriting)}
            style={{
              background: 'transparent',
              border: '1px solid var(--st-border-strong)',
              borderRadius: '4px',
              padding: '4px 12px',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            {showWriting ? 'Ocultar' : 'Ver'} texto escrito por el candidato (
            {data.writing_word_count ?? 0} palabras)
          </button>
          {showWriting && (
            <pre
              style={{
                marginTop: '0.5rem',
                padding: '0.75rem',
                background: 'var(--st-bg-elev-2)',
                borderRadius: '4px',
                whiteSpace: 'pre-wrap',
                fontFamily: 'inherit',
                fontSize: '0.875rem',
                lineHeight: 1.5,
              }}
            >
              {data.writing_text}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
