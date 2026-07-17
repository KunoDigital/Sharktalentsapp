import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { config } from '../../config';
import DatosLegalesModal from './DatosLegalesModal';

type ClientStage =
  | 'cotizacion_contrato'
  | 'contrato_enviado'
  | 'contrato_firmado'
  | 'cobrado'
  | 'perdido';

const CLIENT_STAGES: { key: ClientStage; label: string; emoji: string; color: string }[] = [
  { key: 'cotizacion_contrato', label: 'Cotización', emoji: '👤', color: '#c7d2fe' },
  { key: 'contrato_enviado', label: 'Contrato enviado', emoji: '📄', color: '#bfdbfe' },
  { key: 'contrato_firmado', label: 'Contrato firmado', emoji: '✍️', color: '#bbf7d0' },
  { key: 'cobrado', label: 'Cobrado', emoji: '💵', color: '#86efac' },
  { key: 'perdido', label: 'Perdido', emoji: '❌', color: '#fecaca' },
];

type Client = {
  id: string;
  lead_id: string;
  empresa_nombre: string;
  contacto_nombre: string;
  contacto_email: string;
  contacto_phone: string | null;
  monto_deal_usd: number;
  comision_freelance_usd: number;
  pipeline_stage: ClientStage;
  zoho_deal_id: string | null;
  zoho_sync_status: string | null;
  zoho_sync_error: string | null;
  datos_legales_completos: boolean;
};

/**
 * Kanban de Clientes convertidos — post-venta. Solo aparecen los leads que ya
 * fueron convertidos (etapas 7-11 del pipeline global). El flujo termina en
 * Cobrado o Perdido.
 */
