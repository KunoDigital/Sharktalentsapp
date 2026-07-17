import { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApi } from '../lib/api';
import { OrganizationSwitcher, UserButton, useOrganization } from '@clerk/clerk-react';
import RequireOrganization from '../components/RequireOrganization';
import CommandPalette from '../components/CommandPalette';
import NotificationCenter from '../components/NotificationCenter';
import ShortcutsHelp from '../components/ShortcutsHelp';
import OnboardingTour from '../components/OnboardingTour';
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts';
import './AdminLayout.css';

type NavItem = { to: string; label: string; end?: boolean };
type NavGroup = { title: string; items: NavItem[]; defaultCollapsed?: boolean };

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Inicio',
    items: [
      { to: '/', label: 'Dashboard', end: true },
      { to: '/favorites', label: '★ Favoritos' },
      { to: '/stats', label: '📊 Stats del negocio' },
    ],
  },
  {
    title: 'Clientes',
    items: [
      { to: '/marketing/prospectos', label: 'Marketing → Prospectos' },
      { to: '/marketing/clientes', label: 'Marketing → Clientes' },
      { to: '/marketing/finalistas', label: 'Marketing → Finalistas' },
      { to: '/marketing/leads', label: 'Leads marketing (clásico)' },
      { to: '/team/freelance', label: 'Vendedores freelance' },
      { to: '/drafts', label: 'Drafts pendientes' },
      { to: '/reports', label: 'Reportes enviados' },
      { to: '/clients/health', label: 'Salud de clientes' },
    ],
  },
  {
    title: 'Candidatos',
    items: [
      { to: '/jobs', label: 'Puestos' },
      { to: '/candidates', label: 'Embudo' },
      { to: '/pool', label: 'Pool histórico' },
      { to: '/candidates/duplicates', label: 'Duplicados' },
      { to: '/bot/review', label: 'Bot review queue' },
      { to: '/inbox', label: 'Inbox outbound' },
    ],
  },
  {
    title: 'Operaciones',
    defaultCollapsed: true,
    items: [
      { to: '/alerts', label: 'Alertas' },
      { to: '/operations/expenses', label: 'Gastos' },
      { to: '/health', label: 'Health' },
      { to: '/settings', label: 'Settings' },
      { to: '/emails', label: 'Email templates' },
      { to: '/help', label: '? Ayuda' },
    ],
  },
];

export default function AdminLayout() {
  const { organization } = useOrganization();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { helpOpen, setHelpOpen } = useGlobalShortcuts(navigate);
  const api = useApi();
  const [alertBadge, setAlertBadge] = useState(0);

  // Refresca el badge de alertas críticas cada 60s.
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      api.alerts.list('open', 1)
        .then((res) => { if (!cancelled) setAlertBadge(res.open_critical ?? 0); })
        .catch(() => { /* table not ready or transient — keep current badge */ });
    }
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Cerrar menú móvil al navegar
  function handleNavClick() {
    setMobileOpen(false);
  }

  return (
    <div className="admin-layout">
      <a href="#main-content" className="skip-link">Saltar al contenido</a>
      <button
        className="admin-mobile-toggle"
        onClick={() => setMobileOpen((o) => !o)}
        aria-label={mobileOpen ? 'Cerrar menú' : 'Abrir menú'}
        aria-expanded={mobileOpen}
      >
        ☰
      </button>

      {mobileOpen && <div className="admin-mobile-overlay" onClick={() => setMobileOpen(false)} aria-hidden="true" />}

      <aside className={`admin-sidebar ${mobileOpen ? 'is-open' : ''}`} aria-label="Navegación principal">
        <div className="admin-brand">
          <span className="admin-brand-mark" aria-hidden="true">⌬</span>
          <span className="admin-brand-name">SharkTalents</span>
        </div>
        <nav className="admin-nav" aria-label="Secciones">
          {NAV_GROUPS.map((group) => (
            <NavGroupBlock
              key={group.title}
              group={group}
              onNavigate={handleNavClick}
              alertBadge={group.title === 'Operaciones' ? alertBadge : 0}
            />
          ))}
        </nav>
        <div className="admin-cmdk-hint">
          Buscar: <kbd>⌘</kbd>+<kbd>K</kbd>
          <br />
          Atajos: <kbd>?</kbd>
        </div>
        <div className="admin-tenant-tag">
          {organization ? `${organization.name}` : 'Sin tenant'}
        </div>
      </aside>
      <div className="admin-content">
        <header className="admin-header">
          <div className="admin-header-right">
            <NotificationCenter />
            <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/" />
            <UserButton afterSignOutUrl="/" />
          </div>
        </header>
        <main id="main-content" className="admin-main" key={location.pathname} tabIndex={-1}>
          <RequireOrganization>
            <Outlet />
          </RequireOrganization>
        </main>
      </div>
      <CommandPalette />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <OnboardingTour />
    </div>
  );
}

function NavGroupBlock({
  group,
  onNavigate,
  alertBadge,
}: {
  group: NavGroup;
  onNavigate: () => void;
  alertBadge: number;
}) {
  const [collapsed, setCollapsed] = useState(group.defaultCollapsed ?? false);
  const isSingle = group.items.length === 1;

  if (isSingle) {
    // Grupos con 1 item (ej "Inicio") sin header — solo el link
    const item = group.items[0];
    return (
      <NavLink
        to={item.to}
        end={item.end}
        onClick={onNavigate}
        className={({ isActive }) => 'admin-nav-link' + (isActive ? ' is-active' : '')}
      >
        {item.label}
      </NavLink>
    );
  }

  return (
    <div className="admin-nav-group">
      <button
        type="button"
        className="admin-nav-group-title"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <span>{group.title}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {alertBadge > 0 && (
            <span style={{ background: '#dc2626', color: '#fff', borderRadius: 99, padding: '1px 7px', fontSize: 11, fontWeight: 600 }}>
              {alertBadge}
            </span>
          )}
          <span style={{ fontSize: 11, opacity: 0.6 }}>{collapsed ? '▶' : '▼'}</span>
        </span>
      </button>
      {!collapsed && group.items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) => 'admin-nav-link admin-nav-link-nested' + (isActive ? ' is-active' : '')}
        >
          {item.label}
          {item.to === '/alerts' && alertBadge > 0 && (
            <span style={{ marginLeft: 'auto', background: '#dc2626', color: '#fff', borderRadius: 99, padding: '1px 7px', fontSize: 11, fontWeight: 600 }}>
              {alertBadge}
            </span>
          )}
        </NavLink>
      ))}
    </div>
  );
}
