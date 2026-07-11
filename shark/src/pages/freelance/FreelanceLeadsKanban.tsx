import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { config } from '../../config';
import ConvertToClientModal from './ConvertToClientModal';
import EditLeadModal from './EditLeadModal';
import SendQuoteModal from './SendQuoteModal';

type LeadStage =
  | 'nuevo'
  | 'contactado'
  | 'interesado'
  | 'reunion_agendada'
  | 'reunion_hecha'
  | 'cotizacion_enviada'
  | 'perdido';

const LEAD_STAGES: { key: LeadStage; label: string; emoji: string; color: string }[] = [
  { key: 'nuevo', label: 'Nuevo', emoji: '🆕', color: '#e5e7eb' },
  { key: 'contactado', label: 'Contactado', emoji: '📞', color: '#dbeafe' },
  { key: 'interesado', label: 'Interesado', emoji: '👍', color: '#e0e7ff' },
  { key: 'reunion_agendada', label: 'Reunión agendada', emoji: '📅', color: '#fef3c7' },
  { key: 'reunion_hecha', label: 'Reunión hecha', emoji: '✅', color: '#fde68a' },
  { key: 'cotizacion_enviada', label: 'Cotización enviada', emoji: '💰', color: '#fed7aa' },
  { key: 'perdido', label: 'Perdido', emoji: '❌', color: '#fecaca' },
];

// Etapa que dispara la conversión a cliente. Al llegar acá el vendedor tiene
// que decidir: convertir a cliente (sale de este kanban) o mover a perdido.
const CONVERT_STAGE: LeadStage = 'cotizacion_enviada';

type Lead = {
  id: string;
  email: string;
  contact_name: string | null;
  company: string | null;
  whatsapp: string | null;
  urgency: string | null;
  salary_target: string | null;
  pipeline_stage: LeadStage;
  assigned_at: string | null;
  dolor?: string | null;
  puesto?: string | null;
};

/**
 * Kanban de Leads del freelance — pre-venta. Muestra solo leads no convertidos:
 * etapas 1-6 + Perdido. Cuando el vendedor "convierte a cliente", el lead
 * desaparece de este kanban y aparece en /freelance/clientes.
 */
