import { useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { config } from '../../config';

type MePayload = {
  id: string;
  nombre: string;
  email: string;
  phone: string;
  activo: boolean;
  leads_asignados: number;
  leads_confirmados: number;
  leads_cerrados: number;
  comision_acumulada_usd: number;
};

/**
 * Home del CRM Freelance. Fase 1: solo bienvenida + verificación de que el
 * backend reconoce al vendedor. En fases posteriores se agrega dashboard con
 * leads del día, stats del mes, etc.
 */
export default function FreelanceHome() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [me, setMe] = useState<MePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await getToken();
        if (!token) throw new Error('Sin sesión');
        const res = await fetch(`${config.apiBase}/api/freelance/me`, {
          headers: { 'X-Clerk-Token': token },
        });
        if (cancelled) return;
        if (res.status === 404) {
          setError('Tu cuenta de vendedor aún no está configurada. Contactá al admin para completar tu alta.');
          setLoading(false);
          return;
        }
        if (res.status === 403) {
          setError('Tu cuenta está pausada. Contactá al admin.');
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as MePayload;
        setMe(data);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const primerNombre = (user?.firstName ?? user?.fullName ?? 'Vendedor').split(' ')[0];

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginTop: 0, marginBottom: 8, color: '#111827' }}>
        Hola {primerNombre}
      </h1>
      <p style={{ color: '#6b7280', marginBottom: 32 }}>
        Bienvenido a tu CRM. Desde acá vas a gestionar los leads que te asignemos.
      </p>

      {loading && <div style={{ color: '#6b7280' }}>Cargando tu perfil...</div>}

      {error && (
        <div
          style={{
            background: '#fef3c7',
            border: '1px solid #f59e0b',
            borderLeft: '4px solid #d97706',
            padding: 16,
            borderRadius: 6,
            color: '#78350f',
            fontSize: 14,
          }}
        >
          <strong>Atención:</strong> {error}
        </div>
      )}

      {me && (
        <>
          <div style={styles.grid}>
            <Stat label="Leads asignados" value={me.leads_asignados} tone="neutral" />
            <Stat label="Confirmados" value={me.leads_confirmados} tone="info" />
            <Stat label="Cerrados" value={me.leads_cerrados} tone="good" />
            <Stat
              label="Comisión acumulada"
              value={`$${Math.round(me.comision_acumulada_usd)}`}
              tone="primary"
            />
          </div>

          <div style={styles.emptyCard}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>👋</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, marginBottom: 8, color: '#111827' }}>
              Aún no hay leads asignados
            </h2>
            <p style={{ color: '#6b7280', margin: 0, fontSize: 14, maxWidth: 480 }}>
              Cuando entren leads calificados, te van a llegar por WhatsApp y aparecerán acá listos para
              contactar.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: 'neutral' | 'info' | 'good' | 'primary';
}) {
  const toneStyles: Record<string, React.CSSProperties> = {
    neutral: { background: '#f9fafb', borderColor: '#e5e7eb', color: '#111827' },
    info: { background: '#eff6ff', borderColor: '#bfdbfe', color: '#1e40af' },
    good: { background: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534' },
    primary: { background: '#111827', borderColor: '#111827', color: '#ffffff' },
  };
  return (
    <div
      style={{
        border: '1px solid',
        borderRadius: 12,
        padding: '16px 20px',
        ...toneStyles[tone],
      }}
    >
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.5, opacity: 0.75, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 16,
    marginBottom: 40,
  } as React.CSSProperties,
  emptyCard: {
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '48px 24px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  } as React.CSSProperties,
};
