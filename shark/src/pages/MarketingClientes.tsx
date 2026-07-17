import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { config } from '../config';
import { useApi } from '../lib/api';
import MarketingVentas from './MarketingVentas';

type SourceBucket = 'demo' | 'finalista' | 'meta_ads' | 'linkedin' | 'manual' | 'otros';

type Cliente = {
  id: string;
  email: string;
  contact_name: string | null;
  company: string | null;
  whatsapp: string | null;
  score_quality: number | null;
  urgency: string | null;
  salary_target: string | null;
  puesto: string | null;
  source_bucket: SourceBucket;
  pipeline_stage: string;
  vendor_id: string | null;
  vendor_name: string | null;
  finalistas_count: number;
  status: string | null;
  demo_report_url: string | null;
};

type Stats = {
  total: number;
  demo: number;
  finalista: number;
  meta_ads: number;
  linkedin: number;
  unassigned: number;
};

const STAGES: Array<{ key: string; label: string; color: string }> = [
  { key: 'nuevo', label: 'Nuevo', color: '#94a3b8' },
  { key: 'contactado', label: 'Contactado', color: '#2563eb' },
  { key: 'interesado', label: 'Interesado', color: '#7c3aed' },
  { key: 'reunion_agendada', label: 'Reunión agendada', color: '#d97706' },
  { key: 'reunion_hecha', label: 'Reunión hecha', color: '#059669' },
  { key: 'cotizacion_enviada', label: 'Cotización enviada', color: '#4f46e5' },
  { key: 'perdido', label: 'Perdido', color: '#dc2626' },
];

const SOURCE_LABELS: Record<SourceBucket, { label: string; bg: string; fg: string }> = {
  demo: { label: 'Demo', bg: '#eff6ff', fg: '#2563eb' },
  finalista: { label: 'Finalista', bg: '#f5f3ff', fg: '#7c3aed' },
  meta_ads: { label: 'Meta Ads', bg: '#fdf2f8', fg: '#db2777' },
  linkedin: { label: 'LinkedIn', bg: '#ecfdf5', fg: '#059669' },
  manual: { label: 'Manual', bg: '#f3f4f6', fg: '#6b7280' },
  otros: { label: 'Otros', bg: '#f3f4f6', fg: '#9ca3af' },
};

const URGENCY_LABELS: Record<string, string> = {
  less_30d: '<30 días',
  '1-3m': '1-3 meses',
  '3m+': '3+ meses',
  exploring: 'Explorando',
};

/**
 * Wrapper — decide entre kanban clásico y Marketing V3 (Ventas).
 * Debe ser un componente separado para no violar las reglas de hooks:
 * un return temprano en el mismo componente que después llama useState/useEffect
 * genera "Rendered fewer hooks than expected" (React error #300).
 */