export default function FreelanceLeadsKanban() {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [convertLead, setConvertLead] = useState<Lead | null>(null);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [quoteLead, setQuoteLead] = useState<Lead | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/freelance/me/leads`, {
        headers: { 'X-Clerk-Token': token ?? '' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { leads: Lead[] };
      setLeads(data.leads ?? []);
      setLoading(false);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  async function moveLead(lead: Lead, nextStage: LeadStage) {
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/freelance/me/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'X-Clerk-Token': token ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline_stage: nextStage }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      }
      setRefreshTick((n) => n + 1);
    } catch (err) {
      alert(`Error moviendo lead: ${(err as Error).message}`);
    }
  }

  async function sendEval(lead: Lead) {
    if (!window.confirm(`Enviar email de evaluación a ${lead.email}?\n\nEl lead recibe 2 links para hacer la prueba conductual + integridad.`)) return;
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/freelance/me/leads/${lead.id}/send-eval`, {
        method: 'POST',
        headers: { 'X-Clerk-Token': token ?? '', 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      }
      const result = (await res.json()) as { ok: boolean; message: string };
      alert(result.message);
    } catch (err) {
      alert(`Error enviando evaluación: ${(err as Error).message}`);
    }
  }

  function leadsInStage(stage: LeadStage): Lead[] {
    return leads.filter((l) => l.pipeline_stage === stage);
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#111827' }}>Mis leads</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>
            Etapa pre-venta. Al convertir un lead a cliente, sale de este kanban y aparece en <strong>Mis clientes</strong>.
          </p>
        </div>
        <button
          onClick={() => setRefreshTick((n) => n + 1)}
          style={{
            background: '#f3f4f6',
            border: '1px solid #d1d5db',
            padding: '8px 14px',
            borderRadius: 6,
            fontSize: 13,
            cursor: 'pointer',
            color: '#111827',
          }}
        >
          ↻ Refrescar
        </button>
      </div>

      {loading && <div style={{ color: '#6b7280', padding: 40, textAlign: 'center' }}>Cargando leads...</div>}

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#7f1d1d', padding: 12, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          Error: {error}
        </div>
      )}

      {!loading && (
        <div
          style={{
            display: 'flex',
            gap: 12,
            overflowX: 'auto',
            paddingBottom: 12,
            scrollSnapType: 'x proximity',
          }}
        >
          {LEAD_STAGES.map((stage) => {
            const stageLeads = leadsInStage(stage.key);
            return (
              <StageColumn
                key={stage.key}
                stage={stage}
                leads={stageLeads}
                onMoveNext={(lead) => {
                  const idx = LEAD_STAGES.findIndex((s) => s.key === stage.key);
                  const isConvertStage = stage.key === CONVERT_STAGE;
                  if (isConvertStage) {
                    setConvertLead(lead);
                    return;
                  }
                  const next = LEAD_STAGES[idx + 1];
                  // Saltar "Perdido" al hacer next (Perdido tiene botón dedicado)
                  if (next && next.key !== 'perdido') {
                    void moveLead(lead, next.key);
                  }
                }}
                onMovePerdido={(lead) => void moveLead(lead, 'perdido')}
                onEditLead={(lead) => setEditLead(lead)}
                onSendEval={(lead) => void sendEval(lead)}
                onSendQuote={(lead) => setQuoteLead(lead)}
                isConvertStage={stage.key === CONVERT_STAGE}
              />
            );
          })}
        </div>
      )}

      {convertLead && (
        <ConvertToClientModal
          lead={convertLead}
          onClose={() => setConvertLead(null)}
          onConverted={() => {
            setConvertLead(null);
            setRefreshTick((n) => n + 1);
            if (window.confirm('✅ Cliente convertido. ¿Ir a Mis clientes para seguir el proceso?')) {
              navigate('/freelance/clientes');
            }
          }}
        />
      )}

      {editLead && (
        <EditLeadModal
          lead={editLead}
          onClose={() => setEditLead(null)}
          onSaved={() => {
            setEditLead(null);
            setRefreshTick((n) => n + 1);
          }}
        />
      )}

      {quoteLead && (
        <SendQuoteModal
          lead={quoteLead}
          onClose={() => setQuoteLead(null)}
          onSent={() => {
            setQuoteLead(null);
            setRefreshTick((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

function StageColumn({
  stage,
  leads,
  onMoveNext,
  onMovePerdido,
  onEditLead,
  onSendEval,
  onSendQuote,
  isConvertStage,
}: {
  stage: typeof LEAD_STAGES[number];
  leads: Lead[];
  onMoveNext: (lead: Lead) => void;
  onMovePerdido: (lead: Lead) => void;
  onEditLead: (lead: Lead) => void;
  onSendEval: (lead: Lead) => void;
  onSendQuote: (lead: Lead) => void;
  isConvertStage: boolean;
}) {
  const isPerdido = stage.key === 'perdido';
  return (
    <div
      style={{
        minWidth: 260,
        maxWidth: 260,
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        scrollSnapAlign: 'start',
      }}
    >
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb', background: stage.color, borderRadius: '10px 10px 0 0' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>
          {stage.emoji} {stage.label}
        </div>
        <div style={{ fontSize: 11, color: '#4b5563', marginTop: 2 }}>
          {leads.length} {leads.length === 1 ? 'lead' : 'leads'}
        </div>
      </div>
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 200, maxHeight: 600, overflowY: 'auto' }}>
        {leads.length === 0 && <div style={{ color: '#9ca3af', fontSize: 12, textAlign: 'center', padding: 20 }}>Vacío</div>}
        {leads.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            onMoveNext={isPerdido ? undefined : () => onMoveNext(lead)}
            onMovePerdido={() => onMovePerdido(lead)}
            onEdit={() => onEditLead(lead)}
            onSendEval={() => onSendEval(lead)}
            onSendQuote={() => onSendQuote(lead)}
            isConvertStage={isConvertStage}
          />
        ))}
      </div>
    </div>
  );
}

function LeadCard({
  lead,
  onMoveNext,
  onMovePerdido,
  onEdit,
  onSendEval,
  onSendQuote,
  isConvertStage,
}: {
  lead: Lead;
  onMoveNext?: () => void;
  onMovePerdido: () => void;
  onEdit: () => void;
  onSendEval: () => void;
  onSendQuote: () => void;
  isConvertStage: boolean;
}) {
  const noEmpresa = !lead.company;
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, position: 'relative' }}>
      <button
        onClick={onEdit}
        title="Editar lead"
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: 14,
          color: '#6b7280',
          padding: 4,
        }}
      >
        ✏️
      </button>
      <div style={{ fontSize: 13, fontWeight: 600, color: noEmpresa ? '#9ca3af' : '#111827', marginBottom: 4, paddingRight: 20 }}>
        {lead.company ?? '(sin empresa — editá)'}
      </div>
      <div style={{ fontSize: 12, color: '#4b5563' }}>{lead.contact_name ?? '(sin contacto)'}</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{lead.email}</div>
      {lead.whatsapp && <div style={{ fontSize: 11, color: '#6b7280' }}>📱 {lead.whatsapp}</div>}
      {lead.puesto && <div style={{ fontSize: 11, color: '#4b5563', marginTop: 4 }}>💼 {lead.puesto}</div>}
      {lead.urgency && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4, fontWeight: 600 }}>⚡ {lead.urgency}</div>}
      {lead.salary_target && <div style={{ fontSize: 11, color: '#4b5563', marginTop: 2 }}>💰 {lead.salary_target}</div>}
      {lead.dolor && (
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4, fontStyle: 'italic', padding: 4, background: '#f9fafb', borderRadius: 4 }}>
          {lead.dolor.slice(0, 100)}{lead.dolor.length > 100 ? '…' : ''}
        </div>
      )}
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {onMoveNext && (
          <button
            onClick={onMoveNext}
            disabled={isConvertStage && noEmpresa}
            title={isConvertStage && noEmpresa ? 'Antes de convertir, editá el lead y agregá la empresa' : ''}
            style={{
              background: isConvertStage ? (noEmpresa ? '#e5e7eb' : '#4f46e5') : '#111827',
              color: isConvertStage && noEmpresa ? '#9ca3af' : '#fff',
              border: 'none',
              padding: '6px 8px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              cursor: isConvertStage && noEmpresa ? 'not-allowed' : 'pointer',
            }}
          >
            {isConvertStage ? '👤 Convertir a cliente' : '▶ Siguiente etapa'}
          </button>
        )}
        <button
          onClick={onSendQuote}
          title="Generar y enviar cotización al lead"
          disabled={noEmpresa}
          style={{
            background: noEmpresa ? 'transparent' : '#059669',
            color: noEmpresa ? '#9ca3af' : '#fff',
            border: noEmpresa ? '1px solid #e5e7eb' : 'none',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            cursor: noEmpresa ? 'not-allowed' : 'pointer',
          }}
        >
          💰 Enviar cotización
        </button>
        <button
          onClick={onSendEval}
          title="Enviar email de evaluación al lead"
          style={{
            background: 'transparent',
            color: '#0369a1',
            border: '1px solid #7dd3fc',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          📧 Enviar evaluación
        </button>
        <button
          onClick={onMovePerdido}
          style={{
            background: 'transparent',
            color: '#dc2626',
            border: '1px solid #fca5a5',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          Perdido
        </button>
      </div>
    </div>
  );
}
