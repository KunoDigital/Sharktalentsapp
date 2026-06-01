import { useState } from 'react';
import { useApi } from '../lib/api';
import { config } from '../config';

type Props = {
  onScheduled?: (bookingId: string, meetingUrl?: string) => void;
  defaultClientEmail?: string;
  defaultClientName?: string;
  defaultClientCompany?: string;
};

/**
 * Form para agendar un briefing inicial con cliente nuevo.
 *
 * Llama POST /api/briefings/schedule → backend crea booking en Zoho Bookings
 * → cliente recibe email con invite + link de meeting con Zia activado.
 *
 * Si Zoho Bookings no está configurado, devuelve 503 con mensaje claro.
 */
export default function BriefingForm({ onScheduled, defaultClientEmail, defaultClientName, defaultClientCompany }: Props) {
  const api = useApi();
  const [email, setEmail] = useState(defaultClientEmail ?? '');
  const [name, setName] = useState(defaultClientName ?? '');
  const [company, setCompany] = useState(defaultClientCompany ?? '');
  const [phone, setPhone] = useState('');
  const [startTime, setStartTime] = useState('');
  const [duration, setDuration] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ bookingId: string; meetingUrl?: string } | null>(null);

  // Default start_time: mañana 10:00 AM local
  function tomorrowMorning(): string {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    t.setHours(10, 0, 0, 0);
    return t.toISOString().slice(0, 16);  // datetime-local format
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!config.useApi) {
      setError('Backend no configurado (config.useApi=false)');
      return;
    }

    setSubmitting(true);
    try {
      const isoTime = new Date(startTime || tomorrowMorning()).toISOString();
      const r = await api.briefings.schedule({
        client_email: email,
        client_name: name,
        client_company: company || undefined,
        client_phone: phone || undefined,
        start_time: isoTime,
        duration_minutes: duration,
      });
      setSuccess({ bookingId: r.booking_id, meetingUrl: r.meeting_url });
      if (onScheduled) onScheduled(r.booking_id, r.meeting_url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div style={{ padding: '1rem', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px' }}>
        <div style={{ fontWeight: 700, marginBottom: '0.4rem', color: 'var(--st-ok, #22c55e)' }}>
          ✓ Briefing agendado
        </div>
        <div className="muted small" style={{ marginBottom: '0.4rem' }}>
          Booking ID: <code>{success.bookingId}</code>
        </div>
        {success.meetingUrl && (
          <a href={success.meetingUrl} target="_blank" rel="noreferrer" className="btn-toolbar">
            Ir al meeting
          </a>
        )}
        <p className="muted small" style={{ marginTop: '0.6rem' }}>
          El cliente recibió el invite por email. Cuando termine la reunión, el transcript de Zia llegará automático y arma el briefing IA.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <label style={{ fontSize: '0.85rem' }}>
          Email cliente *
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="cliente@empresa.com"
            style={{ width: '100%' }}
          />
        </label>
        <label style={{ fontSize: '0.85rem' }}>
          Nombre cliente *
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Roberto Castillo"
            style={{ width: '100%' }}
          />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <label style={{ fontSize: '0.85rem' }}>
          Empresa
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="AcmeTech"
            style={{ width: '100%' }}
          />
        </label>
        <label style={{ fontSize: '0.85rem' }}>
          Teléfono (opcional)
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+50760001234"
            style={{ width: '100%' }}
          />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.5rem' }}>
        <label style={{ fontSize: '0.85rem' }}>
          Fecha y hora *
          <input
            type="datetime-local"
            required
            value={startTime || tomorrowMorning()}
            onChange={(e) => setStartTime(e.target.value)}
            min={new Date().toISOString().slice(0, 16)}
            style={{ width: '100%' }}
          />
        </label>
        <label style={{ fontSize: '0.85rem' }}>
          Duración
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={{ width: '100%' }}>
            <option value="15">15 min</option>
            <option value="30">30 min</option>
            <option value="45">45 min</option>
            <option value="60">1 hora</option>
            <option value="90">1h 30min</option>
          </select>
        </label>
      </div>

      {error && (
        <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.25)', borderRadius: '6px', fontSize: '0.85rem' }}>
          ⚠️ {error}
        </div>
      )}

      <button type="submit" className="btn-primary" disabled={submitting}>
        {submitting ? 'Agendando...' : 'Agendar briefing'}
      </button>

      <p className="muted small">
        Se manda invite al cliente con link a meeting + Zia activado. El transcript llega automático al terminar.
      </p>
    </form>
  );
}
