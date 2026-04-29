# 15 — API Pública Documentada

**Objetivo:** exponer una API pública versionada, documentada con OpenAPI, autenticada con API keys por tenant, con rate limiting estricto. Para que clientes integren SharkTalents con sus ATS, CRMs, u otras herramientas.

**Tiempo estimado:** 1.5 semanas.
**Dependencias:** Fase 13 (multitenant) y Fase 14 (Clerk). La API pública vive sobre tenants existentes.
**Riesgo:** medio. Exposición pública amplía superficie de ataque — requiere validación estricta y rate limits.

**Referencias:** [08_INTEGRACIONES_EXTERNAS.md](../aprendizajes/08_INTEGRACIONES_EXTERNAS.md), [04_SEGURIDAD.md](../aprendizajes/04_SEGURIDAD.md).

---

## Contexto: API privada vs API pública

### API privada (actual + panel admin)
- Paths: `/api/admin/*`
- Consumidor: solo nuestro frontend admin.
- Auth: Clerk JWT de usuario logueado.
- Documentación: interna, no publicada.

### API pública (nueva)
- Paths: `/api/v1/*`
- Consumidor: cualquier cliente que tenga una API key de su tenant.
- Auth: API key (por tenant) — header `Authorization: Bearer st_<token>` o `X-Api-Key: st_<token>`.
- Documentación: **OpenAPI 3.1 spec** + Swagger UI en `/docs`.
- Versionado: `/v1/`, con migración planeada a `/v2/` si hay breaking changes.

**Importante:** la API pública tiene **rate limits más estrictos** que la admin — cliente puede hacer bots.

---

## Deliverables

- [ ] Namespace `/api/v1/` separado de `/api/admin/`
- [ ] Tabla `ApiKeys` (una por tenant + usuario creador)
- [ ] Middleware `requireApiKey` (reemplaza o complementa `requireAuth`)
- [ ] OpenAPI 3.1 spec autoritative en `docs/api/openapi.yaml`
- [ ] Swagger UI hosted en `/docs`
- [ ] Endpoint público `GET /api/v1/openapi.json` para clientes que generen SDK
- [ ] 10–15 endpoints iniciales (lectura + acciones core)
- [ ] Rate limit por API key (60 req/min default; configurable por plan)
- [ ] Panel admin: crear/revocar API keys del tenant
- [ ] Docs con ejemplos (curl, Node, Python)
- [ ] Webhook system (opcional futuro: eventos salientes a clientes)

---

## 1. Diseño de la API v1

### Endpoints iniciales (15)

**Jobs:**
- `GET /api/v1/jobs` — lista jobs del tenant
- `GET /api/v1/jobs/:id` — detalle de un job
- `POST /api/v1/jobs` — crear job

**Candidates:**
- `GET /api/v1/candidates` — lista candidates
- `GET /api/v1/candidates/:id` — detalle
- `POST /api/v1/candidates` — registrar candidate (sin disparar test)

**Assessments:**
- `GET /api/v1/jobs/:jobId/assessments` — lista assessments
- `POST /api/v1/jobs/:jobId/assessments/:type/invite` — invitar candidato a test (devuelve link)

**Results:**
- `GET /api/v1/jobs/:jobId/results` — lista results de un job
- `GET /api/v1/results/:id` — detalle con scores

**Reports:**
- `GET /api/v1/reports` — lista reports publicados
- `GET /api/v1/reports/:id` — detalle + candidatos + scores

**Pipeline:**
- `POST /api/v1/results/:id/pipeline-stage` — cambiar stage

**Webhooks (futuro):**
- `POST /api/v1/webhooks` — registrar webhook para eventos
- `DELETE /api/v1/webhooks/:id`

### Convenciones

