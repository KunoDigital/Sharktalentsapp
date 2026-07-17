import { useEffect, useState } from 'react';
import { useApi, type ApiMarketingLead } from '../lib/api';
import { config } from '../config';
import './pages.css';

const URGENCY_LABELS: Record<ApiMarketingLead['urgency'], string> = {
  'less_30d': '<30 días',
  '1-3m': '1-3 meses',
  '3m+': '3+ meses',
  'exploring': 'Explorando',
};

type Stats = {
  total: number;
  new: number;
  eval_requested: number;
  eval_completed: number;
  call_booked: number;
  won: number;
  lost: number;
};

type LeadStatus = ApiMarketingLead['status'];

const KANBAN_STAGES: Array<{ key: LeadStatus; label: string; color: string }> = [
  { key: 'new', label: 'Nuevo', color: '#dafd6f' },
  { key: 'eval_requested', label: 'Eval solicitada', color: '#6366f1' },
  { key: 'eval_completed', label: 'Eval completada', color: '#a855f7' },
  { key: 'call_booked', label: 'Llamada agendada', color: '#fbbf24' },
  { key: 'won', label: 'Ganado', color: '#34d399' },
];

export default function MarketingLeads() {
  const api = useApi();
  const [leads, setLeads] = useState<ApiMarketingLead[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tableReady, setTableReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minScore, setMinScore] = useState<number>(0);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<LeadStatus | null>(null);
  const [movingIds, setMovingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!config.useApi) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.marketing.listLeads({
      minScore: minScore || undefined,
      limit: 200,
    })
      .then((r) => {
        if (cancelled) return;
        setLeads(r.leads);
        setStats(r.stats);
        setTableReady(r.table_ready);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, minScore]);

  async function moveLead(leadId: string, newStatus: LeadStatus) {
    const lead = leads.find((l) => l.ROWID === leadId);
    if (!lead || lead.status === newStatus) return;
    const prevStatus = lead.status;
    setLeads((prev) => prev.map((l) => (l.ROWID === leadId ? { ...l, status: newStatus } : l)));
    setMovingIds((prev) => new Set(prev).add(leadId));
    setStats((prev) => prev && {
      ...prev,
      [prevStatus]: Math.max(0, prev[prevStatus] - 1),
      [newStatus]: prev[newStatus] + 1,
    });
    try {
      await api.marketing.patchLead(leadId, { status: newStatus });
    } catch (err) {
      setLeads((prev) => prev.map((l) => (l.ROWID === leadId ? { ...l, status: prevStatus } : l)));
      setStats((prev) => prev && {
        ...prev,
        [newStatus]: Math.max(0, prev[newStatus] - 1),
        [prevStatus]: prev[prevStatus] + 1,
      });
      setMoveError(`No se pudo mover el lead: ${(err as Error).message}`);
      setTimeout(() => setMoveError(null), 5000);
    } finally {
      setMovingIds((prev) => {
        const next = new Set(prev);
        next.delete(leadId);
        return next;
      });
    }
  }

  if (!config.useApi) {
    return (
      <div>
        <h1 className="page-title">Marketing Leads</h1>
        <p className="muted-note">
          Esta vista requiere backend conectado. Setear <code>VITE_USE_API=true</code> en <code>shark/.env</code>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{
        background: 'rgba(245,158,11,0.12)',
        border: '1px solid rgba(245,158,11,0.4)',
        borderRadius: 10,
        padding: '14px 18px',
        marginBottom: 20,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: '1 1 320px' }}>
          <div style={{ fontWeight: 700, color: '#f59e0b', fontSize: 14, marginBottom: 4 }}>
            ⚠️ Panel legacy — vamos a eliminarlo
          </div>
          <div style={{ color: '#d1d5db', fontSize: 13, lineHeight: 1.5 }}>
            Los mismos leads están en <strong>Marketing → Clientes</strong> con más features
            (drag & drop entre etapas, filtro por vendedor, sync a Zoho, finalistas conectados).
            Este panel se elimina cuando confirmes que el nuevo cubre todo tu flujo.
          </div>
        </div>
        <a
          href="/marketing/clientes"
          style={{
            background: '#4f46e5',
            color: '#fff',
            padding: '9px 16px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          → Ir a Marketing Clientes
        </a>
      </div>

      <h1 className="page-title">Marketing — Leads del funnel (legacy)</h1>
      <p className="page-subtitle">
        Captura del quiz + calculadora de la landing. Cuando alguien completa el quiz, aparece acá con su score de calidad.
      </p>

      {!tableReady && (
        <p className="muted-note">
          ⏳ Tabla <code>MarketingLeads</code> aún no creada en Catalyst. La landing no puede capturar leads todavía.
        </p>
      )}

      {error && (
        <p className="muted small" style={{ color: 'var(--st-warn-fg)' }}>
          ⚠️ {error}
        </p>
      )}

      {stats && tableReady && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Nuevos" value={stats.new} highlight={stats.new > 0} />
          <StatCard label="Eval pedida" value={stats.eval_requested} />
          <StatCard label="Eval completa" value={stats.eval_completed} />
          <StatCard label="Llamada" value={stats.call_booked} />
          <StatCard label="Ganados" value={stats.won} highlight={stats.won > 0} />
          <StatCard label="Perdidos" value={stats.lost} muted />
        </div>
      )}

      <div className="filters-bar" style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '0.85rem' }}>
          Score mínimo:&nbsp;
          <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
            <option value="0">Cualquiera</option>
            <option value="40">40+ (medio)</option>
            <option value="60">60+ (calientes)</option>
            <option value="80">80+ (muy calientes)</option>
          </select>
        </label>
        <CaptureManualLeadButton onCreated={() => window.location.reload()} />
        <ImportFromCrmButton onImported={() => window.location.reload()} />
      </div>

      {moveError && (
        <div className="kanban-move-error">⚠️ {moveError}</div>
      )}

      {loading ? (
        <p className="muted small">Cargando leads…</p>
      ) : leads.length === 0 ? (
        <div className="stub-card">
          <p>{tableReady ? 'Sin leads que matcheen los filtros.' : 'Esperando que se cree la tabla MarketingLeads.'}</p>
        </div>
      ) : (
        <>
          <p className="muted small" style={{ marginBottom: '0.5rem' }}>
            Arrastrá una tarjeta a otra columna para cambiar el estado del lead.
          </p>
          <div className="kanban-board">
            {KANBAN_STAGES.map((stage) => {
              const colLeads = leads.filter((l) => l.status === stage.key);
              return (
                <div
                  key={stage.key}
                  className={`kanban-col ${dragOverCol === stage.key ? 'is-drag-over' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOverCol(stage.key); }}
                  onDragLeave={() => { if (dragOverCol === stage.key) setDragOverCol(null); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverCol(null);
                    const leadId = e.dataTransfer.getData('text/plain');
                    if (leadId) void moveLead(leadId, stage.key);
                  }}
                >
                  <header className="kanban-col-header" style={{ borderTopColor: stage.color }}>
                    <span className="kanban-col-label">{stage.label}</span>
                    <span className="kanban-col-count">{colLeads.length}</span>
                  </header>
                  <div className="kanban-col-body">
                    {colLeads.length === 0 ? (
                      <p className="muted small kanban-empty">—</p>
                    ) : (
                      colLeads.map((l) => (
                        <LeadCard key={l.ROWID} lead={l} isMoving={movingIds.has(l.ROWID)} />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {(() => {
            const lostLeads = leads.filter((l) => l.status === 'lost');
            if (lostLeads.length === 0) return null;
            return (
              <details className="kanban-lost"
                onDragOver={(e) => { e.preventDefault(); setDragOverCol('lost'); }}
                onDragLeave={() => { if (dragOverCol === 'lost') setDragOverCol(null); }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverCol(null);
                  const leadId = e.dataTransfer.getData('text/plain');
                  if (leadId) void moveLead(leadId, 'lost');
                }}
              >
                <summary>Perdidos · {lostLeads.length}</summary>
                <div className="kanban-lost-grid">
                  {lostLeads.map((l) => (
                    <LeadCard key={l.ROWID} lead={l} isMoving={movingIds.has(l.ROWID)} />
                  ))}
                </div>
              </details>
            );
          })()}
        </>
      )}
    </div>
  );
}

function LeadCard({ lead, isMoving }: { lead: ApiMarketingLead; isMoving: boolean }) {
  const [isDragging, setIsDragging] = useState(false);
  return (
    <div
      className={`kanban-card ${isDragging ? 'is-dragging' : ''} ${isMoving ? 'is-moving' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', lead.ROWID);
        e.dataTransfer.effectAllowed = 'move';
        setIsDragging(true);
      }}
      onDragEnd={() => setIsDragging(false)}
    >
      <div className="kanban-card-header">
        <span className="kanban-card-score" style={{ color: scoreColor(lead.score_quality) }}>
          {lead.score_quality}
        </span>
        <span className="kanban-card-name" title={lead.email}>
          {lead.contact_name ?? lead.email}
        </span>
      </div>
      <div className="kanban-card-meta">
        {lead.company && <div className="kanban-card-company">{lead.company}</div>}
        <div className="kanban-card-row">
          <span>{URGENCY_LABELS[lead.urgency] ?? lead.urgency}</span>
          {lead.salary_target ? <span>${lead.salary_target.toLocaleString()}</span> : null}
        </div>
        <div className="kanban-card-source muted small">
          {lead.utm_source ?? lead.source} · {new Date(lead.created_at).toLocaleDateString()}
        </div>
      </div>
      <div className="kanban-card-actions">
        <SendDemoButton lead={lead} />
        <ViewReportButton lead={lead} />
        {(lead.status === 'eval_completed' || lead.status === 'call_booked' || lead.status === 'won') && (
          <ConvertToTenantButton lead={lead} />
        )}
        {lead.status === 'won' && <SendContractButton lead={lead} />}
      </div>
    </div>
  );
}

function SendDemoButton({ lead }: { lead: ApiMarketingLead }) {
  const api = useApi();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function handleSend() {
    setSending(true);
    setResult(null);
    try {
      const r = await api.marketing.sendDemoFromAdmin(lead.ROWID, {
        member_to_evaluate: {
          full_name: lead.contact_name ?? lead.company ?? lead.email,
          email: lead.email.trim().toLowerCase(),
          role: 'Cliente',
          consent_obtained: true,
        },
      });
      setResult({ ok: true, msg: r.message ?? `Demo enviada a ${lead.email}` });
    } catch (err) {
      setResult({ ok: false, msg: (err as Error).message });
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.2rem' }}>
      <button
        type="button"
        className="btn-toolbar"
        style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}
        onClick={handleSend}
        disabled={sending || result?.ok}
        title={`Enviar demo (DISC + integridad) al cliente ${lead.email}`}
      >
        {sending ? 'Enviando…' : result?.ok ? '✓ Demo enviada' : '📤 Demo'}
      </button>
      {result && !result.ok && (
        <span style={{ fontSize: '0.7rem', color: '#ff8888' }} title={result.msg}>Error — pasá el mouse</span>
      )}
    </div>
  );
}

function ViewReportButton({ lead }: { lead: ApiMarketingLead }) {
  const [copied, setCopied] = useState(false);
  if (!lead.demo_report_url) {
    return (
      <button
        type="button"
        className="btn-toolbar"
        style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', opacity: 0.4, cursor: 'not-allowed' }}
        disabled
        title="Demo aún no completada — el reporte aparece cuando el cliente termina las 2 pruebas"
      >
        📊 Reporte
      </button>
    );
  }
  return (
    <div style={{ display: 'inline-flex', gap: 4 }}>
      <a
        href={lead.demo_report_url}
        target="_blank"
        rel="noreferrer"
        className="btn-toolbar"
        style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', textDecoration: 'none' }}
        title="Abrir reporte en nueva pestaña"
      >
        📊 Ver reporte
      </a>
      <button
        type="button"
        className="btn-toolbar"
        style={{ fontSize: '0.78rem', padding: '0.3rem 0.5rem' }}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(lead.demo_report_url!);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            window.prompt('Copiá el link manualmente:', lead.demo_report_url!);
          }
        }}
        title="Copiar link para mandar por WhatsApp"
      >
        {copied ? '✓' : '📋'}
      </button>
    </div>
  );
}

function ConvertToTenantButton({ lead }: { lead: ApiMarketingLead }) {
  const api = useApi();
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string; tenantId?: string; slug?: string } | null>(null);
  const alreadyConverted = lead.status === 'won';

  async function handleConvert() {
    if (alreadyConverted) return;
    if (!lead.contact_name || !lead.company) {
      setResult({ ok: false, msg: 'Falta contact_name o company en el lead. Edítalo primero.' });
      return;
    }
    if (!confirm(`¿Convertir a "${lead.company}" en cliente activo de SharkTalents?\n\nEsto crea un tenant nuevo y marca el lead como ganado.`)) {
      return;
    }
    setConverting(true);
    setResult(null);
    try {
      const r = await api.marketing.convertToTenant(lead.ROWID);
      setResult({ ok: true, msg: `Cliente creado · slug "${r.slug}"`, tenantId: r.tenant_id, slug: r.slug });
    } catch (err) {
      setResult({ ok: false, msg: (err as Error).message });
    } finally {
      setConverting(false);
    }
  }

  if (alreadyConverted) {
    return (
      <span style={{ fontSize: '0.75rem', padding: '0.3rem 0.55rem', borderRadius: '4px', background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontWeight: 600 }}>
        ✓ Cliente
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn-toolbar"
        style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}
        onClick={handleConvert}
        disabled={converting}
        title="Convertir este lead en un tenant activo de SharkTalents"
      >
        {converting ? 'Convirtiendo…' : '→ Convertir'}
      </button>
      {result && (
        <div
          style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: 'var(--st-bg, #1a1a1a)', border: `1px solid ${result.ok ? 'rgba(34,197,94,0.4)' : 'rgba(220,53,69,0.4)'}`,
            borderRadius: '10px', padding: '1.5rem', zIndex: 200, maxWidth: '420px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
          }}
        >
          <h3 style={{ marginTop: 0, color: result.ok ? '#22c55e' : '#ff8888' }}>
            {result.ok ? '✓ Cliente convertido' : 'Error al convertir'}
          </h3>
          <p style={{ marginBottom: '1rem' }}>{result.msg}</p>
          {result.ok && result.slug && (
            <p className="muted small">
              Tenant ID: <code>{result.tenantId}</code>
            </p>
          )}
          <button type="button" className="btn-toolbar" onClick={() => setResult(null)}>Cerrar</button>
        </div>
      )}
    </>
  );
}

