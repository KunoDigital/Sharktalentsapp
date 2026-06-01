import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { config } from '../../config';
import './candidate-test.css';

type Section = 'conductual' | 'integridad';

const SITE_KEY = (import.meta.env as Record<string, string | undefined>).VITE_MARKETING_SITE_KEY ?? 'sharktalents-landing';

const SECTION_LABEL: Record<Section, string> = {
  conductual: 'Prueba de conducta (DISC + capacidad cognitiva)',
  integridad: 'Prueba de integridad',
};

const SECTION_DURATION: Record<Section, string> = {
  conductual: '30-40 min aprox.',
  integridad: '20-30 min aprox.',
};

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 16,
  borderRadius: 6,
  border: '1px solid #ccc',
  background: '#ffffff',
  color: '#1f2937',
};

export default function DemoTestRegister() {
  const { section, token } = useParams<{ section: Section; token: string }>();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!section || !token || (section !== 'conductual' && section !== 'integridad')) {
    return (
      <div className="ct-not-found">
        <h1>Link inválido</h1>
        <p>Este link no es válido. Revisa que esté completo o pide uno nuevo.</p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch(`${config.apiBase}/api/marketing/demo-test/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Marketing-Site-Key': SITE_KEY,
        },
        body: JSON.stringify({ token, name: name.trim(), email: email.trim().toLowerCase() }),
      });

      const data = await response.json();

      if (response.status === 410) {
        setError('Esta prueba ya se completó. Si crees que es un error, contacta a Kuno Digital.');
        setSubmitting(false);
        return;
      }

      if (!response.ok) {
        setError(data.error?.message ?? 'No pudimos registrar tus datos. Intenta de nuevo.');
        setSubmitting(false);
        return;
      }

      const testToken = data.test_token as string;
      // Conductual del demo = VELNA → DISC (orden estándar del flow); integridad va sola
      const sectionRoute = section === 'conductual' ? 'velna' : 'integridad';
      navigate(`/test/${testToken}/${sectionRoute}`, { replace: true });
    } catch (err) {
      setError('Error de conexión. Verifica tu internet e intenta de nuevo.');
      setSubmitting(false);
    }
  }

  return (
    <div className="ct-root">
      <header className="ct-header">
        <div className="ct-brand">SharkTalents.AI</div>
        <div className="ct-brand-tag">Evaluación gratuita</div>
      </header>

      <main className="ct-main">
        <div className="ct-greeting">
          <h1>{SECTION_LABEL[section]}</h1>
          <p className="ct-greeting-text">
            Duración: <strong>{SECTION_DURATION[section]}</strong>. Hazla en un lugar tranquilo, sin interrupciones.
          </p>
        </div>

        <section className="ct-current-card">
          <h2>Antes de empezar, cuéntanos quién eres</h2>
          <p style={{ color: '#666', marginBottom: 16 }}>
            Estos datos los usamos para identificarte en el reporte.
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontWeight: 600 }}>Nombre completo</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                placeholder="Tu nombre completo"
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontWeight: 600 }}>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="tu@email.com"
                style={inputStyle}
              />
            </label>

            {error && (
              <div style={{ background: '#fee', color: '#a00', padding: 12, borderRadius: 6, fontSize: 14 }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || name.trim().length < 2 || !email.includes('@')}
              className="ct-start-btn"
              style={{ opacity: submitting ? 0.5 : 1, cursor: submitting ? 'wait' : 'pointer' }}
            >
              {submitting ? 'Cargando...' : 'Empezar prueba →'}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