- **REST idiomático.** Plural recursos, verbos HTTP correctos.
- **JSON in, JSON out.** Content-Type: application/json.
- **snake_case** en request/response bodies (consistente con DB).
- **UTC** para todos los timestamps, formato ISO 8601.
- **Paginación** en listas: `?page=1&per_page=50`, response con `meta.total`, `meta.page`, `meta.total_pages`.
- **Errores estandarizados:**
  ```json
  {
    "error": {
      "code": "validation_error",
      "message": "Human-readable description",
      "details": { "field": "..." }
    }
  }
  ```

### Response envelope

```json
{
  "data": { ... },
  "meta": { "trace_id": "abc123", "api_version": "v1" }
}
```

Lists:
```json
{
  "data": [ ... ],
  "meta": {
    "trace_id": "...",
    "page": 1,
    "per_page": 50,
    "total": 237,
    "total_pages": 5
  }
}
```

---

## 2. Schema de `ApiKeys`

```
ApiKeys
├── ROWID            BigInt
├── tenant_id        Text (50, FK Tenants)
├── name             Text (100)                   ('Production ATS integration', 'Mi Zapier')
├── key_hash         Text (128, unique check)     SHA256 del token (nunca plaintext)
├── key_prefix       Text (10)                    ('st_abc123...' — mostrar al usuario primeros 10)
├── created_by_user  Text (50)                    (clerk_user_id)
├── permissions      Text (long)                  JSON array: ['read:jobs', 'read:candidates', 'write:results']
├── rate_limit_per_min Integer                    default 60
├── last_used_at     DateTime nullable
├── expires_at       DateTime nullable            (opcional — keys pueden ser permanent o TTL'd)
├── is_active        Boolean
├── created_at       DateTime
├── revoked_at       DateTime nullable
```

### Generación

```typescript
// services/apiKeysService.ts
import * as crypto from 'crypto';

export function generateApiKey(): { token: string; hash: string; prefix: string } {
  // Formato: st_<32 bytes base62>
  const random = crypto.randomBytes(32).toString('base64url');
  const token = `st_${random}`;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const prefix = token.substring(0, 10);
  return { token, hash, prefix };
}

export async function createApiKey(
  req: any, tenantId: string, createdBy: string, data: { name: string; permissions: string[]; expiresAt?: Date }
): Promise<{ id: string; token: string; prefix: string }> {
  const { token, hash, prefix } = generateApiKey();

  const row = await apiKeysDb.insert(req, {
    tenant_id: tenantId,
    name: data.name,
    key_hash: hash,
    key_prefix: prefix,
    created_by_user: createdBy,
    permissions: JSON.stringify(data.permissions),
    rate_limit_per_min: 60,
    expires_at: data.expiresAt ? db.toCatalystDateTime(data.expiresAt) : '',
    is_active: true,
    created_at: db.now(),
  });

  // Devolver token plaintext SOLO una vez. Después solo se ve el prefix.
  return { id: row.id, token, prefix };
}
```

### Validación

```typescript
// middleware/apiKey.ts
export async function requireApiKey(ctx: RequestContext): Promise<string> {
  const authHeader = (ctx.req.headers as any).authorization || '';
  let token: string | null = null;

  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if ((ctx.req.headers as any)['x-api-key']) {
    token = (ctx.req.headers as any)['x-api-key'] as string;
  }

  if (!token || !token.startsWith('st_')) {
    throw new UnauthorizedError('Missing or invalid API key');
  }

  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const apiKey = await apiKeysDb.getByHash(ctx.req, hash);

  if (!apiKey) throw new UnauthorizedError('Invalid API key');
  if (!apiKey.is_active || apiKey.revoked_at) throw new UnauthorizedError('Revoked API key');
  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
    throw new UnauthorizedError('Expired API key');
  }

  // Setear contexto
  ctx.tenantId = apiKey.tenant_id;
  ctx.apiKey = apiKey;

  // Update last_used_at async (no await — no bloquear request)
  apiKeysDb.updateLastUsed(ctx.req, apiKey.id).catch(() => {});

  return apiKey.tenant_id;
}

export function requirePermission(ctx: RequestContext, permission: string): void {
  if (!ctx.apiKey) throw new UnauthorizedError('No API key');
  const perms = JSON.parse(ctx.apiKey.permissions || '[]');
  if (!perms.includes(permission) && !perms.includes('*')) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
}
```

