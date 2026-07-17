/**
 * JobDetail — vista del detalle de un puesto.
 *
 * 2026-06-16: Migrado a PipelineDashboard (vista nueva por defecto).
 * La lógica vieja de 4 tabs paralelos (Prefiltro/Técnica/Conductual/Integridad)
 * fue eliminada — el rediseño confirmado por Cris vive en `components/PipelineDashboard.tsx`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getJobById, type Job } from '../data/mockJobs';
import { type Application } from '../data/mockApplications';
import { PipelineDashboard } from '../components/PipelineDashboard';
import { JobIdealProfilePanel } from '../components/JobIdealProfilePanel';
import { useFavoriteShortcut } from '../hooks/useFavorites';
import { useApi } from '../lib/api';
import { adaptToMockApplication } from '../lib/applicationAdapter';
import { config } from '../config';
import './pages.css';

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const api = useApi();

  // 2026-06-04: en modo useApi cargamos el puesto del backend; en modo dev/mock seguimos
  // con getJobById como antes (el ROWID real no existe en mockJobs).
  const mockJob = useMemo(() => (id ? getJobById(id) : undefined), [id]);
  const [liveJob, setLiveJob] = useState<Job | null>(null);
  const [liveIdealProfile, setLiveIdealProfile] = useState<Record<string, unknown> | null>(null);
  const [liveEnglishRequired, setLiveEnglishRequired] = useState(false);
  const [liveEnglishMinLevel, setLiveEnglishMinLevel] = useState<string | undefined>(undefined);
  const [liveMindsetEnabled, setLiveMindsetEnabled] = useState(false);
  const [jobLoadFailed, setJobLoadFailed] = useState(false);
  const job = liveJob ?? mockJob;
  useFavoriteShortcut('job', id ?? null, job ? `${job.title} · ${job.client_company}` : undefined);
  const [liveApps, setLiveApps] = useState<Application[] | null>(null);
  const [liveLoadFailed, setLiveLoadFailed] = useState(false);

  // Cargar el Job real del backend cuando useApi=true.
  useEffect(() => {
    if (!id || !config.useApi) return;
    let cancelled = false;
    api.jobs.get(id)
      .then((resp) => {
        if (cancelled) return;
        const aj = resp.job;
        // Parsear ideal_profile (es string JSON en backend).
        let parsedIdeal: Record<string, unknown> | null = null;
        if (typeof aj.ideal_profile === 'string' && aj.ideal_profile.trim()) {
          try {
            parsedIdeal = JSON.parse(aj.ideal_profile) as Record<string, unknown>;
          } catch {
            parsedIdeal = null;
          }
        }
        setLiveIdealProfile(parsedIdeal);
        // Inglés y Mindset flags vienen del ideal_profile.
        if (parsedIdeal) {
          setLiveEnglishRequired(parsedIdeal.english_required === true);
          if (typeof parsedIdeal.english_min_level === 'string') {
            setLiveEnglishMinLevel(parsedIdeal.english_min_level);
          }
          setLiveMindsetEnabled(parsedIdeal.mindset_test_enabled === true);
        }
        setLiveJob({
          id: aj.ROWID,
          slug: aj.ROWID,
          title: aj.title,
          client_company: aj.company,
          client_industry: '',
          location: '',
          status: aj.is_active ? 'active' : 'closed',
          created_at: aj.created_at,
          applications_count: 0,
          applications_in_progress: 0,
          finalists_count: 0,
          fee_usd: aj.fee_usd ?? 0,
          salary_range_usd: { min: 0, max: 0 },
          disc_ideal_a: { d: 50, i: 50, s: 50, c: 50 } as Job['disc_ideal_a'],
          velna_ideal: { verbal: 50, espacial: 50, logica: 50, numerica: 50, abstracta: 50 } as Job['velna_ideal'],
          competencias_ideales: [],
          tecnica_minimo_pct: 60,
          context: aj.company_context ?? '',
        } as Job);
      })
      .catch(() => {
        if (!cancelled) setJobLoadFailed(true);
      });
    return () => { cancelled = true; };
  }, [id, api]);

  // Cargar las applications del backend.
  useEffect(() => {
    if (!id || !config.useApi) return;
    let cancelled = false;
    async function load() {
      try {
        const [appsResp, candResp] = await Promise.all([
          api.applications.list({ jobId: id, limit: 200 }),
          api.candidates.list({ limit: 500 }),
        ]);
        if (cancelled) return;
        const candById = new Map(candResp.candidates.map((c) => [c.ROWID, c]));
        const adapted = await Promise.all(
          appsResp.applications.map(async (a) => {
            try {
              const s = await api.applications.readScores(a.ROWID);
              return adaptToMockApplication(a, candById.get(a.candidate_id), s.scores, s.integrity_dimensions);
            } catch {
              return adaptToMockApplication(a, candById.get(a.candidate_id), null, []);
            }
          }),
        );
        if (!cancelled) setLiveApps(adapted);
      } catch {
        if (!cancelled) setLiveLoadFailed(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id, api]);

  if (!job && config.useApi && !jobLoadFailed) {
    return <div style={{ padding: '2rem' }}>Cargando puesto…</div>;
  }

  if (!job) {
    return (
      <div>
        <p>
          Puesto no encontrado. <Link to="/jobs">Volver</Link>
        </p>
      </div>
    );
  }

  const applications = liveApps ?? [];
  const usingFallbackMock = config.useApi && liveLoadFailed && !liveApps;

  return (
    <div>
      <Link to="/jobs" className="back-link">← Jobs</Link>
      {usingFallbackMock && (
        <p className="muted-note">⚠️ Backend no respondió — mostrando candidatos mock para esta vista.</p>
      )}
      {/* 2026-06-18: Perfil de cargo aprobado — Cris pidió verlo dentro del puesto. */}
      <JobIdealProfilePanel
        idealProfile={liveIdealProfile as Parameters<typeof JobIdealProfilePanel>[0]['idealProfile']}
        context={job.context}
        englishRequired={liveEnglishRequired}
        englishMinLevel={liveEnglishMinLevel}
        mindsetEnabled={liveMindsetEnabled}
      />
      <PipelineDashboard
        applications={applications}
        jobTitle={`${job.title} — ${job.client_company}`}
        jobId={job.id}
      />
    </div>
  );
}
