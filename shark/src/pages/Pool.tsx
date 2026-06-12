import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApi, type PoolEntry, type ApiJob } from '../lib/api';
import { toCsv, downloadCsv, type CsvColumn } from '../lib/csvExport';
import { SavedSearchesBar } from '../components/SavedSearchesBar';
import { logger } from '../lib/logger';
import './pages.css';

const log = logger('POOL_PAGE');

export default function PoolPage() {
  const api = useApi();
  const [pool, setPool] = useState<PoolEntry[]>([]);
  const [jobs, setJobs] = useState<ApiJob[]>([]);
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [tableNotReady, setTableNotReady] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [matchMode, setMatchMode] = useState<'all' | 'any'>('any');
  const [availableOnly, setAvailableOnly] = useState(true);
  const [cogLevel, setCogLevel] = useState<'all' | 'basic' | 'mid' | 'senior'>('all');

  // Modal estado para invitar
  const [invitingPool, setInvitingPool] = useState<PoolEntry | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [sendEmail, setSendEmail] = useState(true);
  const [inviting, setInviting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [poolRes, jobsRes, tagsRes] = await Promise.all([
        api.pool.list({
          availableOnly,
          tags: selectedTags.length > 0 ? selectedTags : undefined,
          matchMode,
        }),
        api.jobs.list().catch(() => ({ jobs: [] as ApiJob[] })),
        api.candidates.listAllTenantTags().catch(() => ({ tags: [] as Array<{ tag: string; count: number }> })),
      ]);
      setPool(poolRes.pool);
      setJobs(jobsRes.jobs.filter((j) => j.is_active));
      setTags(tagsRes.tags);
    } catch (err) {
      const msg = (err as Error).message;
      log.warn('pool load failed', { error: msg });
      if (msg.toLowerCase().includes('table_not_ready') || msg.includes('todavía no fue creada')) {
        setTableNotReady(true);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [availableOnly, selectedTags.join(','), matchMode]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return pool.filter((p) => {
      if (cogLevel !== 'all' && p.cognitive_level !== cogLevel) return false;
      if (q) {
        const matchesName = (p.candidate_id ?? '').toLowerCase().includes(q);
        const matchesTag = (p.tags ?? []).some((t) => t.toLowerCase().includes(q));
        if (!matchesName && !matchesTag) return false;
      }
      return true;
    });
  }, [pool, search, cogLevel]);

  async function handleInvite() {
    if (!invitingPool || !selectedJobId) return;
    setInviting(true);
    try {
      const res = await api.pool.inviteToJob(invitingPool.ROWID, selectedJobId, sendEmail);
      alert(`✓ ${res.created_new ? 'Application creada' : 'Application ya existía'} para "${res.job_title}".${res.email_sent ? ' Email enviado al candidato.' : ''}`);
      setInvitingPool(null);
      setSelectedJobId('');
      await load();
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    } finally {
      setInviting(false);
    }
  }

  if (tableNotReady) {
    return (
      <div className="page">
        <h1 className="page-title">Pool de candidatos</h1>
        <div style={{ padding: 20, background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8 }}>
          ⚠️ La tabla CandidatePool no está creada en Catalyst. Cuando la crees aparecerá el pool acá.
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pool de candidatos</h1>
          <p className="page-subtitle">
            {pool.length} candidatos · histórico de gente que llegó a stages avanzados
          </p>
        </div>
        <button
          className="btn-toolbar"
          onClick={() => {
            const cols: CsvColumn<PoolEntry>[] = [
              { key: 'candidate_id', label: 'candidate_id' },
              { key: 'cognitive_level', label: 'nivel_cognitivo' },
              { key: 'disc_d', label: 'disc_d' },
              { key: 'disc_i', label: 'disc_i' },
              { key: 'disc_s', label: 'disc_s' },
              { key: 'disc_c', label: 'disc_c' },
              { key: 'velna_indice', label: 'velna_pct' },
              { key: 'tags', label: 'tags', get: (r) => (r.tags ?? []).join(';') },
              { key: 'languages', label: 'idiomas', get: (r) => (r.languages ?? []).join(';') },
              { key: 'disponible_para_outreach', label: 'disponible' },
              { key: 'times_contacted', label: 'veces_contactado' },
              { key: 'last_active', label: 'ultima_actividad' },
              { key: 'last_contacted_at', label: 'ultimo_contacto' },
              { key: 'added_at', label: 'agregado_al_pool' },
              { key: 'notes_internal', label: 'notas_internas' },
            ];
            const csv = toCsv(filtered, cols);
            const today = new Date().toISOString().slice(0, 10);
            downloadCsv(csv, `pool-${today}.csv`);
          }}
          disabled={filtered.length === 0}
          title="Exportar a CSV — incluye los candidatos visibles según los filtros activos"
        >
          📥 Exportar CSV ({filtered.length})
        </button>
      </div>

      {/* Saved searches */}
      <div style={{ marginTop: 16 }}>
        <SavedSearchesBar
          scope="pool"
          currentFilters={{
            selectedTags,
            matchMode,
            availableOnly,
            cogLevel,
            search,
          }}
          onApply={(f) => {
            if (Array.isArray(f.selectedTags)) setSelectedTags(f.selectedTags as string[]);
            if (f.matchMode === 'all' || f.matchMode === 'any') setMatchMode(f.matchMode);
            if (typeof f.availableOnly === 'boolean') setAvailableOnly(f.availableOnly);
            if (f.cogLevel === 'all' || f.cogLevel === 'basic' || f.cogLevel === 'mid' || f.cogLevel === 'senior') setCogLevel(f.cogLevel);
            if (typeof f.search === 'string') setSearch(f.search);
          }}
        />
      </div>

      {/* Filtros */}
      <div className="filters-bar">
        <input
          type="search"
          className="filter-search"
          placeholder="Buscar por candidate ID o tag…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="filter-select"
          value={cogLevel}
          onChange={(e) => setCogLevel(e.target.value as typeof cogLevel)}
        >
          <option value="all">Todos los niveles cognitivos</option>
          <option value="basic">Básico</option>
          <option value="mid">Medio</option>
          <option value="senior">Senior</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={availableOnly}
            onChange={(e) => setAvailableOnly(e.target.checked)}
          />
          Solo disponibles
        </label>
      </div>

      {/* Filtro multi-tag */}
      {tags.length > 0 && (
        <div style={{ marginTop: 8, padding: 12, background: '#f9fafb', borderRadius: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>FILTRAR POR TAGS</span>
            {selectedTags.length > 1 && (
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  className={`filter-pill ${matchMode === 'any' ? 'is-active' : ''}`}
                  onClick={() => setMatchMode('any')}
                  style={{ fontSize: 11 }}
                >
                  Cualquiera (OR)
                </button>
                <button
                  className={`filter-pill ${matchMode === 'all' ? 'is-active' : ''}`}
                  onClick={() => setMatchMode('all')}
                  style={{ fontSize: 11 }}
                >
                  Todos (AND)
                </button>
              </div>
            )}
            {selectedTags.length > 0 && (
              <button
                onClick={() => setSelectedTags([])}
                style={{ background: 'transparent', border: 0, color: '#0284c7', fontSize: 12, cursor: 'pointer' }}
              >
                Limpiar selección
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tags.slice(0, 30).map((t) => {
              const selected = selectedTags.includes(t.tag);
              return (
                <button
                  key={t.tag}
                  onClick={() => {
                    if (selected) setSelectedTags((curr) => curr.filter((x) => x !== t.tag));
                    else setSelectedTags((curr) => [...curr, t.tag]);
                  }}
                  style={{
                    padding: '4px 10px', borderRadius: 99, fontSize: 12,
                    background: selected ? '#dafd6f' : '#fff',
                    border: selected ? '1px solid #16a34a' : '1px solid #d1d5db',
                    color: '#1f2937', cursor: 'pointer',
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  {t.tag} <span style={{ color: '#9ca3af' }}>({t.count})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <p>Cargando…</p>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          Sin candidatos en este filtro.
        </div>
      ) : (
        <table className="data-table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Candidato</th>
              <th>Tags</th>
              <th>Nivel</th>
              <th>DISC</th>
              <th>VELNA</th>
              <th>Veces contactado</th>
              <th>Última actividad</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.ROWID}>
                <td>
                  <Link to={`/candidates/${p.candidate_id}`} className="link" style={{ fontSize: 13 }}>
                    {p.candidate_id.slice(-10)}
                  </Link>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(p.tags ?? []).slice(0, 5).map((t) => (
                      <span key={t} style={{ padding: '1px 8px', background: '#f3f4f6', borderRadius: 4, fontSize: 11 }}>
                        {t}
                      </span>
                    ))}
                    {(p.tags ?? []).length > 5 && <span style={{ fontSize: 11, color: '#9ca3af' }}>+{(p.tags ?? []).length - 5}</span>}
                  </div>
                </td>
                <td style={{ fontSize: 12 }}>{p.cognitive_level ?? '—'}</td>
                <td style={{ fontSize: 12 }}>
                  {p.disc_d != null ? `${p.disc_d}/${p.disc_i}/${p.disc_s}/${p.disc_c}` : '—'}
                </td>
                <td style={{ fontSize: 12 }}>{p.velna_indice != null ? `${p.velna_indice}%` : '—'}</td>
                <td className="muted">{p.times_contacted ?? 0}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {p.last_active ? new Date(p.last_active).toLocaleDateString('es-419') : '—'}
                </td>
                <td>
                  <button
                    className="btn-toolbar"
                    onClick={() => setInvitingPool(p)}
                    style={{ fontSize: 12 }}
                  >
                    📩 Invitar a puesto
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Modal invitar */}
      {invitingPool && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }} onClick={() => setInvitingPool(null)}>
          <div style={{
            background: '#fff', borderRadius: 8, padding: 24, maxWidth: 500, width: '90%',
          }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 12px 0', fontSize: 18, fontWeight: 600 }}>
              Invitar candidato a un puesto
            </h2>
            <p style={{ margin: '0 0 16px 0', fontSize: 13, color: '#6b7280' }}>
              Crea una nueva Application en el puesto seleccionado, en stage <code>prefilter_passed</code>.
              El candidato se salta el prescreening (porque ya está validado en el pool).
            </p>

            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
              Puesto destino
            </label>
            <select
              value={selectedJobId}
              onChange={(e) => setSelectedJobId(e.target.value)}
              style={{ width: '100%', padding: 10, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 14, marginBottom: 16 }}
            >
              <option value="">Seleccioná un puesto…</option>
              {jobs.map((j) => (
                <option key={j.ROWID} value={j.ROWID}>{j.title} · {j.company}</option>
              ))}
            </select>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 16 }}>
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
              />
              Mandar email al candidato avisando del nuevo puesto
            </label>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn-toolbar" onClick={() => setInvitingPool(null)}>
                Cancelar
              </button>
              <button
                className="btn-primary"
                onClick={handleInvite}
                disabled={!selectedJobId || inviting}
              >
                {inviting ? 'Invitando…' : 'Invitar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
