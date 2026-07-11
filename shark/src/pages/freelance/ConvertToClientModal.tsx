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

export default function ConvertToClientModal({
  lead,
  onClose,
  onConverted,
}: {
  lead: Lead;
  onClose: () => void;
  onConverted: () => void;
}) {
  const { getToken } = useAuth();
  const [empresa, setEmpresa] = useState(lead.company ?? '');
  const [contactoNombre, setContactoNombre] = useState(lead.contact_name ?? '');
  const [contactoEmail, setContactoEmail] = useState(lead.email);
  const [contactoPhone, setContactoPhone] = useState(lead.whatsapp ?? '');
  const [salario, setSalario] = useState('');
  const [closingDate, setClosingDate] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const salarioNum = Number(salario);
  const montoDeal = Number.isFinite(salarioNum) && salarioNum > 0 ? salarioNum * 1.2 : 0;
  const comision = Number.isFinite(salarioNum) && salarioNum > 0 ? salarioNum * 0.10 : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/freelance/me/leads/${lead.id}/convert`, {
        method: 'POST',
        headers: { 'X-Clerk-Token': token ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empresa_nombre: empresa.trim(),
          contacto_nombre: contactoNombre.trim(),
          contacto_email: contactoEmail.trim(),
          contacto_phone: contactoPhone.trim() || undefined,
          salario_mensual_usd: salarioNum,
          closing_date_est: closingDate || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      }
      const result = (await res.json()) as { zoho_sync_status: string; zoho_sync_error: string | null };
      if (result.zoho_sync_status === 'failed') {
        alert(`Cliente creado localmente pero Zoho falló:\n${result.zoho_sync_error}\n\nEl cliente igual queda registrado en SharkTalents. Contactá al admin para reintentar la sincronización.`);
      }
      onConverted();
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
          width: 560,
          maxWidth: '95vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          color: '#111827',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: 0, marginBottom: 6, fontSize: 20, fontWeight: 700, color: '#111827' }}>
          👤 Convertir a cliente
        </h2>
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 18, lineHeight: 1.5 }}>
          Este paso crea el <strong>Trato en Zoho CRM</strong> con la empresa, el contacto y el monto.
          A partir de acá el flujo es formal: propuesta → contrato → firma → cobro.
        </p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Empresa" value={empresa} onChange={setEmpresa} required />
          <Row>
            <Field label="Nombre contacto" value={contactoNombre} onChange={setContactoNombre} required />
            <Field label="Email contacto" value={contactoEmail} onChange={setContactoEmail} type="email" required />
          </Row>
          <Field label="Teléfono contacto" value={contactoPhone} onChange={setContactoPhone} required />

          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, background: '#f9fafb' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#111827' }}>
              💵 Monto del deal
            </div>
            <Field
              label="Salario mensual del puesto que buscan (USD)"
              value={salario}
              onChange={setSalario}
              type="number"
              required
            />
            {salarioNum > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#4b5563', lineHeight: 1.6 }}>
                Monto del trato (salario × 1.2): <strong>${montoDeal.toFixed(2)}</strong><br />
                Tu comisión (10% del salario): <strong style={{ color: '#059669' }}>${comision.toFixed(2)}</strong>
              </div>
            )}
          </div>

          <Field
            label="Fecha estimada de cierre (opcional)"
            value={closingDate}
            onChange={setClosingDate}
            type="date"
            placeholder="30 días a partir de hoy"
          />

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Notas (opcional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              style={{
                padding: '8px 10px',
                background: '#fff',
                color: '#111827',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                fontSize: 13,
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />
          </label>

          {error && (
            <div style={{ color: '#7f1d1d', background: '#fee2e2', padding: 10, borderRadius: 6, fontSize: 13 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
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
                background: '#4f46e5',
                color: '#fff',
                border: 'none',
                padding: '10px 22px',
                borderRadius: 6,
                fontWeight: 600,
                cursor: submitting ? 'wait' : 'pointer',
                fontSize: 13,
              }}
            >
              {submitting ? 'Creando cliente...' : '👤 Convertir a cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>{children}</div>;
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
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
