import { useState, useEffect } from 'react';
import { login, setAuth, getAuthToken } from '../../services/api';
import type { CSSProperties } from 'react';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // If already logged in, try to go to admin
  // But clear stale tokens from previous sessions first time entering login
  useEffect(() => {
    const token = getAuthToken();
    if (token) {
      // Token exists but we're on login page — might be stale, let it be
      // User can try navigating to admin manually
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(username, password);
      setAuth(result.token, result.username);
      window.location.hash = '#/admin';
      window.location.reload();
    } catch (err: any) {
      console.error('[Login] error:', err);
      setError(err?.response?.data?.error || 'Error al iniciar sesión');
    }
    setLoading(false);
  };

  return (
    <div style={container}>
      <div style={card}>
        <div style={logoArea}>
          <div style={logoIcon}>S</div>
          <h1 style={title}>SharkTalents</h1>
          <p style={subtitle}>Panel de reclutamiento</p>
        </div>

        <form onSubmit={handleSubmit} style={form}>
          <div>
            <label style={label}>Usuario</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Ingresa tu usuario"
              style={input}
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label style={label}>Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Ingresa tu contraseña"
              style={input}
              autoComplete="current-password"
              required
            />
          </div>

          {error && <p style={errorStyle}>{error}</p>}

          <button type="submit" disabled={loading || !username || !password} style={loading ? btnDisabled : btn}>
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>

        <p style={footer}>Kuno Digital</p>
      </div>
    </div>
  );
}

const container: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--kuno-bg, #0a0a0f)',
  padding: 20,
};

const card: CSSProperties = {
  background: 'var(--kuno-dark, #12121a)',
  border: '1px solid var(--kuno-border, #2a2a3a)',
  borderRadius: 16,
  padding: '40px 36px',
  width: '100%',
  maxWidth: 380,
};

const logoArea: CSSProperties = {
  textAlign: 'center',
  marginBottom: 32,
};

const logoIcon: CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: '50%',
  background: 'var(--kuno-lime, #dafb6f)',
  color: 'var(--kuno-dark, #12121a)',
  fontSize: 24,
  fontWeight: 800,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  margin: '0 auto 16px',
};

const title: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: 'var(--kuno-cream, #f0ede6)',
  margin: 0,
};

const subtitle: CSSProperties = {
  fontSize: 13,
  color: 'var(--kuno-text-muted, #8a8a9a)',
  marginTop: 4,
};

const form: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
};

const label: CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--kuno-text-muted, #8a8a9a)',
  marginBottom: 6,
};

const input: CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  background: 'var(--kuno-dark-2, #1a1a2a)',
  border: '1px solid var(--kuno-border, #2a2a3a)',
  borderRadius: 8,
  color: 'var(--kuno-cream, #f0ede6)',
  fontSize: 14,
  boxSizing: 'border-box',
};

const btn: CSSProperties = {
  width: '100%',
  padding: '12px',
  background: 'var(--kuno-lime, #dafb6f)',
  color: 'var(--kuno-dark, #12121a)',
  fontWeight: 700,
  fontSize: 14,
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  marginTop: 4,
};

const btnDisabled: CSSProperties = {
  ...btn,
  opacity: 0.5,
  cursor: 'not-allowed',
};

const errorStyle: CSSProperties = {
  color: '#e74c3c',
  fontSize: 13,
  textAlign: 'center',
  margin: 0,
  padding: '8px 12px',
  background: 'rgba(231,76,60,0.1)',
  borderRadius: 8,
};

const footer: CSSProperties = {
  textAlign: 'center',
  fontSize: 11,
  color: 'var(--kuno-text-muted, #8a8a9a)',
  marginTop: 28,
  opacity: 0.6,
};