export default function FreelanceClientesKanban() {
  const { getToken } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [datosLegalesClient, setDatosLegalesClient] = useState<Client | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/freelance/me/clients`, {
        headers: { 'X-Clerk-Token': token ?? '' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { clients: Client[] };
      setClients(data.clients ?? []);
      setLoading(false);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  async function sendContract(client: Client) {
    if (!client.datos_legales_completos) {
      setDatosLegalesClient(client);
      return;
    }
    if (!window.confirm(`Enviar contrato de Zoho Sign a ${client.contacto_email}?\n\nEl representante lo recibe por email para firmar.`)) return;
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/freelance/me/clients/${client.id}/send-contract`, {
        method: 'POST',
        headers: { 'X-Clerk-Token': token ?? '', 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      }
      const result = (await res.json()) as { message: string };
      alert(result.message);
      setRefreshTick((n) => n + 1);
    } catch (err) {
      alert(`Error enviando contrato: ${(err as Error).message}`);
    }
  }

  async function moveClient(client: Client, nextStage: ClientStage) {
    // Guard: si intenta mover a 'contrato_enviado' sin datos legales, abrir modal en vez de PATCH.
    if (nextStage === 'contrato_enviado' && !client.datos_legales_completos) {
      setDatosLegalesClient(client);
      return;
    }
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/freelance/me/clients/${client.id}/stage`, {
        method: 'PATCH',
        headers: { 'X-Clerk-Token': token ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline_stage: nextStage }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      }
      const result = (await res.json()) as { zoho_sync_status?: string; zoho_sync_error?: string | null };
      if (result.zoho_sync_status === 'failed') {
        alert(`Etapa actualizada localmente, pero Zoho falló:\n${result.zoho_sync_error}`);
      }
      setRefreshTick((n) => n + 1);
    } catch (err) {
      alert(`Error moviendo cliente: ${(err as Error).message}`);
    }
  }

  function clientsInStage(stage: ClientStage): Client[] {
    return clients.filter((c) => c.pipeline_stage === stage);
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#111827' }}>Mis clientes</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>
            Post-venta. Los cambios de etapa acá se espejan automáticamente al Trato en Zoho CRM.
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

      {loading && <div style={{ color: '#6b7280', padding: 40, textAlign: 'center' }}>Cargando clientes...</div>}

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#7f1d1d', padding: 12, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          Error: {error}
        </div>
      )}

      {!loading && clients.length === 0 && (
        <div
          style={{
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: '48px 24px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 12 }}>👤</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, marginBottom: 8, color: '#111827' }}>
            Aún no hay clientes convertidos
          </h2>
          <p style={{ color: '#6b7280', margin: 0, fontSize: 13, maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
            Cuando conviertas un lead en Mis leads, va a aparecer acá para gestionar el cierre y facturación.
          </p>
        </div>
      )}

      {!loading && clients.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 12,
            overflowX: 'auto',
            paddingBottom: 12,
            scrollSnapType: 'x proximity',
          }}
        >
          {CLIENT_STAGES.map((stage) => {
            const stageClients = clientsInStage(stage.key);
            return (
              <StageColumn
                key={stage.key}
                stage={stage}
                clients={stageClients}
                onMoveNext={(client) => {
                  const idx = CLIENT_STAGES.findIndex((s) => s.key === stage.key);
                  const next = CLIENT_STAGES[idx + 1];
                  if (next && next.key !== 'perdido') {
                    void moveClient(client, next.key);
                  }
                }}
                onMovePerdido={(client) => void moveClient(client, 'perdido')}
                onSendContract={(client) => void sendContract(client)}
              />
            );
          })}
        </div>
      )}

      {datosLegalesClient && (
        <DatosLegalesModal
          client={{
            id: datosLegalesClient.id,
            empresa_nombre: datosLegalesClient.empresa_nombre,
            contacto_nombre: datosLegalesClient.contacto_nombre,
          }}
          onClose={() => setDatosLegalesClient(null)}
          onSaved={() => {
            const clientToMove = datosLegalesClient;
            setDatosLegalesClient(null);
            // Marcar el datos_legales_completos=true localmente y mover al siguiente stage
            setClients((list) => list.map((c) => (c.id === clientToMove.id ? { ...c, datos_legales_completos: true } : c)));
            void moveClient({ ...clientToMove, datos_legales_completos: true }, 'contrato_enviado');
          }}
        />
      )}
    </div>
  );
}

function StageColumn({
  stage,
  clients,
  onMoveNext,
  onMovePerdido,
  onSendContract,
}: {
  stage: typeof CLIENT_STAGES[number];
  clients: Client[];
  onMoveNext: (client: Client) => void;
  onMovePerdido: (client: Client) => void;
  onSendContract: (client: Client) => void;
}) {
  const isPerdido = stage.key === 'perdido';
  const totalDeal = clients.reduce((sum, c) => sum + Number(c.monto_deal_usd ?? 0), 0);
  const totalComision = clients.reduce((sum, c) => sum + Number(c.comision_freelance_usd ?? 0), 0);
  return (
    <div
      style={{
        minWidth: 280,
        maxWidth: 280,
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
          {clients.length} {clients.length === 1 ? 'cliente' : 'clientes'}
          {clients.length > 0 && ` · $${Math.round(totalDeal)} · comisión $${Math.round(totalComision)}`}
        </div>
      </div>
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 200, maxHeight: 600, overflowY: 'auto' }}>
        {clients.length === 0 && <div style={{ color: '#9ca3af', fontSize: 12, textAlign: 'center', padding: 20 }}>Vacío</div>}
        {clients.map((client) => (
          <ClientCard
            key={client.id}
            client={client}
            onMoveNext={isPerdido ? undefined : () => onMoveNext(client)}
            onMovePerdido={() => onMovePerdido(client)}
            onSendContract={() => onSendContract(client)}
          />
        ))}
      </div>
    </div>
  );
}

function ClientCard({
  client,
  onMoveNext,
  onMovePerdido,
  onSendContract,
}: {
  client: Client;
  onMoveNext?: () => void;
  onMovePerdido: () => void;
  onSendContract: () => void;
}) {
  const canSendContract = client.datos_legales_completos && client.pipeline_stage === 'cotizacion_contrato';
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 4 }}>{client.empresa_nombre}</div>
      <div style={{ fontSize: 12, color: '#4b5563' }}>{client.contacto_nombre}</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{client.contacto_email}</div>
      {client.contacto_phone && <div style={{ fontSize: 11, color: '#6b7280' }}>📱 {client.contacto_phone}</div>}
      <div style={{ marginTop: 6, padding: 6, background: '#f3f4f6', borderRadius: 4 }}>
        <div style={{ fontSize: 11, color: '#4b5563' }}>Trato: <strong>${Math.round(client.monto_deal_usd)}</strong></div>
        <div style={{ fontSize: 11, color: '#059669' }}>Tu comisión: <strong>${Math.round(client.comision_freelance_usd)}</strong></div>
      </div>
      {client.zoho_sync_status === 'ok' && (
        <div style={{ fontSize: 10, color: '#059669', marginTop: 4 }}>✓ Sincronizado con Zoho</div>
      )}
      {client.zoho_sync_status === 'failed' && (
        <div style={{ fontSize: 10, color: '#dc2626', marginTop: 4 }} title={client.zoho_sync_error ?? ''}>
          ⚠ Zoho: falló sync
        </div>
      )}
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {onMoveNext && (
          <button
            onClick={onMoveNext}
            style={{
              background: '#111827',
              color: '#fff',
              border: 'none',
              padding: '6px 8px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ▶ Siguiente etapa
          </button>
        )}
        {canSendContract && (
          <button
            onClick={onSendContract}
            style={{
              background: '#4f46e5',
              color: '#fff',
              border: 'none',
              padding: '6px 8px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
            title="Datos legales completos → dispara Zoho Sign"
          >
            📄 Enviar contrato
          </button>
        )}
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
