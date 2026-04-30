import { useState } from 'react';
import { MOCK_JOBS } from '../data/mockJobs';
import { generateDemoApplications, clearDemoApplications, getDemoCount } from '../lib/demoData';
import { getNotifPrefs, setNotifPrefs, ALL_TYPES, TYPE_LABELS, clearReadIds } from '../lib/notificationPrefs';
import './pages.css';

type Tab = 'integraciones' | 'notifications' | 'api_keys' | 'equipo' | 'branding' | 'plan' | 'demo';

export default function Settings() {
  const [tab, setTab] = useState<Tab>('integraciones');

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="page-subtitle">Configuración del tenant.</p>

      <div className="phase-tabs">
        {(['integraciones', 'notifications', 'api_keys', 'equipo', 'branding', 'plan', 'demo'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`phase-tab${tab === t ? ' is-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'integraciones' ? 'Integraciones' :
             t === 'notifications' ? '🔔 Notificaciones' :
             t === 'api_keys' ? 'API keys' :
             t === 'equipo' ? 'Equipo' :
             t === 'branding' ? 'Branding' :
             t === 'plan' ? 'Plan & Billing' :
             '🎲 Demo data'}
          </button>
        ))}
      </div>

      {tab === 'integraciones' && <IntegracionesTab />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'api_keys' && <ApiKeysTab />}
      {tab === 'equipo' && <EquipoTab />}
      {tab === 'branding' && <BrandingTab />}
      {tab === 'plan' && <PlanTab />}
      {tab === 'demo' && <DemoDataTab />}
    </div>
  );
}

function IntegracionesTab() {
  const integraciones = [
    { name: 'Zoho Recruit', status: 'connected', desc: 'CRM de candidatos. Webhook entrante para job board gratis + sync saliente de etapas.', last_sync: '2026-04-30 09:14' },
    { name: 'Zoho Meeting + Zia', status: 'connected', desc: 'Videocalls con cliente + transcripción automática (Zia).', last_sync: '2026-04-29 16:22' },
    { name: 'Zoho Bookings', status: 'connected', desc: 'Link de agendamiento de cliente para discovery calls.', last_sync: '2026-04-30 11:00' },
    { name: 'Zoho Sign', status: 'pending', desc: 'Generación + firma de contratos cliente.', last_sync: null },
    { name: 'OpenAI Whisper (fallback)', status: 'connected', desc: 'Transcripción de respaldo cuando Zia no transcribe.', last_sync: '2026-04-29 18:30' },
    { name: 'HeyReach', status: 'connected', desc: 'Outbound LinkedIn con cuenta dedicada.', last_sync: '2026-04-30 08:00' },
    { name: 'Anthropic Claude', status: 'connected', desc: 'Modelo IA para drafts, resúmenes, decisiones, narrativa de reportes.', last_sync: '2026-04-30 11:30' },
    { name: 'WhatsApp Business', status: 'pending', desc: 'Notificaciones a candidatos y clientes.', last_sync: null },
  ];
  return (
    <div className="settings-list">
      {integraciones.map((i) => (
        <div key={i.name} className="settings-item">
          <div>
            <div className="settings-item-title">{i.name}</div>
            <div className="settings-item-desc">{i.desc}</div>
            {i.last_sync && <div className="settings-item-meta">Última sync: {i.last_sync}</div>}
          </div>
          <div className="settings-item-actions">
            <span className={`status-tag ${i.status === 'connected' ? 'status-active' : 'status-paused'}`}>
              {i.status === 'connected' ? '✓ Conectado' : 'Pendiente'}
            </span>
            <button className="btn-toolbar">{i.status === 'connected' ? 'Configurar' : 'Conectar'}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ApiKeysTab() {
  const keys = [
    { id: 'k_1', name: 'MCP Server local', prefix: 'st_live_a8b3...c4d2', created: '2026-04-15', last_used: '2026-04-30 11:00' },
    { id: 'k_2', name: 'Zapier integration', prefix: 'st_live_d9f1...e8a3', created: '2026-04-22', last_used: '2026-04-29 14:30' },
  ];
  return (
    <div>
      <div className="page-header-row">
        <p className="muted">API keys del tenant para integrar con tus herramientas (MCP, Zapier, etc.).</p>
        <button className="btn-primary">+ Crear nueva API key</button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Prefijo</th>
            <th>Creada</th>
            <th>Último uso</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id}>
              <td>{k.name}</td>
              <td><code>{k.prefix}</code></td>
              <td className="muted">{k.created}</td>
              <td className="muted">{k.last_used}</td>
              <td>
                <button className="cd-btn-danger" style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>Revocar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted-note">Usá las API keys con el MCP server para que Claude Desktop se conecte directo a tu data. Ver master plan §16 MCP Server.</p>
    </div>
  );
}

function EquipoTab() {
  const team = [
    { name: 'Cris Aguilera', email: 'cris@kunodigital.com', role: 'Admin', joined: '2026-04-10' },
  ];
  return (
    <div>
      <div className="page-header-row">
        <p className="muted">Miembros del equipo Kuno Digital.</p>
        <button className="btn-primary">+ Invitar miembro</button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Email</th>
            <th>Rol</th>
            <th>Se unió</th>
          </tr>
        </thead>
        <tbody>
          {team.map((t) => (
            <tr key={t.email}>
              <td>{t.name}</td>
              <td className="muted">{t.email}</td>
              <td><span className="status-tag status-active">{t.role}</span></td>
              <td className="muted">{t.joined}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BrandingTab() {
  return (
    <div className="settings-list">
      <div className="settings-item">
        <div>
          <div className="settings-item-title">Logo del tenant</div>
          <div className="settings-item-desc">Aparece en el portal cliente y reportes públicos.</div>
        </div>
        <button className="btn-toolbar">Subir logo</button>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-item-title">Color principal</div>
          <div className="settings-item-desc">Override del color accent en el portal del cliente. Default: neón verde.</div>
        </div>
        <button className="btn-toolbar">Cambiar color</button>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-item-title">Texto de bienvenida en portal cliente</div>
          <div className="settings-item-desc">Mensaje custom que ven tus clientes al abrir el portal.</div>
        </div>
        <button className="btn-toolbar">Editar</button>
      </div>
    </div>
  );
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
      </div>

      <div className="settings-item">
        <div>
          <div className="settings-item-title">Generar candidatos random</div>
          <div className="settings-item-desc">
            Útil para mostrar la app a un cliente potencial con volumen real (filtros funcionando, charts con data, kanban poblado).
            Los candidatos se distribuyen entre los 4 puestos existentes con scores aleatorios pero coherentes.
          </div>
        </div>
        <div className="settings-item-actions" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
          <input
            type="number"
            min={5}
            max={200}
            value={count}
            onChange={(e) => setCount(Math.max(5, Math.min(200, Number(e.target.value))))}
            className="filter-search"
            style={{ minWidth: 'auto', width: '100px' }}
          />
          <button className="btn-primary" onClick={handleGenerate}>
            Generar {count}
          </button>
        </div>
      </div>

      <div className="settings-item">
        <div>
          <div className="settings-item-title">Limpiar demo data</div>
          <div className="settings-item-desc">
            Borra todos los candidatos demo. Vuelve a los 8 hardcoded.
          </div>
        </div>
        <div className="settings-item-actions">
          <button className="cd-btn-danger" onClick={handleClear} disabled={generated === 0}>
            Borrar demo
          </button>
        </div>
      </div>

      <p className="muted-note">
        💡 Demo data persiste en <code>localStorage</code>. Cambiar de browser o limpiar cookies elimina la data.
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
