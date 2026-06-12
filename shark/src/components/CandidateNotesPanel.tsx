import { useEffect, useState, type FormEvent } from 'react';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';

const log = logger('NOTES_PANEL');

type Note = {
  ROWID: string;
  author_id: string;
  author_name: string | null;
  body: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('es-419', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function CandidateNotesPanel({ applicationId, currentUserId }: { applicationId: string; currentUserId?: string }) {
  const api = useApi();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableNotReady, setTableNotReady] = useState(false);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await api.applications.listNotes(applicationId);
      setNotes(res.notes);
      if (res.table_not_ready) setTableNotReady(true);
    } catch (err) {
      log.warn('notes load failed', { error: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [applicationId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSaving(true);
    try {
      await api.applications.createNote(applicationId, body.trim());
      setBody('');
      await load();
    } catch (err) {
      alert(`Error guardando: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePin(note: Note) {
    try {
      await api.applications.updateNote(applicationId, note.ROWID, { is_pinned: !note.is_pinned });
      await load();
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    }
  }

  async function handleDelete(note: Note) {
    if (!window.confirm('¿Borrar esta nota? No se puede deshacer.')) return;
    try {
      await api.applications.deleteNote(applicationId, note.ROWID);
      await load();
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    }
  }

  async function handleSaveEdit(note: Note) {
    if (!editingBody.trim()) return;
    try {
      await api.applications.updateNote(applicationId, note.ROWID, { body: editingBody.trim() });
      setEditingId(null);
      await load();
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    }
  }

  if (tableNotReady) {
    return (
      <section style={{ margin: '1rem 0', padding: 16, border: '1px solid var(--st-border)', borderRadius: 8, background: 'var(--st-bg-elev)' }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 600 }}>📝 Notas</h3>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--st-fg-muted)' }}>
          Tabla CandidateNotes pendiente de crear en Catalyst. Cuando exista podrás dejar comentarios sobre este candidato.
        </p>
      </section>
    );
  }

  return (
    <section style={{ margin: '1rem 0', padding: 16, border: '1px solid var(--st-border)', borderRadius: 8, background: 'var(--st-bg-elev)' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600 }}>
        📝 Notas {notes.length > 0 && <span style={{ fontSize: 12, color: 'var(--st-fg-muted)', fontWeight: 400 }}>({notes.length})</span>}
      </h3>

      <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Agregá una nota sobre este candidato (Cmd+Enter para guardar)…"
          style={{ width: '100%', padding: 10, border: '1px solid var(--st-border-strong)', borderRadius: 4, fontSize: 14, minHeight: 60, resize: 'vertical' }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              handleSubmit(e as unknown as FormEvent);
            }
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button
            type="submit"
            disabled={saving || !body.trim()}
            style={{ padding: '6px 14px', background: '#dafd6f', border: 0, borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            {saving ? 'Guardando…' : 'Agregar nota'}
          </button>
        </div>
      </form>

      {loading ? (
        <p style={{ color: 'var(--st-fg-muted)', fontSize: 13 }}>Cargando…</p>
      ) : notes.length === 0 ? (
        <p style={{ color: 'var(--st-fg-muted)', fontSize: 13 }}>No hay notas todavía. Las que agregues quedan solo para tu equipo.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {notes.map((note) => {
            const isMine = currentUserId === note.author_id;
            const isEditing = editingId === note.ROWID;
            return (
              <li key={note.ROWID} style={{
                padding: 12, marginBottom: 8, borderRadius: 6,
                background: note.is_pinned ? '#fef9c3' : 'var(--st-bg-elev-2)',
                border: note.is_pinned ? '1px solid #fcd34d' : '1px solid transparent',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <div style={{ fontSize: 11, color: 'var(--st-fg-muted)' }}>
                    {note.is_pinned && '📌 '}
                    {note.author_name ?? note.author_id} · {fmt(note.created_at)}
                    {note.updated_at !== note.created_at && ' · editada'}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => handleTogglePin(note)}
                      style={{ background: 'transparent', border: 0, cursor: 'pointer', fontSize: 12, color: 'var(--st-fg-muted)' }}
                      title={note.is_pinned ? 'Desfijar' : 'Fijar arriba'}
                    >
                      {note.is_pinned ? '📌' : '📍'}
                    </button>
                    {isMine && !isEditing && (
                      <>
                        <button
                          onClick={() => { setEditingId(note.ROWID); setEditingBody(note.body); }}
                          style={{ background: 'transparent', border: 0, cursor: 'pointer', fontSize: 12, color: '#0284c7' }}
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleDelete(note)}
                          style={{ background: 'transparent', border: 0, cursor: 'pointer', fontSize: 12, color: '#dc2626' }}
                        >
                          Borrar
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {isEditing ? (
                  <div>
                    <textarea
                      value={editingBody}
                      onChange={(e) => setEditingBody(e.target.value)}
                      style={{ width: '100%', padding: 8, border: '1px solid var(--st-border-strong)', borderRadius: 4, fontSize: 13, minHeight: 60 }}
                    />
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, justifyContent: 'flex-end' }}>
                      <button onClick={() => setEditingId(null)} style={{ background: 'transparent', border: '1px solid var(--st-border-strong)', padding: '4px 10px', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>Cancelar</button>
                      <button onClick={() => handleSaveEdit(note)} style={{ background: '#dafd6f', border: 0, padding: '4px 10px', borderRadius: 4, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Guardar</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 14, color: 'var(--st-fg)', whiteSpace: 'pre-wrap' }}>{note.body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
