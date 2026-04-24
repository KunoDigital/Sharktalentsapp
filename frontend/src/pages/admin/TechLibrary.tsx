import { useEffect, useState } from 'react';
import { getLibrary, createLibraryItem, deleteLibraryItem } from '../../services/api';
import type { CSSProperties } from 'react';

interface LibraryItem {
  id: number;
  name: string;
  company: string | null;
  prompt: string;
  origin: string;
  created_at: string;
}

export default function TechLibrary() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', company: '', prompt: '' });
  const [saving, setSaving] = useState(false);

  const refresh = () => getLibrary().then(d => { setItems(d); setLoading(false); });
  useEffect(() => { refresh(); }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await createLibraryItem({ name: form.name, company: form.company || undefined, prompt: form.prompt });
    setForm({ name: '', company: '', prompt: '' });
    setShowForm(false);
    setSaving(false);
    refresh();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar esta prueba de la biblioteca?')) return;
    await deleteLibraryItem(id);
    refresh();
  };

  return (
    <div>
      <div style={headerRow}>
        <h1 style={titleStyle}>Biblioteca de pruebas técnicas</h1>
        <button onClick={() => setShowForm(!showForm)} style={btnPrimary}>
          {showForm ? 'Cancelar' : '+ Guardar prueba'}
        </button>
      </div>

      {showForm && (
        <div style={formCard}>
          <form onSubmit={handleSave} style={formStyle}>
            <div style={formGrid}>
              <div>
                <label style={labelStyle}>Nombre de la prueba</label>
                <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Ej: Full Stack React + Node" required style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Empresa (opcional)</label>
                <input type="text" value={form.company} onChange={e => setForm(p => ({ ...p, company: e.target.value }))} placeholder="Ej: Kuno Digital" style={inputStyle} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Prompt técnico</label>
              <textarea value={form.prompt} onChange={e => setForm(p => ({ ...p, prompt: e.target.value }))} placeholder="Describe las tecnologías y habilidades..." rows={4} required style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
            <button type="submit" disabled={saving} style={{ ...btnPrimary, alignSelf: 'flex-start' }}>
              {saving ? 'Guardando...' : 'Guardar en biblioteca'}
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--kuno-text-muted)' }}>Cargando...</p>
      ) : items.length === 0 ? (
        <div style={emptyState}>
          <p style={{ color: 'var(--kuno-text-muted)', fontSize: 15 }}>No hay pruebas guardadas en la biblioteca.</p>
        </div>
      ) : (
        <div style={grid}>
          {items.map(item => (
            <div key={item.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--kuno-cream)', marginBottom: 4 }}>{item.name}</h3>
                  {item.company && <p style={{ fontSize: 13, color: 'var(--kuno-text-muted)' }}>{item.company}</p>}
                </div>
                <button onClick={() => handleDelete(item.id)} style={btnDeleteStyle}>✕</button>
              </div>
              <p style={{ fontSize: 13, color: 'var(--kuno-text-muted)', marginTop: 8, lineHeight: 1.5, overflow: 'hidden', maxHeight: 60 }}>
                {item.prompt}
              </p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                <span style={item.origin === 'ai' ? originAi : originManual}>
                  {item.origin === 'ai' ? 'Generada por IA' : 'Manual'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--kuno-text-muted)' }}>
                  {new Date(item.created_at + 'Z').toLocaleDateString('es-MX')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const headerRow: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 };
const titleStyle: CSSProperties = { fontSize: 24, fontWeight: 700, color: 'var(--kuno-cream)' };
const btnPrimary: CSSProperties = { background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontWeight: 600, fontSize: 14, padding: '10px 20px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer' };
const formCard: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 24, marginBottom: 24 };
const formStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16 };
const formGrid: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 };
const labelStyle: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--kuno-text-muted)', marginBottom: 6 };
const inputStyle: CSSProperties = { width: '100%', padding: '10px 14px', background: 'var(--kuno-dark-2)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', color: 'var(--kuno-cream)', fontSize: 14 };
const emptyState: CSSProperties = { textAlign: 'center', padding: '60px 0' };
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 };
const card: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 20 };
const btnDeleteStyle: CSSProperties = { background: 'transparent', border: 'none', color: 'var(--kuno-text-muted)', fontSize: 16, cursor: 'pointer', padding: 4 };
const originAi: CSSProperties = { background: 'rgba(218,253,111,0.15)', color: 'var(--kuno-lime)', fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 10 };
const originManual: CSSProperties = { background: 'var(--kuno-dark-2)', color: 'var(--kuno-text-muted)', fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 10, border: '1px solid var(--kuno-border)' };