### Uso en handlers

```typescript
// handlers/api/v1/jobs.ts
export async function listJobs(ctx: RequestContext) {
  await requireApiKey(ctx);
  requirePermission(ctx, 'read:jobs');

  const jobs = await jobsDb.listAll(ctx.req, ctx.tenantId!);
  sendApiResponse(ctx.res, { data: jobs.map(toJobDto) });
}
```

---

## 3. OpenAPI spec

### `docs/api/openapi.yaml`

Archivo canónico con toda la spec:

```yaml
openapi: 3.1.0
info:
  title: SharkTalents API
  description: |
    API pública para integrar SharkTalents con ATS, CRMs, y otras herramientas.

    ## Auth
    Todas las requests requieren un API key (`Authorization: Bearer st_xxx`).
    Las keys se generan desde el panel admin de SharkTalents.

    ## Rate limits
    Default: 60 requests/min por API key. Configurable en el plan.

    ## Errores
    Todos los errores siguen formato estándar:
    ```json
    {
      "error": {
        "code": "validation_error",
        "message": "...",
        "details": { }
      }
    }
    ```
  version: 1.0.0
  contact:
    email: support@sharktalents.ai
servers:
  - url: https://sharktalents.ai/server/api/api/v1
    description: Production
  - url: https://dev.sharktalents.catalystserverless.com/server/api/api/v1
    description: Development

security:
  - ApiKeyAuth: []

components:
  securitySchemes:
    ApiKeyAuth:
      type: http
      scheme: bearer

  schemas:
    Job:
      type: object
      required: [id, title, company, created_at]
      properties:
        id: { type: string, example: "12345" }
        title: { type: string, example: "Senior Developer" }
        company: { type: string, example: "Acme Inc." }
        cognitive_level:
          type: string
          enum: [basic, mid, senior]
        is_active: { type: boolean }
        created_at: { type: string, format: date-time }
        ideal_profile:
          $ref: '#/components/schemas/JobProfile'
        ideal_competencias:
          type: array
          items: { $ref: '#/components/schemas/JobCompetencia' }

    JobProfile:
      type: object
      properties:
        disc:
          type: object
          properties:
            D: { type: integer, minimum: 0, maximum: 100 }
            I: { type: integer, minimum: 0, maximum: 100 }
            S: { type: integer, minimum: 0, maximum: 100 }
            C: { type: integer, minimum: 0, maximum: 100 }
        cognitive:
          type: object
          properties:
            verbal: { type: integer }
            espacial: { type: integer }
            logica: { type: integer }
            numerica: { type: integer }
            abstracta: { type: integer }
        min_technical_score: { type: integer }

    JobCompetencia:
      type: object
      properties:
        id: { type: string }
        nivel_esperado: { type: integer }

    Candidate:
      type: object
      properties:
        id: { type: string }
        name: { type: string }
        email: { type: string, format: email }
        phone: { type: string, nullable: true }
        age: { type: integer, nullable: true }
        created_at: { type: string, format: date-time }

    Result:
      type: object
      properties:
        id: { type: string }
        assessment_type:
          type: string
          enum: [technical, kudert, integrity]
        candidate_id: { type: string }
        status:
          type: string
          enum: [opened, in_progress, completed]
        completed_at: { type: string, format: date-time, nullable: true }
        pipeline_stage: { type: string, nullable: true }
        scores:
          type: object
          description: Scores normalizados. Shape depende del tipo de assessment.

    Error:
      type: object
      required: [error]
      properties:
        error:
          type: object
          properties:
            code: { type: string }
            message: { type: string }
            details: { type: object }

    Meta:
      type: object
      properties:
        trace_id: { type: string }
        api_version: { type: string, example: "v1" }
        page: { type: integer }
        per_page: { type: integer }
        total: { type: integer }
        total_pages: { type: integer }

paths:
  /jobs:
    get:
      summary: Lista jobs del tenant
      tags: [Jobs]
      parameters:
        - { name: page, in: query, schema: { type: integer, default: 1 } }
        - { name: per_page, in: query, schema: { type: integer, default: 50, maximum: 100 } }
        - { name: is_active, in: query, schema: { type: boolean } }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  data: { type: array, items: { $ref: '#/components/schemas/Job' } }
                  meta: { $ref: '#/components/schemas/Meta' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '429': { $ref: '#/components/responses/RateLimited' }

    post:
      summary: Crear un job nuevo
      tags: [Jobs]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [title, company, cognitive_level]
              properties:
                title: { type: string, maxLength: 255 }
                company: { type: string, maxLength: 255 }
                tech_prompt: { type: string, maxLength: 10000 }
                cognitive_level:
                  type: string
                  enum: [basic, mid, senior]
                ideal_profile:
                  $ref: '#/components/schemas/JobProfile'
                ideal_competencias:
                  type: array
                  items: { $ref: '#/components/schemas/JobCompetencia' }
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema:
                type: object
                properties:
                  data: { $ref: '#/components/schemas/Job' }

  /jobs/{id}:
    get:
      summary: Detalle de un job
      tags: [Jobs]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  data: { $ref: '#/components/schemas/Job' }
        '404': { $ref: '#/components/responses/NotFound' }

  /jobs/{jobId}/assessments/{type}/invite:
    post:
      summary: Invitar candidato a un test
      tags: [Assessments]
      parameters:
        - { name: jobId, in: path, required: true, schema: { type: string } }
        - { name: type, in: path, required: true, schema: { type: string, enum: [technical, kudert, integrity] } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email]
              properties:
                email: { type: string, format: email }
                name: { type: string }
                expires_at: { type: string, format: date-time, nullable: true }
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: object
                    properties:
                      invitation_url: { type: string }
                      expires_at: { type: string, format: date-time }

  /results/{id}:
    get:
      summary: Detalle de un result con scores
      tags: [Results]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  data: { $ref: '#/components/schemas/Result' }

  # ... resto de endpoints

  responses:
    Unauthorized:
      description: Invalid or missing API key
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    NotFound:
      description: Resource not found
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    RateLimited:
      description: Too many requests
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
```

