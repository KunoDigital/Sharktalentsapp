# 16 — MCP Server para Claude

**Objetivo:** exponer SharkTalents como un servidor MCP (Model Context Protocol) para que Claude (y otros LLMs que soporten MCP) pueda consultar y operar sobre la data directamente. Los clientes le pueden pedir a Claude: _"¿Cuántos candidatos aplicaron a mi puesto de Dev Senior este mes?"_ o _"Generá un reporte con los 3 mejores candidatos del pipeline de Marketing."_

**Tiempo estimado:** 2 semanas.
**Dependencias:** Fase 13 (multitenant), Fase 14 (Clerk), Fase 15 (API pública). El MCP server reutiliza la API v1 internamente.
**Riesgo:** medio. Nueva superficie de integración; si Claude tiene acceso, hay que cuidar autorización granular.

**Referencia técnica:** https://modelcontextprotocol.io/
**Skill de Claude Code disponible:** `/mcp-builder` (ya instalado) — invocar cuando se implemente.

---

## Qué es MCP

**Model Context Protocol** es un protocolo abierto creado por Anthropic para que LLMs se conecten con fuentes de datos y herramientas externas de forma estandarizada.

Un **MCP Server** expone:
- **Tools**: funciones que el LLM puede invocar (leer data, ejecutar acciones)
- **Resources**: documentos/datos que el LLM puede leer
- **Prompts**: templates preseteados

El **MCP Client** (ej. Claude Desktop, Claude Code, Claude web) se conecta al server y el usuario puede pedirle al LLM que use esas tools/resources.

**Ejemplo de flow:**

```
Usuario → Claude Desktop: "Listame los candidatos del puesto 'Dev Senior'"
  ↓
Claude → MCP Server de SharkTalents: invoke tool `list_candidates` con jobId
  ↓
MCP Server → API SharkTalents: GET /api/v1/jobs/:id/candidates
  ↓
API → MCP Server: { data: [...] }
  ↓
MCP Server → Claude: tool result
  ↓
Claude → Usuario: respuesta formateada
```

---

## Deliverables

- [ ] MCP Server implementado (Node/TS, protocolo stdio + HTTP)
- [ ] 15+ tools expuestas (listar, ver detalle, crear, invitar)
- [ ] Resources: schemas para docs contextuales
- [ ] Auth vía API key del tenant (reutiliza Fase 15)
- [ ] Instrucciones de setup para Claude Desktop
- [ ] Instrucciones de setup para Claude web (vía SSE/HTTP)
- [ ] Publicable como npm package (`@sharktalents/mcp-server`) opcional
- [ ] Docs: `docs/INTEGRATIONS/mcp.md`
- [ ] Smoke tests con Claude Desktop

---

## 1. Arquitectura

### Opciones de deploy

**Opción A: MCP Server como process standalone**
- Cliente instala localmente: `npx @sharktalents/mcp-server --api-key st_xxx`
- Se comunica con Claude Desktop vía stdio.
- Internamente llama a la API pública de SharkTalents (HTTPS).
- **Pros:** trivial instalar. El estándar MCP para Claude Desktop.
- **Cons:** requiere Node en la máquina del usuario.

**Opción B: MCP Server hosted por SharkTalents**
- Deploy dentro de Catalyst como Advanced I/O function separada.
- Claude se conecta vía SSE (Server-Sent Events) o HTTP streaming.
- **Pros:** no requiere instalación. Admin update sin touch users.
- **Cons:** MCP over HTTP es menos maduro. Claude Desktop solo soporta stdio hoy.

**Recomendación MVP:** Opción A.
**Futuro:** agregar Opción B cuando soporte HTTP sea más maduro en clientes.

### Structure del server

```
@sharktalents/mcp-server/
├── package.json
├── README.md
├── src/
│   ├── index.ts              (entry, stdio handler)
│   ├── tools/                (una por tool)
│   │   ├── listJobs.ts
│   │   ├── getJob.ts
│   │   ├── listCandidates.ts
│   │   ├── ...
│   ├── resources/
│   │   ├── schemas.ts        (schema JSON de Job, Candidate, etc.)
│   │   └── context.ts        (descripción del dominio para Claude)
│   ├── api.ts                (wrapper de la API pública)
│   └── auth.ts               (load API key)
├── tsconfig.json
```

---

## 2. SDK de MCP

Anthropic mantiene un SDK oficial:

