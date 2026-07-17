import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { config } from '../config';
import { useApi } from '../lib/api';
import DatosLegalesModal from './freelance/DatosLegalesModal';

type JourneyType = 'finalista' | 'demo' | 'frio';

type V3Stage = 'nuevo_asignado' | 'contactado' | 'en_conversacion' | 'reunion' | 'contrato_pago' | 'perdido';

type Venta = {
  id: string;
  email: string;
  contact_name: string | null;
  company: string | null;
  whatsapp: string | null;
  puesto: string | null;
  journey_type: JourneyType;
  v3_stage: V3Stage | 'candidato_en_pruebas' | 'esperando_reunion' | 'esperando_reporte' | 'reporte_enviado';
  vendor_id: string | null;
  vendor_name: string | null;
  salary_target: string | null;
  urgency: string | null;
  score_quality: number | null;
  demo_report_url: string | null;
  has_fit_report?: boolean;
  created_at: string | null;
};

type Stats = {
  total: number;
  nuevo_asignado: number;
  contactado: number;
  en_conversacion: number;
  reunion: number;
  contrato_pago: number;
  perdido: number;
  por_journey: { finalista: number; demo: number; frio: number };
};

const STAGES: Array<{ key: V3Stage; label: string; color: string; description: string }> = [
  {
    key: 'nuevo_asignado',
    label: 'Nuevo asignado',
    color: '#94a3b8',
    description: 'Asignado a vendedor por round-robin, aún sin contactar',
  },
  {
    key: 'contactado',
    label: 'Contactado',
    color: '#0891b2',
    description: 'Vendedor llamó o mensajeó, cliente aún no responde',
  },
  {
    key: 'en_conversacion',
    label: 'En conversación',
    color: '#2563eb',
    description: 'Cliente respondió, hay diálogo activo con el vendedor',
  },
  {
    key: 'reunion',
    label: 'Reunión',
    color: '#d97706',
    description: 'Reunión agendada o ya hecha',
  },
  {
    key: 'contrato_pago',
    label: 'Contrato + pago',
    color: '#4f46e5',
    description: 'Contrato + link de pago enviados por Zoho Sign. Al pagar, sale del kanban.',
  },
];

const JOURNEY_META: Record<JourneyType, { label: string; bg: string; fg: string }> = {
  finalista: { label: 'Finalista', bg: '#f5f3ff', fg: '#7c3aed' },
  demo: { label: 'Demo', bg: '#eff6ff', fg: '#2563eb' },
  frio: { label: 'Frío', bg: '#f3f4f6', fg: '#6b7280' },
};

