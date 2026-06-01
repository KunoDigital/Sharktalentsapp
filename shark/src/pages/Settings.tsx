import { useState, useCallback } from 'react';
import { MOCK_JOBS } from '../data/mockJobs';
import { generateDemoApplications, clearDemoApplications, getDemoCount, generatePreset, PRESET_LABELS, type DemoPreset } from '../lib/demoData';
import { getNotifPrefs, setNotifPrefs, ALL_TYPES, TYPE_LABELS, clearReadIds } from '../lib/notificationPrefs';
import { resetSetupChecklist } from '../components/SetupChecklist';
import { useApi, ApiError, ALL_API_PERMISSIONS, type ApiKey } from '../lib/api';
import { useEffect } from 'react';
import { config } from '../config';
import { logger } from '../lib/logger';
import { OrganizationProfile, useOrganization } from '@clerk/clerk-react';
import './pages.css';

const portalLog = logger('SETTINGS_PORTAL');

type Tab = 'integraciones' | 'notifications' | 'portales' | 'api_keys' | 'bot_config' | 'equipo' | 'branding' | 'leads' | 'costs' | 'operacional' | 'plan' | 'demo';

export default function Settings() {
  const [tab, setTab] = useState<Tab>('integraciones');

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="page-subtitle">Configuración del tenant.</p>

      <div className="phase-tabs">
        {(['integraciones', 'notifications', 'portales', 'api_keys', 'bot_config', 'equipo', 'branding', 'leads', 'costs', 'operacional', 'plan', 'demo'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`phase-tab${tab === t ? ' is-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'integraciones' ? 'Integraciones' :
             t === 'notifications' ? '🔔 Notificaciones' :
             t === 'portales' ? '🔗 Portales cliente' :
             t === 'api_keys' ? 'API keys' :
             t === 'bot_config' ? '🤖 Bot decisor' :
             t === 'equipo' ? 'Equipo' :
             t === 'branding' ? 'Branding' :
             t === 'leads' ? '📥 Leads' :
             t === 'costs' ? '💰 Costos IA' :
             t === 'operacional' ? '⚙️ Operacional' :
             t === 'plan' ? 'Plan & Billing' :
             '🎲 Demo data'}
          </button>
        ))}
      </div>

      {tab === 'integraciones' && <IntegracionesTab />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'portales' && <PortalesTab />}
      {tab === 'api_keys' && <ApiKeysTab />}
      {tab === 'bot_config' && <BotConfigTab />}
      {tab === 'equipo' && <EquipoTab />}
      {tab === 'branding' && <BrandingTab />}
      {tab === 'leads' && <LeadsTab />}
      {tab === 'costs' && <CostsTab />}
      {tab === 'operacional' && <OperacionalTab />}
      {tab === 'plan' && <PlanTab />}
      {tab === 'demo' && <DemoDataTab />}
    </div>
  );
}

function IntegracionesTab() {
  const api = useApi();
  const [integraciones, setIntegraciones] = useState<Array<{ key: string; name: string; desc: string; configured: boolean; required: boolean }>>([]);
  const [summary, setSummary] = useState<{ required_configured: number; required_total: number; optional_configured: number; optional_total: number; health: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config.useApi) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    api.integrations.status()
      .then((r) => {
        if (cancelled) return;
        setIntegraciones(r.integrations);
        setSummary(r.summary);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [api]);

  if (!config.useApi) {
    return (
      <p className="muted-note">
        Esta vista requiere backend conectado. Setear <code>VITE_USE_API=true</code>.
      </p>
    );
  }

  if (loading) return <p className="muted small">Cargando estado de integraciones...</p>;
  if (error) return <p className="muted small" style={{ color: 'var(--st-warn-fg)' }}>⚠️ {error}</p>;

  return (
    <div>
      {summary && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <strong>Requeridas: {summary.required_configured}/{summary.required_total}</strong>
            {' · '}
            <span className="muted">Opcionales: {summary.optional_configured}/{summary.optional_total}</span>
          </div>
          <span className={`status-tag ${summary.health === 'ok' ? 'status-active' : 'status-paused'}`}>
            {summary.health === 'ok' ? '✓ Setup completo (requeridas)' : '⚠️ Faltan requeridas'}
          </span>
        </div>
      )}

      <div className="settings-list">
        {integraciones.map((i) => (
          <div key={i.key} className="settings-item">
            <div>
              <div className="settings-item-title">
                {i.name}
                {i.required && <span style={{ marginLeft: '0.4rem', fontSize: '0.65rem', color: 'var(--st-warn-fg)', fontWeight: 700 }}>REQUERIDA</span>}
              </div>
              <div className="settings-item-desc">{i.desc}</div>
            </div>
            <div className="settings-item-actions">
              <span className={`status-tag ${i.configured ? 'status-active' : 'status-paused'}`}>
                {i.configured ? '✓ Configurada' : 'Sin configurar'}
              </span>
            </div>
          </div>
        ))}
      </div>

      <p className="muted-note">
        Las integraciones se configuran via env vars en Catalyst Console. Ver <code>docs/master-plan/ENV_VARS.md</code> para la lista completa de variables por integración.
      </p>
    </div>
  );
}

function ApiKeysTab() {
  const api = useApi();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableNotReady, setTableNotReady] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKeyForm, setNewKeyForm] = useState({ name: '', permissions: ['*'] as string[] });
  const [generated, setGenerated] = useState<{ plainKey: string; warning: string } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.apiKeys.list();
      setKeys(res.api_keys);
      setTableNotReady(false);
    } catch (err) {
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

  async function handleCreate() {
    if (!newKeyForm.name.trim()) {
      setError('Nombre obligatorio');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await api.apiKeys.create({
        name: newKeyForm.name.trim(),
        permissions: newKeyForm.permissions,
      });
      setGenerated({
        plainKey: res.api_key.plain_key,
        warning: res.warning,
      });
      setNewKeyForm({ name: '', permissions: ['*'] });
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message;
      setError(msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string, name: string) {
    if (!confirm(`¿Revocar la API key "${name}"? Esta acción es irreversible.`)) return;
    try {
      await api.apiKeys.revoke(id);
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message;
      setError(msg);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      alert('Copiado al portapapeles');
    } catch {
      alert('No se pudo copiar — seleccionalo manual');
    }
  }

  function togglePermission(p: string) {
    setNewKeyForm((curr) => {
      if (curr.permissions.includes(p)) {
        return { ...curr, permissions: curr.permissions.filter((x) => x !== p) };
      }
      return { ...curr, permissions: [...curr.permissions, p] };
    });
  }

  if (!config.useApi) {
    return (
      <div>
        <p className="muted">Modo demo — backend no activo. Activá VITE_USE_API y deployá el backend para ver tus API keys reales.</p>
      </div>
    );
  }

  if (loading) return <p className="muted">Cargando…</p>;

  if (tableNotReady) {
    return (
      <div>
        <div style={{ padding: '0.75rem 1rem', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '6px', color: '#f59e0b' }}>
          ⚠️ La tabla <code>ApiKeys</code> no fue creada todavía en Catalyst. Ver <code>docs/master-plan/MIGRATIONS_BLOCK2.md §5</code>.
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', color: '#fca5a5', marginBottom: '1rem' }}>
          ⚠️ {error}
        </div>
      )}

      {generated && (
        <div style={{ padding: '0.75rem 1rem', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '6px', marginBottom: '1rem' }}>
          <div className="settings-item-title" style={{ marginBottom: '0.3rem' }}>✓ API key creada</div>
          <p className="muted small" style={{ marginBottom: '0.5rem' }}>{generated.warning}</p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <code style={{ flex: 1, wordBreak: 'break-all', background: 'rgba(0,0,0,0.3)', padding: '0.4rem 0.6rem', borderRadius: '4px', fontSize: '0.78rem' }}>
              {generated.plainKey}
            </code>
            <button className="btn-toolbar" onClick={() => copyToClipboard(generated.plainKey)}>Copiar</button>
            <button className="cd-btn-ghost" onClick={() => setGenerated(null)}>Entendido</button>
          </div>
        </div>
      )}

      <div className="page-header-row">
        <p className="muted">API keys del tenant para integrar con tus herramientas (MCP, Zapier, etc.). El cliente API debe mandar header <code>Authorization: Bearer st_live_...</code>.</p>
      </div>

      <div className="settings-item" style={{ flexDirection: 'column', alignItems: 'stretch', marginBottom: '1.5rem' }}>
        <div className="settings-item-title" style={{ marginBottom: '0.5rem' }}>Crear nueva API key</div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={newKeyForm.name}
            onChange={(e) => setNewKeyForm((curr) => ({ ...curr, name: e.target.value }))}
            placeholder="Ej: MCP Server local, Zapier"
            className="filter-search"
            style={{ flex: '1 1 200px', minWidth: 0 }}
          />
          <div style={{ flex: '2 1 300px', display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
            {ALL_API_PERMISSIONS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => togglePermission(p)}
                className={newKeyForm.permissions.includes(p) ? 'btn-primary' : 'btn-toolbar'}
                style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}
              >
                {p}
              </button>
            ))}
          </div>
          <button className="btn-primary" onClick={handleCreate} disabled={creating}>
            {creating ? 'Generando…' : '+ Crear'}
          </button>
        </div>
      </div>

      {keys.length === 0 ? (
        <p className="muted">Todavía no tenés API keys.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Prefijo</th>
              <th>Permisos</th>
              <th>Creada</th>
              <th>Último uso</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.ROWID}>
                <td>{k.name}</td>
                <td><code>{k.key_prefix}…</code></td>
                <td className="muted small">{tryParsePerms(k.permissions).join(', ')}</td>
                <td className="muted">{k.created_at?.slice(0, 10)}</td>
                <td className="muted">{k.last_used_at?.slice(0, 10) ?? 'Nunca'}</td>
                <td>
                  <span className={`status-tag ${k.is_active && !k.revoked_at ? 'status-active' : 'status-paused'}`}>
                    {k.is_active && !k.revoked_at ? 'Activa' : 'Revocada'}
                  </span>
                </td>
                <td>
                  {k.is_active && !k.revoked_at && (
                    <button className="cd-btn-danger" style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }} onClick={() => handleRevoke(k.ROWID, k.name)}>
                      Revocar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted-note">
        Usá las API keys con el MCP server para que Claude Desktop se conecte directo a tu data, o con Zapier/Make/cualquier integración externa.
        Ver master plan §15 API pública y §16 MCP Server.
      </p>
    </div>
  );
}

function tryParsePerms(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function EquipoTab() {
  const { organization } = useOrganization();

  return (
    <div>
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Miembros del equipo de <strong>{organization?.name ?? 'tu organización'}</strong>. Gestionado por Clerk
        (auth provider). Invitaciones, roles y remoción se manejan en el panel de organización.
      </p>

      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '0.5rem' }}>
        <OrganizationProfile
          appearance={{
            elements: {
              rootBox: { width: '100%' },
              card: { boxShadow: 'none', background: 'transparent' },
            },
          }}
        />
      </div>

      <div className="settings-item" style={{ marginTop: '1.5rem' }}>
        <div>
          <div className="settings-item-title">Tour de bienvenida</div>
          <div className="settings-item-desc">
            Volver a ver el tour interactivo que te muestra las features principales.
          </div>
        </div>
        <div className="settings-item-actions">
          <button className="btn-toolbar" onClick={replayTour}>Volver a ver tour</button>
        </div>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-item-title">Checklist de setup</div>
          <div className="settings-item-desc">
            Volver a mostrar el checklist de bienvenida en el dashboard (crear puesto, conectar integraciones, invitar equipo).
          </div>
        </div>
        <div className="settings-item-actions">
          <button className="btn-toolbar" onClick={replayChecklist}>Volver a mostrar</button>
        </div>
      </div>
    </div>
  );
}

type BrandingForm = {
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  on_primary_color?: string;
  legal_name?: string;
  website_url?: string;
  contact_email?: string;
};

function BrandingTab() {
  const [form, setForm] = useState<BrandingForm>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${config.apiBase}/api/tenants/me/branding`, { credentials: 'include' })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setForm(data.branding ?? {});
        } else if (res.status === 401) {
          setError('No autenticado');
        } else {
          setError(`Error cargando branding (${res.status})`);
        }
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${config.apiBase}/api/tenants/me/branding`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setForm(data.branding ?? {});
      setSavedAt(Date.now());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof BrandingForm>(key: K, value: BrandingForm[K]) {
    setForm((curr) => ({ ...curr, [key]: value }));
  }

  if (loading) return <div className="muted">Cargando branding…</div>;

  return (
    <div className="settings-list" style={{ maxWidth: '600px' }}>
      <p className="muted small" style={{ marginBottom: '1rem' }}>
        El branding aparece en el portal del cliente, los reportes públicos y los emails que envías.
      </p>

      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>
          URL del logo (HTTPS)
        </label>
        <input
          type="url"
          placeholder="https://tu-dominio.com/logo.png"
          value={form.logo_url ?? ''}
          onChange={(e) => update('logo_url', e.target.value || undefined)}
          style={inputStyle}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>
            Color primario (hex)
          </label>
          <input
            type="text"
            placeholder="#2563eb"
            value={form.primary_color ?? ''}
            onChange={(e) => update('primary_color', e.target.value || undefined)}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>
            Color secundario (hex)
          </label>
          <input
            type="text"
            placeholder="#10b981"
            value={form.secondary_color ?? ''}
            onChange={(e) => update('secondary_color', e.target.value || undefined)}
            style={inputStyle}
          />
        </div>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>
          Color sobre primario (texto sobre botones)
        </label>
        <input
          type="text"
          placeholder="#ffffff"
          value={form.on_primary_color ?? ''}
          onChange={(e) => update('on_primary_color', e.target.value || undefined)}
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>
          Razón social (legal name)
        </label>
        <input
          type="text"
          placeholder="SharkTalents Inc."
          value={form.legal_name ?? ''}
          onChange={(e) => update('legal_name', e.target.value || undefined)}
          style={inputStyle}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>
            Sitio web (HTTPS)
          </label>
          <input
            type="url"
            placeholder="https://sharktalents.ai"
            value={form.website_url ?? ''}
            onChange={(e) => update('website_url', e.target.value || undefined)}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>
            Email de contacto público
          </label>
          <input
            type="email"
            placeholder="hola@sharktalents.ai"
            value={form.contact_email ?? ''}
            onChange={(e) => update('contact_email', e.target.value || undefined)}
            style={inputStyle}
          />
        </div>
      </div>

      {error && <p style={{ color: '#ef4444', fontSize: '0.875rem' }}>{error}</p>}
      {savedAt && Date.now() - savedAt < 3000 && <p style={{ color: '#10b981', fontSize: '0.875rem' }}>✓ Guardado</p>}

      <button
        type="button"
        className="btn-primary"
        onClick={save}
        disabled={saving}
      >
        {saving ? 'Guardando…' : 'Guardar branding'}
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  fontSize: '0.95rem',
};

function replayTour() {
  localStorage.removeItem('onboarding_completed');
  if (confirm('Tour reseteado. ¿Refrescar para ver?')) {
    window.location.href = '/';
  }
}

function replayChecklist() {
  resetSetupChecklist();
  if (confirm('Checklist reseteado. ¿Ir al dashboard?')) {
    window.location.href = '/';
  }
}

function NotificationsTab() {
  const [prefs, setPrefs] = useState(getNotifPrefs());

  function toggle(type: typeof ALL_TYPES[number]) {
    const next = { ...prefs, [type]: !prefs[type] };
    setPrefs(next);
    setNotifPrefs(next);
  }

  function clearRead() {
    clearReadIds();
    alert('Marcas de leído borradas. Refrescá para ver.');
  }

  return (
    <div className="settings-list">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Activá o silenciá tipos de notificación. Las que silencies no aparecen en el bell ni en el dashboard.
      </p>

      {ALL_TYPES.map((type) => (
        <div key={type} className="settings-item">
          <div>
            <div className="settings-item-title">{TYPE_LABELS[type]}</div>
            <div className="settings-item-desc">
              {type === 'drafts' ? 'Cuando la IA arma un draft post-reunión y necesita tu OK.' :
               type === 'bot_review' ? 'Cuando el bot decisor tiene confidence debajo del umbral.' :
               type === 'finalists' ? 'Cuando un candidato pasa todas las evaluaciones.' :
               type === 'inbox' ? 'Mensajes de candidatos vía LinkedIn / email outbound.' :
               'Cuando un cliente envía feedback en un reporte.'}
            </div>
          </div>
          <div className="settings-item-actions">
            <label className="notif-toggle">
              <input
                type="checkbox"
                checked={prefs[type]}
                onChange={() => toggle(type)}
              />
              <span className="notif-toggle-slider" />
            </label>
          </div>
        </div>
      ))}

      <div className="settings-item">
        <div>
          <div className="settings-item-title">Marcas de "leído"</div>
          <div className="settings-item-desc">
            Cuando hacés click en una notificación se marca como leída. Si querés volver a verlas todas como no leídas, podés limpiar el historial.
          </div>
        </div>
        <div className="settings-item-actions">
          <button className="cd-btn-ghost" onClick={clearRead}>
            Limpiar marcas
          </button>
        </div>
      </div>
    </div>
  );
}

function DemoDataTab() {
  const [count, setCount] = useState(30);
  const [generated, setGenerated] = useState(getDemoCount());

  function handleGenerate() {
    generateDemoApplications(count, MOCK_JOBS.map((j) => j.id));
    setGenerated(getDemoCount());
    if (confirm(`✓ Generados ${count} candidatos demo. ¿Refrescar la página para verlos?`)) {
      window.location.reload();
    }
  }

  function handlePreset(preset: DemoPreset) {
    generatePreset(preset, MOCK_JOBS.map((j) => j.id));
    setGenerated(getDemoCount());
    if (confirm(`✓ Preset cargado. ¿Refrescar la página?`)) {
      window.location.reload();
    }
  }

  function handleClear() {
    if (!confirm('¿Borrar todos los candidatos demo?')) return;
    clearDemoApplications();
    setGenerated(0);
    if (confirm('✓ Borrados. ¿Refrescar la página?')) {
      window.location.reload();
    }
  }

  return (
    <div className="settings-list">
      <div className="settings-item">
        <div>
          <div className="settings-item-title">Candidatos demo actuales</div>
          <div className="settings-item-desc">
            {generated === 0
              ? 'No hay candidatos demo generados — solo ves los 8 hardcoded del mock.'
              : `${generated} candidatos demo activos en localStorage.`}
          </div>
        </div>
        <div className="settings-item-actions">
          <button className="cd-btn-danger" onClick={handleClear} disabled={generated === 0}>
            Borrar demo
          </button>
        </div>
      </div>

      <h3 style={{ margin: '1.5rem 0 0.5rem', fontSize: '0.9rem', color: 'var(--st-fg-strong)' }}>
        Presets recomendados
      </h3>
      <p className="muted small" style={{ marginBottom: '0.5rem' }}>
        Click en un preset para cargar una distribución calibrada (estados balanceados, timelines coherentes, bot decisions realistas).
      </p>

      {(['showcase', 'small', 'medium', 'large'] as DemoPreset[]).map((preset) => (
        <div key={preset} className="settings-item">
          <div>
            <div className="settings-item-title">{PRESET_LABELS[preset].title}</div>
            <div className="settings-item-desc">{PRESET_LABELS[preset].desc}</div>
          </div>
          <div className="settings-item-actions">
            <button className={preset === 'showcase' ? 'btn-primary' : 'btn-toolbar'} onClick={() => handlePreset(preset)}>
              Cargar
            </button>
          </div>
        </div>
      ))}

      <h3 style={{ margin: '1.5rem 0 0.5rem', fontSize: '0.9rem', color: 'var(--st-fg-strong)' }}>
        Cantidad custom
      </h3>
      <div className="settings-item">
        <div>
          <div className="settings-item-title">Generar N candidatos random</div>
          <div className="settings-item-desc">
            Si querés un número específico fuera de los presets.
          </div>
        </div>
        <div className="settings-item-actions" style={{ alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="number"
            min={5}
            max={200}
            value={count}
            onChange={(e) => setCount(Math.max(5, Math.min(200, Number(e.target.value))))}
            className="filter-search"
            style={{ minWidth: 'auto', width: '90px' }}
          />
          <button className="btn-toolbar" onClick={handleGenerate}>
            Generar
          </button>
        </div>
      </div>

      <p className="muted-note">
        💡 Demo data persiste en <code>localStorage</code>. Cambiar de browser o limpiar cookies elimina la data.
        Los cambios de drag&drop también persisten ahí (clave separada <code>app_phase_overrides</code>).
      </p>
    </div>
  );
}

function BotConfigTab() {
  const api = useApi();
  const [tenantCfg, setTenantCfg] = useState<{ bot_threshold: number; bot_mode: 'cold' | 'warm' | 'hot'; tecnica_default_min: number; auto_purge_videos_days: number } | null>(null);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableNotReady, setTableNotReady] = useState(false);
  const [success, setSuccess] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.tenantConfig.get();
      setTenantCfg(res.config);
      setSources(res.sources);
      setTableNotReady(!res.table_exists);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (config.useApi) load();
    else setLoading(false);
  }, []);

  async function save() {
    if (!tenantCfg) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await api.tenantConfig.patch({
        bot_threshold: tenantCfg.bot_threshold,
        bot_mode: tenantCfg.bot_mode,
        tecnica_default_min: tenantCfg.tecnica_default_min,
        auto_purge_videos_days: tenantCfg.auto_purge_videos_days,
      });
      setSuccess(true);
      await load();
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message;
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  if (!tenantCfg) {
    return <p className="muted">Modo demo — backend no disponible.</p>;
  }
  if (loading) return <p className="muted">Cargando…</p>;

  return (
    <div className="settings-list">
      {tableNotReady && (
        <div style={{ padding: '0.75rem 1rem', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '6px', color: '#f59e0b', marginBottom: '1rem' }}>
          ⚠️ La tabla <code>Config</code> no fue creada todavía (Block 2 §9). Mientras tanto, los valores vienen del .env y NO se persisten cambios. Crear la tabla para activar configuración runtime.
        </div>
      )}

      <p className="muted" style={{ marginBottom: '1rem' }}>
        Ajustes runtime del bot decisor y otros umbrales del tenant. Se persisten sin necesidad de re-deploy.
      </p>

      <div className="settings-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div className="settings-item-title" style={{ marginBottom: '0.5rem' }}>Modo del bot decisor</div>
        <div className="settings-item-desc" style={{ marginBottom: '0.5rem' }}>
          <strong>cold:</strong> solo recomienda, todo va a tu cola para que decidas.<br />
          <strong>warm:</strong> aplica auto si la confianza ≥ umbral Y vos pediste auto-apply.<br />
          <strong>hot:</strong> aplica auto siempre que pase el umbral. Para cuando ya entrenaste el bot con suficientes overrides.
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(['cold', 'warm', 'hot'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setTenantCfg({ ...tenantCfg, bot_mode: mode })}
              className={tenantCfg.bot_mode === mode ? 'btn-primary' : 'btn-toolbar'}
            >
              {mode}
            </button>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: '0.3rem' }}>Fuente actual: {sources.bot_mode ?? 'unknown'}</p>
      </div>

      <div className="settings-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div className="settings-item-title" style={{ marginBottom: '0.3rem' }}>
          Umbral de confianza del bot: {(tenantCfg.bot_threshold * 100).toFixed(0)}%
        </div>
        <div className="settings-item-desc" style={{ marginBottom: '0.5rem' }}>
          Si la confianza del bot está por encima de este umbral, aplica auto (en warm/hot). Si está debajo, va a la cola para revisión humana.
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={tenantCfg.bot_threshold}
          onChange={(e) => setTenantCfg({ ...tenantCfg, bot_threshold: Number(e.target.value) })}
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--st-fg-muted)' }}>
          <span>0% (todo a cola)</span>
          <span>50%</span>
          <span>100% (nada a cola)</span>
        </div>
        <p className="muted small">Recomendado: 75% en cold, 85% en warm, 70% en hot. Fuente: {sources.bot_threshold ?? 'unknown'}</p>
      </div>

      <div className="settings-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div className="settings-item-title">Mínimo técnica % default</div>
        <div className="settings-item-desc" style={{ marginBottom: '0.3rem' }}>
          Si el puesto no setea su propio mínimo, se usa este valor (0-100).
        </div>
        <input
          type="number"
          min={0}
          max={100}
          value={tenantCfg.tecnica_default_min}
          onChange={(e) => setTenantCfg({ ...tenantCfg, tecnica_default_min: Number(e.target.value) })}
          className="filter-search"
          style={{ minWidth: 'auto', width: '120px' }}
        />
      </div>

      <div className="settings-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div className="settings-item-title">Días de retención de videos</div>
        <div className="settings-item-desc" style={{ marginBottom: '0.3rem' }}>
          Cuántos días se guardan los videos físicos después de que el puesto cierre. Default 30 (GDPR/Ley PA).
        </div>
        <input
          type="number"
          min={1}
          max={365}
          value={tenantCfg.auto_purge_videos_days}
          onChange={(e) => setTenantCfg({ ...tenantCfg, auto_purge_videos_days: Number(e.target.value) })}
          className="filter-search"
          style={{ minWidth: 'auto', width: '120px' }}
        />
      </div>

      {error && (
        <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', color: '#fca5a5' }}>
          ⚠️ {error}
        </div>
      )}
      {success && (
        <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '6px', color: '#86efac' }}>
          ✓ Guardado
        </div>
      )}

      <button className="btn-primary" onClick={save} disabled={saving || tableNotReady}>
        {saving ? 'Guardando…' : 'Guardar cambios'}
      </button>
    </div>
  );
}

function PortalesTab() {
  const api = useApi();
  const [company, setCompany] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [ttlDays, setTtlDays] = useState(90);
  const [generated, setGenerated] = useState<{ url: string; expires_in_days: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const portalBaseUrl = `${window.location.origin}${window.location.pathname}#`;

  async function handleGenerate() {
    setError(null);
    setGenerated(null);
    if (!company.trim() || !clientName.trim() || !clientEmail.trim() || !clientEmail.includes('@')) {
      setError('Empresa, nombre y email del cliente son obligatorios.');
      return;
    }
    if (!config.useApi) {
      setError('Modo mock: el backend no está activo. Activá USE_API en el .env y deployá el backend.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.portals.issue({
        company: company.trim(),
        client_name: clientName.trim(),
        client_email: clientEmail.trim(),
        ttl_days: ttlDays,
      });
      setGenerated({
        url: `${portalBaseUrl}${res.path}`,
        expires_in_days: res.expires_in_days,
      });
    } catch (err) {
      portalLog.warn('issue portal failed', { error: (err as Error).message });
      const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message;
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      alert('Copiado al portapapeles');
    } catch {
      alert('No se pudo copiar. Seleccioná el texto manualmente.');
    }
  }

  return (
    <div className="settings-list">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Generá un link único para que un cliente externo (la empresa que contrata) vea SUS puestos abiertos y el avance del funnel.
        El link es firmado y vence después del TTL que elijas.
      </p>

      <div className="settings-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div>
            <div className="settings-item-title" style={{ marginBottom: '0.3rem' }}>Empresa cliente</div>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Ej: Banco Pacífico"
              className="filter-search"
              style={{ width: '100%', minWidth: 0 }}
            />
            <p className="muted small" style={{ marginTop: '0.3rem' }}>
              Debe coincidir <em>exactamente</em> con el campo "company" de los puestos en la BD.
            </p>
          </div>
          <div>
            <div className="settings-item-title" style={{ marginBottom: '0.3rem' }}>Persona de contacto</div>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Ej: Carolina Aguilar"
              className="filter-search"
              style={{ width: '100%', minWidth: 0 }}
            />
          </div>
          <div>
            <div className="settings-item-title" style={{ marginBottom: '0.3rem' }}>Email del contacto</div>
            <input
              type="email"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              placeholder="caguilar@bancopacifico.com"
              className="filter-search"
              style={{ width: '100%', minWidth: 0 }}
            />
          </div>
          <div>
            <div className="settings-item-title" style={{ marginBottom: '0.3rem' }}>Vigencia (días)</div>
            <input
              type="number"
              min={1}
              max={365}
              value={ttlDays}
              onChange={(e) => setTtlDays(Math.max(1, Math.min(365, Number(e.target.value))))}
              className="filter-search"
              style={{ width: '100%', minWidth: 0 }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn-primary"
            onClick={handleGenerate}
            disabled={submitting}
          >
            {submitting ? 'Generando…' : 'Generar link del portal'}
          </button>
        </div>

        {error && (
          <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.8rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', color: '#fca5a5', fontSize: '0.85rem' }}>
            ⚠️ {error}
          </div>
        )}

        {generated && (
          <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '6px' }}>
            <div className="settings-item-title" style={{ marginBottom: '0.3rem' }}>
              ✓ Link generado · vence en {generated.expires_in_days} días
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <code style={{ flex: 1, wordBreak: 'break-all', background: 'rgba(0,0,0,0.3)', padding: '0.4rem 0.6rem', borderRadius: '4px', fontSize: '0.78rem' }}>
                {generated.url}
              </code>
              <button className="btn-toolbar" onClick={() => copyToClipboard(generated.url)}>
                Copiar
              </button>
            </div>
            <p className="muted small" style={{ marginTop: '0.5rem' }}>
              💡 Mandalo al cliente por email/WhatsApp. Cuando lo abra ve sus puestos y el funnel en tiempo real.
            </p>
          </div>
        )}
      </div>

      <p className="muted-note">
        ⚠️ Hoy revocar un link puntual implica rotar <code>URL_SIGNING_SECRET</code> (afecta TODOS los tokens).
        Cuando se cree la tabla <code>ClientPortals</code> (Block 2), habrá revocación granular.
      </p>
    </div>
  );
}

