import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { MOCK_APPLICATIONS, STATE_LABELS, SOURCE_LABELS, type ApplicationSource, type ApplicationState, type Application } from '../data/mockApplications';
import { MOCK_JOBS, getJobById } from '../data/mockJobs';
import { exportCandidatesToExcel } from '../lib/excelExport';
import { toCsv, downloadCsv, type CsvColumn } from '../lib/csvExport';
import { useApi, type ApiApplication, type ApiCandidate } from '../lib/api';
import { useApiData } from '../hooks/useApiData';
import { config } from '../config';
import EmptyState from '../components/EmptyState';
import './pages.css';

/**
 * Adapta una ApiApplication + Candidate al shape Application del mock.
 * No tiene todos los campos ricos (disc, velna, etc.) — para la lista alcanza con esto.
 */
function adaptApiApplication(app: ApiApplication, candidate: ApiCandidate | undefined): Application {
  const fallbackState: ApplicationState = (
    [
      'prefilter_pending', 'prefilter_passed', 'salary_out_of_range',
      'tecnica_completed', 'conductual_completed', 'integridad_completed',
      'finalist', 'auto_rejected_low_score', 'rejected_by_admin',
    ] as ApplicationState[]
  ).includes(app.pipeline_stage as ApplicationState)
    ? (app.pipeline_stage as ApplicationState)
    : 'prefilter_pending';

  return {
    id: app.ROWID,
    job_id: app.assessment_id,
    candidate_name: candidate?.name ?? '(sin nombre)',
    candidate_email: candidate?.email ?? '',
    candidate_age: candidate?.age ?? 0,
    candidate_phone: candidate?.phone ?? '',
    source: 'direct',
    state: fallbackState,
    applied_at: app.started_at,
    salary_aspiration_usd: candidate?.salary_expectation ?? 0,
    disponibilidad: candidate?.availability ?? '',
    tecnica_state: 'registrado',
    conductual_state: 'registrado',
    integridad_state: 'registrado',
    anti_cheat_events: [],
    ia_summary: '',
    timeline: [],
  };
}

