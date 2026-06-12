import { useEffect, useState } from 'react';
import { useApi, type ApiJobBudget } from '../lib/api';
import { logger } from '../lib/logger';

const log = logger('JOB_BUDGET');

function fmtUsd(n: number | null): string {
  if (n == null) return '—';
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

const LEVEL_STYLES: Record<ApiJobBudget['level'], { bar: string; bg: string; label: string }> = {
  ok: { bar: '#16a34a', bg: '#f0fdf4', label: 'OK' },
  warn: { bar: '#d97706', bg: '#fffbeb', label: '⚠️ 80% del presupuesto' },
  crit: { bar: '#dc2626', bg: '#fef2f2', label: '🚨 Sobre el 100% del presupuesto' },
  no_fee: { bar: '#6b7280', bg: 'var(--st-bg-elev-2)', label: 'Sin precio cargado' },
};

export function JobBudgetPanel({ jobId }: { jobId: string }) {
  const api = useApi();
  const [budget, setBudget] = useState<ApiJobBudget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adsAmount, setAdsAmount] = useState('');
  const [adsNote, setAdsNote] = useState('');
  const [savingAds, setSavingAds] = useState(false);
  const [adsMsg, setAdsMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function reload() {
    try {
      const res = await api.jobs.getBudget(jobId);
      setBudget(res);
      setError(null);
    } catch (err) {
      log.debug('budget fetch failed', { error: (err as Error).message });
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, [jobId]);

  async function handleAdsSubmit() {
    const n = Number(adsAmount);
    if (!Number.isFinite(n) || n <= 0) {
      setAdsMsg({ ok: false, text: 'Ingresá un monto válido en USD' });
      return;
    }
    setSavingAds(true);
    setAdsMsg(null);
    try {
      await api.jobs.addAdsSpend(jobId, { amount_usd: n, note: adsNote || undefined });
      setAdsMsg({ ok: true, text: `Registrado: $${n.toFixed(2)}` });
      setAdsAmount('');
      setAdsNote('');
      void reload();
    } catch (err) {
      setAdsMsg({ ok: false, text: (err as Error).message });
    } finally {
      setSavingAds(false);
    }
  }

  if (loading) return <div style={{ padding: 12, color: 'var(--st-fg-muted)' }}>Cargando presupuesto…</div>;
  if (error || !budget) {
    return (
      <div style={{ padding: 12, color: '#4b5563', fontSize: 13 }}>
        Presupuesto aún no disponible (tabla pendiente o columna <code>fee_usd</code> sin crear).
      </div>
    );
  }

  const style = LEVEL_STYLES[budget.level];
  const pct = budget.pct_consumed ?? 0;
  const barWidth = Math.min(100, Math.max(0, pct * 100));

  return (
    <div style={{ border: '1px solid var(--st-border)', borderRadius: 8, padding: 16, background: 'var(--st-bg-elev)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--st-fg)' }}>📊 Presupuesto del puesto (20% del fee)</h3>
        {budget.fee_usd != null && (
          <div style={{ fontSize: 13, color: 'var(--st-fg-muted)' }}>Fee cobrado: <strong>{fmtUsd(budget.fee_usd)}</strong></div>
        )}
      </div>

      {budget.level === 'no_fee' ? (
        <div style={{ padding: 12, background: style.bg, borderRadius: 6, fontSize: 13, color: 'var(--st-fg-muted)' }}>
          Para activar el control de presupuesto, cargá el precio cobrado al cliente en el formulario del puesto (campo <code>fee_usd</code>).
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div style={{ fontSize: 13, color: 'var(--st-fg-muted)' }}>
              Gastado: <strong style={{ color: 'var(--st-fg)' }}>{fmtUsd(budget.spent_usd)}</strong> de {fmtUsd(budget.budget_usd)}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: style.bar }}>
              {Math.round(pct * 100)}%
            </div>
          </div>
          <div style={{ height: 12, background: '#e5e7eb', borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{
              height: '100%',
              width: `${barWidth}%`,
              background: style.bar,
              transition: 'width 0.4s ease',
            }} />
          </div>
          <div style={{ fontSize: 12, color: style.bar, fontWeight: 600, marginBottom: 10 }}>
            {style.label}
          </div>

          {budget.level === 'crit' && (
            <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, marginBottom: 12, fontSize: 13, color: '#7f1d1d' }}>
              <strong>📋 Post-mortem:</strong> el puesto se pasó del 20% del fee. El flujo sigue funcionando, pero conviene revisar qué tipo de costo se disparó.<br />
              <div style={{ marginTop: 6 }}>
                Desglose: {Object.entries(budget.by_type)
                  .filter(([, amt]) => amt > 0)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, amt]) => `${type}=$${amt.toFixed(2)}`)
                  .join(' · ')}
              </div>
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: 12, borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>📣 Agregar gasto de pauta LinkedIn</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--st-fg-muted)', display: 'block' }}>Monto USD</label>
            <input
              type="number"
              value={adsAmount}
              onChange={(e) => setAdsAmount(e.target.value)}
              placeholder="80"
              step="0.01"
              min="0"
              style={{ width: 100, padding: '6px 8px', border: '1px solid var(--st-border-strong)', borderRadius: 4, fontSize: 14 }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 11, color: 'var(--st-fg-muted)', display: 'block' }}>Nota (opcional)</label>
            <input
              type="text"
              value={adsNote}
              onChange={(e) => setAdsNote(e.target.value)}
              placeholder="ej: Campaña Promote Job 5d"
              style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--st-border-strong)', borderRadius: 4, fontSize: 14 }}
            />
          </div>
          <button
            className="btn-toolbar"
            onClick={handleAdsSubmit}
            disabled={savingAds || !adsAmount}
            style={{ padding: '6px 14px' }}
          >
            {savingAds ? 'Guardando…' : '+ Registrar'}
          </button>
        </div>
        {adsMsg && (
          <div style={{ marginTop: 8, fontSize: 12, color: adsMsg.ok ? '#15803d' : '#991b1b' }}>
            {adsMsg.text}
          </div>
        )}
      </div>
    </div>
  );
}
