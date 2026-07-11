import { useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { config } from '../../config';

type Me = {
  id: string;
  nombre: string;
  email: string;
  phone: string;
  activo: boolean;
  leads_asignados: number;
  leads_confirmados: number;
  leads_cerrados: number;
  comision_acumulada_usd: number;
  onboarded_at: string | null;
};

export default function FreelancePerfil() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [me, setMe] = useState<Me | null>(null);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await getToken();
        const res = await fetch(`${config.apiBase}/api/freelance/me`, { headers: { 'X-Clerk-Token': token ?? '' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Me;
        if (cancelled) return;
        setMe(data);
        setPhone(data.phone);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
        setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  async function savePhone(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/freelance/me`, {
        method: 'PATCH',
        headers: { 'X-Clerk-Token': token ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      }
      const updated = (await res.json()) as Me;
      setMe(updated);
      setSuccess('Teléfono actualizado');
      setSaving(false);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  if (loading) return <div style={{ color: '#6b7280' }}>Cargando perfil...</div>;
  if (!me) return <div style={{ color: '#dc2626' }}>Error: {error}</div>;

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 24, color: '#111827' }}>
        Mi perfil
      </h1>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        {user?.imageUrl && (
          <img src={user.imageUrl} alt="" style={{ width: 72, height: 72, borderRadius: '50%' }} />
        )}
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#111827' }}>{me.nombre}</div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>{me.email}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            {me.onboarded_at ? `Onboarded ${new Date(me.onboarded_at).toLocaleDateString()}` : ''}
          </div>
        </div>
      </div>

      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, marginBottom: 14, color: '#111827' }}>Estadísticas</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <Stat label="Leads asignados" value={me.leads_asignados} />
          <Stat label="Confirmados" value={me.leads_confirmados} />
          <Stat label="Cerrados" value={me.leads_cerrados} />
          <Stat label="Comisión total" value={`$${Math.round(me.comision_acumulada_usd)}`} highlight />
        </div>
      </div>

      <form onSubmit={savePhone} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#111827' }}>Editar teléfono</h2>
        <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
          Nombre y email los edita el admin. Vos podés actualizar solo el teléfono donde te llegan las notificaciones.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Teléfono (formato E.164, ej: +50761234567)</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            style={{
              padding: '10px 12px',
              background: '#fff',
              color: '#111827',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              fontSize: 14,
              fontFamily: 'inherit',
            }}
          />
        </label>
        {error && <div style={{ color: '#7f1d1d', background: '#fee2e2', padding: 10, borderRadius: 6, fontSize: 13 }}>{error}</div>}
        {success && <div style={{ color: '#065f46', background: '#d1fae5', padding: 10, borderRadius: 6, fontSize: 13 }}>{success}</div>}
        <button
          type="submit"
          disabled={saving || phone === me.phone}
          style={{
            background: phone === me.phone ? '#e5e7eb' : '#111827',
            color: phone === me.phone ? '#9ca3af' : '#fff',
            border: 'none',
            padding: '10px 22px',
            borderRadius: 6,
            fontWeight: 600,
            cursor: saving ? 'wait' : phone === me.phone ? 'not-allowed' : 'pointer',
            fontSize: 13,
            alignSelf: 'flex-start',
          }}
        >
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
      </form>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '12px 14px',
      }}
    >
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.2, color: '#6b7280', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: highlight ? '#059669' : '#111827' }}>{value}</div>
    </div>
  );
}
