import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';

const log = logger('JOB_PRESCREENING');

type Status =
  | { state: 'unknown' }
  | { state: 'none' }
  | { state: 'pending' }
  | { state: 'ready'; count: number }
  | { state: 'failed'; error?: string };

export function JobPrescreeningPanel({ jobId }: { jobId: string }) {
  const api = useApi();
  const [status, setStatus] = useState<Status>({ state: 'unknown' });
  const [generating, setGenerating] = useState(false);

  async function refresh() {
    try {
      const res = await api.jobs.getPrescreeningStatus(jobId);
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

  // Polling cuando está pending
  useEffect(() => {
    if (status.state !== 'pending') return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [status.state, jobId]);

  async function handleGenerate() {
    if (generating) return;
    if (status.state === 'ready') {
      const ok = window.confirm('Ya hay preguntas generadas. ¿Querés regenerarlas? Las anteriores se reemplazan.');
      if (!ok) return;
    }
    setGenerating(true);
    try {
      await api.jobs.generatePrescreening(jobId);
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
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--st-fg)' }}>🎯 Prescreening</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {status.state === 'ready' && (
            <Link to={`/jobs/${jobId}/prescreening`} className="btn-toolbar">Ver/editar</Link>
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
        4-6 preguntas calificatorias que filtran candidatos antes de la prueba técnica.
        Se generan automáticamente desde la descripción del puesto.
      </p>
      <div style={{ marginTop: 12 }}>
        {status.state === 'unknown' && <span style={{ color: '#4b5563', fontSize: 13 }}>Cargando estado…</span>}
        {status.state === 'none' && (
          <span style={{ color: '#4b5563', fontSize: 13 }}>Sin prescreening generado todavía.</span>
        )}
        {status.state === 'pending' && (
          <span style={{ color: '#0284c7', fontSize: 13 }}>⏳ Generando preguntas con IA (1-2 min)…</span>
        )}
        {status.state === 'ready' && (
          <span style={{ color: '#166534', fontSize: 13 }}>✓ {status.count} preguntas listas</span>
        )}
        {status.state === 'failed' && (
          <span style={{ color: '#dc2626', fontSize: 13 }}>
            ✗ Falló: {status.error ?? 'razón desconocida'}. Intentá regenerar.
          </span>
        )}
      </div>
    </div>
  );
}
