import { useEffect, useState } from 'react';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';

const log = logger('SAVED_SEARCHES');

type Scope = 'pool' | 'candidates' | 'jobs';

type SavedSearch = {
  ROWID: string;
  scope: string;
  name: string;
  filters: Record<string, unknown>;
};

/**
 * Barra de saved searches reutilizable. El parent pasa:
 *   - scope: 'pool' | 'candidates' | 'jobs'
 *   - currentFilters: objeto con los filtros actuales (lo guardamos)
 *   - onApply: callback para aplicar los filtros guardados
 */
export function SavedSearchesBar({
  scope,
  currentFilters,
  onApply,
}: {
  scope: Scope;
  currentFilters: Record<string, unknown>;
  onApply: (filters: Record<string, unknown>) => void;
}) {
  const api = useApi();
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [tableNotReady, setTableNotReady] = useState(false);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const res = await api.savedSearches.list(scope);
      if (res.table_not_ready) setTableNotReady(true);
      setSearches(res.searches as SavedSearch[]);
    } catch (err) {
      log.debug('searches load failed', { error: (err as Error).message });
    }
  }

  useEffect(() => { load(); }, [scope]);

  async function handleSave() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await api.savedSearches.create(newName.trim(), scope, currentFilters);
      setNewName('');
      setShowSaveInput(false);
      await load();
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(s: SavedSearch) {
    if (!window.confirm(`¿Eliminar la búsqueda guardada "${s.name}"?`)) return;
    try {
      await api.savedSearches.remove(s.ROWID);
      await load();
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    }
  }

  if (tableNotReady) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>BÚSQUEDAS GUARDADAS:</span>
      {searches.length === 0 ? (
        <span style={{ fontSize: 12, color: '#9ca3af' }}>Ninguna</span>
      ) : (
        searches.map((s) => (
          <span key={s.ROWID} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <button
              onClick={() => onApply(s.filters)}
              style={{
                padding: '3px 10px', borderRadius: 99,
                background: '#dbeafe', color: '#1e40af',
                border: 0, cursor: 'pointer', fontSize: 12, fontWeight: 500,
              }}
              title={`Aplicar filtros: ${JSON.stringify(s.filters).slice(0, 100)}`}
            >
              💾 {s.name}
            </button>
            <button
              onClick={() => handleDelete(s)}
              style={{ background: 'transparent', border: 0, cursor: 'pointer', color: '#9ca3af', fontSize: 12, padding: '0 4px' }}
              title="Eliminar"
            >
              ×
            </button>
          </span>
        ))
      )}
      {showSaveInput ? (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') { setShowSaveInput(false); setNewName(''); }
            }}
            placeholder="Nombre de la búsqueda"
            style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, width: 180 }}
          />
          <button
            onClick={handleSave}
            disabled={saving || !newName.trim()}
            style={{ padding: '4px 10px', background: '#dafd6f', color: '#1f2937', border: 0, borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
          >
            Guardar
          </button>
          <button
            onClick={() => { setShowSaveInput(false); setNewName(''); }}
            style={{ background: 'transparent', border: 0, cursor: 'pointer', color: '#6b7280', fontSize: 12, padding: '0 4px' }}
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowSaveInput(true)}
          style={{
            padding: '3px 10px', borderRadius: 99,
            background: 'transparent', color: '#6b7280',
            border: '1px dashed #d1d5db', cursor: 'pointer', fontSize: 12,
          }}
          title="Guardar los filtros actuales"
        >
          + Guardar actual
        </button>
      )}
    </div>
  );
}
