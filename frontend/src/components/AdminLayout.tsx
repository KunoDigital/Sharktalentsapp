import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { CSSProperties } from 'react';
import { logout, getAuthUser } from '../services/api';

const sidebarStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  bottom: 0,
  width: 'var(--sidebar-width)',
  background: 'var(--kuno-dark)',
  borderRight: '1px solid var(--kuno-border)',
  display: 'flex',
  flexDirection: 'column',
  padding: '24px 16px',
  zIndex: 100,
};

const logoStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--kuno-lime)',
  marginBottom: 2,
};

const subLogoStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--kuno-text-muted)',
  marginBottom: 40,
};

const navStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const contentStyle: CSSProperties = {
  marginLeft: 'var(--sidebar-width)',
  minHeight: '100vh',
  background: 'var(--kuno-dark-2)',
  padding: '32px 40px',
};

const linkBase: CSSProperties = {
  padding: '10px 14px',
  borderRadius: 'var(--radius)',
  fontSize: 14,
  fontWeight: 500,
  color: 'var(--kuno-cream)',
  transition: 'all 0.15s',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

export default function AdminLayout() {
  const nav = useNavigate();
  const user = getAuthUser();

  const getLinkStyle = ({ isActive }: { isActive: boolean }): CSSProperties => ({
    ...linkBase,
    background: isActive ? 'var(--kuno-lime)' : 'transparent',
    color: isActive ? 'var(--kuno-dark)' : 'var(--kuno-cream)',
    fontWeight: isActive ? 600 : 500,
  });

  const handleLogout = () => {
    logout();
    nav('/admin/login');
  };

  return (
    <div>
      <aside style={sidebarStyle}>
        <div style={logoStyle}>SharkTalents</div>
        <div style={subLogoStyle}>by Kuno Digital</div>
        <nav style={navStyle}>
          <NavLink to="/admin" end style={getLinkStyle}>
            <span>◻</span> Puestos
          </NavLink>
          <NavLink to="/admin/candidates" style={getLinkStyle}>
            <span>◉</span> Candidatos
          </NavLink>
          <NavLink to="/admin/library" style={getLinkStyle}>
            <span>▤</span> Biblioteca técnica
          </NavLink>
          <NavLink to="/admin/reportes" style={getLinkStyle}>
            <span>▤</span> Reportes
          </NavLink>
          <NavLink to="/admin/costos" style={getLinkStyle}>
            <span>$</span> Costos
          </NavLink>
        </nav>
        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--kuno-border)', paddingTop: 16 }}>
          {user && <div style={{ fontSize: 12, color: 'var(--kuno-text-muted)', marginBottom: 8 }}>{user}</div>}
          <button onClick={handleLogout} style={logoutBtn}>Cerrar sesión</button>
        </div>
      </aside>
      <main style={contentStyle}>
        <Outlet />
      </main>
    </div>
  );
}

const logoutBtn: CSSProperties = {
  width: '100%',
  padding: '8px 14px',
  background: 'transparent',
  border: '1px solid var(--kuno-border)',
  borderRadius: 'var(--radius)',
  color: 'var(--kuno-text-muted)',
  fontSize: 13,
  cursor: 'pointer',
};
