/**
 * Métricas in-memory para observabilidad básica.
 *
 * Counters globales por instancia. NO se persisten — útil para snapshots de un período
 * dado pero NO para histórico (un cold-start los resetea).
 *
 * Para métricas persistentes/históricas, exportar periódicamente via cron a una tabla
 * Metrics o a un servicio externo (Datadog, Grafana Cloud).
 *
 * Categorías:
 *   - http_requests_total       (counter por status code)
 *   - anthropic_calls_total     (counter por modelo + outcome)
 *   - anthropic_tokens_total    (counter de tokens consumidos)
 *   - integration_calls_total   (counter por integración + outcome)
 *
 * Uso:
 *   import { metrics } from './metrics';
 *   metrics.incrementCounter('anthropic_calls_total', { model: 'claude-haiku-4-5', outcome: 'success' });
 *   metrics.observeHistogram('anthropic_latency_ms', 1234, { model: 'haiku' });
 */

type Labels = Record<string, string>;

type Counter = {
  name: string;
  total: number;
  by_label: Map<string, number>;
};

type Histogram = {
  name: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: { p50: number[]; p95: number[]; p99: number[] };
};

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();

function labelKey(labels: Labels): string {
  const sorted = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([k, v]) => `${k}=${v}`).join(',');
}

function getOrCreateCounter(name: string): Counter {
  let c = counters.get(name);
  if (!c) {
    c = { name, total: 0, by_label: new Map() };
    counters.set(name, c);
  }
  return c;
}

function getOrCreateHistogram(name: string): Histogram {
  let h = histograms.get(name);
  if (!h) {
    h = { name, count: 0, sum: 0, min: Infinity, max: -Infinity, buckets: { p50: [], p95: [], p99: [] } };
    histograms.set(name, h);
  }
  return h;
}

const MAX_HISTOGRAM_SAMPLES = 1000;

export const metrics = {
  incrementCounter(name: string, labels: Labels = {}, value: number = 1): void {
    const c = getOrCreateCounter(name);
    c.total += value;
    const key = labelKey(labels);
    c.by_label.set(key, (c.by_label.get(key) ?? 0) + value);
  },

  observeHistogram(name: string, value: number, _labels: Labels = {}): void {
    const h = getOrCreateHistogram(name);
    h.count += 1;
    h.sum += value;
    if (value < h.min) h.min = value;
    if (value > h.max) h.max = value;
    // Sampling reservoir simple (keep latest MAX_HISTOGRAM_SAMPLES)
    if (h.buckets.p50.length >= MAX_HISTOGRAM_SAMPLES) h.buckets.p50.shift();
    h.buckets.p50.push(value);
  },

  snapshot(): {
    counters: Array<{ name: string; total: number; by_label: Record<string, number> }>;
    histograms: Array<{ name: string; count: number; sum: number; min: number; max: number; mean: number; p50: number; p95: number; p99: number }>;
  } {
    const counterSnapshots = [...counters.values()].map((c) => ({
      name: c.name,
      total: c.total,
      by_label: Object.fromEntries(c.by_label.entries()),
    }));

    const histogramSnapshots = [...histograms.values()].map((h) => {
      const sorted = [...h.buckets.p50].sort((a, b) => a - b);
      const len = sorted.length;
      const p50 = len > 0 ? sorted[Math.floor(len * 0.5)] : 0;
      const p95 = len > 0 ? sorted[Math.floor(len * 0.95)] : 0;
      const p99 = len > 0 ? sorted[Math.floor(len * 0.99)] : 0;
      return {
        name: h.name,
        count: h.count,
        sum: h.sum,
        min: h.min === Infinity ? 0 : h.min,
        max: h.max === -Infinity ? 0 : h.max,
        mean: h.count > 0 ? h.sum / h.count : 0,
        p50, p95, p99,
      };
    });

    return { counters: counterSnapshots, histograms: histogramSnapshots };
  },

  reset(): void {
    counters.clear();
    histograms.clear();
  },
};

export const _internal = { labelKey };
