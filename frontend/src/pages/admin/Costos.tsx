import { useEffect, useState } from 'react';
import { getJobsCosts, updateCostConfig } from '../../services/api';
import type { CSSProperties } from 'react';

interface JobCost {
  id: string;
  title: string;
  company: string;
  is_active: string | number;
  client_type: 'normal' | 'especial' | 'interno';
  salary: number;
  advertising: number;
  hours: number;
  kudert_count: number;
  integrity_count: number;
  tokens_input: number;
  tokens_output: number;
  tokens_estimated: boolean;
}

// Claude Haiku 4.5 pricing per million tokens
const INPUT_COST_PER_M = 1.0;
const OUTPUT_COST_PER_M = 5.0;

const KUDERT_PRICE = 15;
const INTEGRITY_PRICE = 25;
const COMMISSION_RATE = 0.06;
const NORMAL_RATE = 1.2;
const HOURLY_COST = 11.08; // ($1500×12 + $1500 décimo) / 1760h (11 meses productivos)

const TYPE_LABELS: Record<string, string> = { normal: 'Normal', especial: 'Especial', interno: 'Interno' };

export default function Costos() {
  const [jobs, setJobs] = useState<JobCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ client_type: 'normal', salary: 0, advertising: 0, hours: 0 });
  const [saving, setSaving] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('costos_hidden') || '[]')); } catch { return new Set(); }
  });
  const [showHidden, setShowHidden] = useState(false);

  const toggleHide = (id: string) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem('costos_hidden', JSON.stringify([...next]));
      return next;
    });
  };

  useEffect(() => {
    getJobsCosts().then(data => { setJobs(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const startEdit = (job: JobCost) => {
    setEditingId(job.id);
    setEditForm({ client_type: job.client_type, salary: job.salary, advertising: job.advertising, hours: job.hours || 0 });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    await updateCostConfig(editingId, editForm as any);
    setJobs(prev => prev.map(j => j.id === editingId ? { ...j, ...editForm } as JobCost : j));
    setEditingId(null);
    setSaving(false);
  };

  const calcRow = (j: JobCost) => {
    const cloud = (j.tokens_input / 1_000_000) * INPUT_COST_PER_M + (j.tokens_output / 1_000_000) * OUTPUT_COST_PER_M;
    const commission = j.client_type !== 'interno' ? j.salary * COMMISSION_RATE : 0;
    const timeCost = (j.hours || 0) * HOURLY_COST;
    const totalCosts = cloud + j.advertising + commission + timeCost;

    let income: number;
    if (j.client_type === 'interno') {
      income = 0;
    } else if (j.client_type === 'especial') {
      income = (j.kudert_count * KUDERT_PRICE) + (j.integrity_count * INTEGRITY_PRICE) + commission;
    } else {
      income = j.salary * NORMAL_RATE;
    }

    const profit = income - totalCosts;
    const profitability = income > 0 ? Math.round((profit / income) * 100) : (j.client_type === 'interno' ? -100 : 0);
    return { cloud, commission, timeCost, totalCosts, income, profit, profitability };
  };

  if (loading) return <p style={{ color: 'var(--kuno-text-muted)', padding: 24 }}>Cargando...</p>;

  const visibleJobs = jobs.filter(j => showHidden || !hidden.has(j.id));
  const hiddenCount = jobs.filter(j => hidden.has(j.id)).length;

  // Totals (only visible, non-hidden)
  let totCloud = 0, totAd = 0, totComm = 0, totTime = 0, totCosts = 0, totIncome = 0, totProfit = 0;
  for (const j of visibleJobs.filter(j => !hidden.has(j.id))) {
    const r = calcRow(j);
    totCloud += r.cloud;
    totAd += j.advertising;
    totComm += r.commission;
    totTime += r.timeCost;
    totCosts += r.totalCosts;
    totIncome += r.income;
    totProfit += r.profit;
  }
  const totRent = totIncome > 0 ? Math.round((totProfit / totIncome) * 100) : 0;

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--kuno-cream)', marginBottom: 8 }}>Costos y Rentabilidad</h1>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--kuno-text-muted)' }}>Costo hora: ${HOURLY_COST}/h ($19,500/año / 1,760h)</p>
        {hiddenCount > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--kuno-text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} style={{ accentColor: 'var(--kuno-lime)' }} />
            Mostrar ocultos ({hiddenCount})
          </label>
        )}
      </div>

      <div style={tableWrapper}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Puesto</th>
              <th style={thStyle}>Tipo</th>
              <th style={thStyle}>Salario</th>
              <th style={thStyle}>Horas</th>
              <th style={thStyle}>Pruebas</th>
              <th style={thStyle}>Cloud</th>
              <th style={thStyle}>Publicidad</th>
              <th style={thStyle}>Comisión 6%</th>
              <th style={thStyle}>Mi tiempo</th>
              <th style={thStyle}>Total Costos</th>
              <th style={thStyle}>Ingreso</th>
              <th style={thStyle}>Ganancia</th>
              <th style={thStyle}>Rent.</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {visibleJobs.map(j => {
              const r = calcRow(j);
              const isEditing = editingId === j.id;
              const isHidden = hidden.has(j.id);
              return (
                <tr key={j.id} style={{ borderTop: '1px solid var(--kuno-border)', opacity: isHidden ? 0.4 : 1 }}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600, color: 'var(--kuno-cream)' }}>{j.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--kuno-text-muted)' }}>{j.company}</div>
                  </td>
                  <td style={tdStyle}>
                    {isEditing ? (
                      <select value={editForm.client_type} onChange={e => setEditForm(p => ({ ...p, client_type: e.target.value }))} style={inputSmall}>
                        <option value="normal">Normal</option>
                        <option value="especial">Especial</option>
                        <option value="interno">Interno</option>
                      </select>
                    ) : (
                      <span style={j.client_type === 'especial' ? badgeEspecial : j.client_type === 'interno' ? badgeInterno : badgeNormal}>
                        {TYPE_LABELS[j.client_type] || 'Normal'}
                      </span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {isEditing ? (
                      <input type="number" value={editForm.salary} onChange={e => setEditForm(p => ({ ...p, salary: Number(e.target.value) }))} style={{ ...inputSmall, width: 80 }} />
                    ) : (
                      <span style={{ color: 'var(--kuno-cream)' }}>{j.salary > 0 ? `$${j.salary.toLocaleString()}` : '—'}</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {isEditing ? (
                      <input type="number" step="0.5" value={editForm.hours} onChange={e => setEditForm(p => ({ ...p, hours: Number(e.target.value) }))} style={{ ...inputSmall, width: 60 }} />
                    ) : (
                      <span style={{ color: 'var(--kuno-cream)' }}>{(j.hours || 0) > 0 ? `${j.hours}h` : '—'}</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ fontSize: 11, color: 'var(--kuno-text-muted)' }}>
                      <span>K: {j.kudert_count}</span>
                      <span style={{ marginLeft: 8 }}>I: {j.integrity_count}</span>
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <span style={costColor}>${r.cloud.toFixed(4)}</span>
                    <div style={{ fontSize: 10, color: 'var(--kuno-text-muted)' }}>
                      {j.tokens_input.toLocaleString()}in + {j.tokens_output.toLocaleString()}out
                      {j.tokens_estimated && <span style={{ color: '#f39c12', marginLeft: 4 }}>~est</span>}
                    </div>
                  </td>
                  <td style={tdStyle}>
                    {isEditing ? (
                      <input type="number" value={editForm.advertising} onChange={e => setEditForm(p => ({ ...p, advertising: Number(e.target.value) }))} style={{ ...inputSmall, width: 80 }} />
                    ) : (
                      <span style={costColor}>${j.advertising.toLocaleString()}</span>
                    )}
                  </td>
                  <td style={tdStyle}><span style={costColor}>{j.client_type === 'interno' ? '—' : `$${r.commission.toFixed(2)}`}</span></td>
                  <td style={tdStyle}><span style={costColor}>${r.timeCost.toFixed(2)}</span></td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}><span style={costColor}>${r.totalCosts.toFixed(2)}</span></td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>
                    {j.client_type === 'interno' ? (
                      <span style={{ color: 'var(--kuno-text-muted)' }}>Interno</span>
                    ) : (
                      <>
                        <span style={{ color: 'var(--kuno-lime)' }}>${r.income.toFixed(2)}</span>
                        {j.client_type === 'especial' && (
                          <div style={{ fontSize: 10, color: 'var(--kuno-text-muted)' }}>
                            {j.kudert_count}×$15 + {j.integrity_count}×$25 + 6%
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>
                    <span style={{ color: r.profit >= 0 ? 'var(--kuno-lime)' : 'var(--kuno-danger)' }}>
                      ${r.profit.toFixed(2)}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {j.client_type === 'interno' ? (
                      <span style={{ fontWeight: 700, color: 'var(--kuno-text-muted)' }}>N/A</span>
                    ) : (
                      <span style={{ fontWeight: 700, color: r.profitability >= 50 ? 'var(--kuno-lime)' : r.profitability >= 20 ? '#f39c12' : 'var(--kuno-danger)' }}>
                        {r.profitability}%
                      </span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={saveEdit} disabled={saving} style={btnSave}>{saving ? '...' : 'OK'}</button>
                        <button onClick={() => setEditingId(null)} style={btnCancel}>X</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => startEdit(j)} style={btnEdit}>Editar</button>
                        <button onClick={() => toggleHide(j.id)} style={btnEdit} title={isHidden ? 'Mostrar' : 'Ocultar'}>{isHidden ? '👁' : '🙈'}</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--kuno-lime)' }}>
              <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--kuno-lime)' }} colSpan={5}>TOTAL</td>
              <td style={{ ...tdStyle, fontWeight: 700 }}><span style={costColor}>${totCloud.toFixed(4)}</span></td>
              <td style={{ ...tdStyle, fontWeight: 700 }}><span style={costColor}>${totAd.toLocaleString()}</span></td>
              <td style={{ ...tdStyle, fontWeight: 700 }}><span style={costColor}>${totComm.toFixed(2)}</span></td>
              <td style={{ ...tdStyle, fontWeight: 700 }}><span style={costColor}>${totTime.toFixed(2)}</span></td>
              <td style={{ ...tdStyle, fontWeight: 700 }}><span style={costColor}>${totCosts.toFixed(2)}</span></td>
              <td style={{ ...tdStyle, fontWeight: 700 }}><span style={{ color: 'var(--kuno-lime)' }}>${totIncome.toFixed(2)}</span></td>
              <td style={{ ...tdStyle, fontWeight: 700 }}>
                <span style={{ color: totProfit >= 0 ? 'var(--kuno-lime)' : 'var(--kuno-danger)' }}>${totProfit.toFixed(2)}</span>
              </td>
              <td style={{ ...tdStyle, fontWeight: 700 }}>
                <span style={{ color: totRent >= 50 ? 'var(--kuno-lime)' : totRent >= 20 ? '#f39c12' : 'var(--kuno-danger)' }}>{totRent}%</span>
              </td>
              <td style={tdStyle}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

const tableWrapper: CSSProperties = { overflowX: 'auto', borderRadius: 'var(--radius-lg)', border: '1px solid var(--kuno-border)' };
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const thStyle: CSSProperties = { padding: '12px 10px', fontSize: 10, fontWeight: 600, color: 'var(--kuno-cream)', background: 'var(--kuno-slate)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' };
const tdStyle: CSSProperties = { padding: '10px 10px', fontSize: 12, color: 'var(--kuno-cream)', background: 'var(--kuno-dark)', verticalAlign: 'middle' };
const costColor: CSSProperties = { color: '#f39c12' };
const badgeNormal: CSSProperties = { fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 12, background: 'rgba(52,152,219,0.15)', color: '#3498db' };
const badgeEspecial: CSSProperties = { fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 12, background: 'rgba(243,156,18,0.15)', color: '#f39c12' };
const badgeInterno: CSSProperties = { fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 12, background: 'rgba(155,89,182,0.15)', color: '#9b59b6' };
const inputSmall: CSSProperties = { padding: '6px 8px', background: 'var(--kuno-dark-2)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', color: 'var(--kuno-cream)', fontSize: 12 };
const btnEdit: CSSProperties = { background: 'transparent', border: '1px solid var(--kuno-border)', color: 'var(--kuno-text-muted)', fontSize: 11, padding: '4px 10px', borderRadius: 'var(--radius)', cursor: 'pointer' };
const btnSave: CSSProperties = { background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer' };
const btnCancel: CSSProperties = { background: 'transparent', border: '1px solid var(--kuno-border)', color: 'var(--kuno-text-muted)', fontSize: 11, padding: '4px 10px', borderRadius: 'var(--radius)', cursor: 'pointer' };
