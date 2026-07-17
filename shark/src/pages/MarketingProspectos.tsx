import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { config } from '../config';
import { useApi } from '../lib/api';

type JourneyType = 'finalista' | 'demo' | 'frio';

type V3Stage = 'candidato_en_pruebas' | 'esperando_reunion' | 'esperando_reporte' | 'reporte_enviado';

type Prospecto = {
  id: string;
  email: string;
  contact_name: string | null;
  company: string | null;
  whatsapp: string | null;
  puesto: string | null;
  journey_type: JourneyType;
  v3_stage: V3Stage | 'nuevo_asignado' | 'en_seguimiento' | 'contrato_pago' | 'perdido';
  fit_choice: string | null;
  finalist_status: string | null;
  demo_report_url: string | null;
  tests_completed: boolean;
  has_fit_report?: boolean;
  created_at: string | null;
};

type Stats = {
  total: number;
  finalistas: number;
  demos: number;
  candidato_en_pruebas: number;
  esperando_reunion: number;
  esperando_reporte: number;
  reporte_enviado?: number;
};

const STAGES: Array<{ key: V3Stage; label: string; color: string; description: string }> = [
  {
    key: 'candidato_en_pruebas',
    label: 'Candidato en pruebas',
    color: '#94a3b8',
    description: 'El candidato aún no completó las 2 pruebas',
  },
  {
    key: 'esperando_reunion',
    label: 'Esperando reunión',
    color: '#d97706',
    description: 'Cliente pidió fit y agendó — falta que asista',
  },
  {
    key: 'esperando_reporte',
    label: 'Esperando reporte',
    color: '#dc2626',
    description: 'Cliente asistió a reunión — tu turno para armar el fit report',
  },
  {
    key: 'reporte_enviado',
    label: 'Reporte enviado',
    color: '#059669',
    description: 'ZeptoMail despachó el reporte + vendedor asignado por round-robin',
  },
];

