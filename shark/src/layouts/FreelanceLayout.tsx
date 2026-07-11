import { Outlet, Link, useLocation } from 'react-router-dom';
import { UserButton, useUser } from '@clerk/clerk-react';

/**
 * Layout del CRM interno para vendedores freelance.
 *
 * Diseño: fondo blanco (contraste con admin que es azul dark), sidebar mínimo,
 * sin navegación al ATS. El vendedor solo ve secciones comerciales.
 */
export default function FreelanceLayout() {
  const { user } = useUser();
  const location = useLocation();

  const primerNombre = (user?.firstName ?? user?.fullName ?? user?.username ?? 'Vendedor').split(' ')[0];

  const nav = [
    { path: '/freelance', label: 'Inicio', icon: '🏠' },
    { path: '/freelance/leads', label: 'Mis leads', icon: '👥' },
    { path: '/freelance/clientes', label: 'Mis clientes', icon: '📄' },
    { path: '/freelance/perfil', label: 'Mi perfil', icon: '👤' },
  ];

  return (
    <div style={styles.root}>
      <aside style={styles.sidebar}>
        <div style={styles.brand}>
          <span style={styles.brandName}>SharkTalents</span>
          <span style={styles.brandTag}>Freelance</span>
        </div>

        <nav style={styles.nav}>
          {nav.map((item) => {
            const active =
              item.path === '/freelance'
                ? location.pathname === '/freelance'
                : location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                style={{ ...styles.navItem, ...(active ? styles.navItemActive : {}) }}
              >
                <span style={{ marginRight: 10 }}>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div style={styles.sidebarFooter}>
          <div style={styles.userBox}>
            <UserButton afterSignOutUrl="/app/" />
            <div style={{ marginLeft: 10 }}>
              <div style={{ fontSize: 13, color: '#111827', fontWeight: 600 }}>{primerNombre}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Vendedor</div>
            </div>
          </div>
        </div>
      </aside>

      <main style={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

const styles = {
  root: {
    display: 'flex',
    minHeight: '100vh',
    background: '#ffffff',
    color: '#111827',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  } as React.CSSProperties,
  sidebar: {
    width: 240,
    background: '#f8fafc',
    borderRight: '1px solid #e2e8f0',
    display: 'flex',
    flexDirection: 'column',
    padding: '24px 16px',
  } as React.CSSProperties,
  brand: {
    display: 'flex',
    flexDirection: 'column',
    marginBottom: 32,
    paddingLeft: 8,
  } as React.CSSProperties,
  brandName: {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: 1,
    color: '#111827',
  },
  brandTag: {
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: '#6b7280',
    marginTop: 2,
  } as React.CSSProperties,
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flex: 1,
  } as React.CSSProperties,
  navItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 12px',
    borderRadius: 8,
    fontSize: 14,
    color: '#374151',
    textDecoration: 'none',
    transition: 'background 0.12s',
  } as React.CSSProperties,
  navItemActive: {
    background: '#e0e7ff',
    color: '#1e40af',
    fontWeight: 600,
  } as React.CSSProperties,
  sidebarFooter: {
    borderTop: '1px solid #e2e8f0',
    paddingTop: 16,
  } as React.CSSProperties,
  userBox: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 8px',
  } as React.CSSProperties,
  main: {
    flex: 1,
    padding: '32px 40px',
    background: '#ffffff',
    overflowY: 'auto',
  } as React.CSSProperties,
};
