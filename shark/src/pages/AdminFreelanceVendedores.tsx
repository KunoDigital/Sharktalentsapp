import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { config } from '../config';

type FreelanceUser = {
  id: string;
  clerk_user_id: string;
  nombre: string;
  email: string;
  phone: string;
  activo: boolean;
  leads_asignados: number;
  leads_confirmados: number;
  leads_cerrados: number;
  comision_acumulada_usd: number;
  onboarded_at: string | null;
  notes_internal: string | null;
  created_at: string;
  updated_at: string;
};

export default function AdminFreelanceVendedores() {
  const { getToken } = useAuth();
  const [users, setUsers] = useState<FreelanceUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const token = await getToken();
        const res = await fetch(`${config.apiBase}/api/tenant/freelance-users`, {
          headers: { 'X-Clerk-Token': token ?? '' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { count: number; freelance_users: FreelanceUser[] };
        if (cancelled) return;
        setUsers(data.freelance_users);
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
  }, [getToken, refreshTick]);

  async function toggleActivo(user: FreelanceUser) {
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/tenant/freelance-users/${user.id}`, {
        method: 'PATCH',
        headers: { 'X-Clerk-Token': token ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: !user.activo }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRefreshTick((n) => n + 1);
    } catch (err) {
      alert(`Error al cambiar estado: ${(err as Error).message}`);
    }
  }

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Vendedores freelance</h1>
          <p style={{ margin: '4px 0 0', color: '#8a93a3', fontSize: 13 }}>
            Gestionar usuarios con rol `freelance` que reciben leads asignados.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            background: '#dafd6f',
            color: '#0e1218',
            border: 'none',
            padding: '10px 18px',
            borderRadius: 6,
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          + Nuevo vendedor
        </button>
      </div>

      {loading && <div style={{ color: '#8a93a3' }}>Cargando...</div>}

      {error && (
        <div
          style={{
            background: '#7f1d1d',
            color: '#fecaca',
            padding: 14,
            borderRadius: 6,
            marginBottom: 16,
          }}
        >
          Error: {error}
        </div>
      )}

      {!loading && !error && users.length === 0 && (
        <div
          style={{
            padding: 40,
            border: '1px dashed #374151',
            borderRadius: 8,
            textAlign: 'center',
            color: '#8a93a3',
          }}
        >
          Todavía no hay vendedores creados. Click en "Nuevo vendedor" para el primero.
        </div>
      )}

      {!loading && !error && users.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #374151', color: '#8a93a3', textAlign: 'left' }}>
              <th style={{ padding: '10px 8px' }}>Nombre</th>
              <th style={{ padding: '10px 8px' }}>Email</th>
              <th style={{ padding: '10px 8px' }}>Phone</th>
              <th style={{ padding: '10px 8px', textAlign: 'center' }}>Estado</th>
              <th style={{ padding: '10px 8px', textAlign: 'right' }}>Asignados</th>
              <th style={{ padding: '10px 8px', textAlign: 'right' }}>Cerrados</th>
              <th style={{ padding: '10px 8px', textAlign: 'right' }}>Comisión</th>
              <th style={{ padding: '10px 8px' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: '1px solid #1f2937' }}>
                <td style={{ padding: '10px 8px' }}>{u.nombre}</td>
                <td style={{ padding: '10px 8px', color: '#8a93a3' }}>{u.email}</td>
                <td style={{ padding: '10px 8px', color: '#8a93a3' }}>{u.phone}</td>
                <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '3px 10px',
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 700,
                      background: u.activo ? '#065f46' : '#374151',
                      color: u.activo ? '#a7f3d0' : '#9ca3af',
                    }}
                  >
                    {u.activo ? 'Activo' : 'Pausado'}
                  </span>
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'right' }}>{u.leads_asignados}</td>
                <td style={{ padding: '10px 8px', textAlign: 'right' }}>{u.leads_cerrados}</td>
                <td style={{ padding: '10px 8px', textAlign: 'right' }}>${Math.round(u.comision_acumulada_usd)}</td>
                <td style={{ padding: '10px 8px' }}>
                  <button
                    onClick={() => toggleActivo(u)}
                    style={{
                      background: 'transparent',
                      color: '#dafd6f',
                      border: '1px solid #374151',
                      padding: '4px 10px',
                      borderRadius: 4,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {u.activo ? 'Pausar' : 'Reactivar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            setRefreshTick((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { getToken } = useAuth();
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [clerkUserId, setClerkUserId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/tenant/freelance-users`, {
        method: 'POST',
        headers: { 'X-Clerk-Token': token ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clerk_user_id: clerkUserId.trim(),
          nombre: nombre.trim(),
          email: email.trim(),
          phone: phone.trim(),
          notes_internal: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      onCreated();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0e1218',
          border: '1px solid #374151',
          borderRadius: 8,
          padding: 24,
          width: 480,
          maxWidth: '90vw',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: 0, marginBottom: 16, fontSize: 18 }}>Crear vendedor freelance</h2>
        <p style={{ fontSize: 12, color: '#8a93a3', marginBottom: 20, lineHeight: 1.5 }}>
          Antes: invitá al vendedor por Clerk (Settings → Equipo) y setealé el rol{' '}
          <code style={{ background: '#1f2937', padding: '2px 6px', borderRadius: 3 }}>freelance</code> en
          publicMetadata. Después completá su ficha acá.
        </p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Nombre completo" value={nombre} onChange={setNombre} required />
          <Field label="Email" value={email} onChange={setEmail} type="email" required />
          <Field label="Phone (E.164, ej: +50761112233)" value={phone} onChange={setPhone} required />
          <Field label="Clerk User ID (comienza con user_...)" value={clerkUserId} onChange={setClerkUserId} required />
          <Field label="Notas internas (opcional)" value={notes} onChange={setNotes} textarea />

          {error && <div style={{ color: '#fca5a5', fontSize: 13 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                background: 'transparent',
                color: '#8a93a3',
                border: '1px solid #374151',
                padding: '8px 16px',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                background: '#dafd6f',
                color: '#0e1218',
                border: 'none',
                padding: '8px 20px',
                borderRadius: 6,
                fontWeight: 700,
                cursor: submitting ? 'wait' : 'pointer',
              }}
            >
              {submitting ? 'Creando...' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  textarea = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  textarea?: boolean;
}) {
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    background: '#1f2937',
    color: '#f9fafb',
    border: '1px solid #374151',
    borderRadius: 4,
    fontSize: 13,
    fontFamily: 'inherit',
  };
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: '#8a93a3' }}>{label}</span>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          style={inputStyle}
        />
      )}
    </label>
  );
}
