import { useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { OrganizationSwitcher, UserButton, useOrganization } from '@clerk/clerk-react';
import CommandPalette from '../components/CommandPalette';
import NotificationCenter from '../components/NotificationCenter';
import './AdminLayout.css';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/drafts', label: 'Drafts (cliente)' },
  { to: '/jobs', label: 'Jobs' },
  { to: '/candidates', label: 'Candidatos' },
  { to: '/bot/review', label: 'Bot — Review queue' },
  { to: '/reports', label: 'Reportes' },
  { to: '/inbox', label: 'Inbox outbound' },
  { to: '/settings', label: 'Settings' },
];

export default function AdminLayout() {
  const { organization } = useOrganization();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Cerrar menú móvil al navegar
  function handleNavClick() {
    setMobileOpen(false);
  }

  return (
    <div className="admin-layout">
      <button
        className="admin-mobile-toggle"
        onClick={() => setMobileOpen((o) => !o)}
        aria-label="Toggle menu"
      >
        ☰
      </button>

      {mobileOpen && <div className="admin-mobile-overlay" onClick={() => setMobileOpen(false)} />}

      <aside className={`admin-sidebar ${mobileOpen ? 'is-open' : ''}`}>
        <div className="admin-brand">
          <span className="admin-brand-mark">⌬</span>
          <span className="admin-brand-name">SharkTalents</span>
        </div>
        <nav className="admin-nav">
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
        <main className="admin-main" key={location.pathname}>
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
