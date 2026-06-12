import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { publicApi } from '../../lib/publicApi';
import { useTestTokenGuard, renderTokenGuardError } from '../../hooks/useTestTokenGuard';
import { logger } from '../../lib/logger';
import './candidate-test.css';

const log = logger('MY_PROGRESS');

type Progress = Awaited<ReturnType<typeof publicApi.getMyProgress>>;

const PHASE_LABEL: Record<string, { icon: string; name: string }> = {
  prescreening: { icon: '✓', name: 'Prescreening' },
  tecnica: { icon: '✓', name: 'Prueba técnica' },
  disc: { icon: '✓', name: 'Evaluación DISC' },
  integridad: { icon: '✓', name: 'Prueba de integridad' },
  video: { icon: '✓', name: 'Video respuestas' },
};

const ALL_PHASES = ['prescreening', 'tecnica', 'disc', 'integridad', 'video'];

export default function CandidateMyProgress() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const guard = useTestTokenGuard(token);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (guard.state !== 'ok' || !token) return;
    let cancelled = false;
    publicApi.getMyProgress(token).then((res) => {
      if (cancelled) return;
      setProgress(res);
    }).catch((err) => {
      log.warn('progress load failed', { error: (err as Error).message });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [guard.state, token]);

  const guardError = renderTokenGuardError(guard);
  if (guardError) return guardError;

  if (loading || !progress) {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks"><h1>Cargando…</h1></div>
        </main>
      </div>
    );
  }

  const { job, status, completed_phases, next } = progress;
  const isPositive = status.is_positive;
  const isTerminal = status.is_terminal;
  const completedSet = new Set(completed_phases);

  return (
    <div className="ct-root">
      <header style={{ background: '#0e1218', padding: '24px 32px', borderBottom: '4px solid #dafd6f' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#dafd6f', letterSpacing: 1 }}>SHARKTALENTS</div>
          <div style={{ fontSize: 13, color: '#8a93a3', marginTop: 4 }}>Tu proceso</div>
        </div>
      </header>

      <main style={{ maxWidth: 700, margin: '0 auto', padding: '32px 16px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>{job.title}</h1>
        <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 32 }}>{job.company}</p>

        {/* Estado actual */}
        <div style={{
          padding: 20,
          borderRadius: 12,
          background: isPositive ? '#dcfce7' : isTerminal ? '#f3f4f6' : '#dbeafe',
          border: `1px solid ${isPositive ? '#16a34a' : isTerminal ? '#9ca3af' : '#0284c7'}`,
          marginBottom: 32,
        }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px 0' }}>{status.label}</h2>
          <p style={{ margin: 0, fontSize: 14, color: '#374151', lineHeight: 1.6 }}>{status.description}</p>

          {next && (
            <button
              className="ct-btn-primary"
              style={{ marginTop: 16 }}
              onClick={() => navigate(`/test/${token}/${next.phase}`)}
            >
              {next.label} →
            </button>
          )}
        </div>

        {/* Checklist de fases completadas */}
        {!isTerminal && (
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#6b7280', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Progreso
            </h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {ALL_PHASES.map((phase) => {
                const meta = PHASE_LABEL[phase];
                const done = completedSet.has(phase);
                const current = next?.phase === phase;
                return (
                  <li key={phase} style={{
                    padding: '12px 16px',
                    borderRadius: 6,
                    background: done ? '#f0fdf4' : current ? '#fef9c3' : '#fff',
                    border: done ? '1px solid #16a34a' : current ? '1px solid #d97706' : '1px solid #e5e7eb',
                    marginBottom: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 28, height: 28, borderRadius: '50%',
                      background: done ? '#16a34a' : current ? '#d97706' : '#e5e7eb',
                      color: '#fff', fontSize: 14, fontWeight: 600,
                    }}>
                      {done ? '✓' : current ? '●' : ''}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: done || current ? 600 : 400, color: done ? '#15803d' : current ? '#78350f' : '#9ca3af' }}>
                      {meta.name}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div style={{ marginTop: 32, padding: 16, borderTop: '1px solid #e5e7eb', fontSize: 13, color: '#6b7280' }}>
          ¿Dudas? Escribinos a <a href="mailto:proyectos@kunodigital.com">proyectos@kunodigital.com</a>.
          {!isTerminal && (
            <>
              <br />
              <Link to="/recovery" style={{ color: '#0284c7', textDecoration: 'none', marginTop: 8, display: 'inline-block' }}>
                ¿Perdiste tu link?
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
