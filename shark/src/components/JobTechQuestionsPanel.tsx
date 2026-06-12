import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';

const log = logger('JOB_TECH_QUESTIONS');

type Status =
  | { state: 'unknown' }
  | { state: 'none' }
  | { state: 'pending' }
  | { state: 'ready'; count: number }
  | { state: 'failed'; error?: string };

export function JobTechQuestionsPanel({ jobId, onPreview }: { jobId: string; onPreview?: () => void }) {
  const api = useApi();
  const [status, setStatus] = useState<Status>({ state: 'unknown' });
  const [generating, setGenerating] = useState(false);
  const [count, setCount] = useState(15);

  async function refresh() {
    try {
      const res = await api.jobs.getTechQuestionsStatus(jobId);
      if (res.status === 'none') setStatus({ state: 'none' });
      else if (res.status === 'pending') setStatus({ state: 'pending' });
      else if (res.status === 'failed') setStatus({ state: 'failed', error: res.error });
      else if (res.status === 'ready') setStatus({ state: 'ready', count: res.count ?? 0 });
    } catch (err) {
      log.warn('status check failed', { error: (err as Error).message });
    }
  }

  useEffect(() => {
    refresh();
  }, [jobId]);

  useEffect(() => {
    if (status.state !== 'pending') return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [status.state, jobId]);

  async function handleGenerate() {
    if (generating) return;
    if (status.state === 'ready') {
      const ok = window.confirm(`Ya hay ${status.count} preguntas generadas. ¿Regenerar las reemplaza por nuevas. Confirmás?`);
      if (!ok) return;
    }
    setGenerating(true);
    try {
      await api.jobs.generateTechQuestions(jobId, { count });
      setStatus({ state: 'pending' });
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div style={{ border: '1px solid var(--st-border)', borderRadius: 8, padding: 16, background: 'var(--st-bg-elev)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--st-fg)' }}>📝 Prueba técnica</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {status.state === 'ready' && (
            <Link to={`/jobs/${jobId}/tech-questions`} className="btn-toolbar">Ver/editar</Link>
          )}
          {status.state === 'ready' && onPreview && (
            <button className="btn-toolbar" onClick={onPreview}>Ver preguntas</button>
          )}
          <button
            className="btn-toolbar"
            disabled={generating || status.state === 'pending'}
            onClick={handleGenerate}
          >
            {generating ? 'Encolando…'
              : status.state === 'pending' ? 'Generando…'
                : status.state === 'ready' ? '↻ Regenerar'
                  : '🪄 Generar con IA'}
          </button>
        </div>
      </div>
      <p style={{ margin: 0, color: '#4b5563', fontSize: 13 }}>
        Preguntas técnicas específicas del puesto. La IA las genera desde tu descripción técnica.
      </p>
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          {status.state === 'unknown' && <span style={{ color: '#4b5563', fontSize: 13 }}>Cargando estado…</span>}
          {status.state === 'none' && (
            <span style={{ color: '#4b5563', fontSize: 13 }}>Sin preguntas generadas todavía.</span>
          )}
          {status.state === 'pending' && (
            <span style={{ color: '#0284c7', fontSize: 13 }}>⏳ Generando con IA (1-2 min)…</span>
          )}
          {status.state === 'ready' && (
            <span style={{ color: '#166534', fontSize: 13 }}>✓ {status.count} preguntas listas</span>
          )}
          {status.state === 'failed' && (
            <span style={{ color: '#dc2626', fontSize: 13 }}>✗ Falló: {status.error ?? 'desconocido'}</span>
          )}
        </div>
        {status.state !== 'pending' && (
          <label style={{ fontSize: 12, color: 'var(--st-fg-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            Cantidad:
            <input
              type="number"
              min={8}
              max={20}
              value={count}
              onChange={(e) => setCount(Math.max(8, Math.min(20, Number(e.target.value))))}
              style={{ width: 50, padding: '2px 6px', border: '1px solid var(--st-border-strong)', borderRadius: 4, fontSize: 13 }}
              disabled={generating}
            />
          </label>
        )}
      </div>
    </div>
  );
}