export default function MarketingClientes() {
  const { getToken } = useAuth();
  const [v3Mode, setV3Mode] = useState<'unknown' | 'on' | 'off'>('unknown');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${config.apiBase}/api/marketing/ventas?limit=1`, {
          headers: { 'X-Clerk-Token': token ?? '' },
        });
        if (cancelled) return;
        setV3Mode(res.status === 503 ? 'off' : 'on');
      } catch {
        if (!cancelled) setV3Mode('off');
      }
    })();
    return () => { cancelled = true; };
  }, [getToken]);

  if (v3Mode === 'unknown') {
    return <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Cargando…</div>;
  }
  if (v3Mode === 'on') return <MarketingVentas />;
  return <MarketingClientesLegacy />;
}

function MarketingClientesLegacy() {
  const { getToken } = useAuth();
  const api = useApi();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<'all' | SourceBucket>('all');
  const [vendorFilter, setVendorFilter] = useState<string>('all');
  const [busyLeadIds, setBusyLeadIds] = useState<Set<string>>(new Set());
  const [editLead, setEditLead] = useState<Cliente | null>(null);
  const [contractLead, setContractLead] = useState<Cliente | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (sourceFilter !== 'all') params.set('source', sourceFilter);
      if (vendorFilter !== 'all') params.set('vendor', vendorFilter);
      const url = `${config.apiBase}/api/marketing/clientes${params.toString() ? '?' + params.toString() : ''}`;
      const token = await getToken();
      const res = await fetch(url, { headers: { 'X-Clerk-Token': token ?? '' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { clientes: Cliente[]; stats: Stats };
      setClientes(data.clientes ?? []);
      setStats(data.stats ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [getToken, sourceFilter, vendorFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  function clientesInStage(stage: string): Cliente[] {
    return clientes.filter((c) => c.pipeline_stage === stage);
  }

  function markBusy(id: string, busy: boolean) {
    setBusyLeadIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function moveCliente(cliente: Cliente, nextStage: string) {
    // Optimistic update
    const prev = cliente.pipeline_stage;
    setClientes((list) => list.map((c) => (c.id === cliente.id ? { ...c, pipeline_stage: nextStage } : c)));
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/marketing/lead/${cliente.id}`, {
        method: 'PATCH',
        headers: { 'X-Clerk-Token': token ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline_stage: nextStage }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      // Rollback
      setClientes((list) => list.map((c) => (c.id === cliente.id ? { ...c, pipeline_stage: prev } : c)));
      alert(`Error moviendo cliente: ${(err as Error).message}`);
    }
  }

  async function handleSendDemo(cliente: Cliente) {
    if (!confirm(`¿Enviar demo (conductual + integridad) al email ${cliente.email}?`)) return;
    markBusy(cliente.id, true);
    try {
      const r = await api.marketing.sendDemoFromAdmin(cliente.id, {
        member_to_evaluate: {
          full_name: cliente.contact_name ?? cliente.company ?? cliente.email,
          email: cliente.email.trim().toLowerCase(),
          role: 'Cliente',
          consent_obtained: true,
        },
      });
      alert(r.message ?? `Demo enviada a ${cliente.email}`);
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    } finally {
      markBusy(cliente.id, false);
    }
  }

  async function handleConvertTenant(cliente: Cliente) {
    if (!cliente.contact_name || !cliente.company) {
      alert('Faltan datos: contact_name y company. Editá el lead primero.');
      return;
    }
    if (!confirm(`¿Convertir a "${cliente.company}" en cliente activo de SharkTalents?\n\nEsto crea un tenant nuevo y marca el lead como ganado.`)) return;
    markBusy(cliente.id, true);
    try {
      const r = await api.marketing.convertToTenant(cliente.id);
      alert(`✓ Cliente convertido · slug: ${r.slug}\nTenant ID: ${r.tenant_id}`);
      void load();
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    } finally {
      markBusy(cliente.id, false);
    }
  }

  async function saveEdit(cliente: Cliente, patch: { contact_name?: string; company?: string; whatsapp?: string }) {
    markBusy(cliente.id, true);
    try {
      await api.marketing.patchLead(cliente.id, patch);
      setClientes((list) => list.map((c) => (c.id === cliente.id ? { ...c, ...patch } : c)));
      setEditLead(null);
    } catch (err) {
      alert(`Error guardando: ${(err as Error).message}`);
    } finally {
      markBusy(cliente.id, false);
    }
  }

  return (
    <div style={{ padding: '24px 32px', background: '#f7f8fa', minHeight: '100vh', color: '#111827' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>Marketing → Clientes</h1>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
            Empresas/personas que llenaron un formulario. Los vendedores los trabajan hasta convertir.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setManualOpen(true)}
            style={{ background: '#4f46e5', border: 'none', padding: '8px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: '#fff', fontWeight: 600 }}
          >
            + Nuevo lead manual
          </button>
          <button
            onClick={() => setImportOpen(true)}
            style={{ background: '#fff', border: '1px solid #d1d5db', padding: '8px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: '#111827' }}
          >
            ⬇ Importar de CRM
          </button>
          <button
            onClick={() => void load()}
            style={{ background: '#fff', border: '1px solid #d1d5db', padding: '8px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: '#111827' }}
          >
            ↻ Refrescar
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Finalista" value={stats.finalista} color="#7c3aed" />
          <StatCard label="Demo" value={stats.demo} color="#2563eb" />
          <StatCard label="Meta Ads" value={stats.meta_ads} color="#db2777" />
          <StatCard label="LinkedIn" value={stats.linkedin} color="#059669" />
          <StatCard label="Sin asignar" value={stats.unassigned} color="#d97706" />
        </div>
      )}

      {/* Filtros */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span style={{ color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Origen</span>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as 'all' | SourceBucket)}
            style={{ background: '#fff', color: '#111827', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}
          >
            <option value="all">Todos</option>
            <option value="demo">Demo</option>
            <option value="finalista">Finalista</option>
            <option value="meta_ads">Meta Ads</option>
            <option value="linkedin">LinkedIn</option>
            <option value="manual">Manual</option>
            <option value="otros">Otros</option>
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
            <option value="unassigned">Sin asignar</option>
          </select>
        </label>
        <div style={{ marginLeft: 'auto', color: '#6b7280', fontSize: 12 }}>
          Mostrando <strong style={{ color: '#111827' }}>{clientes.length}</strong> clientes
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#7f1d1d', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          Error: {error}
        </div>
      )}

      {/* Kanban */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Cargando…</div>
      ) : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
          {STAGES.map((stage) => {
            const cols = clientesInStage(stage.key);
            const isDragOver = dragOverStage === stage.key;
            return (
              <div
                key={stage.key}
                style={{ minWidth: 280, maxWidth: 280, background: '#fff', border: `1px solid ${isDragOver ? stage.color : '#e5e7eb'}`, borderRadius: 10, display: 'flex', flexDirection: 'column', transition: 'border-color 0.15s' }}
                onDragOver={(e) => { e.preventDefault(); if (dragOverStage !== stage.key) setDragOverStage(stage.key); }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  if (dragOverStage === stage.key) setDragOverStage(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverStage(null);
                  const leadId = e.dataTransfer.getData('text/plain');
                  const dragged = clientes.find((c) => c.id === leadId);
                  if (dragged && dragged.pipeline_stage !== stage.key) void moveCliente(dragged, stage.key);
                }}
              >
                <div style={{ padding: '12px 14px', borderBottom: '1px solid #e5e7eb', borderTop: `3px solid ${stage.color}`, borderRadius: '10px 10px 0 0' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {stage.label}
                    <span style={{ background: '#f3f4f6', padding: '2px 8px', borderRadius: 12, fontSize: 11, color: '#6b7280', fontWeight: 600 }}>{cols.length}</span>
                  </div>
                </div>
                <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 200, maxHeight: '62vh', overflowY: 'auto', background: isDragOver ? '#eef2ff' : '#f7f8fa', borderRadius: '0 0 10px 10px', transition: 'background 0.15s' }}>
                  {cols.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 11, padding: '24px 0' }}>
                      {isDragOver ? '↓ Soltá acá' : 'Vacío'}
                    </div>
                  ) : (
                    cols.map((c) => {
                      const idx = STAGES.findIndex((s) => s.key === c.pipeline_stage);
                      const next = STAGES[idx + 1];
                      const nextKey = next && next.key !== 'perdido' ? next.key : null;
                      const busy = busyLeadIds.has(c.id);
                      return (
                        <ClienteCard
                          key={c.id}
                          cliente={c}
                          nextStage={nextKey}
                          busy={busy}
                          onMoveNext={nextKey ? () => moveCliente(c, nextKey) : undefined}
                          onMovePerdido={c.pipeline_stage !== 'perdido' ? () => moveCliente(c, 'perdido') : undefined}
                          onSendDemo={() => handleSendDemo(c)}
                          onConvertTenant={() => handleConvertTenant(c)}
                          onEdit={() => setEditLead(c)}
                          onSendContract={() => setContractLead(c)}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editLead && (
        <EditLeadModal
          cliente={editLead}
          onClose={() => setEditLead(null)}
          onSave={(patch) => saveEdit(editLead, patch)}
        />
      )}

      {contractLead && (
        <SendContractModal
          cliente={contractLead}
          onClose={() => setContractLead(null)}
          onSent={() => { setContractLead(null); void load(); }}
        />
      )}

      {manualOpen && (
        <CreateManualModal
          onClose={() => setManualOpen(false)}
          onCreated={() => { setManualOpen(false); void load(); }}
        />
      )}

      {importOpen && (
        <ImportFromCrmModal
          onClose={() => setImportOpen(false)}
          onImported={() => { setImportOpen(false); void load(); }}
        />
      )}
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

function ClienteCard({
  cliente,
  nextStage,
  busy,
  onMoveNext,
  onMovePerdido,
  onSendDemo,
  onConvertTenant,
  onEdit,
  onSendContract,
}: {
  cliente: Cliente;
  nextStage: string | null;
  busy: boolean;
  onMoveNext?: () => void;
  onMovePerdido?: () => void;
  onSendDemo: () => void;
  onConvertTenant: () => void;
  onEdit: () => void;
  onSendContract: () => void;
}) {
  const src = SOURCE_LABELS[cliente.source_bucket];
  const urg = cliente.urgency ? URGENCY_LABELS[cliente.urgency] : null;
  const nextStageLabel = nextStage ? STAGES.find((s) => s.key === nextStage)?.label : null;
  const isWon = cliente.status === 'won';
  const [isDragging, setIsDragging] = useState(false);
  const [copiedReport, setCopiedReport] = useState(false);
  return (
    <div
      draggable={!busy}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', cliente.id);
        e.dataTransfer.effectAllowed = 'move';
        setIsDragging(true);
      }}
      onDragEnd={() => setIsDragging(false)}
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: 12,
        position: 'relative',
        opacity: busy ? 0.6 : isDragging ? 0.4 : 1,
        cursor: busy ? 'wait' : 'grab',
        transition: 'opacity 0.15s',
      }}
    >
      <button
        onClick={onEdit}
        title="Editar datos"
        disabled={busy}
        style={{ position: 'absolute', top: 6, right: 6, background: 'transparent', border: 'none', cursor: busy ? 'wait' : 'pointer', fontSize: 14, color: '#6b7280', padding: 4 }}
      >
        ✏️
      </button>
      <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '-0.01em', paddingRight: 20 }}>{cliente.company ?? '(sin empresa)'}</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{cliente.contact_name ?? '(sin contacto)'}</div>
      <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 2 }}>{cliente.email}</div>
      {cliente.puesto && (
        <div style={{ fontSize: 11.5, marginTop: 8, padding: '6px 8px', background: '#f7f8fa', borderRadius: 5, fontWeight: 500 }}>💼 {cliente.puesto}</div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
        <span style={{ background: src.bg, color: src.fg, padding: '2px 8px', borderRadius: 10, fontSize: 10.5, fontWeight: 600 }}>{src.label}</span>
        {cliente.urgency === 'less_30d' && urg && (
          <span style={{ background: '#fef2f2', color: '#dc2626', padding: '2px 8px', borderRadius: 10, fontSize: 10.5, fontWeight: 600 }}>⚡ {urg}</span>
        )}
        {cliente.score_quality != null && (
          <span style={{ background: '#fef3c7', color: '#d97706', padding: '2px 8px', borderRadius: 10, fontSize: 10.5, fontWeight: 700 }}>Score {cliente.score_quality}</span>
        )}
      </div>
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, color: '#6b7280' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {cliente.vendor_name ? (
            <>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#4f46e5', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                {cliente.vendor_name.slice(0, 1).toUpperCase()}
              </span>
              {cliente.vendor_name}
            </>
          ) : (
            <>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#f3f4f6', color: '#9ca3af', border: '1px dashed #d1d5db', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>
                ?
              </span>
              Sin asignar
            </>
          )}
        </div>
        {cliente.finalistas_count > 0 ? (
          <span style={{ background: '#f5f3ff', color: '#7c3aed', padding: '3px 8px', borderRadius: 10, fontWeight: 600, fontSize: 11 }}>
            👥 {cliente.finalistas_count}
          </span>
        ) : (
          <span style={{ color: '#9ca3af', fontSize: 11 }}>—</span>
        )}
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {onMoveNext && nextStageLabel && (
          <button
            onClick={onMoveNext}
            disabled={busy}
            title={`Mover a: ${nextStageLabel}`}
            style={{ background: '#111827', color: '#fff', border: 'none', padding: '6px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
          >
            ▶ Siguiente etapa
          </button>
        )}
        <button
          onClick={onSendDemo}
          disabled={busy}
          title="Enviar demo (DISC + integridad) al email del cliente"
          style={{ background: 'transparent', color: '#0369a1', border: '1px solid #7dd3fc', padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: busy ? 'wait' : 'pointer' }}
        >
          📤 Enviar demo
        </button>
        {cliente.demo_report_url && (
          <div style={{ display: 'flex', gap: 4 }}>
            <a
              href={cliente.demo_report_url}
              target="_blank"
              rel="noreferrer"
              title="Abrir reporte del cliente"
              style={{ flex: 1, background: 'transparent', color: '#059669', border: '1px solid #6ee7b7', padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer', textAlign: 'center', textDecoration: 'none' }}
            >
              📊 Ver reporte
            </a>
            <button
              type="button"
              title="Copiar link para mandar por WhatsApp"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(cliente.demo_report_url!);
                  setCopiedReport(true);
                  setTimeout(() => setCopiedReport(false), 2000);
                } catch {
                  window.prompt('Copiá el link manualmente:', cliente.demo_report_url!);
                }
              }}
              style={{ background: 'transparent', color: '#059669', border: '1px solid #6ee7b7', padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}
            >
              {copiedReport ? '✓' : '📋'}
            </button>
          </div>
        )}
        {isWon ? (
          <span style={{ background: '#ecfdf5', color: '#059669', padding: '4px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, textAlign: 'center' }}>
            ✓ Cliente activo
          </span>
        ) : (
          <button
            onClick={onConvertTenant}
            disabled={busy || !cliente.contact_name || !cliente.company}
            title={
              !cliente.contact_name || !cliente.company
                ? 'Faltan contact_name y company (editá primero)'
                : 'Convertir a Tenant activo de SharkTalents'
            }
            style={{
              background: (!cliente.contact_name || !cliente.company) ? 'transparent' : '#4f46e5',
              color: (!cliente.contact_name || !cliente.company) ? '#9ca3af' : '#fff',
              border: (!cliente.contact_name || !cliente.company) ? '1px solid #e5e7eb' : 'none',
              padding: '4px 8px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              cursor: (!cliente.contact_name || !cliente.company || busy) ? 'not-allowed' : 'pointer',
            }}
          >
            → Convertir Tenant
          </button>
        )}
        <button
          onClick={onSendContract}
          disabled={busy}
          title="Enviar contrato por Zoho Sign"
          style={{ background: 'transparent', color: '#7c3aed', border: '1px solid #c4b5fd', padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: busy ? 'wait' : 'pointer' }}
        >
          📄 Contrato
        </button>
        {onMovePerdido && (
          <button
            onClick={onMovePerdido}
            disabled={busy}
            style={{ background: 'transparent', color: '#dc2626', border: '1px solid #fca5a5', padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: busy ? 'wait' : 'pointer' }}
          >
            Perdido
          </button>
        )}
      </div>
    </div>
  );
}

function EditLeadModal({
  cliente,
  onClose,
  onSave,
}: {
  cliente: Cliente;
  onClose: () => void;
  onSave: (patch: { contact_name?: string; company?: string; whatsapp?: string }) => void;
}) {
  const [contactName, setContactName] = useState(cliente.contact_name ?? '');
  const [company, setCompany] = useState(cliente.company ?? '');
  const [whatsapp, setWhatsapp] = useState(cliente.whatsapp ?? '');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const patch: { contact_name?: string; company?: string; whatsapp?: string } = {};
    if (contactName.trim()) patch.contact_name = contactName.trim();
    if (company.trim()) patch.company = company.trim();
    if (whatsapp.trim()) patch.whatsapp = whatsapp.trim();
    onSave(patch);
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 10, padding: 24, width: 480, maxWidth: '95vw', color: '#111827' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: 0, marginBottom: 12, fontSize: 18, fontWeight: 700 }}>✏️ Editar cliente</h2>
        <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>Email <strong>{cliente.email}</strong> — no editable (es la identidad del lead).</p>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Nombre de contacto" value={contactName} onChange={setContactName} />
          <Field label="Empresa" value={company} onChange={setCompany} />
          <Field label="WhatsApp (E.164)" value={whatsapp} onChange={setWhatsapp} placeholder="+50761234567" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
            <button type="button" onClick={onClose} disabled={submitting} style={{ background: 'transparent', color: '#4b5563', border: '1px solid #d1d5db', padding: '10px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
              Cancelar
            </button>
            <button type="submit" disabled={submitting} style={{ background: '#111827', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 6, fontWeight: 600, cursor: submitting ? 'wait' : 'pointer', fontSize: 13 }}>
              {submitting ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', required = false }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean }) {
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

function ModalShell({ title, subtitle, onClose, wide = false, children }: { title: string; subtitle?: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 10, padding: 24, width: wide ? 720 : 520, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', color: '#111827' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: 0, marginBottom: 4, fontSize: 18, fontWeight: 700 }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4, marginBottom: 16 }}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

function SendContractModal({
  cliente,
  onClose,
  onSent,
}: {
  cliente: Cliente;
  onClose: () => void;
  onSent: () => void;
}) {
  const api = useApi();
  const [puesto, setPuesto] = useState('');
  const [salario, setSalario] = useState('');
  const [ruc, setRuc] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState(cliente.whatsapp ?? '');
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<string>('none');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await api.marketing.getContractContext(cliente.id);
        if (cancelled) return;
        if (ctx.puesto_nombre) setPuesto(ctx.puesto_nombre);
        if (ctx.puesto_salario_usd && ctx.puesto_salario_usd > 0) setSalario(String(ctx.puesto_salario_usd));
        if (ctx.client_phone) setPhone(ctx.client_phone);
        if (ctx.client_ruc_nit_ein) setRuc(ctx.client_ruc_nit_ein);
        if (ctx.client_address) setAddress(ctx.client_address);
        setSource(ctx.source);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [api, cliente.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const salarioNum = Number(salario);
    if (!puesto.trim() || !Number.isFinite(salarioNum) || salarioNum <= 0) {
      setError('Puesto y salario son obligatorios');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const r = await api.marketing.sendContract(cliente.id, {
        puesto_nombre: puesto.trim(),
        puesto_salario_usd: salarioNum,
        client_ruc_nit_ein: ruc.trim() || undefined,
        client_address: address.trim() || undefined,
        client_phone: phone.trim() || undefined,
      });
      alert(r.message ?? 'Contrato enviado — el cliente lo recibe por email para firmar.');
      onSent();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  const sourceLabel: Record<string, string> = {
    'draft+crm': 'draft + Zoho CRM',
    'draft': 'draft',
    'crm': 'Zoho CRM',
    'lead': 'lead',
    'none': 'sin pre-fill',
  };

  return (
    <ModalShell title="📄 Enviar contrato" subtitle={`${cliente.company ?? cliente.email} · ${cliente.contact_name ?? ''}`} onClose={onClose}>
      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>Cargando datos pre-llenados…</div>
      ) : (
        <>
          <div style={{ background: '#f3f4f6', padding: 8, borderRadius: 6, fontSize: 11, color: '#4b5563', marginBottom: 14 }}>
            Datos pre-llenados desde: <strong>{sourceLabel[source] || source}</strong>
          </div>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Puesto (nombre del cargo a reclutar)" value={puesto} onChange={setPuesto} required />
            <Field label="Salario mensual del puesto (USD)" value={salario} onChange={setSalario} type="number" required />
            <Field label="RUC / NIT / cédula jurídica (opcional)" value={ruc} onChange={setRuc} />
            <Field label="Dirección legal de la empresa (opcional)" value={address} onChange={setAddress} />
            <Field label="Teléfono de contacto (opcional)" value={phone} onChange={setPhone} placeholder="+50761234567" />
            {error && <div style={{ color: '#7f1d1d', background: '#fee2e2', padding: 10, borderRadius: 6, fontSize: 13 }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
              <button type="button" onClick={onClose} disabled={submitting} style={{ background: 'transparent', color: '#4b5563', border: '1px solid #d1d5db', padding: '10px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Cancelar</button>
              <button type="submit" disabled={submitting} style={{ background: '#7c3aed', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 6, fontWeight: 600, cursor: submitting ? 'wait' : 'pointer', fontSize: 13 }}>
                {submitting ? 'Enviando…' : '📄 Enviar contrato'}
              </button>
            </div>
          </form>
        </>
      )}
    </ModalShell>
  );
}

function CreateManualModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const api = useApi();
  const [email, setEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [company, setCompany] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [urgency, setUrgency] = useState<'less_30d' | '1-3m' | '3m+' | 'exploring'>('exploring');
  const [salaryTarget, setSalaryTarget] = useState('');
  const [notes, setNotes] = useState('');
  const [source, setSource] = useState('manual');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { setError('Email obligatorio'); return; }
    setError(null);
    setSubmitting(true);
    try {
      const r = await api.marketing.createManualLead({
        email: email.trim().toLowerCase(),
        contact_name: contactName.trim() || undefined,
        company: company.trim() || undefined,
        whatsapp: whatsapp.trim() || undefined,
        urgency,
        salary_target: salaryTarget ? Number(salaryTarget) : undefined,
        notes: notes.trim() || undefined,
        source: source.trim() || 'manual',
      });
      alert(`Lead ${r.action === 'created' ? 'creado' : 'actualizado'} (id: ${r.lead_id})`);
      onCreated();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="+ Nuevo lead manual" subtitle="Para leads que llegaron por WhatsApp/LinkedIn/referido — no venían por la landing." onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Email" value={email} onChange={setEmail} type="email" required placeholder="cliente@empresa.com" />
        <Field label="Nombre de contacto" value={contactName} onChange={setContactName} />
        <Field label="Empresa" value={company} onChange={setCompany} />
        <Field label="WhatsApp (E.164)" value={whatsapp} onChange={setWhatsapp} placeholder="+50761234567" />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Urgencia</span>
          <select value={urgency} onChange={(e) => setUrgency(e.target.value as typeof urgency)} style={{ padding: '8px 10px', background: '#fff', color: '#111827', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}>
            <option value="less_30d">&lt;30 días</option>
            <option value="1-3m">1-3 meses</option>
            <option value="3m+">3+ meses</option>
            <option value="exploring">Explorando</option>
          </select>
        </label>
        <Field label="Salario esperado del puesto (USD, opcional)" value={salaryTarget} onChange={setSalaryTarget} type="number" />
        <Field label="Source (etiqueta libre)" value={source} onChange={setSource} placeholder="manual, whatsapp, linkedin…" />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Notas (contexto de dónde vino, qué charlaron)</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ padding: '8px 10px', background: '#fff', color: '#111827', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
        </label>
        {error && <div style={{ color: '#7f1d1d', background: '#fee2e2', padding: 10, borderRadius: 6, fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
          <button type="button" onClick={onClose} disabled={submitting} style={{ background: 'transparent', color: '#4b5563', border: '1px solid #d1d5db', padding: '10px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Cancelar</button>
          <button type="submit" disabled={submitting} style={{ background: '#4f46e5', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 6, fontWeight: 600, cursor: submitting ? 'wait' : 'pointer', fontSize: 13 }}>
            {submitting ? 'Creando…' : '+ Crear lead'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

type CrmLeadRow = {
  crm_id: string;
  email: string;
  contact_name: string | null;
  company: string | null;
  phone: string | null;
  lead_source: string | null;
  already_imported: boolean;
};

function ImportFromCrmModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const api = useApi();
  const [tag, setTag] = useState('SharkTalents');
  const [items, setItems] = useState<CrmLeadRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<Set<string>>(new Set());
  const [imported, setImported] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.marketing.listCrmLeadsForImport(tag);
      setItems(r.items ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function importOne(email: string) {
    setImporting((s) => new Set(s).add(email));
    try {
      await api.marketing.importLeadFromCrm(email);
      setImported((s) => new Set(s).add(email));
    } catch (err) {
      alert(`Error importando ${email}: ${(err as Error).message}`);
    } finally {
      setImporting((s) => { const n = new Set(s); n.delete(email); return n; });
    }
  }

  return (
    <ModalShell title="⬇ Importar leads desde Zoho CRM" subtitle="Leads en Zoho con el tag especificado, marcados si ya están en SharkTalents." onClose={onClose} wide>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: '#4b5563' }}>Tag Zoho:</span>
        <input type="text" value={tag} onChange={(e) => setTag(e.target.value)} style={{ padding: '6px 10px', background: '#fff', color: '#111827', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
        <button onClick={() => void load()} style={{ background: '#4f46e5', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          Buscar
        </button>
        <span style={{ marginLeft: 'auto', color: '#6b7280', fontSize: 12 }}>{items.length} leads encontrados</span>
      </div>
      {error && <div style={{ color: '#7f1d1d', background: '#fee2e2', padding: 10, borderRadius: 6, fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Cargando…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>Sin leads con ese tag.</div>
      ) : (
        <div style={{ maxHeight: '50vh', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          {items.map((it, i) => {
            const alreadyIn = it.already_imported || imported.has(it.email);
            const isBusy = importing.has(it.email);
            return (
              <div key={it.crm_id} style={{ display: 'flex', alignItems: 'center', padding: 10, borderTop: i > 0 ? '1px solid #e5e7eb' : 'none', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{it.contact_name ?? '(sin nombre)'}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{it.email} · {it.company ?? '(sin empresa)'}</div>
                  {it.lead_source && <div style={{ fontSize: 10, color: '#9ca3af' }}>Fuente: {it.lead_source}</div>}
                </div>
                {alreadyIn ? (
                  <span style={{ background: '#ecfdf5', color: '#059669', padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>✓ Ya importado</span>
                ) : (
                  <button
                    onClick={() => void importOne(it.email)}
                    disabled={isBusy}
                    style={{ background: '#4f46e5', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 4, cursor: isBusy ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600 }}
                  >
                    {isBusy ? 'Importando…' : 'Importar'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
        <button type="button" onClick={imported.size > 0 ? onImported : onClose} style={{ background: '#111827', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          {imported.size > 0 ? `Cerrar y refrescar (${imported.size} nuevos)` : 'Cerrar'}
        </button>
      </div>
    </ModalShell>
  );
}
