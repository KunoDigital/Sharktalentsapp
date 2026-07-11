import { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { config } from '../../config';

type Lead = {
  id: string;
  email: string;
  contact_name: string | null;
  company: string | null;
  whatsapp: string | null;
};

/**
 * Modal para completar/corregir datos del lead que Meta no trae o que el vendedor
 * descubre al primer contacto (empresa, cargo real, dolor específico, etc).
 */
export default function EditLeadModal({
  lead,
  onClose,
  onSaved,
}: {
  lead: Lead & { dolor?: string | null; puesto?: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { getToken } = useAuth();
  const [contactName, setContactName] = useState(lead.contact_name ?? '');
  const [company, setCompany] = useState(lead.company ?? '');
  const [whatsapp, setWhatsapp] = useState(lead.whatsapp ?? '');
  const [puesto, setPuesto] = useState(lead.puesto ?? '');
  const [dolor, setDolor] = useState(lead.dolor ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/freelance/me/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'X-Clerk-Token': token ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_name: contactName.trim(),
          company: company.trim(),
          whatsapp: whatsapp.trim(),
          puesto: puesto.trim(),
          dolor: dolor.trim(),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      }
      onSaved();
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
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 10,
          padding: 24,
          width: 480,
          maxWidth: '95vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          color: '#111827',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: 0, marginBottom: 6, fontSize: 18, fontWeight: 700, color: '#111827' }}>
          ✏️ Editar lead
        </h2>
        <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 18, lineHeight: 1.5 }}>
          Completá los datos que Meta no trae (empresa, cargo específico) o corregí lo que descubriste al hablarle al lead.
          El email no se puede editar acá.
        </p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Nombre de contacto" value={contactName} onChange={setContactName} />
          <Field label="Empresa" value={company} onChange={setCompany} placeholder="Nombre comercial de la empresa" />
          <Field label="WhatsApp" value={whatsapp} onChange={setWhatsapp} placeholder="+50761234567" />
          <Field label="Cargo que busca reclutar" value={puesto} onChange={setPuesto} placeholder="Ej: Vendedor senior" />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>
              Dolor / contexto del cliente
            </span>
            <span style={{ fontSize: 11, color: '#9ca3af', marginTop: -2 }}>
              ¿Qué le está pasando? ¿Qué contó en la primera llamada?
            </span>
            <textarea
              value={dolor}
              onChange={(e) => setDolor(e.target.value)}
              rows={3}
              placeholder="Ej: rotación muy alta en ventas, ya lo intentó con 2 agencias y le fallaron"
              style={{
                padding: '8px 10px',
                background: '#fff',
                color: '#111827',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                fontSize: 13,
                fontFamily: 'inherit',
                resize: 'vertical',
                marginTop: 2,
              }}
            />
          </label>

          <div style={{ background: '#f3f4f6', padding: 10, borderRadius: 6, fontSize: 11, color: '#6b7280' }}>
            <strong>Email del lead:</strong> {lead.email}
            <br />
            <span style={{ fontSize: 10 }}>No editable — es la identidad del lead en el sistema.</span>
          </div>

          {error && (
            <div style={{ color: '#7f1d1d', background: '#fee2e2', padding: 10, borderRadius: 6, fontSize: 13 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                background: 'transparent',
                color: '#4b5563',
                border: '1px solid #d1d5db',
                padding: '10px 18px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                background: '#111827',
                color: '#fff',
                border: 'none',
                padding: '10px 22px',
                borderRadius: 6,
                fontWeight: 600,
                cursor: submitting ? 'wait' : 'pointer',
                fontSize: 13,
              }}
            >
              {submitting ? 'Guardando...' : 'Guardar'}
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
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: '8px 10px',
          background: '#fff',
          color: '#111827',
          border: '1px solid #d1d5db',
          borderRadius: 6,
          fontSize: 13,
          fontFamily: 'inherit',
        }}
      />
    </label>
  );
}
