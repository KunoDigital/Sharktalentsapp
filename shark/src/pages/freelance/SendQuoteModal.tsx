import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { config } from '../../config';

type Lead = {
  id: string;
  email: string;
  contact_name: string | null;
  company: string | null;
  puesto?: string | null;
};

/**
 * Modal para generar y enviar una cotización simple al lead.
 * Sin conexión a Zoho — solo pide el precio del puesto, calcula fee 1.2×, y
 * envía por email con el detalle. Opcional: descargar PDF antes de enviar.
 */
export default function SendQuoteModal({
  lead,
  onClose,
  onSent,
}: {
  lead: Lead;
  onClose: () => void;
  onSent: () => void;
}) {
  const { getToken } = useAuth();
  const [salario, setSalario] = useState('');
  const [mensajeExtra, setMensajeExtra] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const salarioNum = Number(salario);
  const fee = useMemo(() => (Number.isFinite(salarioNum) && salarioNum > 0 ? salarioNum * 1.2 : 0), [salarioNum]);
  const empresa = lead.company?.trim() || '—';
  const puesto = lead.puesto?.trim() || 'Reclutamiento del cargo';
  const nombreCliente = lead.contact_name?.trim() || lead.email.split('@')[0];

  async function downloadPdf() {
    if (fee <= 0) {
      setError('Ingresá primero un salario válido');
      return;
    }
    setError(null);
    setDownloading(true);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      let y = 24;
      doc.setFillColor(17, 24, 39);
      doc.rect(0, 0, 210, 20, 'F');
      doc.setTextColor(218, 253, 111);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('SharkTalents', 15, 13);
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text('Cotización de reclutamiento', 15, 17);
      doc.setTextColor(17, 24, 39);
      y = 35;
      doc.setFontSize(11);
      doc.text(`Cliente: ${nombreCliente}`, 15, y);
      y += 6;
      doc.text(`Empresa: ${empresa}`, 15, y);
      y += 6;
      doc.text(`Fecha: ${new Date().toLocaleDateString('es-PA')}`, 15, y);
      y += 12;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setFillColor(249, 250, 251);
      doc.rect(15, y - 4, 180, 8, 'F');
      doc.text('CONCEPTO', 18, y);
      doc.text('PRECIO (USD)', 178, y, { align: 'right' });
      y += 8;
      doc.setFont('helvetica', 'normal');
      doc.text(`Reclutamiento cargo: ${puesto}`, 18, y);
      y += 5;
      doc.setFontSize(8);
      doc.setTextColor(107, 114, 128);
      const desc = 'Proceso completo: filtro, evaluación DISC + integridad + técnica, entrevistas, shortlist final.';
      const descLines = doc.splitTextToSize(desc, 130);
      doc.text(descLines, 18, y);
      y += descLines.length * 4;
      doc.setTextColor(17, 24, 39);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(`$${fee.toFixed(2)}`, 195, y - descLines.length * 4 - 5, { align: 'right' });
      y += 8;
      doc.setDrawColor(17, 24, 39);
      doc.setLineWidth(0.5);
      doc.line(15, y, 195, y);
      y += 8;
      doc.setFontSize(14);
      doc.text('TOTAL:', 130, y);
      doc.text(`$${fee.toFixed(2)}`, 195, y, { align: 'right' });
      y += 14;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(75, 85, 99);
      doc.text('Vigencia: 30 días desde la fecha de envío.', 15, y);
      y += 5;
      doc.text('Forma de pago: 50% al firmar contrato, 50% al entregar shortlist final.', 15, y);
      y += 5;
      doc.text('Garantía: Reemplazo del candidato sin costo dentro de los primeros 60 días.', 15, y);
      if (mensajeExtra.trim()) {
        y += 10;
        doc.setFontSize(10);
        doc.setTextColor(17, 24, 39);
        doc.setFont('helvetica', 'bold');
        doc.text('Nota:', 15, y);
        y += 5;
        doc.setFont('helvetica', 'normal');
        const extra = doc.splitTextToSize(mensajeExtra.trim(), 175);
        doc.text(extra, 15, y);
      }
      doc.save(`cotizacion-sharktalents-${empresa.replace(/\s+/g, '-')}.pdf`);
    } catch (err) {
      setError(`Error generando PDF: ${(err as Error).message}`);
    } finally {
      setDownloading(false);
    }
  }

  async function sendByEmail(e: React.FormEvent) {
    e.preventDefault();
    if (fee <= 0) {
      setError('Ingresá primero un salario válido');
      return;
    }
    if (!window.confirm(`Enviar cotización por email a ${lead.email}?\n\nTotal: $${fee.toFixed(2)}`)) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/freelance/me/leads/${lead.id}/send-quote`, {
        method: 'POST',
        headers: { 'X-Clerk-Token': token ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ salario_mensual_usd: salarioNum, mensaje_extra: mensajeExtra.trim() || undefined }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      }
      const result = (await res.json()) as { ok: boolean; message: string };
      alert(result.message);
      onSent();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#ffffff', borderRadius: 10, padding: 24, width: 560, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', color: '#111827' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: 0, marginBottom: 6, fontSize: 20, fontWeight: 700 }}>💰 Enviar cotización</h2>
        <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 18, lineHeight: 1.5 }}>
          Al enviar, el lead pasa automáticamente a "Cotización enviada". La cotización NO se registra en Zoho (es solo un presupuesto para el cliente).
        </p>

        <form onSubmit={sendByEmail} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Row label="Cliente" value={nombreCliente} />
          <Row label="Empresa" value={empresa} />
          <Row label="Cargo a reclutar" value={puesto} />

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Precio del puesto (salario mensual USD)</span>
            <input
              type="number"
              value={salario}
              onChange={(e) => setSalario(e.target.value)}
              required
              min={100}
              placeholder="Ej: 2000"
              autoFocus
              style={{
                padding: '10px 12px',
                background: '#fff',
                color: '#111827',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                fontSize: 15,
                fontFamily: 'inherit',
              }}
            />
          </label>

          {fee > 0 && (
            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#6b7280', marginBottom: 8 }}>
                Preview
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, borderBottom: '1px dashed #e5e7eb' }}>
                <span>Reclutamiento cargo: {puesto}</span>
                <strong>${fee.toFixed(2)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', fontSize: 15, fontWeight: 700 }}>
                <span>TOTAL</span>
                <span>${fee.toFixed(2)}</span>
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8 }}>
                (Fee SharkTalents = 1.2 × salario del puesto)
              </div>
            </div>
          )}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Nota extra al cliente (opcional)</span>
            <textarea
              value={mensajeExtra}
              onChange={(e) => setMensajeExtra(e.target.value)}
              rows={2}
              placeholder="Ej: Podemos empezar el proceso la próxima semana si aprobás esta cotización."
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

          <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 6 }}>
            <button
              type="button"
              onClick={downloadPdf}
              disabled={downloading || fee <= 0}
              style={{
                background: 'transparent',
                color: '#111827',
                border: '1px solid #d1d5db',
                padding: '10px 16px',
                borderRadius: 6,
                cursor: fee <= 0 ? 'not-allowed' : 'pointer',
                fontSize: 13,
                opacity: fee <= 0 ? 0.5 : 1,
              }}
            >
              {downloading ? 'Generando...' : '⬇️ Descargar PDF'}
            </button>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                style={{
                  background: 'transparent',
                  color: '#4b5563',
                  border: '1px solid #d1d5db',
                  padding: '10px 16px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting || fee <= 0}
                style={{
                  background: fee > 0 ? '#059669' : '#e5e7eb',
                  color: fee > 0 ? '#fff' : '#9ca3af',
                  border: 'none',
                  padding: '10px 22px',
                  borderRadius: 6,
                  fontWeight: 700,
                  cursor: submitting ? 'wait' : fee > 0 ? 'pointer' : 'not-allowed',
                  fontSize: 13,
                }}
              >
                {submitting ? 'Enviando...' : '📧 Enviar por email'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0' }}>
      <span style={{ color: '#6b7280' }}>{label}:</span>
      <strong style={{ color: '#111827' }}>{value}</strong>
    </div>
  );
}
