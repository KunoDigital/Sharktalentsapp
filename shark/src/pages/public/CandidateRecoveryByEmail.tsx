import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { publicApi } from '../../lib/publicApi';
import { logger } from '../../lib/logger';
import './candidate-test.css';

const log = logger('CANDIDATE_RECOVERY_EMAIL');

export default function CandidateRecoveryByEmail() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !email.includes('@')) {
      setError('Email inválido');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await publicApi.recoverByEmail(email.trim().toLowerCase());
      setSubmitted(true);
    } catch (err) {
      log.warn('recovery failed', { error: (err as Error).message });
      setError('No pudimos procesar tu pedido. Intenta más tarde o escríbenos a proyectos@kunodigital.com');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks">
            <h1>✓ Listo</h1>
            <p>Si tu email está en nuestro sistema, vas a recibir un link nuevo en los próximos minutos.</p>
            <p style={{ marginTop: 16, fontSize: 13, color: '#6b7280' }}>
              Revisa tu bandeja de entrada y la carpeta de spam. Si en 10 min no llegó nada, escríbenos a{' '}
              <a href="mailto:proyectos@kunodigital.com">proyectos@kunodigital.com</a>.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="ct-root">
      <main className="ct-main">
        <div className="ct-test-intro">
          <h1>Recuperar mi link</h1>
          <p className="ct-instructions">
            Pusiste tu email cuando aplicaste — úsalo aquí para que te mandemos un link nuevo
            a la próxima fase de evaluación.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>
          <label style={{ display: 'block', fontSize: 14, marginBottom: 8, color: '#374151' }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            style={{ width: '100%', padding: '12px 14px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 15 }}
            required
          />
          {error && <p style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{error}</p>}
          <button
            type="submit"
            className="ct-btn-primary"
            disabled={submitting}
            style={{ marginTop: 16, width: '100%' }}
          >
            {submitting ? 'Enviando…' : 'Mandame el link nuevo'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: '#6b7280' }}>
          <Link to="/">Volver al inicio</Link>
        </p>
      </main>
    </div>
  );
}