```bash
npm install @modelcontextprotocol/sdk
```

### Entry point

```typescript
// src/index.ts
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import * as tools from './tools';
import { loadApiKey } from './auth';

const apiKey = loadApiKey();  // lee de --api-key arg o env var ST_API_KEY

const server = new Server(
  { name: 'sharktalents', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {} } }
);

// Handler: list tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.values(tools).map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

// Handler: call tool
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = tools[req.params.name];
  if (!tool) throw new Error(`Unknown tool: ${req.params.name}`);
  const result = await tool.handler(apiKey, req.params.arguments);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

// Start stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[SharkTalents MCP] Server ready');
```

---

## 3. Tools expuestas

### Categorías

**Read-only (lectura segura):**
1. `list_jobs` — lista jobs del tenant
2. `get_job` — detalle de un job
3. `list_candidates` — lista candidatos
4. `get_candidate` — detalle de candidato
5. `list_results` — results de un job
6. `get_result` — result con scores completos
7. `list_reports` — reports publicados
8. `get_report` — reporte con candidatos y comparativa
9. `search_candidates` — búsqueda por nombre/email
10. `get_competencias_catalog` — catálogo de 54 competencias

**Write (acciones):**
11. `create_job` — crear un puesto nuevo
12. `invite_candidate` — invitar candidato a un test (retorna link)
13. `update_pipeline_stage` — mover candidato en el pipeline
14. `mark_result_reviewed` — marcar reporte como revisado

**Meta:**
15. `get_tenant_info` — info del tenant activo (plan, features, limits)

### Ejemplo: `list_jobs`

```typescript
// src/tools/listJobs.ts
import { z } from 'zod';
import { apiFetch } from '../api';

export const listJobs = {
  name: 'list_jobs',
  description: 'Lista los puestos (jobs) del tenant activo. Soporta filtros y paginación.',
  inputSchema: {
    type: 'object',
    properties: {
      page: { type: 'integer', description: 'Número de página (default 1)' },
      per_page: { type: 'integer', description: 'Items por página (default 50, max 100)' },
      is_active: { type: 'boolean', description: 'Filtrar solo activos si true, archivados si false, ambos si no se pasa' },
    },
  },

  async handler(apiKey: string, args: any) {
    const params = new URLSearchParams();
    if (args?.page) params.set('page', String(args.page));
    if (args?.per_page) params.set('per_page', String(args.per_page));
    if (args?.is_active !== undefined) params.set('is_active', String(args.is_active));

    const res = await apiFetch(apiKey, `/jobs?${params.toString()}`);
    return {
      total: res.meta.total,
      page: res.meta.page,
      jobs: res.data.map((j: any) => ({
        id: j.id,
        title: j.title,
        company: j.company,
        cognitive_level: j.cognitive_level,
        is_active: j.is_active,
        created_at: j.created_at,
      })),
    };
  },
};
```

### Ejemplo: `create_job`

```typescript
// src/tools/createJob.ts
export const createJob = {
  name: 'create_job',
  description: `
    Crea un nuevo puesto de trabajo. Requiere título, empresa, y nivel cognitivo.
    Puede incluir perfil DISC ideal y competencias.

    Ejemplo de llamada:
    create_job({
      title: "Senior React Developer",
      company: "Acme Tech",
      cognitive_level: "senior",
      tech_prompt: "React 18, TypeScript, testing con Jest...",
      ideal_profile: {
        disc: { D: 60, I: 70, S: 30, C: 70 },
        min_technical_score: 70
      }
    })
  `,
  inputSchema: {
    type: 'object',
    required: ['title', 'company', 'cognitive_level'],
    properties: {
      title: { type: 'string', maxLength: 255 },
      company: { type: 'string', maxLength: 255 },
      cognitive_level: { type: 'string', enum: ['basic', 'mid', 'senior'] },
      tech_prompt: { type: 'string', maxLength: 10000 },
      ideal_profile: {
        type: 'object',
        properties: {
          disc: {
            type: 'object',
            properties: {
              D: { type: 'integer', minimum: 0, maximum: 100 },
              I: { type: 'integer', minimum: 0, maximum: 100 },
              S: { type: 'integer', minimum: 0, maximum: 100 },
              C: { type: 'integer', minimum: 0, maximum: 100 },
            },
          },
          min_technical_score: { type: 'integer', minimum: 0, maximum: 100 },
        },
      },
      ideal_competencias: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            nivel_esperado: { type: 'integer', minimum: 0, maximum: 100 },
          },
        },
      },
    },
  },

  async handler(apiKey: string, args: any) {
    const res = await apiFetch(apiKey, '/jobs', {
      method: 'POST',
      body: args,
    });
    return {
      id: res.data.id,
      title: res.data.title,
      company: res.data.company,
      assessments_created: res.data.assessments?.map((a: any) => ({
        type: a.type,
        invitation_link_template: `Use invite_candidate with assessment_type "${a.type}"`,
      })),
    };
  },
};
```

