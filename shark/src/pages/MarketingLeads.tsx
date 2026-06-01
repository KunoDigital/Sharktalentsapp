import { useEffect, useState } from 'react';
import { useApi, type ApiMarketingLead } from '../lib/api';
import { config } from '../config';
import './pages.css';

const STATUS_LABELS: Record<ApiMarketingLead['status'], string> = {
  new: 'Nuevo',
  eval_requested: 'Eval solicitada',
  eval_completed: 'Eval completada',
  call_booked: 'Llamada agendada',
  won: 'Ganado',
  lost: 'Perdido',
};

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

export default function MarketingLeads() {
  const api = useApi();
  const [leads, setLeads] = useState<ApiMarketingLead[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tableReady, setTableReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [minScore, setMinScore] = useState<number>(0);

  useEffect(() => {
    if (!config.useApi) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.marketing.listLeads({
      status: statusFilter || undefined,
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
  }, [api, statusFilter, minScore]);

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
      <h1 className="page-title">Marketing — Leads del funnel</h1>
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
          Estado:&nbsp;
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: '0.85rem' }}>
          Score mínimo:&nbsp;
          <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
            <option value="0">Cualquiera</option>
            <option value="40">40+ (medio)</option>
            <option value="60">60+ (calientes)</option>
            <option value="80">80+ (muy calientes)</option>
          </select>
        </label>
      </div>

      {loading ? (
        <p className="muted small">Cargando leads…</p>
      ) : leads.length === 0 ? (
        <div className="stub-card">
          <p>{tableReady ? 'Sin leads que matcheen los filtros.' : 'Esperando que se cree la tabla MarketingLeads.'}</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Score</th>
              <th>Email</th>
              <th>Contacto</th>
              <th>Empresa</th>
              <th>Urgencia</th>
              <th>Salary target</th>
              <th>Source</th>
              <th>Estado</th>
              <th>Recibido</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.ROWID}>
                <td>
                  <span style={{ fontWeight: 700, color: scoreColor(l.score_quality) }}>
                    {l.score_quality}
                  </span>
                </td>
                <td>{l.email}</td>
                <td>{l.contact_name ?? '—'}</td>
                <td>{l.company ?? '—'}</td>
                <td>{URGENCY_LABELS[l.urgency] ?? l.urgency}</td>
                <td>{l.salary_target ? `$${l.salary_target.toLocaleString()}` : '—'}</td>
                <td className="muted small">{l.utm_source ?? l.source}{l.utm_campaign ? ` · ${l.utm_campaign}` : ''}</td>
                <td>
                  <span className={`status-tag status-${l.status}`}>
                    {STATUS_LABELS[l.status] ?? l.status}
                  </span>
                </td>
                <td className="muted small">
                  {new Date(l.created_at).toLocaleDateString()}
                </td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <SendDemoButton lead={l} />
                  <ViewReportButton lead={l} />
                  <ConvertToTenantButton lead={l} />
                  <SendContractButton lead={l} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
            ⚠ Faltan datos del lead (contact_name + company). Editá el lead primero o el envío va a fallar.
          </div>
        )}
        {contextLoaded && contextSource === 'draft+crm' && (
          <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: '6px', color: '#22c55e', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
            ✓ Pre-llenado desde el draft (puesto/salario) y Zoho CRM (RUC/dirección/teléfono). Editá si necesitás.
          </div>
        )}
        {contextLoaded && contextSource === 'draft' && (
          <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: '6px', color: '#22c55e', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
            ✓ Puesto y salario desde el draft. No se encontró este lead en Zoho CRM — completá RUC + dirección manualmente.
          </div>
        )}
        {contextLoaded && contextSource === 'crm' && (
          <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: '6px', color: '#22c55e', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
            ✓ RUC + dirección + teléfono desde Zoho CRM. No hay draft del puesto — escribí puesto + salario.
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

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--st-ok, #22c55e)';
  if (score >= 60) return 'var(--st-warn-fg, #f59e0b)';
  if (score >= 40) return 'var(--st-fg)';
  return 'var(--st-fg-muted)';
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