function SendContractButton({ lead }: { lead: ApiMarketingLead }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [puesto, setPuesto] = useState('');
  const [salario, setSalario] = useState<number>(lead.salary_target ?? 0);
  const [ruc, setRuc] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState(lead.whatsapp ?? '');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [contextSource, setContextSource] = useState<'draft' | 'lead' | 'crm' | 'draft+crm' | 'none' | null>(null);

  const missingClient = !lead.contact_name || !lead.company;

  // Cuando el modal se abre, traer del backend lo que ya sabemos del lead/draft/CRM.
  // Pre-llena puesto + salario desde el draft, y RUC + dirección + phone desde Zoho CRM.
  useEffect(() => {
    if (!open || contextLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const ctx = await api.marketing.getContractContext(lead.ROWID);
        if (cancelled) return;
        if (ctx.puesto_nombre) setPuesto(ctx.puesto_nombre);
        if (ctx.puesto_salario_usd && ctx.puesto_salario_usd > 0) setSalario(ctx.puesto_salario_usd);
        if (ctx.client_phone && !phone) setPhone(ctx.client_phone);
        if (ctx.client_ruc_nit_ein) setRuc(ctx.client_ruc_nit_ein);
        if (ctx.client_address) setAddress(ctx.client_address);
        setContextSource(ctx.source);
      } catch {
        setContextSource('none');
      } finally {
        if (!cancelled) setContextLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  async function handleSend() {
    if (!puesto.trim() || salario <= 0) {
      setResult({ ok: false, msg: 'Puesto y salario son obligatorios.' });
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const r = await api.marketing.sendContract(lead.ROWID, {
        puesto_nombre: puesto.trim(),
        puesto_salario_usd: salario,
        client_ruc_nit_ein: ruc.trim() || undefined,
        client_address: address.trim() || undefined,
        client_phone: phone.trim() || undefined,
      });
      setResult({ ok: true, msg: r.message ?? 'Contrato enviado — el cliente lo recibe por email para firmar.' });
    } catch (err) {
      setResult({ ok: false, msg: (err as Error).message });
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn-toolbar"
        style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}
        onClick={() => setOpen(true)}
        title={missingClient ? 'Faltan contact_name + company en el lead' : 'Enviar contrato por Zoho Sign'}
      >
        📄 Contrato
      </button>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => !sending && setOpen(false)}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--st-bg)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1.5rem', width: '100%', maxWidth: '480px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Enviar contrato a {lead.contact_name ?? lead.email}</h3>
        <p className="muted small" style={{ marginTop: 0, marginBottom: '1rem' }}>
          El cliente recibe el contrato por email vía Zoho Sign para firma electrónica. El fee total es 20% del salario, en 2 tractos.
        </p>
        {missingClient && (
          <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '6px', color: '#f59e0b', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
            ⚠ Faltan datos del lead (contact_name + company). Edita el lead primero o el envío va a fallar.
          </div>
        )}
        {contextLoaded && contextSource === 'draft+crm' && (
          <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: '6px', color: '#22c55e', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
            ✓ Pre-llenado desde el draft (puesto/salario) y Zoho CRM (RUC/dirección/teléfono). Edita si necesitas.
          </div>
        )}
        {contextLoaded && contextSource === 'draft' && (
          <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: '6px', color: '#22c55e', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
            ✓ Puesto y salario desde el draft. No se encontró este lead en Zoho CRM — completa RUC + dirección manualmente.
          </div>
        )}
        {contextLoaded && contextSource === 'crm' && (
          <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: '6px', color: '#22c55e', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
            ✓ RUC + dirección + teléfono desde Zoho CRM. No hay draft del puesto — escribe puesto + salario.
          </div>
        )}
        {contextLoaded && contextSource === 'none' && (
          <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(148,163,184,0.1)', border: '1px solid rgba(148,163,184,0.3)', borderRadius: '6px', color: 'var(--muted)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
            ℹ No encontré draft ni registro en CRM para este lead. Completá todo manualmente.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <span className="muted small">Puesto a buscar *</span>
            <input type="text" value={puesto} onChange={(e) => setPuesto(e.target.value)} placeholder="Ej: Gerente de Ventas" style={{ padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <span className="muted small">Salario USD/mes *</span>
            <input type="number" value={salario} onChange={(e) => setSalario(Number(e.target.value))} min={0} style={{ padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)' }} />
            {salario > 0 && (
              <span className="muted small">Fee total: ${(salario * 1.2).toLocaleString()} · 2 tractos de ${(salario * 0.6).toLocaleString()} c/u</span>
            )}
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <span className="muted small">RUC / NIT / EIN del cliente (opcional)</span>
            <input type="text" value={ruc} onChange={(e) => setRuc(e.target.value)} style={{ padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <span className="muted small">Dirección fiscal (opcional)</span>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} style={{ padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <span className="muted small">Teléfono del cliente (opcional)</span>
            <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)' }} />
          </label>
        </div>
        {result && (
          <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.75rem', borderRadius: '6px', fontSize: '0.85rem', background: result.ok ? 'rgba(34,197,94,0.1)' : 'rgba(220,53,69,0.1)', border: `1px solid ${result.ok ? 'rgba(34,197,94,0.4)' : 'rgba(220,53,69,0.4)'}`, color: result.ok ? '#22c55e' : '#ff8888' }}>
            {result.msg}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn-toolbar" onClick={() => setOpen(false)} disabled={sending}>Cerrar</button>
          <button type="button" className="btn-primary" onClick={handleSend} disabled={sending || result?.ok}>
            {sending ? 'Enviando…' : result?.ok ? 'Enviado ✓' : 'Enviar contrato'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportFromCrmButton({ onImported }: { onImported: () => void }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Array<{
    crm_id: string; email: string; contact_name: string | null; company: string | null;
    phone: string | null; lead_source: string | null; already_imported: boolean;
  }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function loadList() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.marketing.listCrmLeadsForImport('SharkTalents');
      if (!r.ok) {
        setError(r.error ?? 'Error consultando Zoho CRM');
        setItems([]);
      } else {
        setItems(r.items);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) loadList();
  }, [open]);

  function toggle(email: string) {
    setSelected((curr) => {
      const next = new Set(curr);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  }

  async function handleImport() {
    if (selected.size === 0) return;
    setImporting(true);
    setProgress({ done: 0, total: selected.size });
    const emails = Array.from(selected);
    let done = 0;
    let failed: string[] = [];
    for (const email of emails) {
      try {
        await api.marketing.importLeadFromCrm(email);
      } catch (err) {
        failed.push(`${email}: ${(err as Error).message}`);
      }
      done++;
      setProgress({ done, total: emails.length });
    }
    setImporting(false);
    if (failed.length > 0) {
      setError(`${failed.length} de ${emails.length} fallaron:\n${failed.join('\n')}`);
    } else {
      setOpen(false);
      onImported();
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn-toolbar"
        style={{ fontSize: '0.85rem', marginLeft: 'auto' }}
        onClick={() => setOpen(true)}
        title="Traer leads de Zoho CRM con etiqueta SharkTalents"
      >
        📥 Importar de CRM
      </button>
    );
  }

  const importables = items.filter((i) => !i.already_imported);
  const alreadyIn = items.filter((i) => i.already_imported).length;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => !importing && setOpen(false)}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--st-bg)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1.5rem', width: '100%', maxWidth: '640px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ marginTop: 0, marginBottom: '0.4rem' }}>📥 Importar leads desde Zoho CRM</h3>
        <p className="muted small" style={{ marginTop: 0, marginBottom: '1rem' }}>
          Mostrando leads con etiqueta <code>SharkTalents</code> en CRM. Los que ya están en SharkTalents aparecen en gris.
        </p>

        {loading && <p className="muted small">Consultando Zoho CRM…</p>}
        {error && (
          <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(220,53,69,0.12)', border: '1px solid rgba(220,53,69,0.4)', borderRadius: '6px', color: '#ff8888', fontSize: '0.85rem', marginBottom: '0.75rem', whiteSpace: 'pre-wrap' }}>
            {error}
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <p className="muted">No se encontraron leads con etiqueta <code>SharkTalents</code> en CRM. Asegurate que el tag esté escrito exactamente <code>SharkTalents</code> y aplicado a algún lead.</p>
        )}

        {!loading && items.length > 0 && (
          <>
            {alreadyIn > 0 && (
              <p className="muted small" style={{ marginBottom: '0.5rem' }}>
                {alreadyIn} lead{alreadyIn !== 1 ? 's' : ''} ya están en SharkTalents. {importables.length} disponibles para importar.
              </p>
            )}

            <div style={{ overflowY: 'auto', flex: 1, border: '1px solid var(--border)', borderRadius: '6px' }}>
              {items.map((item) => (
                <label
                  key={item.crm_id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.6rem',
                    padding: '0.6rem 0.75rem',
                    borderBottom: '1px solid var(--border)',
                    opacity: item.already_imported ? 0.5 : 1,
                    cursor: item.already_imported ? 'not-allowed' : 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    disabled={item.already_imported}
                    checked={selected.has(item.email)}
                    onChange={() => toggle(item.email)}
                    style={{ marginTop: '0.2rem' }}
                  />
                  <div style={{ flex: 1, fontSize: '0.88rem' }}>
                    <div style={{ fontWeight: 600 }}>{item.email}</div>
                    <div className="muted small">
                      {item.contact_name ?? '—'} {item.company ? `· ${item.company}` : ''}
                    </div>
                    {item.phone && <div className="muted small">📞 {item.phone}</div>}
                    {item.lead_source && <div className="muted small">Source: {item.lead_source}</div>}
                    {item.already_imported && <div style={{ fontSize: '0.7rem', color: '#22c55e' }}>✓ Ya en SharkTalents</div>}
                  </div>
                </label>
              ))}
            </div>

            {progress && (
              <p className="muted small" style={{ marginTop: '0.5rem' }}>
                Importando… {progress.done} / {progress.total}
              </p>
            )}
          </>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn-toolbar" onClick={() => setOpen(false)} disabled={importing}>
            Cerrar
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleImport}
            disabled={importing || selected.size === 0 || importables.length === 0}
          >
            {importing ? 'Importando…' : `Importar ${selected.size} lead${selected.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--st-ok, #22c55e)';
  if (score >= 60) return 'var(--st-warn-fg, #f59e0b)';
  if (score >= 40) return 'var(--st-fg)';
  return 'var(--st-fg-muted)';
}

/**
 * Botón "Capturar manual" — crea un MarketingLead directo desde el admin sin pasar
 * por el funnel público. Útil para: leads que llegaron por WhatsApp/llamada/recomendación,
 * setup de tests E2E, y cualquier lead sin tracking.
 */
function CaptureManualLeadButton({ onCreated }: { onCreated: () => void }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [company, setCompany] = useState('');
  const [whatsapp, setWhatsapp] = useState('');

  async function handleSubmit() {
    setError(null);
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Email inválido.');
      return;
    }
    setSubmitting(true);
    try {
      await api.marketing.createManualLead({
        email: email.trim(),
        contact_name: contactName.trim() || undefined,
        company: company.trim() || undefined,
        whatsapp: whatsapp.trim() || undefined,
      });
      setOpen(false);
      setEmail(''); setContactName(''); setCompany(''); setWhatsapp('');
      onCreated();
    } catch (err) {
      setError((err as Error).message || 'No se pudo crear el lead.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn-toolbar"
        onClick={() => setOpen(true)}
      >
        ➕ Capturar manual
      </button>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => !submitting && setOpen(false)}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--st-bg)', border: '1px solid var(--st-border-soft)', borderRadius: '10px', padding: '1.5rem', width: '100%', maxWidth: '480px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '0.4rem' }}>➕ Capturar lead manual</h3>
        <p className="muted small" style={{ marginTop: 0, marginBottom: '1rem' }}>
          Crear un lead sin pasar por el funnel público. Útil para leads que llegaron por WhatsApp, llamada o recomendación.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <span className="muted small">Email *</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@empresa.com" style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--st-border-soft)', background: 'var(--st-bg-elev)', color: 'var(--st-fg)' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <span className="muted small">Nombre de contacto</span>
            <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Diego Méndez" style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--st-border-soft)', background: 'var(--st-bg-elev)', color: 'var(--st-fg)' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <span className="muted small">Empresa</span>
            <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="PixelWeb Digital" style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--st-border-soft)', background: 'var(--st-bg-elev)', color: 'var(--st-fg)' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <span className="muted small">WhatsApp (opcional)</span>
            <input type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+507..." style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--st-border-soft)', background: 'var(--st-bg-elev)', color: 'var(--st-fg)' }} />
          </label>
          {error && <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(220,53,69,0.1)', border: '1px solid rgba(220,53,69,0.4)', borderRadius: '6px', color: '#ff8888', fontSize: '0.88rem' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button type="button" className="btn-toolbar" onClick={() => setOpen(false)} disabled={submitting}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={handleSubmit} disabled={submitting || !email.trim()}>
              {submitting ? 'Creando…' : 'Crear lead'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, highlight, muted }: { label: string; value: number; highlight?: boolean; muted?: boolean }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '0.75rem 0.9rem',
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: '1.5rem',
        fontWeight: 700,
        color: highlight ? 'var(--st-ok)' : muted ? 'var(--st-fg-muted)' : 'var(--st-fg)',
        lineHeight: 1.1,
        marginBottom: '0.2rem',
      }}>
        {value}
      </div>
      <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--st-fg-muted)' }}>
        {label}
      </div>
    </div>
  );
}
