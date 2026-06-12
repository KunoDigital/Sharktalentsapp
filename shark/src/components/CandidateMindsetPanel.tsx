/**
 * Panel de resumen del Test de Mentalidades del candidato.
 *
 * Hace fetch a `/api/applications/:id/mindset` y renderiza el resultado.
 * Si el candidato no completó el test todavía → muestra placeholder "Pendiente".
 * Si la tabla MindsetScores no existe → 503 → muestra warning amigable.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { config } from '../config';

type MindsetScore = {
  ROWID: string;
  result_id: string;
  adaptability_score_pct: number | null;
  adaptability_pattern: 'adaptable' | 'mixto' | 'limitante' | null;
  mindset_growth_pct: number | null;
  mindset_curious_pct: number | null;
  mindset_creative_pct: number | null;
  mindset_agent_pct: number | null;
  mindset_abundance_pct: number | null;
  mindset_exploration_pct: number | null;
  mindset_opportunity_pct: number | null;
  completed_at: string | null;
};

const PATTERN_COLORS: Record<string, string> = {
  adaptable: '#10b981',
  mixto: '#f59e0b',
  limitante: '#ef4444',
};

export default function CandidateMindsetPanel({ applicationId }: { applicationId: string }) {
  const { getToken } = useAuth();
  const [data, setData] = useState<MindsetScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableMissing, setTableMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      // El gateway de Catalyst rechaza Bearer JWT, por eso usamos X-Clerk-Token (mismo
      // patrón que useApi() en lib/api.ts).
      const token = await getToken();
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (token) headers['X-Clerk-Token'] = token;
      return fetch(`${config.apiBase}/api/applications/${encodeURIComponent(applicationId)}/mindset`, {
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
          setData(body.mindset_score);
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

  if (loading) return <section className="cd-stat-card"><div className="muted">Cargando mentalidades...</div></section>;

  if (tableMissing) {
    return (
      <section className="cd-stat-card">
        <h3>Test de Mentalidades</h3>
        <div className="muted small">
          Tabla MindsetScores no creada en Catalyst. Ver <code>docs/PUNCH_LIST.md</code>.
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="cd-stat-card">
        <h3>Test de Mentalidades</h3>
        <div className="muted small">Error: {error}</div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="cd-stat-card">
        <h3>Test de Mentalidades</h3>
        <div className="cd-stat-pending">Pendiente — el candidato no completó el test todavía.</div>
      </section>
    );
  }

  const patternColor = PATTERN_COLORS[data.adaptability_pattern ?? 'mixto'];

  return (
    <section className="cd-stat-card">
      <h3>Test de Mentalidades (McKinsey Forward)</h3>

      <div style={{ marginBottom: '0.5rem' }}>
        <span style={{ fontWeight: 600 }}>Adaptabilidad: </span>
        <span style={{ color: patternColor, fontWeight: 700 }}>
          {data.adaptability_score_pct}% — {data.adaptability_pattern?.toUpperCase()}
        </span>
      </div>

      <div className="muted small" style={{ marginBottom: '0.75rem' }}>
        Perfil de mentalidades adaptables del candidato:
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.875rem' }}>
        <li>Crecimiento: {data.mindset_growth_pct ?? 0}%</li>
        <li>Curiosa: {data.mindset_curious_pct ?? 0}%</li>
        <li>Creativa: {data.mindset_creative_pct ?? 0}%</li>
        <li>Agente: {data.mindset_agent_pct ?? 0}%</li>
        <li>Abundancia: {data.mindset_abundance_pct ?? 0}%</li>
        <li>Exploración: {data.mindset_exploration_pct ?? 0}%</li>
        <li>Oportunidad: {data.mindset_opportunity_pct ?? 0}%</li>
      </ul>
    </section>
  );
}
