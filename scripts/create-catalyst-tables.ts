#!/usr/bin/env npx tsx
/**
 * Crea tablas de Catalyst Datastore vía API.
 *
 * Lee `docs/master-plan/SCHEMA_MANIFEST.json` y para cada tabla:
 *   1. Verifica si ya existe (best-effort — Catalyst no expone GET tables en el PDF, pero detecta el error 4xx "table already exists")
 *   2. Si no existe → POST /baas/v1/project/{projectId}/table
 *   3. Para la nueva tabla → POST /baas/v1/project/{projectId}/table/{id}/column con todas las columnas en bulk
 *
 * Uso:
 *   ./scripts/create-catalyst-tables.ts                # dry-run (solo muestra lo que haría)
 *   ./scripts/create-catalyst-tables.ts --execute      # ejecuta de verdad
 *   ./scripts/create-catalyst-tables.ts --only=Tenants # solo 1 tabla
 *
 * Env vars requeridas (las setás en tu shell antes de correr):
 *   CATALYST_PROJECT_ID       — el ID del proyecto Catalyst (URL del Catalyst Console)
 *   CATALYST_ORG_ID           — el ID de la organización (Settings → Organization)
 *   CATALYST_OAUTH_CLIENT_ID  — del Self Client en api-console.zoho.com
 *   CATALYST_OAUTH_CLIENT_SECRET
 *   CATALYST_OAUTH_REFRESH_TOKEN — generado a partir del code (ver bloque "Como conseguir el refresh token")
 *   CATALYST_ENVIRONMENT      — Development o Production (default Development)
 *
 * Como conseguir el refresh token (one-time):
 *   1. En api-console.zoho.com → tu Self Client → Generate Code → con scopes:
 *        ZohoCatalyst.tables.CREATE,ZohoCatalyst.tables.columns.CREATE
 *      → te da un code de ~50 chars válido 10 min.
 *   2. Inmediatamente corré:
 *        curl -X POST https://accounts.zoho.com/oauth/v2/token \
 *          -d "grant_type=authorization_code" \
 *          -d "client_id=$CATALYST_OAUTH_CLIENT_ID" \
 *          -d "client_secret=$CATALYST_OAUTH_CLIENT_SECRET" \
 *          -d "code=<EL_CODE_DEL_PASO_1>"
 *      → la response tiene `refresh_token` (durable, lo guardás) + `access_token` (1h).
 *   3. Setá CATALYST_OAUTH_REFRESH_TOKEN con el refresh_token.
 *
 *   El script intercambia refresh_token por access_token automáticamente en cada run.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const MANIFEST_PATH = resolve(__dirname, '../docs/master-plan/SCHEMA_MANIFEST.json');
const BASE_URL = 'https://console.catalyst.zoho.com/baas/v1';
const TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token';

type ColumnSpec = {
  column_name: string;
  data_type: string;
  is_mandatory: string;
  audit_consent: string;
  is_unique?: string;
  search_index_enabled?: string;
  max_length?: number;
  default_value?: string;
};

type TableSpec = {
  name: string;
  table_scope: 'GLOBAL' | 'ORG' | 'USER';
  columns: ColumnSpec[];
};

type Manifest = {
  tables: TableSpec[];
};

// ===== CLI args =====

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const ONLY = args.find((a) => a.startsWith('--only='))?.split('=')[1] ?? null;

function log(level: 'info' | 'warn' | 'error' | 'ok', msg: string, meta?: Record<string, unknown>) {
  const icon = { info: 'ℹ️ ', warn: '⚠️ ', error: '❌', ok: '✅' }[level];
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  console.log(`${icon} ${msg}${metaStr}`);
}

// ===== Env validation =====

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    log('error', `Missing env var: ${name}. Ver docstring del script.`);
    process.exit(1);
  }
  return v;
}

// ===== OAuth =====

async function getAccessToken(): Promise<string> {
  const clientId = requireEnv('CATALYST_OAUTH_CLIENT_ID');
  const clientSecret = requireEnv('CATALYST_OAUTH_CLIENT_SECRET');
  const refreshToken = requireEnv('CATALYST_OAUTH_REFRESH_TOKEN');

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`OAuth refresh failed: ${data.error ?? JSON.stringify(data)}`);
  }
  return data.access_token;
}

// ===== Catalyst API =====

type ApiCtx = {
  projectId: string;
  orgId: string;
  environment: string;
  accessToken: string;
};

function headers(ctx: ApiCtx): Record<string, string> {
  return {
    Authorization: `Zoho-oauthtoken ${ctx.accessToken}`,
    Environment: ctx.environment,
    'Catalyst-org': ctx.orgId,
    'Content-Type': 'application/json',
  };
}

async function createTable(ctx: ApiCtx, table: TableSpec): Promise<string | null> {
  const url = `${BASE_URL}/project/${ctx.projectId}/table`;
  const body = JSON.stringify({ table_name: table.name, table_scope: table.table_scope });

  if (!EXECUTE) {
    log('info', `DRY-RUN would POST ${url}`, { body: JSON.parse(body) });
    return 'DRY_RUN_TABLE_ID';
  }

  const res = await fetch(url, { method: 'POST', headers: headers(ctx), body });
  const data = (await res.json()) as { data?: { table_id?: string; table_name?: string }; status?: string; message?: string };

  if (res.status === 200 || res.status === 201) {
    const tableId = data.data?.table_id;
    if (!tableId) {
      log('warn', `Tabla "${table.name}" creada pero sin table_id en response`, { data });
      return null;
    }
    log('ok', `Tabla "${table.name}" creada`, { table_id: tableId });
    return tableId;
  }

  // Catalyst suele devolver 409 o 400 con mensaje "already exists"
  const errMsg = (data.message ?? '').toLowerCase();
  if (errMsg.includes('already exist') || errMsg.includes('duplicate') || res.status === 409) {
    log('info', `Tabla "${table.name}" ya existe — skip create, intentaré agregar columnas que falten`);
    return 'EXISTS';
  }

  throw new Error(`Create table "${table.name}" failed: HTTP ${res.status} ${JSON.stringify(data)}`);
}

async function createColumns(ctx: ApiCtx, tableId: string, columns: ColumnSpec[], tableName: string): Promise<void> {
  if (tableId === 'EXISTS') {
    log('info', `Tabla "${tableName}" ya existía — no agrego columnas (no tengo su id sin GET endpoint). Si necesitás agregar columnas a esta tabla, revisá manual o pedime un script GET separado.`);
    return;
  }
  const url = `${BASE_URL}/project/${ctx.projectId}/table/${tableId}/column`;

  if (!EXECUTE) {
    log('info', `DRY-RUN would POST ${url} with ${columns.length} columns`, { sample: columns[0] });
    return;
  }

  // Eventual consistency: Catalyst tarda hasta 60s en propagar la nueva tabla a la columns API.
  // Si no esperamos suficiente, el primer POST devuelve 404 y la tabla queda "huérfana"
  // (table_id permanentemente roto, hay que borrarla manual y reintentar con otra).
  // Por eso esperamos GENEROSO desde el primer intento — 60s.
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const delayMs = attempt === 1 ? 60000 : 30000;
    log('info', `Esperando ${delayMs / 1000}s antes de POST /column (intento ${attempt}/3)`);
    await new Promise((r) => setTimeout(r, delayMs));

    const res = await fetch(url, { method: 'POST', headers: headers(ctx), body: JSON.stringify(columns) });
    const data = (await res.json()) as { data?: { message?: string; error_code?: string }; message?: string; status?: string };

    if (res.status === 200 || res.status === 201) {
      log('ok', `${columns.length} columnas creadas para "${tableName}"`);
      return;
    }

    const errorMsg = JSON.stringify(data);
    lastError = `HTTP ${res.status} ${errorMsg}`;

    // Si el error es "no such table" → retry (eventual consistency)
    const errorCode = data.data?.error_code ?? '';
    const isRetryable = errorCode === 'INVALID_ID' || res.status === 404;
    if (!isRetryable) break;
  }

  throw new Error(`Create columns for "${tableName}" failed después de retries: ${lastError}`);
}

// ===== Main =====

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  log('info', `Manifest cargado: ${manifest.tables.length} tablas, ${manifest.tables.reduce((s, t) => s + t.columns.length, 0)} columnas`);

  let tables = manifest.tables;
  if (ONLY) {
    tables = tables.filter((t) => t.name === ONLY);
    if (tables.length === 0) {
      log('error', `No se encontró tabla "${ONLY}" en el manifest`);
      process.exit(1);
    }
    log('info', `Filtro --only=${ONLY} → 1 tabla`);
  }

  if (!EXECUTE) {
    log('warn', 'DRY-RUN MODE — no se va a crear nada. Agregá --execute para ejecutar.');
  }

  const ctx: ApiCtx = {
    projectId: requireEnv('CATALYST_PROJECT_ID'),
    orgId: requireEnv('CATALYST_ORG_ID'),
    environment: process.env.CATALYST_ENVIRONMENT ?? 'Development',
    accessToken: EXECUTE ? await getAccessToken() : 'DRY_RUN_TOKEN',
  };

  log('info', `Catalyst project ${ctx.projectId} · org ${ctx.orgId} · env ${ctx.environment}`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const table of tables) {
    try {
      log('info', `\n=== ${table.name} (${table.columns.length} columnas) ===`);
      const tableId = await createTable(ctx, table);
      if (tableId === 'EXISTS') {
        skipped++;
        continue;
      }
      if (!tableId) {
        failed++;
        continue;
      }
      await createColumns(ctx, tableId, table.columns, table.name);
      created++;
      // Pequeña pausa para no saturar Catalyst API
      if (EXECUTE) await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      log('error', `Falló "${table.name}"`, { error: (err as Error).message });
      failed++;
    }
  }

  console.log('\n=== Resumen ===');
  log('ok', `Creadas: ${created}`);
  log('info', `Ya existían (skipped): ${skipped}`);
  if (failed > 0) log('error', `Fallaron: ${failed}`);

  if (!EXECUTE) {
    console.log('\nPara ejecutar de verdad: ./scripts/create-catalyst-tables.ts --execute');
  }
}

main().catch((err) => {
  log('error', 'Fatal', { error: err.message });
  process.exit(1);
});