---

## 4. Resources (contextuales para Claude)

Los resources son documentos que Claude puede leer para mejor contexto:

```typescript
// src/resources/context.ts
export const resources = [
  {
    uri: 'sharktalents://domain/competencias',
    name: 'Catálogo de 54 competencias',
    mimeType: 'application/json',
    handler: () => loadCompetenciasCatalog(),
  },
  {
    uri: 'sharktalents://domain/pk-profiles',
    name: 'Catálogo de 27 perfiles PK (DISC)',
    mimeType: 'application/json',
    handler: () => loadPKProfiles(),
  },
  {
    uri: 'sharktalents://domain/dimensions-integrity',
    name: '15 dimensiones del test de integridad',
    mimeType: 'application/json',
    handler: () => loadIntegrityDimensions(),
  },
  {
    uri: 'sharktalents://domain/overview',
    name: 'Overview del sistema SharkTalents',
    mimeType: 'text/markdown',
    handler: () => `
# SharkTalents — Sistema de evaluación de candidatos

## 5 dimensiones:
1. Conducta (DISC) — 40 preguntas
2. Cognición (VELNA) — 100-125 preguntas según nivel
3. Técnica — 25 preguntas generadas con IA
4. Emoción — 20 preguntas
5. Integridad — 90 preguntas

## Flow típico:
Admin crea job → genera 3 assessments → envía links a candidatos
→ candidatos completan tests → admin revisa pipeline → arma reporte
→ publica reporte (URL público) → comparte con cliente final.

## Roles:
- admin: control total del tenant
- recruiter: crear jobs, ver candidatos, generar reportes
- viewer: solo lectura
    `,
  },
];
```

Claude puede leer estos resources al iniciar una conversación y así entender el dominio.

---

## 5. Auth: API key vía CLI arg o env var

```typescript
// src/auth.ts
export function loadApiKey(): string {
  // 1. CLI arg
  const argIdx = process.argv.indexOf('--api-key');
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    return process.argv[argIdx + 1];
  }

  // 2. Env var
  if (process.env.ST_API_KEY) {
    return process.env.ST_API_KEY;
  }

  console.error('[SharkTalents MCP] ERROR: API key required.');
  console.error('Usage:');
  console.error('  npx @sharktalents/mcp-server --api-key st_xxxxxxxxxx');
  console.error('Or set ST_API_KEY env var.');
  process.exit(1);
}

export function getApiBaseUrl(): string {
  return process.env.ST_API_BASE || 'https://sharktalents.ai/server/api/api/v1';
}
```

---

## 6. Setup en Claude Desktop

### Instalación desde npm (futuro, si publicamos)

```bash
npx @sharktalents/mcp-server --api-key st_xxxxxxxxxx
# Probar que inicia (sin error)
Ctrl+C
```

### Config de Claude Desktop

Editar `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "sharktalents": {
      "command": "npx",
      "args": ["-y", "@sharktalents/mcp-server@latest", "--api-key", "st_xxxxxxxxxx"]
    }
  }
}
```

Reiniciar Claude Desktop. En el chat, aparece el icon 🔌 → expandir → ver "sharktalents" con las tools.

### Setup alternativo (sin publicar npm)

Durante desarrollo, desde el repo:

```bash
cd packages/mcp-server
npm install
npm run build
```

Luego:
```json
{
  "mcpServers": {
    "sharktalents": {
      "command": "node",
      "args": ["/ruta/absoluta/a/packages/mcp-server/dist/index.js"],
      "env": { "ST_API_KEY": "st_xxxxxxxxxx" }
    }
  }
}
```

---

## 7. Ejemplos de uso con Claude

Una vez configurado, usuario puede hacer requests naturales:

**Usuario:** "Listame los puestos activos de mi tenant."
**Claude:** invoca `list_jobs({ is_active: true })` → devuelve lista.

**Usuario:** "¿Cuántos candidatos han completado el test de integridad en el puesto 'Senior Dev'?"
**Claude:** 
1. `list_jobs({ is_active: true })` para encontrar el job por nombre
2. `list_results({ jobId: X, assessment_type: 'integrity' })` 
3. Filtra los que tienen `completed_at`
4. Responde con conteo

**Usuario:** "Creá un nuevo puesto de 'Product Manager' para 'Acme Corp', nivel senior, con DISC ideal D=70 I=60 S=40 C=50."
**Claude:** invoca `create_job({ title: 'Product Manager', company: 'Acme Corp', cognitive_level: 'senior', ideal_profile: { disc: { D:70, I:60, S:40, C:50 } } })`.

**Usuario:** "Invitá a juan@example.com al test kudert del puesto 'Product Manager' que acabás de crear."
**Claude:** invoca `invite_candidate({ jobId: <nuevo_id>, assessment_type: 'kudert', email: 'juan@example.com' })` → devuelve link → Claude le pasa al usuario.

---

## 8. Seguridad

### API key expone el tenant completo

Si la API key del usuario se filtra:
- Attacker puede leer TODA la data del tenant (candidatos, reportes, etc.).
- Attacker puede crear puestos fantasma, invitar candidatos spam, etc.

**Mitigaciones:**

1. **API keys scope-reducibles:** crear keys con solo `read:*` (no write) para uso con LLMs en modo lectura.
2. **Rotation fácil:** key compromised → revoke en panel → generar nueva → update config.
3. **Audit log:** toda acción via API key queda registrada en `AuditLog` con `api_key_id`. Post-incident podés ver qué hizo el attacker.
4. **Rate limits estrictos:** un attacker no puede vaciar la DB en segundos.

### Recomendación al usuario

En el README del package:

```markdown
⚠ Usá una API key dedicada para MCP, con permisos mínimos.

Ejemplo para uso con Claude:
- name: "Claude MCP (lectura + crear jobs)"
- permissions: ["read:jobs", "read:candidates", "read:results", "read:reports", "write:jobs"]

No uses tu API key de producción que tiene `*`.
```

### Confirmación en acciones destructivas

En el handler de tools de escritura, agregar un hint para que Claude pida confirmación:

```typescript
export const createJob = {
  // ...
  description: `
    Crea un nuevo puesto. ⚠ ACCIÓN DESTRUCTIVA: crea un recurso permanente.
    PIDE CONFIRMACIÓN AL USUARIO antes de invocar esta tool.
  `,
  // ...
};
```

Claude suele respetar estos hints y pregunta antes.

---

## 9. Publicación como npm package

### `packages/mcp-server/package.json`

```json
{
  "name": "@sharktalents/mcp-server",
  "version": "1.0.0",
  "description": "MCP Server for SharkTalents — talent assessment platform",
  "bin": {
    "sharktalents-mcp": "./dist/index.js"
  },
  "main": "./dist/index.js",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "node --loader ts-node/esm src/index.ts",
    "prepublishOnly": "npm run build"
  },
  "files": ["dist", "README.md", "LICENSE"],
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "node-fetch": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0"
  },
  "engines": { "node": ">=18" },
  "license": "MIT",
  "repository": "https://github.com/kunodigital/sharktalents-mcp"
}
```

### Publicar

```bash
cd packages/mcp-server
npm login                # primera vez
npm publish --access public
```

**Tag de release en git:**
```bash
git tag mcp-server-v1.0.0
git push --tags
```

**Versionado independiente** del backend de SharkTalents. La API v1 es estable → el MCP server puede iterar rápido sin afectar el core.

### Alternativa: sin publicar

Mantener el MCP server en el monorepo y distribuir via `npm install git+https://github.com/kunodigital/sharktalents#subdirectory=packages/mcp-server`. Menos clean pero no requiere npm publish.

---

## 10. Testing

### Manual con Claude Desktop