### Endpoint que sirve el spec

```typescript
// handlers/api/v1/openapi.ts
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

let cachedSpec: any = null;

export async function getOpenApiSpec(ctx: RequestContext) {
  if (!cachedSpec) {
    const file = path.join(__dirname, '..', '..', '..', '..', 'docs', 'api', 'openapi.yaml');
    cachedSpec = yaml.load(fs.readFileSync(file, 'utf-8'));
  }
  sendJson(ctx.res, 200, cachedSpec);
}
```

Exponer en `/api/v1/openapi.json` (público, sin auth — es spec).

---

## 4. Swagger UI en `/docs`

Instalar:
```bash
cd frontend
npm install swagger-ui-react
```

O mejor: usar hosted alternative **Scalar** (`@scalar/api-reference`) que es más moderno:

```bash
npm install @scalar/api-reference-react
```

### Página `/docs`

```tsx
// shark/src/pages/public/ApiDocs.tsx
import { ApiReferenceReact } from '@scalar/api-reference-react';
import { API_BASE } from '@/config';

export default function ApiDocs() {
  return (
    <ApiReferenceReact
      configuration={{
        spec: { url: `${API_BASE}/v1/openapi.json` },
        theme: 'purple',
        layout: 'modern',
      }}
    />
  );
}
```

Ruta en `App.tsx`:
```tsx
<Route path="/docs/*" element={<ApiDocs />} />
```

