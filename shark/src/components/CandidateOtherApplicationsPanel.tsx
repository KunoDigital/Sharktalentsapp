import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, type ApiApplication } from '../lib/api';
import { logger } from '../lib/logger';

const log = logger('OTHER_APPS');

export function CandidateOtherApplicationsPanel({
  candidateId,
  currentApplicationId,
}: {
  candidateId: string;
  currentApplicationId?: string;
}) {
  const api = useApi();
  const [apps, setApps] = useState<ApiApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobsById, setJobsById] = useState<Record<string, { title: string; company: string }>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.applications.list({ candidateId }),
      api.jobs.list(),
    ]).then(([appsRes, jobsRes]) => {
      if (cancelled) return;
      setApps(appsRes.applications);
      const map: Record<string, { title: string; company: string }> = {};
      for (const j of jobsRes.jobs) {
        map[j.ROWID] = { title: j.title, company: j.company };
      }
      setJobsById(map);
    }).catch((err) => {
      log.warn('load failed', { error: (err as Error).message });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [candidateId]);

  if (loading) return null;
  // Filtrar la aplicación actual + ordenar por más reciente
  const others = apps.filter((a) => a.ROWID !== currentApplicationId);
  if (others.length === 0) return null;

  return (
    <div style={{ border: '1px solid var(--st-border)', borderRadius: 8, padding: 16, background: 'var(--st-bg-elev)', marginTop: 16 }}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: 15, fontWeight: 600 }}>
        🔁 Este candidato también aplicó a otros puestos
      </h3>
      <p style={{ margin: '0 0 12px 0', fontSize: 12, color: 'var(--st-fg-muted)' }}>
        Total {apps.length} aplicaciones en este tenant (incluyendo la actual).
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {others.map((a) => {
          const job = jobsById[a.assessment_id];
          return (
            <li key={a.ROWID} style={{ padding: '8px 0', borderTop: '1px solid #f3f4f6' }}>
              <Link
                to={`/candidates/${a.ROWID}`}
                style={{ fontSize: 13, color: '#0284c7', textDecoration: 'none' }}
              >
                {job ? `${job.title} · ${job.company}` : `Puesto ${a.assessment_id}`}
              </Link>
              <div style={{ fontSize: 11, color: 'var(--st-fg-muted-2)', marginTop: 2 }}>
                Estado: {a.pipeline_stage}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