function PlanTab() {
  return (
    <div className="settings-list">
      <div className="settings-item">
        <div>
          <div className="settings-item-title">Plan actual: Free</div>
          <div className="settings-item-desc">5 puestos activos · 50 candidatos/mes · MCP server: incluido</div>
        </div>
        <button className="btn-primary">Upgrade a Pro</button>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-item-title">Uso de Anthropic Claude (este mes)</div>
          <div className="settings-item-desc">12,450 tokens input · 4,890 tokens output · ~$0.42 USD</div>
        </div>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-item-title">Uso de Whisper (este mes)</div>
          <div className="settings-item-desc">3 transcripciones · 84 minutos · ~$0.50 USD</div>
        </div>
      </div>
    </div>
  );
}

// LeadsTab + CostsTab agregados al final

type MarketingLead = {
  ROWID: string;
  email: string;
  contact_name: string | null;
  company: string | null;
  whatsapp: string | null;
  score_quality: number | null;
  urgency: string | null;
  salary_target: number | null;
  status: string | null;
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  eval_result_id: string | null;
  created_at: string;
  updated_at: string | null;
};

type LeadsResponse = {
  leads: MarketingLead[];
  count: number;
  stats?: { total: number; new: number; eval_requested: number; eval_completed: number; call_booked: number; won: number; lost: number };
  table_ready: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  new: '🆕 Nuevo',
  eval_requested: '⏳ Eval pedida',
  eval_completed: '✅ Eval completa',
  call_booked: '📞 Call agendada',
  won: '🏆 Cerrado',
  lost: '❌ Perdido',
};
const URGENCY_LABELS: Record<string, string> = {
  less_30d: '🔥 <30 días',
  '1-3m': '⏰ 1-3 meses',
  '3m+': '🐢 3+ meses',
  exploring: '👀 Explorando',
};

