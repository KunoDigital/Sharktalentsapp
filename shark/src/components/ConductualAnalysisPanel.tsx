import { useState } from 'react';
import { useApi, ApiError } from '../lib/api';

/**
 * Capa 4 — Análisis IA contextual del Conductual.
 *
 * Confirmado por Cris 2026-06-12: reemplaza el análisis manual del recruiter
 * con IA que considera el contexto específico del puesto (no umbrales binarios).
 *
 * El análisis es INFORMATIVO. El recruiter siempre decide al final.
 */

type Analysis = {
  veredicto: 'encaja' | 'encaja_con_reservas' | 'no_encaja';
  razones_a_favor: string[];
  razones_en_contra: string[];
  recomendacion: 'avanzar_a_entrevista' | 'duda_cv_revisar_manual' | 'considerar_perfil_alternativo' | 'no_avanzar';
  alertas_especificas: string[];
  resumen_ejecutivo: string;
};

const VEREDICTO_LABEL: Record<Analysis['veredicto'], { label: string; color: string; icon: string }> = {
  encaja: { label: 'Encaja', color: '#047857', icon: '✅' },
  encaja_con_reservas: { label: 'Encaja con reservas', color: '#b45309', icon: '⚠️' },
  no_encaja: { label: 'No encaja', color: '#b91c1c', icon: '❌' },
};

const RECOMENDACION_LABEL: Record<Analysis['recomendacion'], string> = {
  avanzar_a_entrevista: 'Avanzar a entrevista',
  duda_cv_revisar_manual: 'Duda CV — revisar manualmente',
  considerar_perfil_alternativo: 'Considerar perfil alternativo',
  no_avanzar: 'No avanzar',
};

export function ConductualAnalysisPanel({ applicationId }: { applicationId: string }) {
  const api = useApi();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.applications.getConductualAnalysis(applicationId);
      setAnalysis(res.analysis);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError('Este candidato todavía no completó las evaluaciones conductuales');
      } else {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="cd-section" style={{ marginTop: '1.5rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>🧠 Análisis IA del candidato</h3>
        {!analysis && (
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="cd-btn-secondary"
            style={{ fontSize: '0.85rem' }}
          >
            {loading ? 'Analizando…' : 'Analizar con IA'}
          </button>
        )}
      </header>

      {error && (
        <div style={{ background: '#fef2f2', color: '#991b1b', padding: '0.75rem', borderRadius: '6px', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {analysis && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem' }}>
          {/* Veredicto + resumen */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <span
                style={{
                  background: VEREDICTO_LABEL[analysis.veredicto].color,
                  color: 'white',
                  padding: '0.25rem 0.75rem',
                  borderRadius: '999px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                }}
              >
                {VEREDICTO_LABEL[analysis.veredicto].icon} {VEREDICTO_LABEL[analysis.veredicto].label}
              </span>
              <span style={{ color: '#475569', fontSize: '0.85rem' }}>
                · Recomendación: <strong>{RECOMENDACION_LABEL[analysis.recomendacion]}</strong>
              </span>
            </div>
            <p style={{ margin: 0, color: '#1f2937', fontSize: '0.9rem', fontStyle: 'italic' }}>
              {analysis.resumen_ejecutivo}
            </p>
          </div>

          {/* Razones a favor */}
          {analysis.razones_a_favor.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <h4 style={{ margin: '0 0 0.4rem', fontSize: '0.85rem', color: '#047857' }}>✅ A favor</h4>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#1f2937', fontSize: '0.85rem' }}>
                {analysis.razones_a_favor.map((r, i) => <li key={i} style={{ marginBottom: '0.25rem' }}>{r}</li>)}
              </ul>
            </div>
          )}

          {/* Razones en contra */}
          {analysis.razones_en_contra.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <h4 style={{ margin: '0 0 0.4rem', fontSize: '0.85rem', color: '#b45309' }}>⚠️ A tomar en cuenta</h4>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#1f2937', fontSize: '0.85rem' }}>
                {analysis.razones_en_contra.map((r, i) => <li key={i} style={{ marginBottom: '0.25rem' }}>{r}</li>)}
              </ul>
            </div>
          )}

          {/* Alertas específicas */}
          {analysis.alertas_especificas.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <h4 style={{ margin: '0 0 0.4rem', fontSize: '0.85rem', color: '#b91c1c' }}>🚨 Alertas</h4>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#1f2937', fontSize: '0.85rem' }}>
                {analysis.alertas_especificas.map((a, i) => <li key={i} style={{ marginBottom: '0.25rem' }}>{a}</li>)}
              </ul>
            </div>
          )}

          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="cd-btn-secondary"
            style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}
          >
            {loading ? 'Regenerando…' : '🔄 Regenerar análisis'}
          </button>
        </div>
      )}

      {!analysis && !loading && !error && (
        <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>
          Toca "Analizar con IA" para generar un análisis honesto del candidato según el contexto del puesto. El análisis es informativo — tú decides al final.
        </p>
      )}
    </section>
  );
}