export default function MarketingProspectos() {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const api = useApi();
  const [prospectos, setProspectos] = useState<Prospecto[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flagOff, setFlagOff] = useState(false);
  const [journeyFilter, setJourneyFilter] = useState<'all' | JourneyType>('all');
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [editProspecto, setEditProspecto] = useState<Prospecto | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFlagOff(false);
    try {
      const params = new URLSearchParams();
      if (journeyFilter !== 'all') params.set('journey', journeyFilter);
      const url = `${config.apiBase}/api/marketing/prospectos${params.toString() ? '?' + params.toString() : ''}`;
      const token = await getToken();
      const res = await fetch(url, { headers: { 'X-Clerk-Token': token ?? '' } });
      if (res.status === 503) {
        const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
        if (body.error?.code === 'v3_disabled') {
          setFlagOff(true);
          setLoading(false);
          return;
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { prospectos: Prospecto[]; stats: Stats };
      setProspectos(data.prospectos ?? []);
      setStats(data.stats ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [getToken, journeyFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  function prospectosInStage(stage: V3Stage): Prospecto[] {
    return prospectos.filter((p) => p.v3_stage === stage);
  }

  async function handleSendDemo(p: Prospecto) {
    if (!confirm(`¿Enviar demo (DISC + integridad) al email ${p.email}?`)) return;
    setBusyIds((s) => new Set(s).add(p.id));
    try {
      const r = await api.marketing.sendDemoFromAdmin(p.id, {
        member_to_evaluate: {
          full_name: p.contact_name ?? p.company ?? p.email,
          email: p.email.trim().toLowerCase(),
          role: 'Cliente',
          consent_obtained: true,
        },
      });
      alert(r.message ?? `Demo enviada a ${p.email}`);
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(p.id); return n; });
    }
  }

  async function markMeetingDone(p: Prospecto) {
    if (!confirm(`¿Marcar la reunión con ${p.contact_name ?? p.email} como hecha? Pasa a "Esperando reporte".`)) return;
    setBusyIds((s) => new Set(s).add(p.id));
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/marketing/lead/${p.id}/mark-meeting-done`, {
        method: 'POST',
        headers: { 'X-Clerk-Token': token ?? '', 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      void load();
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(p.id); return n; });
    }
  }

  async function saveEdit(p: Prospecto, patch: { contact_name?: string; company?: string; whatsapp?: string }) {
    setBusyIds((s) => new Set(s).add(p.id));
    try {
      await api.marketing.patchLead(p.id, patch);
      setProspectos((list) => list.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
      setEditProspecto(null);
    } catch (err) {
      alert(`Error guardando: ${(err as Error).message}`);
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(p.id); return n; });
    }
  }

  if (flagOff) {
    return (
      <div style={{ padding: '24px 32px', background: '#f7f8fa', minHeight: '100vh', color: '#111827' }}>
        <div style={{ maxWidth: 640, margin: '80px auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 32 }}>
          <h1 style={{ margin: 0, marginBottom: 8, fontSize: 20, fontWeight: 700 }}>Marketing V3 no está activado</h1>
          <p style={{ color: '#4b5563', fontSize: 14, lineHeight: 1.6, marginTop: 12 }}>
            Esta vista consume los endpoints nuevos del modelo Prospectos + Ventas, que están detrás de un feature flag.
          </p>
          <p style={{ color: '#4b5563', fontSize: 14, lineHeight: 1.6 }}>
            Para activarla, tienes que agregar la variable <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>MARKETING_V3_ENABLED=true</code> en Catalyst Console → Server → Api → Environment Variables.
          </p>
          <p style={{ color: '#6b7280', fontSize: 12, marginTop: 20 }}>
            Mientras el flag está apagado, todo el marketing sigue funcionando con la vista clásica (Marketing → Clientes).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px', background: '#f7f8fa', minHeight: '100vh', color: '#111827' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>Marketing → Prospectos</h1>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
            Finalistas y demos en tu bandeja pre-handoff. Cuando disparas el reporte, el lead pasa automáticamente al kanban de ventas del vendedor asignado.
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
          <StatCard label="Finalistas" value={stats.finalistas} color="#7c3aed" />
          <StatCard label="Demos" value={stats.demos} color="#2563eb" />
          <StatCard label="Candidato en pruebas" value={stats.candidato_en_pruebas} color="#94a3b8" />
          <StatCard label="Esperando reunión" value={stats.esperando_reunion} color="#d97706" />
          <StatCard label="Esperando reporte" value={stats.esperando_reporte} color="#dc2626" />
          <StatCard label="Reporte enviado" value={stats.reporte_enviado ?? 0} color="#059669" />
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
            <option value="finalista">Solo Finalistas</option>
            <option value="demo">Solo Demos</option>
          </select>
        </label>
        <div style={{ marginLeft: 'auto', color: '#6b7280', fontSize: 12 }}>
          Mostrando <strong style={{ color: '#111827' }}>{prospectos.length}</strong> prospectos
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#7f1d1d', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          Error: {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Cargando…</div>
      ) : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
          {STAGES.map((stage) => {
            const cards = prospectosInStage(stage.key);
            return (
              <div
                key={stage.key}
                style={{ minWidth: 300, maxWidth: 300, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, display: 'flex', flexDirection: 'column' }}
              >
                <div style={{ padding: '12px 14px', borderBottom: '1px solid #e5e7eb', borderTop: `3px solid ${stage.color}`, borderRadius: '10px 10px 0 0' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {stage.label}
                    <span style={{ background: '#f3f4f6', padding: '2px 8px', borderRadius: 12, fontSize: 11, color: '#6b7280', fontWeight: 600 }}>{cards.length}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4, lineHeight: 1.4 }}>{stage.description}</div>
                </div>
                <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 220, maxHeight: '65vh', overflowY: 'auto', background: '#f7f8fa', borderRadius: '0 0 10px 10px' }}>
                  {cards.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 11, padding: '30px 0' }}>Vacío</div>
                  ) : (
                    cards.map((p) => (
                      <ProspectoCard
                        key={p.id}
                        prospecto={p}
                        busy={busyIds.has(p.id)}
                        onEdit={() => setEditProspecto(p)}
                        onSendDemo={() => handleSendDemo(p)}
                        onMarkMeetingDone={p.v3_stage === 'esperando_reunion' ? () => markMeetingDone(p) : undefined}
                        onArmarFitReport={p.v3_stage === 'esperando_reporte' && !p.has_fit_report ? () => navigate(`/marketing/fit-report/${p.id}`) : undefined}
                        onVerFitReport={p.has_fit_report ? () => navigate(`/marketing/fit-report/${p.id}`) : undefined}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editProspecto && (
        <EditProspectoModal
          prospecto={editProspecto}
          onClose={() => setEditProspecto(null)}
          onSave={(patch) => saveEdit(editProspecto, patch)}
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

function ProspectoCard({
  prospecto: p,
  busy = false,
  onEdit,
  onSendDemo,
  onMarkMeetingDone,
  onArmarFitReport,
  onVerFitReport,
}: {
  prospecto: Prospecto;
  busy?: boolean;
  onEdit?: () => void;
  onSendDemo?: () => void;
  onMarkMeetingDone?: () => void;
  onArmarFitReport?: () => void;
  onVerFitReport?: () => void;
}) {
  const [copiedReport, setCopiedReport] = useState(false);
  const journeyMeta = {
    finalista: { label: 'Finalista', bg: '#f5f3ff', fg: '#7c3aed' },
    demo: { label: 'Demo', bg: '#eff6ff', fg: '#2563eb' },
    frio: { label: 'Frío', bg: '#f3f4f6', fg: '#6b7280' },
  }[p.journey_type];

  const fitBadge =
    p.journey_type === 'finalista'
      ? p.fit_choice === 'agendado'
        ? { label: 'Fit', bg: '#dcfce7', fg: '#166534' }
        : { label: 'sin Fit', bg: '#f3f4f6', fg: '#6b7280' }
      : null;

  const daysSince = p.created_at ? Math.floor((Date.now() - new Date(p.created_at).getTime()) / (1000 * 60 * 60 * 24)) : null;

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, position: 'relative', opacity: busy ? 0.5 : 1 }}>
      {onEdit && (
        <button
          onClick={onEdit}
          title="Editar datos del lead"
          disabled={busy}
          style={{ position: 'absolute', top: 6, right: 6, background: 'transparent', border: 'none', cursor: busy ? 'wait' : 'pointer', fontSize: 14, color: '#6b7280', padding: 4 }}
        >
          ✏️
        </button>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8, paddingRight: 20 }}>
        <span style={{ background: journeyMeta.bg, color: journeyMeta.fg, padding: '2px 8px', borderRadius: 10, fontSize: 10.5, fontWeight: 600 }}>{journeyMeta.label}</span>
        {fitBadge && (
          <span style={{ background: fitBadge.bg, color: fitBadge.fg, padding: '2px 8px', borderRadius: 10, fontSize: 10.5, fontWeight: 600 }}>{fitBadge.label}</span>
        )}
        {p.tests_completed ? (
          <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: 10, fontSize: 10.5, fontWeight: 600 }}>✓ Pruebas listas</span>
        ) : (
          <span style={{ background: '#fef3c7', color: '#78350f', padding: '2px 8px', borderRadius: 10, fontSize: 10.5, fontWeight: 600 }}>⏳ Pruebas pendientes</span>
        )}
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '-0.01em' }}>{p.company ?? '(sin empresa)'}</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{p.contact_name ?? '(sin contacto)'}</div>
      <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 2 }}>{p.email}</div>
      {p.puesto && (
        <div style={{ fontSize: 11.5, marginTop: 8, padding: '6px 8px', background: '#f7f8fa', borderRadius: 5, fontWeight: 500 }}>💼 {p.puesto}</div>
      )}
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e5e7eb', fontSize: 11.5, color: '#6b7280' }}>
        <span>{daysSince != null ? `Hace ${daysSince} día${daysSince !== 1 ? 's' : ''}` : '—'}</span>
      </div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {onMarkMeetingDone && (
          <button
            onClick={onMarkMeetingDone}
            title="Confirmar que el cliente asistió a la reunión de fit"
            disabled={busy}
            style={{ background: '#059669', color: '#fff', border: 'none', padding: '6px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
          >
            ✓ Reunión hecha
          </button>
        )}
        {onArmarFitReport && (
          <button
            onClick={onArmarFitReport}
            title="Abrir editor de fit report (IA arma el reporte desde transcripción + notas)"
            disabled={busy}
            style={{ background: '#4f46e5', color: '#fff', border: 'none', padding: '6px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
          >
            📝 Armar fit report
          </button>
        )}
        {onVerFitReport && (
          <button
            onClick={onVerFitReport}
            title="Ver el fit report enviado (podés editar y re-enviar)"
            disabled={busy}
            style={{ background: 'transparent', color: '#7c3aed', border: '1px solid #c4b5fd', padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: busy ? 'wait' : 'pointer' }}
          >
            📄 Ver fit report
          </button>
        )}
        {onSendDemo && (
          <button
            onClick={onSendDemo}
            title="Enviar demo (DISC + integridad) al cliente"
            disabled={busy}
            style={{ background: 'transparent', color: '#0369a1', border: '1px solid #7dd3fc', padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: busy ? 'wait' : 'pointer' }}
          >
            📤 Enviar demo
          </button>
        )}
        {p.demo_report_url && (
          <div style={{ display: 'flex', gap: 4 }}>
            <a
              href={p.demo_report_url}
              target="_blank"
              rel="noreferrer"
              style={{ flex: 1, background: 'transparent', color: '#059669', border: '1px solid #6ee7b7', padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer', textAlign: 'center', textDecoration: 'none' }}
            >
              📊 Ver reporte
            </a>
            <button
              type="button"
              title="Copiar link del reporte"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(p.demo_report_url!);
                  setCopiedReport(true);
                  setTimeout(() => setCopiedReport(false), 2000);
                } catch {
                  window.prompt('Copiá el link:', p.demo_report_url!);
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

function EditProspectoModal({
  prospecto,
  onClose,
  onSave,
}: {
  prospecto: Prospecto;
  onClose: () => void;
  onSave: (patch: { contact_name?: string; company?: string; whatsapp?: string }) => void;
}) {
  const [contactName, setContactName] = useState(prospecto.contact_name ?? '');
  const [company, setCompany] = useState(prospecto.company ?? '');
  const [whatsapp, setWhatsapp] = useState(prospecto.whatsapp ?? '');
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
        <h2 style={{ margin: 0, marginBottom: 12, fontSize: 18, fontWeight: 700 }}>✏️ Editar prospecto</h2>
        <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>Email <strong>{prospecto.email}</strong> — no editable.</p>
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