function LeadsTab() {
  const api = useApi();
  const [data, setData] = useState<LeadsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterUrgency, setFilterUrgency] = useState<string>('');
  const [minScore, setMinScore] = useState<string>('');
  const [searchEmail, setSearchEmail] = useState<string>('');
  const [selectedLead, setSelectedLead] = useState<MarketingLead | null>(null);
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);

  const load = useCallback(() => {
    if (!config.useApi) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus) params.set('status', filterStatus);
    if (filterUrgency) params.set('urgency', filterUrgency);
    if (minScore) params.set('min_score', minScore);
    const qs = params.toString();
    fetch(`${config.apiBase}/api/marketing/leads${qs ? `?${qs}` : ''}`, { credentials: 'include' })
      .then(async (res) => {
        if (res.status === 503) {
          setError('Tabla MarketingLeads no creada en Catalyst todavía.');
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as LeadsResponse;
        setData(json);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filterStatus, filterUrgency, minScore]);

  useEffect(() => { load(); }, [load]);

  if (!config.useApi) {
    return <p className="muted-note">Esta vista requiere backend conectado.</p>;
  }
  if (loading && !data) return <p className="muted small">Cargando leads…</p>;
  if (error) return <p className="muted small" style={{ color: 'var(--st-warn-fg)' }}>⚠️ {error}</p>;
  if (!data) return null;

  const stats = data.stats;
  const filteredBySearch = searchEmail
    ? data.leads.filter((l) => l.email.toLowerCase().includes(searchEmail.toLowerCase()))
    : data.leads;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ marginTop: 0 }}>📥 Marketing leads</h2>
          <p className="muted small">
            Leads del funnel capturados desde landing o cargados manualmente desde WhatsApp.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowNewLeadModal(true)}>
          + Nuevo lead manual
        </button>
      </div>

      {/* Stats cards */}
      {stats && (
        <div style={{ display: 'flex', gap: 12, marginTop: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Nuevos" value={stats.new} highlight={stats.new > 0} />
          <StatCard label="Eval pedida" value={stats.eval_requested} />
          <StatCard label="Eval completa" value={stats.eval_completed} />
          <StatCard label="Call agendada" value={stats.call_booked} />
          <StatCard label="Won" value={stats.won} />
          <StatCard label="Lost" value={stats.lost} />
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <label className="muted small">Status</label>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="form-input">
            <option value="">Todos</option>
            <option value="new">Nuevo</option>
            <option value="eval_requested">Eval pedida</option>
            <option value="eval_completed">Eval completa</option>
            <option value="call_booked">Call agendada</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>
        </div>
        <div>
          <label className="muted small">Urgencia</label>
          <select value={filterUrgency} onChange={(e) => setFilterUrgency(e.target.value)} className="form-input">
            <option value="">Todas</option>
            <option value="less_30d">&lt;30 días</option>
            <option value="1-3m">1-3 meses</option>
            <option value="3m+">3+ meses</option>
            <option value="exploring">Explorando</option>
          </select>
        </div>
        <div>
          <label className="muted small">Score mín (0-100)</label>
          <input type="number" value={minScore} onChange={(e) => setMinScore(e.target.value)} min="0" max="100"
            placeholder="ej: 60" className="form-input" style={{ width: 100 }} />
        </div>
        <div>
          <label className="muted small">Buscar por email</label>
          <input type="text" value={searchEmail} onChange={(e) => setSearchEmail(e.target.value)}
            placeholder="contiene…" className="form-input" />
        </div>
      </div>

      {filteredBySearch.length === 0 ? (
        <p className="muted">No hay leads con esos filtros.</p>
      ) : (
        <table className="settings-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
              <th style={cellStyle}>Email</th>
              <th style={cellStyle}>Nombre</th>
              <th style={cellStyle}>Empresa</th>
              <th style={cellStyle}>Score</th>
              <th style={cellStyle}>Urgencia</th>
              <th style={cellStyle}>Salary</th>
              <th style={cellStyle}>Status</th>
              <th style={cellStyle}>UTM</th>
              <th style={cellStyle}>Fecha</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {filteredBySearch.map((l) => (
              <tr key={l.ROWID} style={{ cursor: 'pointer' }} onClick={() => setSelectedLead(l)}>
                <td style={cellStyle}>{l.email}</td>
                <td style={cellStyle}>{l.contact_name ?? '—'}</td>
                <td style={cellStyle}>{l.company ?? '—'}</td>
                <td style={cellStyle}>
                  {l.score_quality != null ? (
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                      background: l.score_quality >= 70 ? 'rgba(34, 197, 94, 0.2)' : l.score_quality >= 40 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(239, 68, 68, 0.15)',
                      color: l.score_quality >= 70 ? '#22c55e' : l.score_quality >= 40 ? '#f59e0b' : '#ef4444',
                    }}>{l.score_quality}</span>
                  ) : '—'}
                </td>
                <td style={cellStyle}>{l.urgency ? (URGENCY_LABELS[l.urgency] ?? l.urgency) : '—'}</td>
                <td style={cellStyle}>{l.salary_target ? `$${l.salary_target}` : '—'}</td>
                <td style={cellStyle}>{l.status ? (STATUS_LABELS[l.status] ?? l.status) : '—'}</td>
                <td style={cellStyle} className="muted small">
                  {l.utm_source ? `${l.utm_source}${l.utm_medium ? '/' + l.utm_medium : ''}` : 'directo'}
                </td>
                <td style={cellStyle} className="muted small">{new Date(l.created_at).toLocaleDateString()}</td>
                <td style={cellStyle}>
                  <button className="btn-secondary" style={{ fontSize: 12 }} onClick={(e) => { e.stopPropagation(); setSelectedLead(l); }}>
                    Detalle
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          api={api}
          onActionComplete={() => { setSelectedLead(null); load(); }}
        />
      )}
      {showNewLeadModal && (
        <NewLeadModal
          api={api}
          onClose={() => setShowNewLeadModal(false)}
          onCreated={() => { setShowNewLeadModal(false); load(); }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div style={{
      padding: '8px 14px', borderRadius: 6,
      border: highlight ? '1px solid rgba(197, 252, 111, 0.4)' : '1px solid var(--border)',
      background: highlight ? 'rgba(197, 252, 111, 0.05)' : 'transparent',
      minWidth: 80,
    }}>
      <div className="muted small">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

type ApiClient = ReturnType<typeof useApi>;

function LeadDetailModal({
  lead, onClose, api, onActionComplete,
}: {
  lead: MarketingLead;
  onClose: () => void;
  api: ApiClient;
  onActionComplete: () => void;
}) {
  const [view, setView] = useState<'detail' | 'send_demo' | 'convert'>('detail');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // send_demo form state
  const [demoName, setDemoName] = useState('');
  const [demoEmail, setDemoEmail] = useState('');
  const [demoRole, setDemoRole] = useState('');
  const [demoConsent, setDemoConsent] = useState(false);

  async function handleSendDemo() {
    if (!demoName || !demoEmail || !demoRole) return setError('Completá nombre, email y cargo');
    if (!demoConsent) return setError('Necesitás confirmar que tenés consentimiento del colaborador');
    setBusy(true); setError(null);
    try {
      const result = await api.marketing.sendDemoFromAdmin(lead.ROWID, {
        member_to_evaluate: { full_name: demoName, email: demoEmail, role: demoRole, consent_obtained: true },
      });
      setInfo(`✓ ${result.message}. Link válido hasta ${new Date(result.test_expires_at).toLocaleDateString()}`);
      setTimeout(onActionComplete, 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConvert() {
    if (!window.confirm(`¿Convertir "${lead.email}" en cliente? Va a crear un Tenant en SharkTalents.`)) return;
    setBusy(true); setError(null);
    try {
      const result = await api.marketing.convertToTenant(lead.ROWID);
      setInfo(`✓ Tenant creado (ID: ${result.tenant_id}). Próximos pasos:\n${result.next_steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, maxWidth: 600, maxHeight: '80vh', overflow: 'auto', padding: 24, position: 'relative', minWidth: 500 }} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 12, background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20 }}>×</button>

        <h3 style={{ marginTop: 0 }}>{lead.email}</h3>
        <p className="muted small" style={{ marginTop: -8 }}>{lead.contact_name ?? '—'} · {lead.company ?? '—'}</p>

        {view === 'detail' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <button className="btn-primary" onClick={() => setView('send_demo')}>📧 Mandar demo gratis</button>
              <button className="btn-secondary" onClick={handleConvert} disabled={busy || lead.status === 'won'}>
                📝 Convertir a cliente
              </button>
            </div>

            <table style={{ width: '100%', fontSize: 14 }}>
              <tbody>
                <tr><td style={cellStyle}>WhatsApp</td><td style={cellStyle}>{lead.whatsapp ?? '—'}</td></tr>
                <tr><td style={cellStyle}>Score quality</td><td style={cellStyle}>{lead.score_quality ?? '—'}</td></tr>
                <tr><td style={cellStyle}>Urgencia</td><td style={cellStyle}>{lead.urgency ? URGENCY_LABELS[lead.urgency] ?? lead.urgency : '—'}</td></tr>
                <tr><td style={cellStyle}>Salary target</td><td style={cellStyle}>{lead.salary_target ? `$${lead.salary_target}/mes` : '—'}</td></tr>
                <tr><td style={cellStyle}>Status</td><td style={cellStyle}>{lead.status ? STATUS_LABELS[lead.status] ?? lead.status : '—'}</td></tr>
                <tr><td style={cellStyle}>Eval result ID</td><td style={cellStyle} className="muted small">{lead.eval_result_id ?? '—'}</td></tr>
                <tr><td style={cellStyle}>Source</td><td style={cellStyle}>{lead.source ?? '—'}</td></tr>
                <tr><td style={cellStyle}>UTM source</td><td style={cellStyle}>{lead.utm_source ?? '—'}</td></tr>
                <tr><td style={cellStyle}>UTM medium</td><td style={cellStyle}>{lead.utm_medium ?? '—'}</td></tr>
                <tr><td style={cellStyle}>UTM campaign</td><td style={cellStyle}>{lead.utm_campaign ?? '—'}</td></tr>
                <tr><td style={cellStyle}>Creado</td><td style={cellStyle}>{new Date(lead.created_at).toLocaleString()}</td></tr>
                {lead.updated_at && <tr><td style={cellStyle}>Actualizado</td><td style={cellStyle}>{new Date(lead.updated_at).toLocaleString()}</td></tr>}
                <tr><td style={cellStyle}>ROWID</td><td style={cellStyle} className="muted small">{lead.ROWID}</td></tr>
              </tbody>
            </table>
          </>
        )}

        {view === 'send_demo' && (
          <>
            <button className="btn-toolbar" onClick={() => { setView('detail'); setError(null); setInfo(null); }}>← Volver</button>
            <h4>Mandar demo gratis</h4>
            <p className="muted small">Le mandamos a un colaborador del cliente un test DISC + cognitivo + integridad. Después el lead recibe el reporte.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              <input className="form-input" placeholder="Nombre completo del colaborador" value={demoName} onChange={(e) => setDemoName(e.target.value)} />
              <input className="form-input" type="email" placeholder="Email del colaborador" value={demoEmail} onChange={(e) => setDemoEmail(e.target.value)} />
              <input className="form-input" placeholder="Cargo (ej: Gerente de Ventas)" value={demoRole} onChange={(e) => setDemoRole(e.target.value)} />
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, color: 'var(--muted)' }}>
                <input type="checkbox" checked={demoConsent} onChange={(e) => setDemoConsent(e.target.checked)} />
                <span>Confirmo que el colaborador sabe que va a recibir este email y dio consentimiento</span>
              </label>
              <button className="btn-primary" onClick={handleSendDemo} disabled={busy}>
                {busy ? 'Enviando…' : 'Enviar demo'}
              </button>
            </div>
          </>
        )}

        {error && <p style={{ color: 'var(--danger)', marginTop: 12 }}>⚠️ {error}</p>}
        {info && <pre style={{ color: 'var(--success, #22c55e)', marginTop: 12, whiteSpace: 'pre-wrap', fontSize: 13 }}>{info}</pre>}
      </div>
    </div>
  );
}

type LeadSource = 'manual_whatsapp' | 'meta_lead_ad' | 'landing_demo' | 'referido' | 'contacto_directo' | 'otros';

const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  manual_whatsapp: 'WhatsApp',
  meta_lead_ad: 'Meta Lead Ad',
  landing_demo: 'Landing demo',
  referido: 'Referido',
  contacto_directo: 'Contacto directo',
  otros: 'Otros',
};

function NewLeadModal({
  api, onClose, onCreated,
}: { api: ApiClient; onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [company, setCompany] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [source, setSource] = useState<LeadSource>('manual_whatsapp');
  const [urgency, setUrgency] = useState<'less_30d' | '1-3m' | '3m+' | 'exploring'>('exploring');
  const [salaryTarget, setSalaryTarget] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!email.includes('@')) return setError('Email inválido');
    setBusy(true); setError(null);
    try {
      await api.marketing.createManualLead({
        email: email.trim().toLowerCase(),
        contact_name: contactName.trim() || undefined,
        company: company.trim() || undefined,
        whatsapp: whatsapp.trim() || undefined,
        urgency,
        salary_target: salaryTarget ? Number(salaryTarget) : undefined,
        notes: notes.trim() || undefined,
        source,
      });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, maxWidth: 500, padding: 24, position: 'relative' }} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 12, background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20 }}>×</button>
        <h3 style={{ marginTop: 0 }}>+ Nuevo lead manual</h3>
        <p className="muted small">Para cuando el cliente entra por WhatsApp, Meta Lead Ad, referido, etc., y no pasó por la landing.</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
          <input className="form-input" type="email" placeholder="Email *" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="form-input" placeholder="Nombre del contacto" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          <input className="form-input" placeholder="Empresa" value={company} onChange={(e) => setCompany(e.target.value)} />
          <input className="form-input" placeholder="WhatsApp (ej +507 6000-0000)" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
          <label style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Origen del lead</label>
          <select className="form-input" value={source} onChange={(e) => setSource(e.target.value as LeadSource)}>
            {(Object.keys(LEAD_SOURCE_LABELS) as LeadSource[]).map((s) => (
              <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>
            ))}
          </select>
          <select className="form-input" value={urgency} onChange={(e) => setUrgency(e.target.value as typeof urgency)}>
            <option value="exploring">Urgencia: Explorando</option>
            <option value="3m+">3+ meses</option>
            <option value="1-3m">1-3 meses</option>
            <option value="less_30d">Menos de 30 días</option>
          </select>
          <input className="form-input" type="number" placeholder="Salario target del puesto (USD/mes)" value={salaryTarget} onChange={(e) => setSalaryTarget(e.target.value)} min="100" max="6000" />
          <textarea className="form-input" placeholder="Notas (opcional) — qué te dijo por WhatsApp / contexto" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          {error && <p style={{ color: 'var(--danger)', fontSize: 14 }}>⚠️ {error}</p>}
          <button className="btn-primary" onClick={submit} disabled={busy || !email}>
            {busy ? 'Creando…' : 'Crear lead'}
          </button>
        </div>
      </div>
    </div>
  );
}

type TokenUsageRow = {
  ROWID: string;
  feature: string;
  model: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  cost_usd_estimated: number;
  occurred_at: string;
};

function CostsTab() {
  const [rows, setRows] = useState<TokenUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config.useApi) {
      setLoading(false);
      return;
    }
    fetch(`${config.apiBase}/api/admin/token-usage?hours=168`, { credentials: 'include' })
      .then(async (res) => {
        if (res.status === 503) {
          setError('Tabla TokenUsage no creada en Catalyst todavía.');
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setRows(data.usage ?? []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (!config.useApi) {
    return <p className="muted-note">Esta vista requiere backend conectado.</p>;
  }
  if (loading) return <p className="muted small">Cargando uso de tokens...</p>;
  if (error) return <p className="muted small" style={{ color: 'var(--st-warn-fg)' }}>⚠️ {error}</p>;

  const total = rows.reduce((sum, r) => sum + (r.cost_usd_estimated ?? 0), 0);
  const byFeature: Record<string, { calls: number; cost: number }> = {};
  for (const r of rows) {
    const k = r.feature || 'unknown';
    if (!byFeature[k]) byFeature[k] = { calls: 0, cost: 0 };
    byFeature[k].calls++;
    byFeature[k].cost += r.cost_usd_estimated ?? 0;
  }
  const features = Object.entries(byFeature).sort((a, b) => b[1].cost - a[1].cost);

  return (
    <div>
      <div style={{ marginBottom: '1rem', padding: '1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '8px' }}>
        <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>${total.toFixed(4)} USD</div>
        <div className="muted small">Total estimado últimos 7 días · {rows.length} llamadas IA</div>
      </div>

      <h3 style={{ marginBottom: '0.5rem' }}>Por feature</h3>
      <table className="settings-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
            <th style={cellStyle}>Feature</th>
            <th style={cellStyle}>Llamadas</th>
            <th style={cellStyle}>Costo USD</th>
            <th style={cellStyle}>Avg/llamada</th>
          </tr>
        </thead>
        <tbody>
          {features.map(([f, stats]) => (
            <tr key={f}>
              <td style={cellStyle}>{f}</td>
              <td style={cellStyle}>{stats.calls}</td>
              <td style={cellStyle}>${stats.cost.toFixed(4)}</td>
              <td style={cellStyle}>${(stats.cost / stats.calls).toFixed(5)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="muted-note">
        Solo Claude Haiku 4.5 al momento. Si en algún feature gastás demasiado, revisar prompt caching
        o si está re-generando innecesariamente. <code>cached_input_tokens</code> alto = caching funciona.
      </p>
    </div>
  );
}

const cellStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid var(--border)',
  textAlign: 'left',
};

// ===== Operacional tab =====

function OperacionalTab() {
  const api = useApi();
  const [processing, setProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<{
    processed: number;
    results: Array<{ event_id: string; event_type: string; outcome: 'sent' | 'failed' | 'retried'; error?: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function trigger() {
    setProcessing(true);
    setError(null);
    try {
      const result = await api.outbox.processNow();
      setLastResult(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="settings-section">
      <h2>⚙️ Operacional</h2>
      <p className="muted">
        Acciones manuales que normalmente corre el cron, pero podés disparar a mano cuando necesités.
      </p>

      <section style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>📤 Procesar outbox (emails pending)</h3>
        <p className="muted small">
          Si configuraste el cron en Catalyst Console, esto corre automático cada 5 min. Mientras no esté el cron, click acá
          para mandar emails que hayan quedado pending (típico: client_portal_access, client_report_ready, recovery_link).
        </p>
        <button className="btn-primary" onClick={trigger} disabled={processing}>
          {processing ? 'Procesando…' : 'Procesar ahora (hasta 5 eventos)'}
        </button>

        {error && (
          <p style={{ color: 'var(--danger)', marginTop: 12 }}>
            ⚠️ {error}
          </p>
        )}

        {lastResult && (
          <div style={{ marginTop: 16 }}>
            <p>
              <strong>{lastResult.processed} eventos procesados</strong>
              {lastResult.processed === 0 && ' — no había nada pending'}
            </p>
            {lastResult.results.length > 0 && (
              <table className="data-table" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th style={cellStyle}>Tipo</th>
                    <th style={cellStyle}>Resultado</th>
                    <th style={cellStyle}>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {lastResult.results.map((r) => (
                    <tr key={r.event_id}>
                      <td style={cellStyle}><code>{r.event_type}</code></td>
                      <td style={cellStyle}>
                        {r.outcome === 'sent' && '✅ enviado'}
                        {r.outcome === 'retried' && '⏳ reintentar'}
                        {r.outcome === 'failed' && '❌ falló (5 intentos)'}
                      </td>
                      <td style={cellStyle}>{r.error ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      <section style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>📧 Setup de email (ZeptoMail)</h3>
        <p className="muted small">
          Los emails que sale de la app (portal_access + report_ready al cliente, recovery_link al candidato).
          Los emails al candidato del pipeline (invitación a tests, etapas, rechazo) los manda Zoho Recruit, no esto.
        </p>
        <table style={{ marginTop: 12, width: '100%' }}>
          <tbody>
            <tr><td style={cellStyle}><strong>From</strong></td><td style={cellStyle}><code>SharkTalents &lt;reportes@sharktalents.ai&gt;</code></td></tr>
            <tr><td style={cellStyle}><strong>Reply-To</strong></td><td style={cellStyle}><code>proyectos@kunodigital.com</code> (cliente responde y te llega al inbox)</td></tr>
            <tr><td style={cellStyle}><strong>Provider</strong></td><td style={cellStyle}>ZeptoMail (incluido en Zoho One — costo $0)</td></tr>
            <tr><td style={cellStyle}><strong>Templates activos</strong></td><td style={cellStyle}><code>client_portal_access</code>, <code>client_report_ready</code>, <code>recovery_link</code></td></tr>
          </tbody>
        </table>
        <p className="muted small" style={{ marginTop: 12 }}>
          Para cambiar el From o Reply-To: agregar env vars <code>ZEPTOMAIL_FROM_EMAIL</code>, <code>ZEPTOMAIL_FROM_NAME</code>,
          <code> ZEPTOMAIL_REPLY_TO</code> en Catalyst Console.
        </p>
      </section>

      <RecentOutboxEvents />

      <section style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>📅 Cron jobs configurados</h3>
        <p className="muted small">
          Estos se setean en Catalyst Console → Cloud Scale → Cron Jobs. La definición está en
          <code> functions/api/cron-config.json</code> del repo.
        </p>
        <ul style={{ marginTop: 12 }}>
          <li><strong>outbox_processor</strong> — cada 5 min, procesa emails + sync.recruit + whatsapp pending</li>
          <li><strong>video_purge</strong> — todos los días 3am, GDPR retention</li>
        </ul>
      </section>
    </div>
  );
}

type OutboxEvent = {
  id: string;
  event_type: string;
  status: 'pending' | 'processing' | 'sent' | 'failed';
  retry_count: number;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
};

function RecentOutboxEvents() {
  const api = useApi();
  const [events, setEvents] = useState<OutboxEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const load = useCallback(() => {
    if (!config.useApi) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api.outbox.recent()
      .then((r) => {
        if ('error' in r && r.error === 'outbox_table_not_ready') {
          setMissing(true);
        } else {
          setEvents(r.items);
        }
      })
      .catch(() => setMissing(true))
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => { load(); }, [load]);

  if (!config.useApi) return null;
  if (missing) return null;
  if (loading) return <p className="muted small">Cargando eventos…</p>;
  if (events.length === 0) {
    return (
      <section style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>📋 Eventos outbox recientes</h3>
        <p className="muted small">Aún no hay eventos. Se generan cuando creás portales, mandás contratos, etc.</p>
      </section>
    );
  }

  const statusColor = (s: OutboxEvent['status']) => {
    if (s === 'sent') return '#22c55e';
    if (s === 'failed') return '#ef4444';
    if (s === 'processing') return '#3b82f6';
    return '#f59e0b';
  };
  const statusIcon = (s: OutboxEvent['status']) => ({ sent: '✅', failed: '❌', processing: '⏳', pending: '⏸' }[s] ?? '?');

  return (
    <section style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>📋 Eventos outbox recientes (últimos 20)</h3>
        <button className="btn-secondary" style={{ fontSize: 12 }} onClick={load}>🔄 Refrescar</button>
      </div>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
            <th style={cellStyle}>Estado</th>
            <th style={cellStyle}>Tipo</th>
            <th style={cellStyle}>Reintentos</th>
            <th style={cellStyle}>Creado</th>
            <th style={cellStyle}>Procesado</th>
            <th style={cellStyle}>Error</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td style={cellStyle}><span style={{ color: statusColor(e.status), fontWeight: 600 }}>{statusIcon(e.status)} {e.status}</span></td>
              <td style={cellStyle}><code>{e.event_type}</code></td>
              <td style={cellStyle}>{e.retry_count}</td>
              <td style={cellStyle} className="muted small">{new Date(e.created_at).toLocaleString()}</td>
              <td style={cellStyle} className="muted small">{e.processed_at ? new Date(e.processed_at).toLocaleString() : '—'}</td>
              <td style={cellStyle} className="muted small" title={e.last_error ?? ''}>{e.last_error ? e.last_error.slice(0, 40) + '…' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
