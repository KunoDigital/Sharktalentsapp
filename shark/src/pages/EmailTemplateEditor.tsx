import { useEffect, useState } from 'react';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';
import './pages.css';

const log = logger('EMAIL_EDITOR');

type ListItem = {
  key: string;
  locale: string;
  default_subject: string;
  has_tenant_override: boolean;
  has_global_override: boolean;
  tenant_override_updated_at: string | null;
  tenant_override_updated_by: string | null;
};

type FullTemplate = {
  key: string;
  locale: string;
  default: { subject: string; body_html: string; body_text: string };
  effective: { subject: string; body_html: string; body_text: string };
  is_overridden: boolean;
};

export default function EmailTemplateEditor() {
  const api = useApi();
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<FullTemplate | null>(null);
  const [draft, setDraft] = useState<{ subject: string; body_html: string; body_text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'overridden'>('all');

  async function loadList() {
    setLoading(true);
    try {
      const res = await api.emailTemplates.list();
      setItems(res.items);
    } catch (err) {
      log.warn('list failed', { error: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadList(); }, []);

  async function openTemplate(key: string, locale: string) {
    try {
      const res = await api.emailTemplates.get(key, locale);
      setSelected(res);
      setDraft({
        subject: res.effective.subject,
        body_html: res.effective.body_html,
        body_text: res.effective.body_text,
      });
    } catch (err) {
      alert(`Error cargando template: ${(err as Error).message}`);
    }
  }

  async function handleSave() {
    if (!selected || !draft) return;
    setSaving(true);
    try {
      const body: { subject?: string; body_html?: string; body_text?: string } = {};
      // Solo mandar lo que cambió respecto al default
      if (draft.subject !== selected.default.subject) body.subject = draft.subject;
      if (draft.body_html !== selected.default.body_html) body.body_html = draft.body_html;
      if (draft.body_text !== selected.default.body_text) body.body_text = draft.body_text;
      if (Object.keys(body).length === 0) {
        alert('No hay cambios respecto al default. Usá "Restaurar default" si querés eliminar el override actual.');
        return;
      }
      await api.emailTemplates.save(selected.key, selected.locale, body);
      alert('✓ Guardado');
      setSelected(null);
      setDraft(null);
      await loadList();
    } catch (err) {
      alert(`Error guardando: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!selected) return;
    if (!window.confirm('¿Eliminar el override y volver al default del código? Esto NO se puede deshacer.')) return;
    setSaving(true);
    try {
      await api.emailTemplates.reset(selected.key, selected.locale);
      alert('✓ Override eliminado, vuelve al default');
      setSelected(null);
      setDraft(null);
      await loadList();
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const filtered = filter === 'overridden' ? items.filter((i) => i.has_tenant_override || i.has_global_override) : items;

  if (loading) return <div className="page"><p>Cargando…</p></div>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Templates de email</h1>
          <p className="page-subtitle">Editá los emails sin redeploy. Los cambios afectan a tu tenant únicamente.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`btn-toolbar ${filter === 'all' ? 'btn-toolbar-active' : ''}`} onClick={() => setFilter('all')}>Todos</button>
          <button className={`btn-toolbar ${filter === 'overridden' ? 'btn-toolbar-active' : ''}`} onClick={() => setFilter('overridden')}>Modificados</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 2fr' : '1fr', gap: 16, marginTop: 24 }}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, background: '#fff', maxHeight: 600, overflowY: 'auto' }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {filtered.map((item) => (
              <li
                key={`${item.key}:${item.locale}`}
                onClick={() => openTemplate(item.key, item.locale)}
                style={{
                  padding: 10, borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
                  background: selected?.key === item.key && selected?.locale === item.locale ? '#f0fdf4' : 'transparent',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {item.key} <span style={{ color: '#9ca3af', fontSize: 11 }}>({item.locale})</span>
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{item.default_subject}</div>
                {item.has_tenant_override && (
                  <span style={{ display: 'inline-block', marginTop: 4, padding: '1px 8px', background: '#dafd6f', color: '#1f2937', borderRadius: 99, fontSize: 10, fontWeight: 600 }}>
                    ✎ Modificado
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        {selected && draft && (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{selected.key}</h3>
                <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>Idioma: {selected.locale}{selected.is_overridden ? ' · Modificado' : ' · Default'}</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {selected.is_overridden && (
                  <button className="btn-toolbar" onClick={handleReset} disabled={saving}>
                    ↺ Restaurar default
                  </button>
                )}
                <button className="btn-toolbar" onClick={handleSave} disabled={saving}>
                  {saving ? 'Guardando…' : '💾 Guardar'}
                </button>
                <button className="btn-toolbar" onClick={() => { setSelected(null); setDraft(null); }}>✕</button>
              </div>
            </div>

            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Subject</label>
            <input
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              style={{ width: '100%', padding: 8, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 14, marginBottom: 12 }}
            />

            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>HTML body</label>
            <textarea
              value={draft.body_html}
              onChange={(e) => setDraft({ ...draft, body_html: e.target.value })}
              style={{ width: '100%', padding: 8, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, fontFamily: 'ui-monospace, monospace', minHeight: 240, marginBottom: 12 }}
            />

            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Text body (fallback para clientes sin HTML)</label>
            <textarea
              value={draft.body_text}
              onChange={(e) => setDraft({ ...draft, body_text: e.target.value })}
              style={{ width: '100%', padding: 8, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, fontFamily: 'ui-monospace, monospace', minHeight: 120 }}
            />

            <p style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>
              Las variables como <code style={{ background: '#f3f4f6', padding: '1px 4px' }}>{'{{candidate_name}}'}</code> se reemplazan al enviar.
              No los borres si querés que el email tenga sentido.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
