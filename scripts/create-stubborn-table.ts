#!/usr/bin/env npx tsx
/**
 * Para las tablas que Catalyst se niega a propagar con delays normales.
 * Crea la tabla y POLEA cada 15s hasta 5 min — cuando el columns API la reconoce, agrega columnas.
 *
 * Uso: ./scripts/create-stubborn-table.ts <NombreDeTabla>
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const MANIFEST_PATH = resolve(__dirname, '../docs/master-plan/SCHEMA_MANIFEST.json');
const BASE_URL = 'https://console.catalyst.zoho.com/baas/v1';
const TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token';

const tableName = process.argv[2];
if (!tableName) {
  console.error('Uso: ./scripts/create-stubborn-table.ts <NombreDeTabla>');
  process.exit(1);
}

const projectId = process.env.CATALYST_PROJECT_ID!;
const orgId = process.env.CATALYST_ORG_ID!;
const env = process.env.CATALYST_ENVIRONMENT ?? 'Development';

async function getAccessToken() {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.CATALYST_OAUTH_CLIENT_ID!,
    client_secret: process.env.CATALYST_OAUTH_CLIENT_SECRET!,
    refresh_token: process.env.CATALYST_OAUTH_REFRESH_TOKEN!,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

function headers(token: string) {
  return {
    Authorization: `Zoho-oauthtoken ${token}`,
    Environment: env,
    'Catalyst-org': orgId,
    'Content-Type': 'application/json',
  };
}

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    tables: Array<{ name: string; table_scope: string; columns: unknown[] }>;
  };
  const table = manifest.tables.find((t) => t.name === tableName);
  if (!table) {
    console.error(`Tabla "${tableName}" no encontrada en manifest`);
    process.exit(1);
  }

  const token = await getAccessToken();
  console.log(`✅ Access token obtenido`);

  // 1. Create table
  const createRes = await fetch(`${BASE_URL}/project/${projectId}/table`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ table_name: table.name, table_scope: table.table_scope }),
  });
  const createData = await createRes.json() as {
    status: string;
    data?: { table_id?: number; message?: string };
    message?: string;
  };
  if (createData.status !== 'success' || !createData.data?.table_id) {
    console.error(`❌ Create failed:`, JSON.stringify(createData, null, 2));
    process.exit(1);
  }
  const tableId = createData.data.table_id;
  console.log(`✅ Tabla creada: table_id=${tableId}`);

  // 2. Poll columns endpoint with a single probe column every 15s, up to 5 min
  const probePayload = JSON.stringify([
    { column_name: '_probe_temp', data_type: 'text', is_mandatory: 'false', audit_consent: 'false' },
  ]);
  const POLL_INTERVAL = 15000;
  const MAX_ATTEMPTS = 20; // 20 × 15s = 5 min max
  let ready = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    const probeRes = await fetch(`${BASE_URL}/project/${projectId}/table/${tableId}/column`, {
      method: 'POST',
      headers: headers(token),
      body: probePayload,
    });
    const probeData = (await probeRes.json()) as { status?: string; data?: { error_code?: string } };
    const t = attempt * 15;
    if (probeData.status === 'success') {
      console.log(`✅ Tabla queryable a los ${t}s — probe column agregada. Agrego las columnas reales.`);
      ready = true;
      break;
    }
    console.log(`⏳ Intento ${attempt}/${MAX_ATTEMPTS} (${t}s): ${probeData.data?.error_code ?? 'unknown'}`);
  }

  if (!ready) {
    console.error(`❌ Tabla no se hizo queryable en 5 min. table_id=${tableId} queda huérfana — borrá manual.`);
    process.exit(1);
  }

  // 3. Add real columns
  const colRes = await fetch(`${BASE_URL}/project/${projectId}/table/${tableId}/column`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(table.columns),
  });
  const colData = await colRes.json();
  if ((colData as { status?: string }).status === 'success') {
    console.log(`✅ ${table.columns.length} columnas agregadas a "${tableName}"`);
    console.log(`⚠️  Recordá borrar la columna "_probe_temp" desde Catalyst Console.`);
  } else {
    console.error(`❌ Falló agregar columnas reales:`, JSON.stringify(colData, null, 2));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
