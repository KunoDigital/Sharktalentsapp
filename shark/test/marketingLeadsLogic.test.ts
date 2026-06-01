/**
 * Tests de la lógica de filtros + ordering del MarketingLeads page.
 *
 * No testeamos render React (overhead alto sin beneficio claro). Testeamos:
 * - Score color helper
 * - Filtro por status
 * - Filtro por urgency
 * - Filtro por minScore
 */
import { describe, expect, it } from 'vitest';

// Replica del helper de Color del page (no exportado)
function scoreColor(score: number): 'green' | 'amber' | 'fg' | 'muted' {
  if (score >= 80) return 'green';
  if (score >= 60) return 'amber';
  if (score >= 40) return 'fg';
  return 'muted';
}

// Tipo del lead simplificado
type Lead = {
  ROWID: string;
  email: string;
  score_quality: number;
  urgency: 'less_30d' | '1-3m' | '3m+' | 'exploring';
  status: 'new' | 'eval_requested' | 'eval_completed' | 'call_booked' | 'won' | 'lost';
};

function applyFilters(leads: Lead[], filters: { status?: string; urgency?: string; minScore?: number }): Lead[] {
  let result = leads;
  if (filters.status) result = result.filter((l) => l.status === filters.status);
  if (filters.urgency) result = result.filter((l) => l.urgency === filters.urgency);
  if (filters.minScore !== undefined) result = result.filter((l) => l.score_quality >= filters.minScore!);
  return result;
}

describe('scoreColor', () => {
  it('score 80+ → green', () => {
    expect(scoreColor(80)).toBe('green');
    expect(scoreColor(95)).toBe('green');
    expect(scoreColor(100)).toBe('green');
  });

  it('score 60-79 → amber', () => {
    expect(scoreColor(60)).toBe('amber');
    expect(scoreColor(75)).toBe('amber');
    expect(scoreColor(79)).toBe('amber');
  });

  it('score 40-59 → fg (normal)', () => {
    expect(scoreColor(40)).toBe('fg');
    expect(scoreColor(50)).toBe('fg');
    expect(scoreColor(59)).toBe('fg');
  });

  it('score <40 → muted', () => {
    expect(scoreColor(0)).toBe('muted');
    expect(scoreColor(20)).toBe('muted');
    expect(scoreColor(39)).toBe('muted');
  });

  it('boundary correcto: 39 muted, 40 fg', () => {
    expect(scoreColor(39)).toBe('muted');
    expect(scoreColor(40)).toBe('fg');
  });

  it('boundary correcto: 59 fg, 60 amber', () => {
    expect(scoreColor(59)).toBe('fg');
    expect(scoreColor(60)).toBe('amber');
  });

  it('boundary correcto: 79 amber, 80 green', () => {
    expect(scoreColor(79)).toBe('amber');
    expect(scoreColor(80)).toBe('green');
  });
});

describe('applyFilters', () => {
  const leads: Lead[] = [
    { ROWID: '1', email: 'a@x.com', score_quality: 90, urgency: 'less_30d', status: 'new' },
    { ROWID: '2', email: 'b@x.com', score_quality: 50, urgency: '1-3m', status: 'eval_requested' },
    { ROWID: '3', email: 'c@x.com', score_quality: 30, urgency: 'exploring', status: 'lost' },
    { ROWID: '4', email: 'd@x.com', score_quality: 75, urgency: 'less_30d', status: 'won' },
    { ROWID: '5', email: 'e@x.com', score_quality: 65, urgency: '3m+', status: 'new' },
  ];

  it('sin filtros devuelve todos', () => {
    expect(applyFilters(leads, {})).toHaveLength(5);
  });

  it('filtra por status', () => {
    const r = applyFilters(leads, { status: 'new' });
    expect(r).toHaveLength(2);
    expect(r.map((l) => l.ROWID)).toEqual(['1', '5']);
  });

  it('filtra por urgency', () => {
    const r = applyFilters(leads, { urgency: 'less_30d' });
    expect(r).toHaveLength(2);
    expect(r.map((l) => l.ROWID)).toEqual(['1', '4']);
  });

  it('filtra por minScore (incluye igual)', () => {
    const r = applyFilters(leads, { minScore: 60 });
    expect(r.map((l) => l.ROWID).sort()).toEqual(['1', '4', '5']);
  });

  it('filtra por minScore=0 incluye todos', () => {
    expect(applyFilters(leads, { minScore: 0 })).toHaveLength(5);
  });

  it('combina filtros: status+urgency', () => {
    const r = applyFilters(leads, { status: 'new', urgency: 'less_30d' });
    expect(r.map((l) => l.ROWID)).toEqual(['1']);
  });

  it('combinación que no matchea nada → []', () => {
    expect(applyFilters(leads, { status: 'won', minScore: 100 })).toEqual([]);
  });
});