export default function MarketingVentas() {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const api = useApi();
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [journeyFilter, setJourneyFilter] = useState<'all' | JourneyType>('all');
  const [vendorFilter, setVendorFilter] = useState<string>('all');
  const [dragOverStage, setDragOverStage] = useState<V3Stage | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [convertLead, setConvertLead] = useState<Venta | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [editVenta, setEditVenta] = useState<Venta | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (journeyFilter !== 'all') params.set('journey', journeyFilter);
      if (vendorFilter !== 'all') params.set('vendor', vendorFilter);
      const url = `${config.apiBase}/api/marketing/ventas${params.toString() ? '?' + params.toString() : ''}`;
      const token = await getToken();
      const res = await fetch(url, { headers: { 'X-Clerk-Token': token ?? '' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { ventas: Venta[]; stats: Stats };
      setVentas(data.ventas ?? []);
      setStats(data.stats ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [getToken, journeyFilter, vendorFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  function ventasInStage(stage: V3Stage): Venta[] {
    return ventas.filter((v) => v.v3_stage === stage);
  }

  async function handleSendDemo(venta: Venta) {
    if (!confirm(`¿Enviar demo (DISC + integridad) al email ${venta.email}?`)) return;
    setBusyIds((s) => new Set(s).add(venta.id));
    try {
      const r = await api.marketing.sendDemoFromAdmin(venta.id, {
        member_to_evaluate: {
          full_name: venta.contact_name ?? venta.company ?? venta.email,
          email: venta.email.trim().toLowerCase(),
          role: 'Cliente',
          consent_obtained: true,
        },
      });
      alert(r.message ?? `Demo enviada a ${venta.email}`);
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(venta.id); return n; });
    }
  }

  async function saveEdit(venta: Venta, patch: { contact_name?: string; company?: string; whatsapp?: string }) {
    setBusyIds((s) => new Set(s).add(venta.id));
    try {
      await api.marketing.patchLead(venta.id, patch);
      setVentas((list) => list.map((v) => (v.id === venta.id ? { ...v, ...patch } : v)));
      setEditVenta(null);
    } catch (err) {
      alert(`Error guardando: ${(err as Error).message}`);
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(venta.id); return n; });
    }
  }

  async function moveVenta(venta: Venta, target: V3Stage) {
    if (venta.v3_stage === target) return;

    // Contrato + pago: no se mueve directamente, abre modal para conversión Zoho
    if (target === 'contrato_pago') {
      setConvertLead(venta);
      return;
    }

    // Otras columnas: PATCH directo
    const prev = venta.v3_stage;
    setVentas((list) => list.map((v) => (v.id === venta.id ? { ...v, v3_stage: target } : v)));
    setBusyIds((s) => new Set(s).add(venta.id));
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/marketing/lead/${venta.id}/v3-stage`, {
        method: 'PATCH',
        headers: { 'X-Clerk-Token': token ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ v3_stage: target }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setVentas((list) => list.map((v) => (v.id === venta.id ? { ...v, v3_stage: prev } : v)));
      setMoveError(`No se pudo mover: ${(err as Error).message}`);
      setTimeout(() => setMoveError(null), 5000);
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(venta.id); return n; });
    }
  }

  const perdidas = ventasInStage('perdido');
  const uniqueVendors = Array.from(new Set(ventas.map((v) => v.vendor_id).filter(Boolean))) as string[];
  const vendorNameById = new Map(ventas.filter((v) => v.vendor_id && v.vendor_name).map((v) => [v.vendor_id!, v.vendor_name!]));

  return (
    <div style={{ padding: '24px 32px', background: '#f7f8fa', minHeight: '100vh', color: '#111827' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>Marketing → Ventas</h1>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
            Leads asignados a vendedores. Cierre con contrato + link de pago. Al pagar, sale del kanban y aparece como cliente activo.
          </p>
        </div>
        <button
          onClick={() => void load()}
          style={{ background: '#fff', border: '1px solid #d1d5db', padding: '8px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: '#111827' }}
        >
          ↻ Refrescar
        </button>
      </div>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 14 }}>
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Nuevo asignado" value={stats.nuevo_asignado} color="#94a3b8" />
          <StatCard label="Contactado" value={stats.contactado} color="#0891b2" />
          <StatCard label="En conversación" value={stats.en_conversacion} color="#2563eb" />
          <StatCard label="Reunión" value={stats.reunion} color="#d97706" />
          <StatCard label="Contrato + pago" value={stats.contrato_pago} color="#4f46e5" />
          <StatCard label="Finalistas" value={stats.por_journey.finalista} color="#7c3aed" />
          <StatCard label="Demos" value={stats.por_journey.demo} color="#2563eb" />
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span style={{ color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Journey</span>
          <select
            value={journeyFilter}
            onChange={(e) => setJourneyFilter(e.target.value as 'all' | JourneyType)}
            style={{ background: '#fff', color: '#111827', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}
          >
            <option value="all">Todos</option>
            <option value="finalista">Finalistas</option>
            <option value="demo">Demos</option>
            <option value="frio">Fríos</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span style={{ color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Vendedor</span>
          <select
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
            style={{ background: '#fff', color: '#111827', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}
          >
            <option value="all">Todos</option>
            {uniqueVendors.map((vid) => (
              <option key={vid} value={vid}>{vendorNameById.get(vid) ?? vid.slice(0, 8)}</option>
            ))}
          </select>
        </label>
        <div style={{ marginLeft: 'auto', color: '#6b7280', fontSize: 12 }}>
          Mostrando <strong style={{ color: '#111827' }}>{ventas.length}</strong> ventas
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#7f1d1d', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          Error: {error}
        </div>
      )}

      {moveError && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#7f1d1d', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          ⚠️ {moveError}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Cargando…</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
            {STAGES.map((stage) => {
              const cards = ventasInStage(stage.key);
              const isDragOver = dragOverStage === stage.key;
              return (
                <div
                  key={stage.key}
                  style={{ minWidth: 300, maxWidth: 300, background: '#fff', border: `1px solid ${isDragOver ? stage.color : '#e5e7eb'}`, borderRadius: 10, display: 'flex', flexDirection: 'column', transition: 'border-color 0.15s' }}
                  onDragOver={(e) => { e.preventDefault(); if (dragOverStage !== stage.key) setDragOverStage(stage.key); }}
                  onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; if (dragOverStage === stage.key) setDragOverStage(null); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverStage(null);
                    const id = e.dataTransfer.getData('text/plain');
                    const dragged = ventas.find((v) => v.id === id);
                    if (dragged) void moveVenta(dragged, stage.key);
                  }}
                >
                  <div style={{ padding: '12px 14px', borderBottom: '1px solid #e5e7eb', borderTop: `3px solid ${stage.color}`, borderRadius: '10px 10px 0 0' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {stage.label}
                      <span style={{ background: '#f3f4f6', padding: '2px 8px', borderRadius: 12, fontSize: 11, color: '#6b7280', fontWeight: 600 }}>{cards.length}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4, lineHeight: 1.4 }}>{stage.description}</div>
                  </div>
                  <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 220, maxHeight: '65vh', overflowY: 'auto', background: isDragOver ? '#eef2ff' : '#f7f8fa', borderRadius: '0 0 10px 10px', transition: 'background 0.15s' }}>
                    {cards.length === 0 ? (
                      <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 11, padding: '30px 0' }}>
                        {isDragOver ? '↓ Soltá acá' : 'Vacío'}
                      </div>
                    ) : (
                      cards.map((v) => (
                        <VentaCard
                          key={v.id}
                          venta={v}
                          busy={busyIds.has(v.id)}
                          onEdit={() => setEditVenta(v)}
                          onSendDemo={() => handleSendDemo(v)}
                          onVerFitReport={v.has_fit_report ? () => navigate(`/marketing/fit-report/${v.id}`) : undefined}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {perdidas.length > 0 && (
            <details
              style={{ marginTop: 20, background: '#fff', border: `1px solid ${dragOverStage === 'perdido' ? '#dc2626' : '#e5e7eb'}`, borderRadius: 10, padding: 12 }}
              onDragOver={(e) => { e.preventDefault(); if (dragOverStage !== 'perdido') setDragOverStage('perdido'); }}
              onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; if (dragOverStage === 'perdido') setDragOverStage(null); }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverStage(null);
                const id = e.dataTransfer.getData('text/plain');
                const dragged = ventas.find((v) => v.id === id);
                if (dragged) void moveVenta(dragged, 'perdido');
              }}
            >
              <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#dc2626' }}>
                Perdidos ({perdidas.length}) — arrastrá acá para descartar
              </summary>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8, marginTop: 12 }}>
                {perdidas.map((v) => (
                  <VentaCard
                    key={v.id}
                    venta={v}
                    busy={busyIds.has(v.id)}
                    onEdit={() => setEditVenta(v)}
                    onSendDemo={() => handleSendDemo(v)}
                    onVerFitReport={v.has_fit_report ? () => navigate(`/marketing/fit-report/${v.id}`) : undefined}
                  />
                ))}
              </div>
            </details>
          )}

          {/* Zona vacía perdidos — para poder tirar cards cuando no hay perdidos aún */}
          {perdidas.length === 0 && (
            <div
              style={{
                marginTop: 20,
                background: dragOverStage === 'perdido' ? '#fef2f2' : '#f7f8fa',
                border: `2px dashed ${dragOverStage === 'perdido' ? '#dc2626' : '#e5e7eb'}`,
                borderRadius: 10,
                padding: '16px 12px',
                textAlign: 'center',
                fontSize: 12,
                color: dragOverStage === 'perdido' ? '#dc2626' : '#9ca3af',
                fontWeight: 500,
              }}
              onDragOver={(e) => { e.preventDefault(); if (dragOverStage !== 'perdido') setDragOverStage('perdido'); }}
              onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; if (dragOverStage === 'perdido') setDragOverStage(null); }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverStage(null);
                const id = e.dataTransfer.getData('text/plain');
                const dragged = ventas.find((v) => v.id === id);
                if (dragged) void moveVenta(dragged, 'perdido');
              }}
            >
              {dragOverStage === 'perdido' ? '↓ Soltá para marcar como perdido' : 'Arrastrá acá los leads perdidos'}
            </div>
          )}
        </>
      )}

      {convertLead && (
        <DatosLegalesModal
          mode="marketing-to-deal"
          client={{
            id: convertLead.id,
            empresa_nombre: convertLead.company ?? '',
            contacto_nombre: convertLead.contact_name ?? '',
            salary_target: convertLead.salary_target,
            puesto: convertLead.puesto,
          }}
          onClose={() => setConvertLead(null)}
          onSaved={() => { setConvertLead(null); void load(); }}
        />
      )}

      {editVenta && (
        <EditVentaModal
          venta={editVenta}
          onClose={() => setEditVenta(null)}
          onSave={(patch) => saveEdit(editVenta, patch)}
        />
      )}
    </div>
  );
}

function EditVentaModal({
  venta,
  onClose,
  onSave,
}: {
  venta: Venta;
  onClose: () => void;
  onSave: (patch: { contact_name?: string; company?: string; whatsapp?: string }) => void;
}) {
  const [contactName, setContactName] = useState(venta.contact_name ?? '');
  const [company, setCompany] = useState(venta.company ?? '');
  const [whatsapp, setWhatsapp] = useState(venta.whatsapp ?? '');
  const [submitting, setSubmitting] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const patch: { contact_name?: string; company?: string; whatsapp?: string } = {};
    if (contactName.trim()) patch.contact_name = contactName.trim();
    if (company.trim()) patch.company = company.trim();
    if (whatsapp.trim()) patch.whatsapp = whatsapp.trim();
    onSave(patch);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 10, padding: 24, width: 480, maxWidth: '95vw', color: '#111827' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0, marginBottom: 12, fontSize: 18, fontWeight: 700 }}>✏️ Editar lead</h2>
        <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>Email <strong>{venta.email}</strong> — no editable (es la identidad del lead).</p>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Nombre de contacto</span>
            <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} style={{ padding: '8px 10px', background: '#fff', color: '#111827', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Empresa</span>
            <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} style={{ padding: '8px 10px', background: '#fff', color: '#111827', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>WhatsApp (E.164)</span>
            <input type="text" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+50761234567" style={{ padding: '8px 10px', background: '#fff', color: '#111827', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
            <button type="button" onClick={onClose} disabled={submitting} style={{ background: 'transparent', color: '#4b5563', border: '1px solid #d1d5db', padding: '10px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Cancelar</button>
            <button type="submit" disabled={submitting} style={{ background: '#111827', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 6, fontWeight: 600, cursor: submitting ? 'wait' : 'pointer', fontSize: 13 }}>{submitting ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StatCard({ label, value, color = '#111827' }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, letterSpacing: '-0.02em' }}>{value}</div>
    </div>
  );
}

function VentaCard({
  venta: v,
  busy = false,
  onEdit,
  onSendDemo,
  onVerFitReport,
}: {
  venta: Venta;
  busy?: boolean;
  onEdit?: () => void;
  onSendDemo?: () => void;
  onVerFitReport?: () => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [copiedReport, setCopiedReport] = useState(false);
  const journeyMeta = JOURNEY_META[v.journey_type];
  const daysSince = v.created_at ? Math.floor((Date.now() - new Date(v.created_at).getTime()) / (1000 * 60 * 60 * 24)) : null;
  const urgent = v.urgency === 'less_30d';

  return (
    <div
      draggable={!busy}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', v.id);
        e.dataTransfer.effectAllowed = 'move';
        setIsDragging(true);
      }}
      onDragEnd={() => setIsDragging(false)}
      style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, opacity: busy ? 0.5 : isDragging ? 0.4 : 1, cursor: busy ? 'wait' : 'grab', transition: 'opacity 0.15s', position: 'relative' }}
    >
      {onEdit && (
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          onMouseDown={(e) => e.stopPropagation()}
          title="Editar datos del lead"
          disabled={busy}
          style={{ position: 'absolute', top: 6, right: 6, background: 'transparent', border: 'none', cursor: busy ? 'wait' : 'pointer', fontSize: 14, color: '#6b7280', padding: 4 }}
        >
          ✏️
        </button>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ background: journeyMeta.bg, color: journeyMeta.fg, padding: '2px 8px', borderRadius: 10, fontSize: 10.5, fontWeight: 600 }}>{journeyMeta.label}</span>
        {urgent && (
          <span style={{ background: '#fef2f2', color: '#dc2626', padding: '2px 8px', borderRadius: 10, fontSize: 10.5, fontWeight: 600 }}>⚡ Urgente</span>
        )}
        {v.score_quality != null && (
          <span style={{ background: '#fef3c7', color: '#d97706', padding: '2px 8px', borderRadius: 10, fontSize: 10.5, fontWeight: 700 }}>Score {v.score_quality}</span>
        )}
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '-0.01em' }}>{v.company ?? '(sin empresa)'}</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{v.contact_name ?? '(sin contacto)'}</div>
      <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 2 }}>{v.email}</div>
      {v.puesto && (
        <div style={{ fontSize: 11.5, marginTop: 8, padding: '6px 8px', background: '#f7f8fa', borderRadius: 5, fontWeight: 500 }}>💼 {v.puesto}</div>
      )}
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, color: '#6b7280' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {v.vendor_name ? (
            <>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#4f46e5', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                {v.vendor_name.slice(0, 1).toUpperCase()}
              </span>
              {v.vendor_name}
            </>
          ) : (
            'Sin vendedor'
          )}
        </div>
        <span>{daysSince != null ? `${daysSince}d` : '—'}</span>
      </div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {onSendDemo && (
          <button
            onClick={(e) => { e.stopPropagation(); onSendDemo(); }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Enviar demo (DISC + integridad) al cliente"
            disabled={busy}
            style={{ background: 'transparent', color: '#0369a1', border: '1px solid #7dd3fc', padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: busy ? 'wait' : 'pointer' }}
          >
            📤 Enviar demo
          </button>
        )}
        {onVerFitReport && (
          <button
            onClick={(e) => { e.stopPropagation(); onVerFitReport(); }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Ver el fit report que se envió al cliente"
            disabled={busy}
            style={{ background: 'transparent', color: '#7c3aed', border: '1px solid #c4b5fd', padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: busy ? 'wait' : 'pointer' }}
          >
            📄 Ver fit report
          </button>
        )}
        {v.demo_report_url && (
          <div style={{ display: 'flex', gap: 4 }}>
            <a
              href={v.demo_report_url}
              target="_blank"
              rel="noreferrer"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={{ flex: 1, background: 'transparent', color: '#059669', border: '1px solid #6ee7b7', padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer', textAlign: 'center', textDecoration: 'none' }}
            >
              📊 Ver reporte
            </a>
            <button
              type="button"
              title="Copiar link del reporte"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  await navigator.clipboard.writeText(v.demo_report_url!);
                  setCopiedReport(true);
                  setTimeout(() => setCopiedReport(false), 2000);
                } catch {
                  window.prompt('Copiá el link:', v.demo_report_url!);
                }
              }}
              style={{ background: 'transparent', color: '#059669', border: '1px solid #6ee7b7', padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}
            >
              {copiedReport ? '✓' : '📋'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
