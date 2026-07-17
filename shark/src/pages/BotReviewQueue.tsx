import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MOCK_APPLICATIONS } from '../data/mockApplications';
import { getJobById } from '../data/mockJobs';
import { useApi, ApiError, type ReviewQueueItem } from '../lib/api';
import { config } from '../config';
import { logger } from '../lib/logger';
import { TableNotReadyBanner } from '../components/TableNotReadyBanner';
import './pages.css';
import './bot.css';

const log = logger('BOT_REVIEW_QUEUE');

type OverrideModalState = { item: ReviewQueueItem; stage: string; rationale: string } | null;

const OVERRIDE_STAGE_OPTIONS = [
  { value: 'finalist', label: 'Finalist (avanzar)' },
  { value: 'rejected_by_admin', label: 'Rechazar (admin)' },
  { value: 'integridad_completed', label: 'Volver a integridad_completed' },
  { value: 'conductual_completed', label: 'Volver a conductual_completed' },
  { value: 'tecnica_completed', label: 'Volver a tecnica_completed' },
];

export default function BotReviewQueue() {
  const api = useApi();
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableNotReady, setTableNotReady] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'high' | 'normal'>('all');
  const [overrideModal, setOverrideModal] = useState<OverrideModalState>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.bot.listReviewQueue();
      setItems(res.items);
      setTableNotReady(false);
    } catch (err) {
      log.warn('list review queue failed', { error: (err as Error).message });
      if (err instanceof ApiError && err.code === 'table_not_ready') {
        setTableNotReady(true);
      } else if (err instanceof ApiError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (config.useApi) load();
    else setLoading(false);
  }, []);

  async function confirmDecision(item: ReviewQueueItem) {
    if (!item.bot_decision) return;
    setDecidingId(item.ROWID);
    try {
      await api.bot.decide(item.ROWID, { action: 'confirm' });
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message;
      alert(`Error: ${msg}`);
    } finally {
      setDecidingId(null);
    }
  }

  function openOverrideModal(item: ReviewQueueItem) {
    setOverrideModal({ item, stage: 'rejected_by_admin', rationale: '' });
  }

  async function submitOverride() {
    if (!overrideModal) return;
    const { item, stage, rationale } = overrideModal;
    if (!stage) return;
    setDecidingId(item.ROWID);
    setOverrideModal(null);
    try {
      await api.bot.decide(item.ROWID, { action: 'override', override_stage: stage, rationale });
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message;
      alert(`Error: ${msg}`);
    } finally {
      setDecidingId(null);
    }
  }

  // Modo demo (sin backend): mostramos mock items.
  const demoItems = MOCK_APPLICATIONS
    .filter((a) => a.bot_decision && (a.bot_decision as { needs_review?: boolean }).needs_review);

  if (!config.useApi) {
    return (
      <div>
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Bot decisor — Review queue</h1>
            <p className="page-subtitle">Casos donde el bot tiene confianza debajo del umbral.</p>
          </div>
          <div className="bot-mode-badge bot-mode-warm">Modo: Demo (sin backend)</div>
        </div>
        <div style={{ padding: '0.75rem 1rem', background: 'rgba(99, 102, 241, 0.08)', border: '1px dashed rgba(99, 102, 241, 0.4)', borderRadius: '6px', marginBottom: '1rem', color: '#a5b4fc', fontSize: '0.8rem' }}>
          📺 Demo · Activá VITE_USE_API y deployá el backend para ver la cola real del bot.
        </div>
        {/* Mock list — read-only */}
        <div className="bot-queue-list">
          {demoItems.map((app) => {
            const job = getJobById(app.job_id);
            const bd = app.bot_decision as { stage?: string; confidence: number; recommendation: string; rationale_text: string; threshold?: number };
            return (
              <div key={app.id} className="bot-queue-card">
                <div className="bot-queue-header">
                  <div>
                    <div className="bot-queue-name">{app.candidate_name}</div>
                    <div className="bot-queue-meta">{job?.title} · etapa {bd.stage}</div>
                  </div>
                  <div className="bot-queue-confidence">
                    <div className="bot-queue-conf-pct">{(bd.confidence * 100).toFixed(0)}%</div>
                  </div>
                </div>
                <div className="bot-queue-recommendation"><strong>Bot dice:</strong> {bd.recommendation}</div>
                <div className="bot-queue-rationale">{bd.rationale_text}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (loading) return <p className="muted">Cargando cola del bot…</p>;

  if (tableNotReady) {
    return (
      <div>
        <h1 className="page-title">Bot decisor — Review queue</h1>
        <TableNotReadyBanner
          tableName="BotDecisions / ReviewQueue"
          migrationSection="§10/§11"
          unlocksFeature="el bot pasa de modo cold (solo recomienda) a warm/hot (acumula decisiones para revisión)"
        />
      </div>
    );
  }

  const filteredItems = priorityFilter === 'all'
    ? items
    : items.filter((i) => i.priority === priorityFilter);

  return (
    <div>
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Bot decisor — Review queue</h1>
          <p className="page-subtitle">
            Casos donde el bot tiene confianza debajo del umbral y necesita tu decisión humana.
          </p>
        </div>
      </div>

      {overrideModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: 'var(--st-bg, #1a1a1a)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1.25rem', maxWidth: '500px', width: '90%' }}>
            <h3 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Override decisión del bot</h3>
            <p className="muted small" style={{ marginBottom: '0.75rem' }}>
              El bot sugería <strong>{overrideModal.item.bot_decision?.to_stage_proposed}</strong>. ¿A qué etapa quieres mover en su lugar?
            </p>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.6rem' }}>
              Etapa destino:
              <select
                value={overrideModal.stage}
                onChange={(e) => setOverrideModal({ ...overrideModal, stage: e.target.value })}
                style={{ width: '100%', marginTop: '0.2rem' }}
              >
                {OVERRIDE_STAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              Razón (queda como training example para el bot):
              <textarea
                value={overrideModal.rationale}
                onChange={(e) => setOverrideModal({ ...overrideModal, rationale: e.target.value })}
                rows={3}
                style={{ width: '100%', marginTop: '0.2rem' }}
                placeholder="ej: el candidato tiene experiencia que el bot no consideró"
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="cd-btn-ghost" onClick={() => setOverrideModal(null)}>
                Cancelar
              </button>
              <button type="button" className="btn-primary" onClick={submitOverride}>
                Confirmar override
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', color: '#fca5a5', marginBottom: '1rem' }}>
          ⚠️ {error}
        </div>
      )}

      <div className="bot-stats-grid">
        <div className="stat-card">
          <div className="stat-value">{items.length}</div>
          <div className="stat-label">Esperando tu decisión</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{items.filter((i) => i.priority === 'high').length}</div>
          <div className="stat-label">Prioridad alta</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          Pendientes ({filteredItems.length}{priorityFilter !== 'all' ? ` de ${items.length}` : ''})
        </h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as 'all' | 'high' | 'normal')}>
            <option value="all">Todos</option>
            <option value="high">Solo prioridad alta</option>
            <option value="normal">Solo normal</option>
          </select>
          <button type="button" className="btn-toolbar" onClick={load} disabled={loading}>
            {loading ? '⟳…' : '⟳ Refrescar'}
          </button>
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div className="bot-empty-state">
          <p>{items.length === 0 ? '✓ No hay casos pendientes. El bot está corriendo con confianza alta.' : 'Sin items que matcheen el filtro.'}</p>
        </div>
      ) : (
        <div className="bot-queue-list">
          {filteredItems.map((item) => {
            const bd = item.bot_decision;
            return (
              <div key={item.ROWID} className={`bot-queue-card${item.priority === 'high' ? ' is-high-priority' : ''}`}>
                <div className="bot-queue-header">
                  <div>
                    <Link to={`/candidates/${item.application_id}`} className="bot-queue-name link">
                      Application {item.application_id.slice(0, 8)}…
                    </Link>
                    <div className="bot-queue-meta">
                      {bd ? `${bd.from_stage} → ${bd.to_stage_proposed}` : 'Decision data missing'}
                      {item.priority === 'high' && ' · ⚠️ Prioridad alta'}
                    </div>
                  </div>
                  {bd && (
                    <div className="bot-queue-confidence">
                      <div className="bot-queue-conf-pct">{bd.confidence}%</div>
                      <div className="bot-queue-conf-label">confidence</div>
                    </div>
                  )}
                </div>
                <div className="bot-queue-recommendation">
                  <strong>Razón en cola:</strong> {item.reason}
                </div>
                {bd && <div className="bot-queue-rationale">{bd.rationale}</div>}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <button
                    className="btn-primary"
                    onClick={() => confirmDecision(item)}
                    disabled={decidingId === item.ROWID}
                  >
                    ✓ Confirmar sugerencia bot
                  </button>
                  <button
                    className="btn-toolbar"
                    onClick={() => openOverrideModal(item)}
                    disabled={decidingId === item.ROWID}
                  >
                    ✗ Override
                  </button>
                  <Link to={`/candidates/${item.application_id}`} className="cd-btn-ghost">
                    Ver perfil
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="muted-note">
        💡 Cada override que hagas se persiste como <code>BotTrainingExample</code> para que el bot aprenda.
      </p>
    </div>
  );
}