Seguir [sección 6](#6-setup-en-claude-desktop) y probar:

- [ ] Listar jobs → Claude responde con lista formatada
- [ ] Crear job → Claude pide confirmación, ejecuta, confirma
- [ ] Invitar candidato → Claude devuelve el link correcto
- [ ] Cross-tenant: API key de tenant A intentando ver data de B → error apropiado

### Tests programáticos

```typescript
// packages/mcp-server/test/tools.test.ts
import { describe, it, expect } from 'vitest';
import { listJobs } from '../src/tools/listJobs';

describe('list_jobs tool', () => {
  it('returns array of jobs', async () => {
    const result = await listJobs.handler(process.env.TEST_API_KEY!, {});
    expect(result).toHaveProperty('jobs');
    expect(Array.isArray(result.jobs)).toBe(true);
  });
});
```

Requiere API key de sandbox SharkTalents. Variables de test en `.env.test` (no commiteado).

---

## 11. Observability del MCP server

El MCP server es un proceso separado del backend. Logs van a:
- stderr del proceso (Claude Desktop los muestra en su log)
- No persisten en Catalyst Logs — solo del lado del usuario

Para debugging cuando el server falla:
- Usuario puede ver logs en Claude Desktop (Settings → Advanced → View MCP server logs)
- Errores con context completo (URL llamada, response status, etc.)

**Telemetría opcional:** endpoint `/api/v1/mcp/telemetry` donde el server reporta uso anónimo. No en v1.

---

## 12. Documentación `docs/INTEGRATIONS/mcp.md`

```markdown
# MCP Server para Claude

## Qué hace
Te permite pedirle a Claude que consulte y opere sobre tu cuenta de SharkTalents
usando lenguaje natural.

## Setup

### 1. Generar API key
Panel admin → API Keys → Create
- Name: "Claude MCP"
- Permissions: "read:*" o las que necesites
- Copiar el token (solo se muestra una vez)

### 2. Configurar Claude Desktop
Editar `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sharktalents": {
      "command": "npx",
      "args": ["-y", "@sharktalents/mcp-server@latest"],
      "env": { "ST_API_KEY": "st_xxxxxxxxxx" }
    }
  }
}
```

### 3. Reiniciar Claude Desktop
Debería aparecer el icon 🔌 con "sharktalents" activo.

## Tools disponibles (15+)
- list_jobs, get_job, create_job
- list_candidates, get_candidate, search_candidates
- list_results, get_result
- list_reports, get_report
- invite_candidate
- update_pipeline_stage
- mark_result_reviewed
- get_competencias_catalog
- get_tenant_info

## Ejemplos de prompts

**Análisis:**
- "Hacé un resumen del puesto 'Senior Dev' con sus candidatos y scores principales."
- "¿Qué candidatos del puesto 'PM' tienen DISC dominante?"
- "Mostrame los 3 candidatos con mejor score técnico del mes."

**Acciones:**
- "Creá un puesto de 'DevOps Engineer' para 'Acme Corp', nivel senior."
- "Invitá a juan@example.com al test de integridad del puesto 'PM'."
- "Moveme a María Pérez a 'siguiente etapa kudert'."

**Exploración:**
- "Explicame la competencia 'Persuasión y negociación'."
- "¿Qué perfiles PK hay?"

## Troubleshooting

### Error "Invalid API key"
- Verificá que el token esté bien copiado (sin espacios).
- Verificá que el token no esté revocado en el panel.

### Claude no ve las tools
- Reiniciá Claude Desktop completamente.
- Verificá el config JSON (debe ser válido).
- Logs: Settings → Advanced → View MCP server logs.

### Rate limited
- Esperá 1 min.
- Si persiste, upgrade de plan o crear más API keys.
```

---

## 13. Checklist de cierre

- [ ] Package `@sharktalents/mcp-server` creado
- [ ] 15+ tools implementadas
- [ ] Resources con contexto del dominio
- [ ] Auth vía API key (arg o env var)
- [ ] Reutiliza API pública v1 internamente
- [ ] README del package con setup instructions
- [ ] Testing manual con Claude Desktop:
  - [ ] Conecta sin errores
  - [ ] `list_jobs` funciona
  - [ ] `create_job` funciona con confirmación
  - [ ] `invite_candidate` devuelve link válido
  - [ ] API key de otro tenant → falla con error claro
- [ ] `docs/INTEGRATIONS/mcp.md` escrito
- [ ] Versión inicial publicada (npm o git)
- [ ] Documentado en panel admin: "Integrar con Claude" con instrucciones
- [ ] Skill de Claude Code `/mcp-builder` invocado al implementar para guía

---

## Siguiente paso

→ Volver a [00_INDEX.md](00_INDEX.md). El master plan está completo.
