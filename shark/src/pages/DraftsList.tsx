import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { MOCK_DRAFTS, STATUS_LABELS, STATUS_COLOR } from '../data/mockDrafts';
import { useApi, ApiError, type JobDraft } from '../lib/api';
import { config } from '../config';
import { logger } from '../lib/logger';
// 2026-06-05: BriefingForm reemplazado por TranscriptUploadForm inline — el flow
// de schedule por API fue eliminado (era frágil). Cris manda link de Bookings al
// cliente y sube el transcript después manualmente.
import { TableNotReadyBanner } from '../components/TableNotReadyBanner';
import './pages.css';
import './draft-review.css';

const log = logger('DRAFTS_LIST');

export default function DraftsList() {
  const api = useApi();
  const [backendDrafts, setBackendDrafts] = useState<JobDraft[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [tableNotReady, setTableNotReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!config.useApi) {
      setLoading(false);
      return;
    }
    api.drafts.list()
      .then((res) => {
        if (cancelled) return;
        setBackendDrafts(res.drafts);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'table_not_ready') {
          setTableNotReady(true);
        } else {
          log.warn('drafts list failed', { error: (err as Error).message });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Si backend respondió, usar drafts reales mapeados al shape de mock para reusar UI.
  // Si no, fallback al mock.
  const useBackend = config.useApi && backendDrafts !== null;
  const drafts = useBackend ? backendDrafts.map(adaptBackendDraft) : MOCK_DRAFTS;

  const pending = drafts.filter((d) => d.status === 'draft_generated' || d.status === 'in_review');
  const inFlight = drafts.filter((d) => d.status === 'transcript_pending' || d.status === 'transcript_ready' || d.status === 'sent_to_client');
  const closed = drafts.filter((d) => d.status === 'client_approved' || d.status === 'client_requested_changes' || d.status === 'archived');

  if (loading) return <div><h1 className="page-title">Job Profile Drafts</h1><p className="muted">Cargando…</p></div>;

  // Total de comentarios sin leer en todos los drafts (notificación global)
  const totalUnreadComments = drafts.reduce(
    (acc, d) => acc + ((d as unknown as { client_comments_count?: number }).client_comments_count ?? 0),
    0,
  );
  const draftsWithComments = drafts.filter(
    (d) => ((d as unknown as { client_comments_count?: number }).client_comments_count ?? 0) > 0,
  );

  return (
    <div>
      <h1 className="page-title">Job Profile Drafts</h1>
      <p className="page-subtitle">
        Borradores de puestos generados por IA después de cada reunión con cliente. Revisás, editás, aprobás → mandamos al cliente.
        {useBackend && <span className="muted small"> · Datos en vivo del backend</span>}
      </p>

      {totalUnreadComments > 0 && (
        <div style={{
          marginBottom: '1rem',
          padding: '0.85rem 1.1rem',
          background: 'rgba(255, 200, 0, 0.1)',
          border: '1px solid rgba(255, 200, 0, 0.45)',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
        }}>
          <span style={{ fontSize: '1.4rem' }}>💬</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: '#f0b330', marginBottom: '0.2rem' }}>
              {totalUnreadComments} comentario{totalUnreadComments > 1 ? 's' : ''} del cliente en {draftsWithComments.length} draft{draftsWithComments.length > 1 ? 's' : ''}
            </div>
            <div className="muted small">
              Los drafts marcados con borde amarillo abajo tienen comentarios para revisar.
            </div>
          </div>
        </div>
      )}

      {tableNotReady && (
        <div style={{ marginBottom: '1rem' }}>
          <TableNotReadyBanner
            tableName="JobProfileDrafts"
            migrationSection="§4"
            unlocksFeature="los drafts post-briefing van a persistir en lugar de mostrarse mock"
          />
        </div>
      )}

      <Section title={`Para revisar (${pending.length})`} drafts={pending} highlight />
      <Section title={`En curso (${inFlight.length})`} drafts={inFlight} />
      <Section title={`Cerrados (${closed.length})`} drafts={closed} dim />

      <TranscriptUploader />
    </div>
  );
}

/**
 * Carga manual de transcript: pegás el texto de la reunión, IA genera draft, se guarda y redirige.
 */
function TranscriptUploader() {
  const api = useApi();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [marketingLeadId, setMarketingLeadId] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leads, setLeads] = useState<Array<{ ROWID: string; email: string; contact_name: string | null; company: string | null }>>([]);

  // Cargar leads al abrir el form — el dropdown reemplaza el typing manual del email
  // que era fuente de errores humanos (ver flujo Kuno 2026-06-02).
  useEffect(() => {
    if (!open || !config.useApi) return;
    api.marketing.listLeads({ limit: 300 })
      .then((res) => setLeads(res.leads.map((l) => ({ ROWID: l.ROWID, email: l.email, contact_name: l.contact_name, company: l.company }))))
      .catch((err) => log.warn('load leads for picker failed', { error: (err as Error).message }));
  }, [open, api.marketing]);

  // Al seleccionar un lead del dropdown, auto-rellenar email (preview — el backend lo
  // re-resuelve igual de la fuente en MarketingLeads para evitar drift).
  function handleLeadChange(leadId: string) {
    setMarketingLeadId(leadId);
    if (!leadId) {
      setClientEmail('');
      return;
    }
    const lead = leads.find((l) => l.ROWID === leadId);
    if (lead?.email) setClientEmail(lead.email);
  }

  async function handleGenerate() {
    setError(null);
    const t = transcript.trim();
    if (t.length < 100) {
      setError('El transcript debe tener al menos 100 caracteres.');
      return;
    }
    // 2026-06-05: usamos endpoint ASYNC (briefings/upload-transcript) que publica al
    // outbox y devuelve rápido (<2s) en vez del síncrono que esperaba Anthropic 30-90s.
    // El síncrono se caía con "JWT is expired" porque los tokens Clerk duran 60s y
    // el request entero superaba eso. Async resuelve el problema de raíz.
    // El draft se genera en background; el frontend redirige a /drafts donde aparece
    // cuando el outbox lo procesa (~30-60s después).
    let resolvedEmail = clientEmail.trim();
    let resolvedName = '';
    if (marketingLeadId) {
      const lead = leads.find((l) => l.ROWID === marketingLeadId);
      if (lead) {
        resolvedEmail = resolvedEmail || lead.email;
        resolvedName = lead.contact_name ?? lead.email.split('@')[0];
      }
    }
    if (!resolvedEmail) {
      setError('Seleccioná un lead o ingresá el email del cliente manualmente.');
      return;
    }
    if (!resolvedName) {
      resolvedName = resolvedEmail.split('@')[0];
    }
    setSubmitting(true);
    try {
      const r = await api.briefings.uploadTranscript({
        client_email: resolvedEmail,
        client_name: resolvedName,
        transcript: t,
      });
      if (!r || !r.queued) throw new Error('No se pudo encolar el transcript');
      // Redirigir a la lista de drafts con mensaje. El draft va a aparecer en ~30-60s
      // cuando el outbox procese el evento. El usuario hace refresh y lo ve.
      alert('✅ Transcript en cola. El draft se genera en background (~30-60 segundos). Refrescá la página de Drafts para verlo aparecer.');
      navigate('/drafts');
    } catch (err) {
      log.warn('upload transcript failed', { error: (err as Error).message });
      setError((err as Error).message || 'No se pudo subir el transcript.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section style={{ marginTop: '2rem', padding: '1rem 1.25rem', background: 'rgba(218,253,111,0.04)', border: '1px solid var(--accent)', borderRadius: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: open ? '0.75rem' : 0 }}>
        <div>
          <strong>Subir transcript manualmente</strong>
          <p className="muted small" style={{ marginTop: '0.2rem' }}>
            Ya tuviste la reunión pero la transcripción no llegó automática? Pegá el texto acá y la IA arma el draft.
          </p>
        </div>
        <button type="button" className="btn-toolbar" onClick={() => setOpen((o) => !o)}>
          {open ? 'Cerrar' : 'Pegar transcript'}
        </button>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span className="muted small">Cliente (vincular con Marketing Lead)</span>
            <select
              value={marketingLeadId}
              onChange={(e) => handleLeadChange(e.target.value)}
              style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--st-border-soft)', background: 'var(--st-bg-elev)', color: 'var(--st-fg)' }}
            >
              <option value="">— Sin vincular (escribir email manual) —</option>
              {leads.map((l) => (
                <option key={l.ROWID} value={l.ROWID}>
                  {l.company || l.contact_name || l.email} · {l.email}
                </option>
              ))}
            </select>
            {marketingLeadId && (
              <span className="muted small">Email auto-resuelto del lead. Si el lead no tiene email, editalo en Marketing Leads.</span>
            )}
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span className="muted small">Email del cliente {marketingLeadId ? '(del lead)' : '(manual)'}</span>
              <input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                placeholder="cliente@empresa.com"
                disabled={Boolean(marketingLeadId)}
                style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--st-border-soft)', background: marketingLeadId ? 'var(--st-bg-elev-2)' : 'var(--st-bg-elev)', color: 'var(--st-fg)', opacity: marketingLeadId ? 0.7 : 1 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span className="muted small">URL de la reunión (opcional)</span>
              <input
                type="url"
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                placeholder="https://meeting.zoho.com/..."
                style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--st-border-soft)', background: 'transparent', color: 'var(--st-fg)' }}
              />
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span className="muted small">Transcript completo de la reunión</span>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Pegá acá el texto completo de la reunión. La IA va a inferir: rol, requisitos, perfil DISC ideal, capacidad cognitiva esperada, salario, contexto."
              rows={10}
              style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--st-border-soft)', background: 'transparent', color: 'var(--st-fg)', fontFamily: 'inherit', fontSize: '0.92rem', lineHeight: 1.5 }}
            />
            <span className="muted small">{transcript.length} caracteres · mínimo 100</span>
          </label>
          {error && (
            <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(220,53,69,0.1)', border: '1px solid rgba(220,53,69,0.4)', borderRadius: '6px', color: '#ff8888', fontSize: '0.88rem' }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn-toolbar" onClick={() => { setTranscript(''); setMarketingLeadId(''); setClientEmail(''); setMeetingUrl(''); setError(null); }} disabled={submitting}>
              Limpiar
            </button>
            <button type="button" className="btn-primary" onClick={handleGenerate} disabled={submitting || transcript.trim().length < 100}>
              {submitting ? 'Generando con IA…' : 'Generar draft con IA'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Adapta un draft del backend al shape de mock para reusar la UI.
 * Mapea status del backend (subset) al status de mock (superset).
 */
function adaptBackendDraft(d: JobDraft): typeof MOCK_DRAFTS[number] {
  // Mapeo de status backend → mock
  const statusMap: Record<JobDraft['status'], typeof MOCK_DRAFTS[number]['status']> = {
    draft_generated: 'draft_generated',
    pending_client_review: 'sent_to_client',
    client_approved: 'client_approved',
    client_changes_requested: 'client_requested_changes',
    converted_to_job: 'archived',
    discarded: 'archived',
  };

  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(d.draft_payload); } catch { /* empty */ }

  // Comentarios del cliente — columna highlights con shape { client_comments: [{at, text}] }
  let clientCommentsCount = 0;
  const rawHl = (d as unknown as { highlights?: string | null }).highlights;
  if (rawHl) {
    try {
      const parsedHl = JSON.parse(rawHl);
      if (parsedHl && Array.isArray(parsedHl.client_comments)) {
        clientCommentsCount = parsedHl.client_comments.length;
      }
    } catch { /* ignore */ }
  }

  return {
    id: d.ROWID,
    status: statusMap[d.status],
    meeting_date: d.created_at?.slice(0, 10) ?? '',
    meeting_duration_min: 30,
    transcript_source: (d.transcript_source as 'zia' | 'whisper') ?? 'zia',
    client_company: typeof payload.company === 'string' ? payload.company : '—',
    client_name: d.client_email ?? '—',
    client_email: d.client_email ?? '',
    transcript_excerpt: d.transcript ? d.transcript.slice(0, 300) : '',
    transcript: d.transcript ?? '',
    draft: typeof payload.title === 'string' ? {
      title: payload.title,
      cognitive_level: 'mid' as const,
      disc_ideal_a: { d: 50, i: 50, s: 50, c: 50, pk_profile_code: 'PK', pk_profile_name: 'Custom', description: [] },
      velna_ideal: { verbal: 70, espacial: 65, logica: 75, numerica: 70, abstracta: 70 },
      competencias_ideales: [],
      tecnica_minimo_pct: 60,
      context: typeof payload.context_summary === 'string' ? payload.context_summary : '',
      salary_range_usd: { min: 0, max: 0 },
    } : undefined,
    ia_concerns: [],
    history: [],
    highlights: [],
    created_at: d.created_at,
    ia_summary_meeting: '',
    client_comments_count: clientCommentsCount,
  } as unknown as typeof MOCK_DRAFTS[number] & { client_comments_count: number };
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
        {drafts.map((d) => {
          const commentsCount = (d as unknown as { client_comments_count?: number }).client_comments_count ?? 0;
          return (
          <Link
            key={d.id}
            to={`/drafts/${d.id}`}
            className={`drafts-card ${highlight ? 'is-highlight' : ''} ${dim ? 'is-dim' : ''}`}
            style={commentsCount > 0 ? { borderLeft: '4px solid #f0b330' } : undefined}
          >
            <div className="drafts-card-header">
              <span className={`status-tag drafts-status-${STATUS_COLOR[d.status]}`}>
                {STATUS_LABELS[d.status]}
              </span>
              {commentsCount > 0 && (
                <span style={{
                  fontSize: '0.72rem',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '10px',
                  background: 'rgba(255, 200, 0, 0.15)',
                  border: '1px solid rgba(255, 200, 0, 0.4)',
                  color: '#f0b330',
                  fontWeight: 600,
                }}>
                  💬 {commentsCount} comentario{commentsCount > 1 ? 's' : ''} sin leer
                </span>
              )}
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
          );
        })}
      </div>
    </div>
  );
}