URL final: `https://sharktalents.ai/app/index.html#/docs` — pública, sin auth.

---

## 5. Rate limiting por API key

Reutilizar la tabla `RateLimitEvents` con keys específicas:

```typescript
// middleware/rateLimit.ts — aumentado
export async function rateLimitApi(ctx: RequestContext): Promise<void> {
  if (!ctx.apiKey) return;  // solo para requests con API key

  await rateLimit(ctx, `api:key:${ctx.apiKey.id}`, {
    windowMs: 60_000,
    max: ctx.apiKey.rate_limit_per_min || 60,
  });
}
```

Aplicar en router para todas las `/api/v1/*`.

### Límites sugeridos por plan

| Plan | req/min por API key | API keys por tenant | Webhooks por tenant |
|---|---|---|---|
| Free | 30 | 1 | 0 |
| Starter | 60 | 3 | 2 |
| Pro | 300 | 10 | 10 |
| Enterprise | Custom | Unlimited | Unlimited |

Configurable en `ApiKeys.rate_limit_per_min` (override por key).

---

## 6. Webhooks salientes (feature futura)

Clientes registran webhooks → SharkTalents les manda eventos cuando algo pasa.

### Eventos

- `candidate.registered` — nuevo candidato para un job
- `test.completed` — candidato terminó test
- `report.published` — reporte al cliente publicado
- `pipeline.changed` — transition de stage

### Schema

```
Webhooks
├── ROWID        BigInt
├── tenant_id    Text (50)
├── url          Text (500)
├── events       Text (JSON array)   (['test.completed', ...])
├── secret       Text (64)           (nuestro secret — cliente lo usa para verificar)
├── is_active    Boolean
├── created_at   DateTime
```

### Envío

Al ocurrir un evento, insertar en `OutboxEvents` con `event_type: 'webhook.send'` + payload. Worker procesa y manda POST al webhook del cliente con HMAC en header.

**No implementar en v1 — dejar placeholder.** Es una feature enterprise típica, no MVP.

---

## 7. Panel admin para gestionar API keys

### UI: nueva página `/admin/api-keys`

- Listar keys existentes: nombre, prefix, created_at, last_used_at, is_active, revoke button
- Crear key: modal con name + permissions + expiration (opcional)
- Al crear: **mostrar el token completo UNA SOLA VEZ** (después solo prefix). Mensaje: "Guardá esto — no podrás verlo de nuevo."
- Revoke: mark `is_active = false` + `revoked_at`

### Endpoints admin

```
POST   /api/admin/api-keys           → create
GET    /api/admin/api-keys           → list (prefix only, never plaintext)
DELETE /api/admin/api-keys/:id       → revoke
```

---

## 8. Security best practices

### Rotation

Documentar en runbook:
- Si se sospecha leak: revocar key inmediatamente.
- Crear nueva key con mismos permisos → cliente actualiza su integración.
- No hay "grace period" — la key comprometida debe desactivarse ya.

### Scoping

Permissions granulares:
- `read:jobs`, `write:jobs`
- `read:candidates`, `write:candidates`
- `read:results`
- `read:reports`
- `*` (wildcard — solo para keys de owners del tenant)

### Rate limit global

Además del rate limit por key, protección anti-DDoS a nivel tenant:

```typescript
await rateLimit(ctx, `api:tenant:${ctx.tenantId}`, {
  windowMs: 60_000,
  max: 1000,  // tenant entero
});
```

### Logging

Cada request a `/api/v1/*` se logea con:
- `api_key_id` (no el token, solo el ID)
- `tenant_id`
- `endpoint`
- `status_code`
- `duration_ms`

Para auditoria + detección de abuse.

---

## 9. SDKs (futuro)

Cuando haya clientes usando la API, considerar generar SDKs:

- **Node.js:** `openapi-generator` desde el spec → package npm `@sharktalents/sdk-js`
- **Python:** similar → `sharktalents-sdk`

