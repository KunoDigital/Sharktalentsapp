import type { CSSProperties } from 'react';

export default function TestDone() {
  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <span style={logoStyle}>SharkTalents</span>
      </header>

      <div style={cardStyle}>
        <div style={checkCircle}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <path d="M14 24L21 31L34 18" stroke="var(--kuno-lime)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 style={titleStyle}>¡Prueba completada!</h1>
        <p style={textStyle}>Tus respuestas han sido registradas exitosamente.</p>
        <p style={textStyle}>El equipo de reclutamiento revisará tus resultados y te contactará pronto.</p>
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: 'var(--kuno-dark-2)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

const headerStyle: CSSProperties = {
  padding: '24px 0',
  textAlign: 'center',
};

const logoStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: 'var(--kuno-lime)',
};

const cardStyle: CSSProperties = {
  background: 'var(--kuno-dark)',
  border: '1px solid var(--kuno-border)',
  borderRadius: 'var(--radius-lg)',
  padding: '48px 36px',
  width: '100%',
  maxWidth: 460,
  marginTop: 40,
  textAlign: 'center',
};

const checkCircle: CSSProperties = {
  width: 80,
  height: 80,
  borderRadius: '50%',
  border: '2px solid var(--kuno-lime)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  margin: '0 auto 24px',
};

const titleStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: 'var(--kuno-cream)',
  marginBottom: 12,
};

const textStyle: CSSProperties = {
  fontSize: 14,
  color: 'var(--kuno-text-muted)',
  lineHeight: 1.6,
  marginBottom: 4,
};
