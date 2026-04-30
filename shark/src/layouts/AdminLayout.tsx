import { useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { OrganizationSwitcher, UserButton, useOrganization } from '@clerk/clerk-react';
import CommandPalette from '../components/CommandPalette';
import NotificationCenter from '../components/NotificationCenter';
import ShortcutsHelp from '../components/ShortcutsHelp';
import OnboardingTour from '../components/OnboardingTour';
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts';
import './AdminLayout.css';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/drafts', label: 'Drafts (cliente)' },
  { to: '/jobs', label: 'Jobs' },
  { to: '/candidates', label: 'Candidatos' },
  { to: '/bot/review', label: 'Bot — Review queue' },
  { to: '/reports', label: 'Reportes' },
  { to: '/inbox', label: 'Inbox outbound' },
  { to: '/emails', label: 'Email templates' },
  { to: '/settings', label: 'Settings' },
  { to: '/help', label: '? Ayuda' },
];

export default function AdminLayout() {
  const { organization } = useOrganization();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { helpOpen, setHelpOpen } = useGlobalShortcuts(navigate);

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
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={handleNavClick}
              className={({ isActive }) => 'admin-nav-link' + (isActive ? ' is-active' : '')}
            >
              {item.label}
            </NavLink>
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
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <OnboardingTour />
    </div>
  );
}
