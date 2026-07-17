import { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { config } from '../../config';

type Client = {
  id: string;
  empresa_nombre: string;
  contacto_nombre: string;
  salary_target?: string | number | null;
  puesto?: string | null;
};

export type DatosLegalesMode = 'freelance' | 'marketing-to-deal';

/**
 * Modal que aparece antes de mover un cliente a la etapa de contrato.
 *
 * Dos modos:
 *  - 'freelance' (default) → CRM Freelance, endpoint /api/freelance/me/clients/:id/datos-legales.
 *  - 'marketing-to-deal' → Marketing V3, endpoint /api/marketing/lead/:id/convert-to-deal.
 *    Agrega sección "Del deal" con salario + fecha de cierre; el backend hace
 *    la conversión Lead → Account + Contact + Deal en Zoho + Zoho Sign.
 */
export default function DatosLegalesModal({
  client,
  onClose,
  onSaved,
  mode = 'freelance',
}: {
  client: Client;
  onClose: () => void;
  onSaved: () => void;
  mode?: DatosLegalesMode;
}) {
  const { getToken } = useAuth();

  const [razonSocial, setRazonSocial] = useState(client.empresa_nombre ?? '');
  const [rucNit, setRucNit] = useState('');
  const [direccion, setDireccion] = useState('');
  const [ciudad, setCiudad] = useState('');
  const [pais, setPais] = useState('Panamá');

  const [repNombre, setRepNombre] = useState(client.contacto_nombre ?? '');
  const [repCargo, setRepCargo] = useState('');
  const [repCedula, setRepCedula] = useState('');
  const [repEmail, setRepEmail] = useState('');

  const [puestoCargo, setPuestoCargo] = useState(client.puesto ?? '');

  // Campos extra del modo marketing-to-deal
  const initialSalary = client.salary_target ? String(client.salary_target) : '';
  const [salarioUsd, setSalarioUsd] = useState(initialSalary);
  const defaultClosingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [closingDate, setClosingDate] = useState(defaultClosingDate);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const salarioNum = Number(salarioUsd) || 0;
  const feeTotal = salarioNum > 0 ? Math.round(salarioNum * 1.2 * 100) / 100 : 0;
  const feeTracto = feeTotal > 0 ? Math.round((feeTotal / 2) * 100) / 100 : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    if (mode === 'marketing-to-deal') {
      if (!salarioNum || salarioNum <= 0) {
        setError('Salario debe ser mayor a 0');
        setSubmitting(false);
        return;
      }
      if (!closingDate) {
        setError('Fecha de cierre requerida');
        setSubmitting(false);
        return;
      }
    }

    try {
      const token = await getToken();
      const endpoint =
        mode === 'marketing-to-deal'
          ? `${config.apiBase}/api/marketing/lead/${client.id}/convert-to-deal`
          : `${config.apiBase}/api/freelance/me/clients/${client.id}/datos-legales`;
      const method = mode === 'marketing-to-deal' ? 'POST' : 'PATCH';

      const bodyPayload: Record<string, unknown> = {
        empresa_razon_social: razonSocial.trim(),
        empresa_ruc_nit: rucNit.trim(),
        empresa_direccion: direccion.trim(),
        empresa_ciudad: ciudad.trim(),
        empresa_pais: pais.trim(),
        representante_nombre: repNombre.trim(),
        representante_cargo: repCargo.trim(),
        representante_cedula: repCedula.trim(),
        representante_email: repEmail.trim(),
        puesto_cargo: puestoCargo.trim(),
      };
      if (mode === 'marketing-to-deal') {
        bodyPayload.salario_usd = salarioNum;
        bodyPayload.closing_date = closingDate;
      }

      const res = await fetch(endpoint, {
        method,
        headers: { 'X-Clerk-Token': token ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      }
      const result = (await res.json()) as { zoho_sync_status?: string; zoho_sync_errors?: string[] | null; sync_errors?: string[] | null };
      const partialErrors = result.zoho_sync_errors ?? result.sync_errors ?? null;
      if (partialErrors && partialErrors.length > 0) {
        alert(`Datos guardados. Sincronización parcial con errores:\n${partialErrors.join('\n')}`);
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 10, padding: 24, width: 640, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', color: '#111827' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: 0, marginBottom: 4, fontSize: 20, fontWeight: 700 }}>📋 Datos legales para el contrato</h2>
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4, marginBottom: 18, lineHeight: 1.5 }}>
          Completá esto antes de disparar el contrato de Zoho Sign. Los datos se sincronizan a la Cuenta en Zoho CRM (razón social, RUC, dirección) y creamos un Contacto para el representante que va a firmar.
        </p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div style={{ padding: 12, background: '#f7f8fa', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <h3 style={{ margin: 0, marginBottom: 10, fontSize: 13, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 0.5 }}>Empresa</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label="Razón social (nombre legal completo)*" value={razonSocial} onChange={setRazonSocial} required placeholder="Ej: FinTech Panamá S.A." />
              <Field label="RUC / NIT / cédula jurídica*" value={rucNit} onChange={setRucNit} required placeholder="Ej: 155123456-2-2020" />
              <Field label="Dirección legal" value={direccion} onChange={setDireccion} placeholder="Calle 50, Torre XYZ, Piso 12, Oficina 1201" />
              <Row>
                <Field label="Ciudad" value={ciudad} onChange={setCiudad} placeholder="Panamá" />
                <Field label="País" value={pais} onChange={setPais} placeholder="Panamá" />
              </Row>
            </div>
          </div>

          <div style={{ padding: 12, background: '#f7f8fa', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <h3 style={{ margin: 0, marginBottom: 10, fontSize: 13, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 0.5 }}>Representante legal (quien firma)</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label="Nombre completo*" value={repNombre} onChange={setRepNombre} required placeholder="Ej: Ana Rodríguez" />
              <Field label="Cargo*" value={repCargo} onChange={setRepCargo} required placeholder="Ej: Gerente General" />
              <Field label="Cédula/DNI del representante" value={repCedula} onChange={setRepCedula} placeholder="Ej: 8-234-567" />
              <Field label="Email para el contrato Zoho Sign*" value={repEmail} onChange={setRepEmail} type="email" required placeholder="ana@fintech.pa" />
            </div>
          </div>

          <div style={{ padding: 12, background: '#f7f8fa', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <h3 style={{ margin: 0, marginBottom: 10, fontSize: 13, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 0.5 }}>Del puesto</h3>
            <Field label="Cargo a reclutar*" value={puestoCargo} onChange={setPuestoCargo} required placeholder="Ej: Gerente Comercial Senior" />
          </div>

          {mode === 'marketing-to-deal' && (
            <div style={{ padding: 12, background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8 }}>
              <h3 style={{ margin: 0, marginBottom: 10, fontSize: 13, fontWeight: 700, color: '#78350f', textTransform: 'uppercase', letterSpacing: 0.5 }}>Del deal en Zoho</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Field
                  label="Salario mensual del puesto (USD)*"
                  value={salarioUsd}
                  onChange={setSalarioUsd}
                  type="number"
                  required
                  placeholder="Ej: 2500"
                />
                {salarioNum > 0 && (
                  <div style={{ padding: 8, background: '#fff', borderRadius: 5, fontSize: 12, color: '#78350f' }}>
                    <div><strong>Fee total:</strong> USD {feeTotal.toLocaleString()}</div>
                    <div><strong>2 tractos:</strong> USD {feeTracto.toLocaleString()} cada uno (50% + 50%)</div>
                  </div>
                )}
                <Field
                  label="Fecha estimada de cierre*"
                  value={closingDate}
                  onChange={setClosingDate}
                  type="date"
                  required
                />
                <p style={{ fontSize: 11, color: '#78350f', margin: 0, lineHeight: 1.5 }}>
                  Se crea el Deal en Zoho CRM con estos datos y se dispara automáticamente el contrato Zoho Sign al representante legal.
                </p>
              </div>
            </div>
          )}

          <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>
            * Campos obligatorios. La cédula del representante se guarda solo local (para armar el contrato Sign) — no se sincroniza a Zoho.
          </p>

          {error && (
            <div style={{ color: '#7f1d1d', background: '#fee2e2', padding: 10, borderRadius: 6, fontSize: 13 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{ background: 'transparent', color: '#4b5563', border: '1px solid #d1d5db', padding: '10px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{ background: '#4f46e5', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 6, fontWeight: 600, cursor: submitting ? 'wait' : 'pointer', fontSize: 13 }}
            >
              {submitting ? 'Guardando…' : '📋 Guardar datos legales'}
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
        placeholder={placeholder}
        required={required}
        style={{ padding: '8px 10px', background: '#fff', color: '#111827', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }}
      />
    </label>
  );
}
