import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { config } from '../../config';
import { publicApi, type PortalApi, type PortalJobApi, type PortalJobStage } from '../../lib/publicApi';
import { trackPortalEvent } from '../../lib/portalTracker';
import { ClientHelpBox } from './ClientHelpBox';
import { PublicPortalFooter } from './PublicPortalFooter';
import { logger } from '../../lib/logger';
import { getPortalByToken } from '../../data/mockClientPortals';
import './client-portal.css';

const log = logger('CLIENT_PORTAL_LANDING');

const STAGE_INFO: Record<PortalJobStage, { label: string; color: string; cta: string }> = {
  profile_pending: { label: 'Perfil pendiente de aprobar', color: 'warn', cta: 'Aprobar perfil' },
  search_started: { label: 'Búsqueda iniciada', color: 'mid', cta: 'Ver tracking' },
  funnel_active: { label: 'Candidatos en evaluación', color: 'mid', cta: 'Ver tracking' },
  finalists_ready: { label: 'Finalistas listos', color: 'good', cta: 'Ver finalistas' },
  closed: { label: 'Cerrado', color: 'muted', cta: 'Ver historial' },
};

export default function ClientPortalLanding() {
  const { token } = useParams<{ token: string }>();
  const [portal, setPortal] = useState<PortalApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    // Track open event una sola vez por sesión
    trackPortalEvent(token, { event_type: 'portal.opened' }, `opened:${token}`);

    async function load() {
      try {
        if (config.useApi) {
          const res = await publicApi.getClientPortal(token!);
          if (cancelled) return;
          if (res?.portal) {
            setPortal(res.portal);
            setLoading(false);
            return;
          }
          // useApi=true pero res sin portal — tratar como no encontrado
          setNotFound(true);
          return;
        }
        // Modo dev sin backend: mock fallback. En prod useApi=true así que esto no corre.
        const mock = getPortalByToken(token!);
        if (cancelled) return;
        if (mock) setPortal(mockToApi(mock));
        else setNotFound(true);
      } catch (err) {
        if (cancelled) return;
        log.warn('portal load failed', { error: (err as Error).message });
        // En prod (useApi=true) NO caemos al mock — exponer mock data a un cliente real
        // sería peor que mostrarle "error temporal". Si es 401/404 → notFound; otros →
        // notFound con mismo mensaje (cliente puede reintentar más tarde).
        if (config.useApi) {
          setNotFound(true);
          return;
        }
        // Solo en dev (useApi=false) intentamos mock como último recurso.
        const mock = getPortalByToken(token!);
        if (mock) setPortal(mockToApi(mock));
        else setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <div className="cp-not-found">
        <h1>Cargando…</h1>
      </div>
    );
  }

  if (notFound || !portal) {
    return (
      <div className="cp-not-found">
        <h1>Portal no encontrado</h1>
        <p>El link puede haber expirado. Contactá a Kuno Digital.</p>
      </div>
    );
  }

  const pendingDraft = portal.jobs.filter((j) => j.stage === 'profile_pending');
  const finalistsReady = portal.jobs.filter((j) => j.stage === 'finalists_ready');

  return (
    <div className="cp-root">
      <header className="cp-header">
        <div className="cp-header-brand">
          <span className="cp-brand">SharkTalents.AI</span>
          <span className="cp-brand-tag">por {portal.agency_name}</span>
        </div>
        <div className="cp-header-user">
          <div className="cp-user-name">{portal.client_name}</div>
          <div className="cp-user-company">{portal.client_company}</div>
        </div>
      </header>

      <main className="cp-main">
        <h1 className="cp-greeting">Hola {portal.client_name.split(' ')[0]} 👋</h1>
        <p className="cp-greeting-sub">
          Bienvenida al portal de {portal.client_company}. Acá ves el avance de cada puesto que estamos buscando con vos.
        </p>

        {pendingDraft.length > 0 && (
          <div className="cp-callout cp-callout-warn">
            <div className="cp-callout-title">⏰ {pendingDraft.length} {pendingDraft.length === 1 ? 'perfil necesita' : 'perfiles necesitan'} tu aprobación</div>
            <div className="cp-callout-text">
              Después de la reunión inicial, nuestra IA armó un borrador del perfil. Necesitamos tu OK antes de empezar a buscar.
            </div>
          </div>
        )}

        {finalistsReady.length > 0 && (
          <div className="cp-callout cp-callout-good">
            <div className="cp-callout-title">🎯 {finalistsReady.length} {finalistsReady.length === 1 ? 'puesto tiene' : 'puestos tienen'} finalistas listos</div>
            <div className="cp-callout-text">
              Los candidatos completaron todas las evaluaciones. Hay reporte para revisar.
            </div>
          </div>
        )}

        <h2 className="cp-section-title">Tus puestos</h2>
        {portal.jobs.length === 0 ? (
          <p className="cp-section-text">Todavía no hay puestos abiertos.</p>
        ) : (
          <div className="cp-jobs-grid">
            {portal.jobs.map((job) => (
              <JobCard key={job.id} job={job} token={token!} />
            ))}
          </div>
        )}

        <ClientHelpBox
          recruiterEmail={portal.recruiter_email}
          recruiterWhatsapp={portal.recruiter_whatsapp}
        />
      </main>

      <PublicPortalFooter agencyName={portal.agency_name} />
    </div>
  );
}

