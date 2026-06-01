/**
 * Tests estructurales adicionales de los nuevos clientes (WhatsApp + CRM + Metrics).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { _internal as waInternal } from '../src/lib/whatsappClient';
import { _internal as crmInternal } from '../src/lib/zohoCrmClient';
import { metrics, _internal as metricsInternal } from '../src/lib/metrics';

describe('whatsappClient.normalizePhone', () => {
  it('strip todos los chars no-dígito', () => {
    expect(waInternal.normalizePhone('+507 6000-1234')).toBe('50760001234');
    expect(waInternal.normalizePhone('+1 (415) 555-0123')).toBe('14155550123');
  });

  it('preserva dígitos consecutivos', () => {
    expect(waInternal.normalizePhone('50712345678')).toBe('50712345678');
  });

  it('vacío → vacío', () => {
    expect(waInternal.normalizePhone('')).toBe('');
  });
});

describe('zohoCrmClient.splitName', () => {
  it('un solo nombre → first only', () => {
    expect(crmInternal.splitName('Carlos')).toEqual({ first_name: 'Carlos', last_name: '' });
  });

  it('dos partes → first + last', () => {
    expect(crmInternal.splitName('Carlos Méndez')).toEqual({ first_name: 'Carlos', last_name: 'Méndez' });
  });

  it('múltiples: primero = first, resto = last', () => {
    expect(crmInternal.splitName('Carlos Méndez Pérez')).toEqual({ first_name: 'Carlos', last_name: 'Méndez Pérez' });
  });

  it('whitespace múltiple se colapsa', () => {
    expect(crmInternal.splitName('Carlos   Méndez')).toEqual({ first_name: 'Carlos', last_name: 'Méndez' });
  });

  it('trim correcto', () => {
    expect(crmInternal.splitName('  Carlos  ')).toEqual({ first_name: 'Carlos', last_name: '' });
  });
});

describe('metrics counters', () => {
  beforeEach(() => {
    metrics.reset();
  });

  it('increment crea counter en cero + suma', () => {
    metrics.incrementCounter('test_counter', {}, 1);
    metrics.incrementCounter('test_counter', {}, 1);
    const snap = metrics.snapshot();
    const c = snap.counters.find((c) => c.name === 'test_counter');
    expect(c?.total).toBe(2);
  });

  it('increment con labels distintos crea by_label entries', () => {
    metrics.incrementCounter('http_requests', { method: 'GET', status: '200' });
    metrics.incrementCounter('http_requests', { method: 'GET', status: '200' });
    metrics.incrementCounter('http_requests', { method: 'POST', status: '500' });
    const snap = metrics.snapshot();
    const c = snap.counters.find((c) => c.name === 'http_requests');
    expect(c?.total).toBe(3);
    expect(Object.keys(c?.by_label ?? {})).toHaveLength(2);
  });

  it('increment con value custom suma ese value', () => {
    metrics.incrementCounter('tokens', {}, 1500);
    metrics.incrementCounter('tokens', {}, 2500);
    const snap = metrics.snapshot();
    expect(snap.counters[0].total).toBe(4000);
  });

  it('reset borra todo', () => {
    metrics.incrementCounter('test', {}, 1);
    metrics.reset();
    const snap = metrics.snapshot();
    expect(snap.counters).toHaveLength(0);
  });
});

describe('metrics histograms', () => {
  beforeEach(() => {
    metrics.reset();
  });

  it('observe acumula count + sum', () => {
    metrics.observeHistogram('latency', 100);
    metrics.observeHistogram('latency', 200);
    metrics.observeHistogram('latency', 300);
    const snap = metrics.snapshot();
    const h = snap.histograms[0];
    expect(h.count).toBe(3);
    expect(h.sum).toBe(600);
    expect(h.mean).toBe(200);
    expect(h.min).toBe(100);
    expect(h.max).toBe(300);
  });

  it('p50 razonable con datos uniformes', () => {
    for (let i = 1; i <= 100; i++) {
      metrics.observeHistogram('uniform', i);
    }
    const snap = metrics.snapshot();
    const h = snap.histograms[0];
    // p50 debería estar cerca de 50
    expect(h.p50).toBeGreaterThanOrEqual(40);
    expect(h.p50).toBeLessThanOrEqual(60);
  });

  it('histograms vacíos → min=0/max=0/mean=0', () => {
    const snap = metrics.snapshot();
    expect(snap.histograms).toHaveLength(0);
  });
});

describe('metrics labelKey ordering', () => {
  it('mismo set de labels → mismo key independiente del orden', () => {
    expect(metricsInternal.labelKey({ a: '1', b: '2' })).toBe(metricsInternal.labelKey({ b: '2', a: '1' }));
  });

  it('keys distintos producen labels distintos', () => {
    expect(metricsInternal.labelKey({ a: '1' })).not.toBe(metricsInternal.labelKey({ a: '2' }));
  });

  it('labels vacíos → key vacío', () => {
    expect(metricsInternal.labelKey({})).toBe('');
  });
});
