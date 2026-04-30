import { Link } from 'react-router-dom';
import { MOCK_DRAFTS, STATUS_LABELS, STATUS_COLOR } from '../data/mockDrafts';
import './pages.css';
import './draft-review.css';

export default function DraftsList() {
  const pending = MOCK_DRAFTS.filter((d) => d.status === 'draft_generated' || d.status === 'in_review');
  const inFlight = MOCK_DRAFTS.filter((d) => d.status === 'transcript_pending' || d.status === 'transcript_ready' || d.status === 'sent_to_client');
  const closed = MOCK_DRAFTS.filter((d) => d.status === 'client_approved' || d.status === 'client_requested_changes' || d.status === 'archived');

  return (
    <div>
      <h1 className="page-title">Job Profile Drafts</h1>
      <p className="page-subtitle">
        Borradores de puestos generados por IA después de cada reunión con cliente. Revisás, editás, aprobás → mandamos al cliente.
      </p>

      <Section title={`Para revisar (${pending.length})`} drafts={pending} highlight />
      <Section title={`En curso (${inFlight.length})`} drafts={inFlight} />
      <Section title={`Cerrados (${closed.length})`} drafts={closed} dim />
    </div>
  );
}

function Section({
  title,
  drafts,
  highlight,
  dim,
}: {
  title: string;
  drafts: typeof MOCK_DRAFTS;
  highlight?: boolean;
  dim?: boolean;
}) {
  if (drafts.length === 0) {
    return (
      <div className="drafts-section">
        <h2 className="section-title">{title}</h2>
        <p className="muted">Sin drafts en esta categoría.</p>
      </div>
    );
  }
  return (
    <div className="drafts-section">
      <h2 className="section-title">{title}</h2>
      <div className="drafts-grid">
        {drafts.map((d) => (
          <Link
            key={d.id}
            to={`/drafts/${d.id}`}
            className={`drafts-card ${highlight ? 'is-highlight' : ''} ${dim ? 'is-dim' : ''}`}
          >
            <div className="drafts-card-header">
              <span className={`status-tag drafts-status-${STATUS_COLOR[d.status]}`}>
                {STATUS_LABELS[d.status]}
              </span>
              <span className="drafts-card-date">{d.meeting_date}</span>
            </div>
            <div className="drafts-card-title">{d.draft?.title ?? 'Pendiente de generar'}</div>
            <div className="drafts-card-client">{d.client_company} — {d.client_name}</div>
            <div className="drafts-card-meta">
              <span>{d.meeting_duration_min} min</span>
              <span>·</span>
              <span>Transcript: {d.transcript_source === 'zia' ? 'Zia' : 'Whisper'}</span>
              {d.ia_concerns && d.ia_concerns.length > 0 && (
                <>
                  <span>·</span>
                  <span className="drafts-card-concern">⚠️ {d.ia_concerns.length} alertas IA</span>
                </>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
