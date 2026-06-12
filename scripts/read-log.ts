#!/usr/bin/env npx tsx
/**
 * Lee logs estructurados desde el bucket Stratus `sharktalents-logs` via el
 * endpoint /api/_dev/logs/:traceId del backend de SharkTalents.
 *
 * Uso:
 *   ./scripts/read-log.ts <traceId>             # log de hoy
 *   ./scripts/read-log.ts <traceId> --day=YYYY-MM-DD
 *   ./scripts/read-log.ts --list                # lista traceIds del día
 *   ./scripts/read-log.ts --list --day=YYYY-MM-DD --limit=50
 *
 * Env vars:
 *   API_BASE_URL    — base del backend (default: https://app.sharktalents.ai/server/api)
 *   INTERNAL_API_KEY — clave admin para el endpoint (obligatorio)
 *
 * Diseño basado en docs/15_STRATUS_LOG_LOOP.md (Cristian, 2026-06).
 */

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);

const apiBase = process.env.API_BASE_URL ?? 'https://app.sharktalents.ai/server/api';
const internalKey = process.env.INTERNAL_API_KEY;
if (!internalKey) {
  process.stderr.write('ERROR: falta env var INTERNAL_API_KEY\n');
  process.exit(2);
}

async function main(): Promise<void> {
  const day = flag('day');
  if (has('list')) {
    const limit = flag('limit') ?? '50';
    const qs = new URLSearchParams();
    if (day) qs.set('day', day);
    qs.set('limit', limit);
    const url = `${apiBase}/api/_dev/logs?${qs.toString()}`;
    const res = await fetch(url, { headers: { 'X-Internal-Key': internalKey! } });
    const text = await res.text();
    if (!res.ok) {
      process.stderr.write(`ERROR ${res.status} ${url}\n${text}\n`);
      process.exit(1);
    }
    process.stdout.write(text + '\n');
    return;
  }

  const traceId = args.find((a) => !a.startsWith('--'));
  if (!traceId) {
    process.stderr.write('Uso: ./scripts/read-log.ts <traceId> [--day=YYYY-MM-DD]\n');
    process.stderr.write('     ./scripts/read-log.ts --list [--day=YYYY-MM-DD] [--limit=50]\n');
    process.exit(2);
  }
  if (!/^trc_[a-z0-9]{6,40}$/i.test(traceId)) {
    process.stderr.write(`ERROR: traceId inválido (esperado trc_xxxxx): ${traceId}\n`);
    process.exit(2);
  }

  const qs = day ? `?day=${day}` : '';
  const url = `${apiBase}/api/_dev/logs/${encodeURIComponent(traceId)}${qs}`;
  const res = await fetch(url, { headers: { 'X-Internal-Key': internalKey! } });
  const text = await res.text();
  if (!res.ok) {
    process.stderr.write(`ERROR ${res.status} ${url}\n${text}\n`);
    process.exit(1);
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    process.stdout.write(JSON.stringify(parsed, null, 2) + '\n');
  } catch {
    process.stdout.write(text + '\n');
  }
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${(err as Error).message}\n`);
  process.exit(1);
});