function JobCard({ job, token }: { job: PortalJobApi; token: string }) {
  const info = STAGE_INFO[job.stage];
  const completed = job.milestones.filter((m) => m.completed_at !== null).length;

  // "Nuevo desde tu última visita" — usa localStorage para trackear conteo previo
  const storageKey = `portal_seen_${token}_${job.id}`;
  const currentSignal = job.funnel?.applied ?? 0;
  let badge: string | null = null;
  try {
    const prev = Number(localStorage.getItem(storageKey) ?? '');
    if (job.stage === 'finalists_ready' && prev < 1000) {
      badge = '🎯 ¡Finalistas listos!';
    } else if (Number.isFinite(prev) && currentSignal > prev) {
      const delta = currentSignal - prev;
      badge = `🆕 ${delta} ${delta === 1 ? 'nuevo' : 'nuevos'} desde tu última visita`;
    }
  } catch { /* localStorage disabled */ }

  return (
    <Link
      to={`/portal/${token}/jobs/${job.id}`}
      className={`cp-job-card cp-stage-${info.color}`}
      onClick={() => {
        try {
          // Marcar como visto: si es finalists_ready, usamos un valor alto para no re-disparar
          const sentinel = job.stage === 'finalists_ready' ? 1000000 : currentSignal;
          localStorage.setItem(storageKey, String(sentinel));
        } catch { /* ignore */ }
      }}
    >
      <div className="cp-job-card-header">
        <div className={`cp-stage-tag cp-stage-tag-${info.color}`}>{info.label}</div>
        <div className="cp-job-progress">
          <span className="cp-job-progress-dots">
            {job.milestones.map((m, i) => (
              <span key={i} className={`cp-job-dot ${m.completed_at ? 'is-done' : ''}`} />
            ))}
          </span>
          <span className="cp-job-progress-text">{completed}/4</span>
        </div>
      </div>
      <div className="cp-job-title">{job.display_title}</div>
      {badge && (
        <div style={{
          marginTop: 8, padding: '4px 10px', borderRadius: 99,
          background: 'rgba(218, 253, 111, 0.15)', color: '#dafd6f',
          fontSize: 12, fontWeight: 600, display: 'inline-block',
        }}>
          {badge}
        </div>
      )}
      <div className="cp-job-cta">{info.cta} →</div>
    </Link>
  );
}

// Convierte el shape del mock al shape del backend para evitar branching en la UI.
function mockToApi(mock: ReturnType<typeof getPortalByToken>): PortalApi {
  if (!mock) throw new Error('mock undefined');
  return {
    client_name: mock.client_name,
    client_email: mock.client_email,
    client_company: mock.client_company,
    agency_name: mock.agency_name,
    jobs: mock.jobs.map((j) => ({
      id: j.id,
      job_id: j.job_id,
      display_title: j.display_title,
      stage: j.stage === 'profile_approved' ? 'search_started' : j.stage,
      created_at: j.created_at,
      funnel: j.funnel,
      report_token: j.report_token,
      milestones: j.milestones,
    })),
  };
}