No se hace en v1. Solo mantener el spec OpenAPI limpio — cuando haya tracción, generar SDK con una command.

---

## 10. Documentación `docs/INTEGRATIONS/api.md`

```markdown
# API Pública SharkTalents

## Quick start

1. Obtener API key: Panel admin → API Keys → Create
2. Hacer request:
   ```bash
   curl https://sharktalents.ai/server/api/api/v1/jobs \
     -H "Authorization: Bearer st_xxxxxxxxx"
   ```

## Spec completo
https://sharktalents.ai/app/index.html#/docs

## Ejemplos

### Node.js
```js
const fetch = require('node-fetch');

async function listJobs() {
  const res = await fetch('https://sharktalents.ai/server/api/api/v1/jobs', {
    headers: { Authorization: 'Bearer ' + process.env.ST_API_KEY },
  });
  const { data, meta } = await res.json();
  console.log(`Total jobs: ${meta.total}`);
  return data;
}
```

### Python
```python
import requests

def list_jobs():
    r = requests.get(
        'https://sharktalents.ai/server/api/api/v1/jobs',
        headers={'Authorization': f'Bearer {os.environ["ST_API_KEY"]}'}
    )
    r.raise_for_status()
    body = r.json()
    print(f'Total jobs: {body["meta"]["total"]}')
    return body['data']
```

### Crear un job + invitar candidato
```bash
JOB_ID=$(curl -sX POST /v1/jobs \
  -H "Authorization: Bearer $KEY" \
  -d '{"title":"Dev","company":"Acme","cognitive_level":"mid"}' \
  | jq -r '.data.id')

curl -X POST /v1/jobs/$JOB_ID/assessments/kudert/invite \
  -H "Authorization: Bearer $KEY" \
  -d '{"email":"juan@example.com","name":"Juan Pérez"}'
```

## Rate limits
Default 60 req/min por API key. Header `X-RateLimit-Remaining` indica cuánto te queda.

## Errores
```json
{ "error": { "code": "validation_error", "message": "...", "details": {} } }
```

Códigos comunes:
- `invalid_api_key` → 401
- `missing_permission` → 403
- `not_found` → 404
- `validation_error` → 400
- `rate_limited` → 429
- `internal_error` → 500

## Versionado
- `/v1/` es la versión actual.
- Breaking changes = nueva versión (`/v2/`). Mantenemos `/v1/` por 12 meses post-release de v2.
- Non-breaking changes se deployan a `/v1/` sin notice (campos opcionales nuevos, etc.).

## Changelog
Ver https://sharktalents.ai/app/index.html#/docs
```

---

## 11. Checklist de cierre

- [ ] Tabla `ApiKeys` creada
- [ ] Middleware `requireApiKey` implementado
- [ ] Middleware `requirePermission` para granularidad
- [ ] Namespace `/api/v1/` separado de `/api/admin/`
- [ ] 10+ endpoints iniciales implementados (GET jobs, candidates, results, POST job, POST invite, etc.)
- [ ] OpenAPI spec en `docs/api/openapi.yaml`
- [ ] Endpoint `/api/v1/openapi.json` sirve el spec
- [ ] `/docs` con Scalar o Swagger UI funcional
- [ ] Rate limiting por API key activo
- [ ] Panel admin `/admin/api-keys` para crear/revocar
- [ ] Token mostrado solo una vez al crear
- [ ] `docs/INTEGRATIONS/api.md` con ejemplos
- [ ] Smoke tests:
  - [ ] Crear API key → hacer request → 200
  - [ ] Key inválida → 401
  - [ ] Cross-tenant: key de tenant A intenta acceder a recurso de B → 404
  - [ ] Rate limit: 61 requests en 1 min → 429
  - [ ] OpenAPI spec válido (verificar con https://editor.swagger.io/)

---

## Siguiente paso

→ [16_MCP_SERVER.md](16_MCP_SERVER.md) — servidor MCP para conectar Claude directamente.