export default function CandidatesList() {
  const api = useApi();
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | ApplicationSource>('all');
  const [stateFilter, setStateFilter] = useState<'all' | ApplicationState>('all');
  // Toggle de filtro temporal: default últimos 90 días, opcional "todo el histórico".
  const [showAll, setShowAll] = useState(false);
  // Selection para bulk actions
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { data, loading, error } = useApiData(
    async () => {
      if (!config.useApi) return null;
      const [apps, cands] = await Promise.all([
        api.applications.list(),
        api.candidates.list({ lastNDays: showAll ? 0 : 90 }),
      ]);
      return { apps: apps.applications, cands: cands.candidates };
    },
    [config.useApi, showAll],
  );

  const applications: Application[] = useMemo(() => {
    if (config.useApi && data) {
      const candById = new Map(data.cands.map((c) => [c.ROWID, c]));
      return data.apps.map((a) => adaptApiApplication(a, candById.get(a.candidate_id)));
    }
    return MOCK_APPLICATIONS;
  }, [data]);

  const sources = Array.from(new Set(applications.map((a) => a.source)));
  const states = Array.from(new Set(applications.map((a) => a.state)));

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return applications.filter((app) => {
      if (sourceFilter !== 'all' && app.source !== sourceFilter) return false;
      if (stateFilter !== 'all' && app.state !== stateFilter) return false;
      if (q && !app.candidate_name.toLowerCase().includes(q) && !app.candidate_email.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [applications, search, sourceFilter, stateFilter]);

  return (
    <div>
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Candidatos</h1>
          <p className="page-subtitle">
            Vista cross-job de todas las aplicaciones.
            {config.useApi && <span className="muted small"> · Datos en vivo del backend</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn-toolbar"
            onClick={() => {
              const cols: CsvColumn<Application>[] = [
                { key: 'id', label: 'application_id' },
                { key: 'candidate_name', label: 'nombre' },
                { key: 'candidate_email', label: 'email' },
                { key: 'job_id', label: 'job_id' },
                { key: 'source', label: 'fuente' },
                { key: 'state', label: 'estado' },
                { key: 'applied_at', label: 'aplico_el' },
                { key: 'tecnica_pct', label: 'tecnica_pct', get: (a) => a.tecnica?.pct ?? '' },
                { key: 'disc_dominant', label: 'disc_dominante', get: (a) => a.disc?.dominant_label ?? '' },
                { key: 'integridad_buena_imp', label: 'integridad_buena_imp', get: (a) => (a.integridad?.buena_impresion_alta ? 'si' : 'no') },
                { key: 'bot_recommendation', label: 'bot_recomendacion', get: (a) => a.bot_decision?.recommendation ?? '' },
              ];
              const csv = toCsv(filtered, cols);
              const today = new Date().toISOString().slice(0, 10);
              downloadCsv(csv, `candidatos-${today}.csv`);
            }}
            disabled={filtered.length === 0}
            title="Exportar a CSV — incluye los candidatos visibles según los filtros activos"
          >
            📥 CSV ({filtered.length})
          </button>
          <button
            className="btn-toolbar"
            onClick={() => exportCandidatesToExcel(filtered, MOCK_JOBS, `candidatos-${filtered.length}.xlsx`)}
          >
            Excel ({filtered.length})
          </button>
        </div>
      </div>

      {config.useApi && error && (
        <div className="cd-alert cd-alert-warn" style={{ marginBottom: '1rem' }}>
          ⚠️ No se pudo cargar del backend: {error.message}. Mostrando data mock.
        </div>
      )}

      {config.useApi && loading && <p className="muted">Cargando...</p>}

      <div className="filters-bar">
        <input
          type="search"
          className="filter-search"
          placeholder="Buscar por nombre o email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="filter-select"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as 'all' | ApplicationSource)}
        >
          <option value="all">Todos los sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
          ))}
        </select>
        <select
          className="filter-select"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value as 'all' | ApplicationState)}
        >
          <option value="all">Todos los estados</option>
          {states.map((s) => (
            <option key={s} value={s}>{STATE_LABELS[s]}</option>
          ))}
        </select>
        <button
          type="button"
          className="filter-select"
          onClick={() => setShowAll((v) => !v)}
          title="Por defecto mostramos solo los últimos 90 días para mantener la lista rápida"
        >
          📅 {showAll ? 'Mostrando histórico completo' : 'Últimos 90 días'}
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No encontramos candidatos"
          description={applications.length === 0
            ? 'Cuando un candidato aplique a alguno de tus puestos, va a aparecer acá automáticamente.'
            : 'Ningún candidato coincide con los filtros activos. Cambiá source, estado o limpiá la búsqueda.'}
          hint={applications.length === 0 ? 'El link de aplicación se comparte como /apply/<tenant>/<puesto>' : undefined}
        />
      ) : (
        <>
          <BulkActionBar
            selectedIds={selectedIds}
            onClear={() => setSelectedIds([])}
            onDone={async () => { setSelectedIds([]); /* parent should refresh */ }}
          />
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.length > 0 && selectedIds.length === filtered.length}
                    onChange={(e) => setSelectedIds(e.target.checked ? filtered.map((a) => a.id) : [])}
                    title="Seleccionar todos los visibles"
                  />
                </th>
                <th>Candidato</th>
                <th>Email</th>
                <th>Puesto</th>
                <th>Source</th>
                <th>Estado</th>
                <th>Aplicó</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((app) => {
                const job = getJobById(app.job_id);
                const checked = selectedIds.includes(app.id);
                return (
                  <tr key={app.id} style={checked ? { background: '#f0fdf4' } : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedIds((curr) => [...curr, app.id]);
                          else setSelectedIds((curr) => curr.filter((id) => id !== app.id));
                        }}
                      />
                    </td>
                    <td>
                      <Link to={`/candidates/${app.id}`} className="link">{app.candidate_name}</Link>
                    </td>
                    <td className="muted">{app.candidate_email}</td>
                    <td>
                      {job ? <Link to={`/jobs/${job.id}`} className="link">{job.title}</Link> : '—'}
                    </td>
                    <td className="muted">{SOURCE_LABELS[app.source]}</td>
                    <td>{STATE_LABELS[app.state]}</td>
                    <td className="muted">{app.applied_at}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function BulkActionBar({
  selectedIds,
  onClear,
  onDone,
}: {
  selectedIds: string[];
  onClear: () => void;
  onDone: () => Promise<void>;
}) {
  const api = useApi();
  const [acting, setActing] = useState(false);
  const [tagInputOpen, setTagInputOpen] = useState(false);
  const [tagValue, setTagValue] = useState('');

  if (selectedIds.length === 0) return null;

  async function bulkReject() {
    if (!window.confirm(`¿Rechazar ${selectedIds.length} candidatos seleccionados?`)) return;
    const reason = window.prompt('Razón del rechazo (se loggea + se le envía al candidato como contexto)', 'No avanzaron en este proceso');
    if (reason == null) return;
    setActing(true);
    try {
      const res = await api.applications.bulkTransition(selectedIds, 'rejected_by_admin', reason);
      alert(`✓ ${res.summary.succeeded}/${res.summary.total} candidatos rechazados${res.summary.failed > 0 ? ` (${res.summary.failed} fallaron — ver consola para detalles)` : ''}`);
      if (res.summary.failed > 0) console.warn('Bulk transition failures:', res.results.filter((r) => !r.success));
      await onDone();
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    } finally {
      setActing(false);
    }
  }

  async function bulkTag() {
    if (!tagValue.trim()) return;
    setActing(true);
    try {
      const res = await api.candidates.bulkTag(selectedIds, tagValue.trim());
      alert(`✓ ${res.tagged} tags agregados, ${res.already_had} ya tenían, ${res.failed} fallaron.`);
      setTagInputOpen(false);
      setTagValue('');
      await onDone();
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    } finally {
      setActing(false);
    }
  }

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 5, background: '#0e1218', color: '#fff',
      padding: '10px 16px', borderRadius: 8, marginBottom: 12,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      flexWrap: 'wrap', gap: 8,
    }}>
      <div>
        <strong>{selectedIds.length}</strong> {selectedIds.length === 1 ? 'seleccionado' : 'seleccionados'}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {tagInputOpen ? (
          <>
            <input
              autoFocus
              value={tagValue}
              onChange={(e) => setTagValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') bulkTag(); if (e.key === 'Escape') setTagInputOpen(false); }}
              placeholder="ej. react, panama, remote"
              style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid #4b5563', background: '#1f2937', color: '#fff', fontSize: 13, width: 200 }}
            />
            <button
              style={{ background: '#dafd6f', color: '#1f2937', border: 0, padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              onClick={bulkTag}
              disabled={acting || !tagValue.trim()}
            >
              Aplicar tag
            </button>
            <button
              style={{ background: 'transparent', color: '#fff', border: 0, padding: '6px 8px', cursor: 'pointer', fontSize: 13 }}
              onClick={() => { setTagInputOpen(false); setTagValue(''); }}
            >
              ✕
            </button>
          </>
        ) : (
          <>
            <button
              style={{ background: '#dafd6f', color: '#1f2937', border: 0, padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              onClick={() => setTagInputOpen(true)}
              disabled={acting}
            >
              🏷️ Tag seleccionados
            </button>
            <button
              style={{ background: '#dc2626', color: '#fff', border: 0, padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
              onClick={bulkReject}
              disabled={acting}
            >
              {acting ? 'Procesando…' : '✕ Rechazar seleccionados'}
            </button>
            <button
              style={{ background: 'transparent', color: '#fff', border: '1px solid #fff', padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
              onClick={onClear}
              disabled={acting}
            >
              Cancelar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
