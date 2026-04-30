import { Link, useParams } from 'react-router-dom';
import { getPortalByToken, type PortalJob, type PortalJobStage } from '../../data/mockClientPortals';
import './client-portal.css';

const STAGE_INFO: Record<PortalJobStage, { label: string; color: string; cta: string }> = {
  profile_pending: { label: 'Perfil pendiente de aprobar', color: 'warn', cta: 'Aprobar perfil' },
  profile_approved: { label: 'Perfil aprobado', color: 'mid', cta: 'Ver detalle' },
  search_started: { label: 'Búsqueda iniciada', color: 'mid', cta: 'Ver tracking' },
  funnel_active: { label: 'Candidatos en evaluación', color: 'mid', cta: 'Ver tracking' },
  finalists_ready: { label: 'Finalistas listos', color: 'good', cta: 'Ver finalistas' },
  closed: { label: 'Cerrado', color: 'muted', cta: 'Ver historial' },
};

export default function ClientPortalLanding() {
  const { token } = useParams<{ token: string }>();
  const portal = token ? getPortalByToken(token) : undefined;

  if (!portal) {
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
        <div className="cp-jobs-grid">
          {portal.jobs.map((job) => (
            <JobCard key={job.id} job={job} token={portal.token} />
          ))}
        </div>

        <div className="cp-help-box">
          <div className="cp-help-title">¿Algo no está claro?</div>
          <p>
            Escribime a <a href={`mailto:${portal.agency_name === 'Kuno Digital' ? 'cris@kunodigital.com' : 'hola@sharktalents.ai'}`} className="cp-help-link">cris@kunodigital.com</a> o por WhatsApp.
          </p>
        </div>
      </main>

      <footer className="cp-footer">
        <div className="cp-brand">SharkTalents.AI</div>
        <div className="cp-footer-tag">Plataforma de evaluación de talento con IA</div>
      </footer>
    </div>
  );
}

function JobCard({ job, token }: { job: PortalJob; token: string }) {
  const info = STAGE_INFO[job.stage];
  const completed = job.milestones.filter((m) => m.completed_at !== null).length;
  return (
    <Link to={`/portal/${token}/jobs/${job.id}`} className={`cp-job-card cp-stage-${info.color}`}>
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
      <div className="cp-job-cta">{info.cta} →</div>
    </Link>
  );
}
