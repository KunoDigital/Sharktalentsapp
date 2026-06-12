/**
 * Panel de sourcing interno: busca candidatos del pool histórico que matchean
 * el puesto. Se expande/colapsa con un botón. Llama `api.pool.match`.
 *
 * Si la tabla `CandidatePool` no existe (deferred Block 2), muestra banner explicativo.
 * Si `useApi=false`, banner "modo demo".
 */
import { useState } from 'react';
import { useApi, ApiError, type PoolMatchResult } from '../lib/api';
import { config } from '../config';
import { logger } from '../lib/logger';
import { TableNotReadyBanner } from './TableNotReadyBanner';

const log = logger('POOL_MATCH_PANEL');

export default function PoolMatchPanel({ jobId, areaTags, requiresEnglish }: {
  jobId: string;
  areaTags?: string[];
  requiresEnglish?: boolean;
}) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<PoolMatchResult[] | null>(null);
  const [poolSize, setPoolSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tableNotReady, setTableNotReady] = useState(false);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());

  async function invite(poolEntryId: string) {
    if (invitingId || invitedIds.has(poolEntryId)) return;
    if (!window.confirm('¿Invitar a este candidato al puesto? Le va a llegar email/WhatsApp con el link.')) return;
    setInvitingId(poolEntryId);
    try {
      const res = await api.pool.inviteToJob(poolEntryId, jobId, true);
      setInvitedIds((curr) => new Set(curr).add(poolEntryId));
      alert(res.created_new
        ? `✓ Invitado a "${res.job_title}". Email enviado al candidato.`
        : `Ya tenía una aplicación en este puesto (stage: ${res.pipeline_stage}).`);
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    } finally {
      setInvitingId(null);
    }
  }

  async function search() {
    if (!config.useApi) {
      setError('Modo demo — activá VITE_USE_API y deployá backend para usar el pool real');
      return;
    }
    setLoading(true);
    setError(null);
    setTableNotReady(false);
    try {
      const res = await api.pool.match({
        job_id: jobId,
        area_tags: areaTags,
        requires_english: requiresEnglish,
        limit: 20,
      });
      setMatches(res.matches);
      setPoolSize(res.pool_size);
    } catch (err) {
      log.warn('pool match failed', { error: (err as Error).message });
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

  return (
    <section className="job-form-section" style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>🔍 Sourcing del pool histórico</h2>
        <button className="btn-toolbar" onClick={() => setOpen((v) => !v)}>
          {open ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: '1rem' }}>
          <p className="muted small">
            Buscá candidatos en tu pool interno (histórico de candidatos que aplicaron a otros puestos del tenant).
            Score 0-100 calculado por DISC + cognitive level + tags + idiomas + recency, descontando candidatos contactados muchas veces.
          </p>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <button className="btn-primary" onClick={search} disabled={loading}>
              {loading ? 'Buscando…' : '🔍 Buscar matches en el pool'}
            </button>
          </div>

          {error && (
            <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', color: '#fca5a5', marginBottom: '1rem' }}>
              ⚠️ {error}
            </div>
          )}

          {tableNotReady && (
            <TableNotReadyBanner
              tableName="CandidatePool"
              migrationSection="§15"
              unlocksFeature="al agregar candidatos al pool, esta búsqueda los devuelve ordenados por match"
            />
          )}

          {matches !== null && !error && !tableNotReady && (
            <>
              <p className="muted small">
                Pool total: {poolSize} · Disponibles para match: {matches.length} · Excluidos los que ya aplicaron a este puesto.
              </p>
              {matches.length === 0 ? (
                <p className="muted">No hay matches disponibles. Probá agregar más candidatos al pool desde sus detalles.</p>
              ) : (
                <div className="bot-queue-list">
                  {matches.map((m) => (
                    <div key={m.pool_entry_id} className="bot-queue-card">
                      <div className="bot-queue-header">
                        <div>
                          <div className="bot-queue-name">Candidato {m.candidate_id.slice(0, 8)}…</div>
                          <div className="bot-queue-meta">
                            {m.available ? '🟢 Disponible para outreach' : '⚪ No disponible'}
                          </div>
                        </div>
                        <div className="bot-queue-confidence">
                          <div className="bot-queue-conf-pct">{m.match_score}%</div>
                          <div className="bot-queue-conf-label">match</div>
                        </div>
                      </div>
                      {m.available && (
                        <div style={{ marginTop: '0.5rem' }}>
                          {invitedIds.has(m.pool_entry_id) ? (
                            <span style={{ color: '#16a34a', fontSize: 12, fontWeight: 600 }}>✓ Invitado</span>
                          ) : (
                            <button
                              className="btn-toolbar"
                              onClick={() => invite(m.pool_entry_id)}
                              disabled={invitingId !== null}
                              style={{ fontSize: 12 }}
                            >
                              {invitingId === m.pool_entry_id ? 'Invitando…' : '📩 Invitar a este puesto'}
                            </button>
                          )}
                        </div>
                      )}
                      <ul style={{ marginTop: '0.5rem', fontSize: '0.85rem', paddingLeft: '1rem' }}>
                        {m.reasoning.map((r, idx) => <li key={idx}>{r}</li>)}
                      </ul>
                      <details style={{ marginTop: '0.5rem', fontSize: '0.78rem' }}>
                        <summary className="muted">Breakdown del score</summary>
                        <table style={{ marginTop: '0.5rem' }}>
                          <tbody>
                            <tr><td>DISC similitud:</td><td>{m.breakdown.disc}</td></tr>
                            <tr><td>Cognitive level:</td><td>{m.breakdown.cognitive}</td></tr>
                            <tr><td>Área tags:</td><td>{m.breakdown.area}</td></tr>
                            <tr><td>Idiomas:</td><td>{m.breakdown.english}</td></tr>
                            <tr><td>Recency:</td><td>{m.breakdown.recency}</td></tr>
                            <tr><td>Penalty contactos:</td><td>{m.breakdown.contact_history}</td></tr>
                          </tbody>
                        </table>
                      </details>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
