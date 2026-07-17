/**
 * Recovery flow del candidato — pidió reenvío del link de su test.
 *
 * Ruta: /apply/:tenantSlug/:jobSlug/recover
 *
 * El candidato perdió el email con el link. Pone su email, el backend valida
 * que tenga una Application a ese puesto, le manda un nuevo link via email.
 *
 * Backend: POST /apply/<tenantSlug>/<jobIdentifier>/resend
 */
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { config } from '../../config';
import './candidate-test.css';

export default function CandidateRecovery() {
  const { tenantSlug, jobSlug } = useParams<{ tenantSlug: string; jobSlug: string }>();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes('@')) {
      setError('Email inválido');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const url = `${config.apiBase}/apply/${encodeURIComponent(tenantSlug ?? '')}/${encodeURIComponent(jobSlug ?? '')}/resend`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data?.error?.message ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setSubmitted(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="candidate-test-container">
        <div className="candidate-test-card">
          <h1>✓ Listo</h1>
          <p>
            Si tienes una aplicación activa con ese email a este puesto, vas a recibir un email con un link nuevo en
            los próximos minutos.
          </p>
          <p style={{ color: '#666', fontSize: 14 }}>
            Revisa tu bandeja de spam si no aparece. El link nuevo dura 7 días.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="candidate-test-container">
      <div className="candidate-test-card">
        <h1>¿Perdiste tu link?</h1>
        <p>Poné el email con el que aplicaste y te mandamos un link nuevo.</p>

        <form onSubmit={handleSubmit} style={{ marginTop: 24 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            required
            autoFocus
            disabled={submitting}
            style={{
              width: '100%',
              padding: '12px',
              fontSize: 16,
              border: '1px solid #d1d5db',
              borderRadius: 6,
              marginBottom: 16,
            }}
          />

          {error && (
            <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 12 }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !email}
            className="btn-primary"
            style={{ width: '100%' }}
          >
            {submitting ? 'Enviando…' : 'Mandame un link nuevo'}
          </button>
        </form>

        <p style={{ marginTop: 24, fontSize: 14 }}>
          <Link to={`/apply/${tenantSlug}/${jobSlug}`}>← Volver a la página del puesto</Link>
        </p>
      </div>
    </div>
  );
}
