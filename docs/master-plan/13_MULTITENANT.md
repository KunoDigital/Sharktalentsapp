# 13 — Multitenancy

**Objetivo:** convertir SharkTalents de single-tenant (un admin único, una empresa = Kuno) a multi-tenant (N empresas independientes usan la misma instancia con data aislada).

**Tiempo estimado:** 2 semanas (integrado con Fase 2 de DB + Fase 3 de Seguridad).
**Dependencias:** Fase 1 completa. Se ejecuta junto con [14_CLERK_AUTH.md](14_CLERK_AUTH.md) — el tenant_id viene del Clerk Organization.
**Riesgo:** alto. Un bug de isolation = data leak entre clientes. Requiere testeo exhaustivo.

**Referencias:** [docs/aprendizajes/03_DATABASE_DESIGN.md](../aprendizajes/03_DATABASE_DESIGN.md), [04_SEGURIDAD.md](../aprendizajes/04_SEGURIDAD.md).

---

## Terminología

| Término | Significado |
|---|---|
| **Tenant** | Empresa/organización cliente que usa SharkTalents (ej. Kuno, AcmeTech, Hotel Pacifica). |
| **Organization** (Clerk) | El concepto de Clerk que mapea 1:1 a tenant. |
| **User** | Persona física con acceso a uno o más tenants (con roles distintos en cada uno). |
| **Tenant scope** | Filtro automático que aplica `WHERE tenant_id = X` a todas las queries. |
| **Cross-tenant data** | Data que no pertenece a un tenant (ej. catálogo de competencias global). |

---

## Modelo: Clerk Organizations = Tenants

Clerk tiene feature "Organizations" que es literalmente multitenancy built-in:

- 1 Clerk Organization = 1 Tenant de SharkTalents
- Users pueden pertenecer a N organizations
- Cada organization tiene roles (`admin`, `member`) — Clerk los define
- El JWT de Clerk incluye `org_id` cuando hay org activa

Ver [14_CLERK_AUTH.md](14_CLERK_AUTH.md) para el detalle de integración.

**Decisión:** usamos el `organization_id` de Clerk como nuestro `tenant_id`. No mantenemos tabla local de "Tenants" separada — es la source of truth de Clerk.

Pero sí mantenemos tabla local **`Tenants`** con metadata adicional que no vive en Clerk:
- Configuración de features habilitadas
- Límites de plan (max puestos activos, max candidatos/mes)
- Branding (logo, colores del reporte público)

---

## Deliverables

- [ ] Tabla `Tenants` con metadata local + sync con Clerk Organizations
- [ ] Columna `tenant_id` en todas las tablas de dominio
- [ ] Middleware `requireTenant` que extrae `org_id` del Clerk JWT
- [ ] `ctx.tenantId` propagado a todos los handlers/services
- [ ] Todas las queries filtran por `tenant_id` automáticamente
- [ ] Tests de isolation: user del tenant A no puede acceder a data del tenant B
- [ ] Webhook Clerk → crea/actualiza Tenant en DB
- [ ] UI de switch de tenant en sidebar (si user pertenece a varios)
- [ ] Audit log incluye tenant_id
- [ ] Rate limiting scope por tenant
- [ ] Token usage tracking por tenant

---

## 1. Schema multitenant

### Tablas a las que se agrega `tenant_id`

Todas las tablas del dominio operacional:

| Tabla | `tenant_id` | Comentario |
|---|---|---|
| `Tenants` | — | Identifier único (row id del tenant) |
| `Jobs` | ✅ required | Un puesto pertenece a un tenant |
| `JobProfiles` | ✅ (heredado) | via Jobs.tenant_id |
| `JobCompetencias` | ✅ (heredado) | via Jobs.tenant_id |
| `JobCostConfig` | ✅ (heredado) | via Jobs.tenant_id |
| `Assessments` | ✅ required | Via job, pero denormalizar para queries rápidas |
| `AssessmentQuestions` | ✅ (heredado) | Heredan del assessment → job → tenant |
| `Candidates` | ✅ required | **Nota**: un candidato físico podría aplicar a puestos de distintos tenants — ver sección "Candidates cross-tenant" |
| `Results` | ✅ required | Por tenant (para queries rápidas) |
| `DiscScores`, `CognitiveScores`, etc. | ✅ (heredado) | via Results.tenant_id, denormalizado |
| `ScreenExits` | ✅ (heredado) | |
| `PipelineTransitions` | ✅ (heredado) | |
| `ClientReports` | ✅ required | |
| `ReportCandidates` | ✅ (heredado) | |
| `TechLibrary` | ✅ required | Biblioteca es por tenant (lo que Kuno acumula ≠ lo que AcmeTech acumula) |
| `AuditLog` | ✅ required | Por tenant para compliance |
| `TokenUsage` | ✅ required | Para billing por tenant |
| `OutboxEvents` | ✅ required | Eventos escopados por tenant |
| `ProcessedEvents` | Opcional | Idempotencia global aceptable |
| `RateLimitEvents` | ✅ (en key) | El `key` incluye `tenant:<id>:...` |
| `CircuitBreakers` | — | Global por servicio externo (Anthropic) |
| `HealthChecks` | — | Global |
| `Config` | Opcional | Feature flags pueden ser globales o por tenant |

### Schema `Tenants`

```
Tenants
├── ROWID               BigInt
├── clerk_org_id        Text (50, unique)      ← fuente de verdad
├── name                Text (255)              ← sync desde Clerk
├── slug                Text (100, unique)      ← para URLs (sharktalents.ai/t/<slug>)
├── plan                Text (20)               ('free' | 'starter' | 'pro' | 'enterprise')
├── status              Text (20)               ('active' | 'suspended' | 'deleted')
├── max_active_jobs     Integer                 (límite del plan)
├── max_candidates_per_month Integer
├── features_enabled    Text (long)             JSON: { mcp: true, api: true, custom_branding: false }
├── branding_config     Text (long, nullable)   JSON: { logo_url, primary_color, etc. }
├── billing_email       Text (255, nullable)
├── created_at          DateTime
├── updated_at          DateTime
```

### Ejemplo: Jobs con tenant_id

```
Jobs
├── ROWID            BigInt
├── tenant_id        Text (50, FK a Tenants.ROWID)     ← NUEVO
├── title            Text (255)
├── company          Text (255)           ← este campo sigue existiendo como "nombre del puesto" (no es el tenant)
├── ...
```

**Nota sutil:** `company` en Jobs sigue significando "la empresa cliente de este puesto" — que es el **mismo tenant** (Kuno crea puestos para sus clientes = Kuno como agencia cliente de SharkTalents, pero `Jobs.company` es el cliente final de Kuno). O, si AcmeTech usa SharkTalents directamente para sí misma, `Jobs.company = "AcmeTech"` y `tenant_id = org_of_acmetech`. Confuso pero así se modela.

Alternativa más limpia: renombrar `Jobs.company` a `Jobs.client_company` para clarity.

---

## 2. `Candidates` cross-tenant — decisión importante

Un candidato humano (Juan Pérez, email `juan@gmail.com`) puede aplicar a puestos de AcmeTech Y de Hotel Pacifica. ¿Lo tratamos como:

### Opción A: Candidate es por tenant (siempre separado)

- Si Juan aplica a AcmeTech: se crea candidato `#123` con `tenant_id = acme`.
- Si Juan aplica a Hotel Pacifica: se crea candidato `#456` con `tenant_id = hotel` (duplicado).
- **Pros:** isolation absoluta. Cero chance de leak.
- **Cons:** Juan hace la misma DISC 2 veces. Kuno no puede "enviar candidatos entre puestos".

### Opción B: Candidate es global, results son por tenant

- Juan es candidato `#123`, sin tenant.
- Cuando aplica a un puesto de AcmeTech, se crea Result con `tenant_id = acme`.
- Juan ve sus datos al volver (reuso de DISC).
- **Pros:** mejor UX. Menos duplicación. Matching mejor.
- **Cons:** necesitamos un paso de "consent" explícito — "¿autorizás compartir tus resultados con <tenant>?"

### Opción C: Tenant scope con compartir explícito

Igual que B, pero:
- Results viven en tenant específico.
- Candidatos que ya hicieron test en tenant X pueden compartir results con tenant Y **solo si dan consent en el flow**.

### Recomendación

**Opción C** para un producto serio. Pros de UX sin violar compliance.

**Para el MVP multitenant:** empezar con Opción A (más simple, más segura). Migrar a B o C en una fase futura si hay demanda.

Este doc asume **Opción A** — schema con `Candidates.tenant_id` required.

---

## 3. Middleware de tenant scope

### `middleware/tenant.ts`

```typescript
// functions/api/src/middleware/tenant.ts
import { ForbiddenError, UnauthorizedError } from '../lib/errors';
import { RequestContext } from '../lib/context';
import * as tenantsDb from '../db/tenants';

export async function requireTenant(ctx: RequestContext): Promise<string> {
  if (!ctx.user) {
    throw new UnauthorizedError('Authentication required');
  }

  // org_id viene del Clerk JWT (ver 14_CLERK_AUTH.md)
  const clerkOrgId = ctx.user.clerk_org_id;
  if (!clerkOrgId) {
    throw new ForbiddenError('No active organization. Select one.');
  }

  // Lookup tenant por clerk_org_id
  const tenant = await tenantsDb.getByClerkOrgId(ctx.req, clerkOrgId);
  if (!tenant) {
    throw new ForbiddenError(`Tenant not provisioned for org ${clerkOrgId}`);
  }

  if (tenant.status !== 'active') {
    throw new ForbiddenError(`Tenant is ${tenant.status}`);
  }

  ctx.tenantId = tenant.id;
  ctx.tenant = tenant;
  return tenant.id;
}
```

### Uso en router

```typescript
// router.ts
if (path.startsWith('/api/admin')) {
  await requireAuth(ctx);
  await requireTenant(ctx);   // 🆕 inyecta tenantId
}
```

### Endpoints excluidos

Algunos endpoints **no** deben requerir tenant:

- `/api/health`, `/api/health/detailed` — global
- `/api/auth/*` (si usamos Clerk webhooks, endpoints de callback)
- `/api/public/test/:token` — el candidato tomando el test no tiene sesión; el tenant se deriva del assessment
- `/api/public/report/:company/:job/:id` — público, tenant se deriva del reporte
- `/api/internal/*` — función-a-función con `INTERNAL_API_KEY`

---

## 4. Queries con tenant scope

### Helper `db/scope.ts`

```typescript
// functions/api/src/db/scope.ts
import { esc } from './helpers';

export function scopedWhere(tenantId: string, additional?: string): string {
  const base = `tenant_id = ${esc(tenantId)}`;
  return additional ? `${base} AND ${additional}` : base;
}

export function scopedQuery(table: string, tenantId: string, additional?: string): string {
  return `SELECT * FROM ${table} WHERE ${scopedWhere(tenantId, additional)}`;
}
```

### Uso en módulos `db/*.ts`

**Todo módulo db debe recibir `tenantId` como parámetro.** Sin excepción.

```typescript
// db/jobs.ts
export async function listAll(req: any, tenantId: string): Promise<Job[]> {
  return await db.queryAll(req,
    `SELECT * FROM Jobs WHERE ${scopedWhere(tenantId)} ORDER BY created_at DESC`,
    'Jobs'
  );
}

export async function getById(req: any, tenantId: string, id: string): Promise<Job | null> {
  return await db.queryOne(req,
    `SELECT * FROM Jobs WHERE ${scopedWhere(tenantId, `ROWID = ${esc(id)}`)}`,
    'Jobs'
  );
}
```

**Nunca** una función de `db/` acepta `getById(req, id)` sin tenantId. Esto previene que un bug en el handler traiga data ajena.

### Handler ejemplo

```typescript
// handlers/adminJobs.ts
export async function getJob(ctx: RequestContext) {
  await requireTenant(ctx);   // ctx.tenantId ya está
  const job = await jobsDb.getById(ctx.req, ctx.tenantId!, ctx.params.id);
  if (!job) throw new NotFoundError('Job not found');
  sendJson(ctx.res, 200, job);
}
```

Si el user intenta acceder a un job de otro tenant, la query devuelve null → 404 (no 403 por seguridad; no revelamos que el job existe en otro tenant).

---

## 5. Inserts con tenant_id

Al crear cualquier recurso, inyectar `tenant_id`:

```typescript
// services/jobsService.ts
export async function create(req: any, tenantId: string, data: NewJobData, createdBy: string): Promise<Job> {
  const job = await jobsDb.insert(req, {
    tenant_id: tenantId,     // siempre
    title: data.title,
    company: data.company,
    ...
  });
  return job;
}
```

Regla: **ninguna función de `services/` acepta data sin tenantId**. El handler lo pasa explicit.

---

## 6. Denormalización de tenant_id

Para tablas que son secundarias (heredan vía FK chain), considerar denormalizar `tenant_id`:

### Pros
- Queries más rápidas: `WHERE tenant_id = X AND result_id = Y` sin join.
- Validación más simple: en cada insert, verify que todos los ancestros matchean.

### Cons
- Ligeramente más storage.
- Consistency: si cambia el tenant del ancestro (raro), hay que update en cascada.

### Decisión

Denormalizar en: `DiscScores`, `CognitiveScores`, `EmotionalScores`, `IntegrityScores`, `IntegrityDimensions`, `TechnicalScores`, `CompetenciaScores`, `ScreenExits`, `PipelineTransitions`, `AssessmentQuestions`, `JobProfiles`, `JobCompetencias`, `JobCostConfig`, `ReportCandidates`.

Sin denormalizar (join siempre): `Tenants` (obviamente).

---

## 7. Validación de cross-tenant references

Al relacionar entidades, verificar que ambas pertenecen al mismo tenant:

```typescript
// services/reportsService.ts
export async function createClientReport(
  req: any,
  tenantId: string,
  data: { jobId: string; candidateIds: string[] }
): Promise<ClientReport> {

  // Validar: job pertenece al tenant
  const job = await jobsDb.getById(req, tenantId, data.jobId);
  if (!job) throw new NotFoundError('Job not found');

  // Validar: todos los candidatos pertenecen al tenant
  const candidates = await candidatesDb.listByIds(req, tenantId, data.candidateIds);
  if (candidates.length !== data.candidateIds.length) {
    throw new ValidationError('Some candidates not found or cross-tenant');
  }

  // ... crear reporte
}
```

Si un attacker logra pasar IDs de otros tenants en el request, la query con `tenantId` en WHERE devuelve vacío → error.

---

## 8. Audit log con tenant

```typescript
await auditLog.log(ctx.req, {
  tenantId: ctx.tenantId,    // NUEVO
  actor: ctx.user!.username,
  action: 'job.create',
  resourceType: 'job',
  resourceId: job.id,
  changes: { title: job.title },
  request: ctx.req,
});
```

Tabla `AuditLog.tenant_id` agregado. Queries de audit scope por tenant — cada tenant solo ve su propio audit.

---

## 9. Token usage per tenant

Esto habilita billing por tenant:

```typescript
await tokenTracker.track(req, {
  tenantId: ctx.tenantId,
  jobId: jobId,
  action: 'generate_technical',
  // ...
});
```

Agregados en `/admin/metrics`:
- Si es admin global de SharkTalents → ve totales de todos los tenants
- Si es admin de un tenant → ve solo sus totales

---

## 10. Rate limiting scope por tenant

Keys incluyen tenant:

```typescript
// Before
await rateLimit(ctx, `createJob:user:${userId}`, { windowMs: 300000, max: 50 });

// After (multi-tenant)
await rateLimit(ctx, `createJob:tenant:${ctx.tenantId}:user:${userId}`, { windowMs: 300000, max: 50 });
```

Separar buckets por tenant previene que un tenant abuse y afecte a otros.

---

## 11. Webhook Clerk → crear Tenant

Ver [14_CLERK_AUTH.md](14_CLERK_AUTH.md) para el detalle del webhook. Resumen:

```
Clerk event: organization.created
  ↓
POST /api/webhooks/clerk/organization-created  (con HMAC verificado)
  ↓
Handler:
  - Extrae org_id, name, slug del event
  - INSERT en Tenants con plan='free' default
  - Inicializa features_enabled
  - Envía email de bienvenida (via outbox)
```

```
Clerk event: organization.updated
  ↓
Handler actualiza el Tenants.name, Tenants.slug si cambiaron en Clerk
```

```
Clerk event: organization.deleted
  ↓
Handler marca Tenant.status = 'deleted'
(Data no se borra — podrían necesitarla para compliance. Reingresable si el cliente vuelve.)
```

---

## 12. UI: switch de tenant

Si el user pertenece a 2+ tenants, el sidebar muestra un selector:

```tsx
// components/TenantSwitcher.tsx
import { OrganizationSwitcher } from '@clerk/react';

export default function TenantSwitcher() {
  return (
    <OrganizationSwitcher
      afterSelectOrganizationUrl="/admin"
      hidePersonal={true}   // forzamos que trabaje en contexto de org, no personal
    />
  );
}
```

`OrganizationSwitcher` de Clerk maneja el state de active org. Al cambiar, el JWT subsecuente incluye el nuevo `org_id` → requests van al tenant nuevo automáticamente.

---

## 13. Aislamiento en reportes públicos

Los reportes públicos se acceden sin login (via token). El `tenant_id` se obtiene del reporte mismo:

```typescript
// handlers/publicReport.ts
export async function getPublicReport(ctx: RequestContext) {
  const { companySlug, jobSlug, reportId } = ctx.params;
  const token = ctx.query.token;

  // Load report — NOTA: sin filter por tenant, viene por el path
  const report = await clientReportsDb.getByIdAndSlugsPublic(
    ctx.req, reportId, companySlug, jobSlug
  );
  if (!report) throw new NotFoundError();

  // Validar token
  if (!verifyToken(token, report.access_token)) throw new ForbiddenError();

  // Ahora sí, load todo el dominio DENTRO del tenant del reporte
  const candidates = await candidatesDb.listByReportId(ctx.req, report.tenant_id, reportId);
  // ...
}
```

Isolation: aunque el token sea de otro tenant, el reporte tiene su propio tenant_id y la data se carga con ese scope. Imposible leak cross-tenant.

---

## 14. Migración de data existente

Hoy todo existe sin `tenant_id`. Opciones:

### Opción simple: Single-tenant inicial
Todos los jobs/candidates/reports existentes → asignados al tenant `kuno-digital`.

```sql
-- Pseudo SQL (ejecutar desde script/console de Catalyst):
-- Asumiendo tenant "Kuno Digital" con clerk_org_id conocido tiene ROWID 1001

UPDATE Jobs SET tenant_id = '1001' WHERE tenant_id IS NULL OR tenant_id = '';
UPDATE Candidates SET tenant_id = '1001' WHERE tenant_id IS NULL OR tenant_id = '';
UPDATE Results SET tenant_id = '1001' WHERE tenant_id IS NULL OR tenant_id = '';
-- ... repetir para cada tabla con tenant_id
```

En la práctica, como ZCQL no tiene UPDATE masivo como SQL, iterar con script Node:

```javascript
// migration/assign-tenant-to-existing.js
const KUNO_TENANT_ID = '1001';
const tables = ['Jobs', 'Candidates', 'Results', 'Assessments', /* ... */];

for (const table of tables) {
  const rows = await zcql(`SELECT ROWID FROM ${table} WHERE tenant_id IS NULL OR tenant_id = ''`);
  for (const row of rows) {
    await datastore.table(table).updateRow({ ROWID: row.ROWID, tenant_id: KUNO_TENANT_ID });
  }
  console.log(`✓ ${table}: ${rows.length} rows updated`);
}
```

---

## 15. Testing de isolation

**Crítico:** sin tests de isolation, podés tener data leak sin notar.

### Test manual mínimo

1. Crear 2 tenants en Clerk: `test-tenant-a`, `test-tenant-b`.
2. Admin del tenant A crea un puesto "Job A1".
3. Admin del tenant B:
   - Login como tenant B.
   - GET `/api/admin/jobs` → debe devolver solo jobs de B. No debe aparecer "Job A1".
   - GET `/api/admin/jobs/<id-de-A1>` → 404.
   - POST a `/api/admin/jobs/<id-de-A1>/regenerate-technical` → 404.
4. Admin del tenant A:
   - No debe poder ver jobs de B.

### Test programático (futuro, cuando haya tests)

```typescript
describe('Tenant isolation', () => {
  it('User of tenant A cannot see jobs of tenant B', async () => {
    const jobA = await createJob(tokenA, { title: 'Job A' });
    const jobs = await getJobs(tokenB);
    expect(jobs).not.toContainEqual(expect.objectContaining({ id: jobA.id }));
  });

  it('User of tenant A gets 404 when requesting job of tenant B', async () => {
    const jobB = await createJob(tokenB, { title: 'Job B' });
    const res = await getJobRaw(tokenA, jobB.id);
    expect(res.status).toBe(404);
  });
});
```

---

## 16. Branding por tenant

Cada tenant puede tener su propio logo, colores, fonts en los reportes públicos.

Columna `Tenants.branding_config`:
```json
{
  "logo_url": "https://cdn.sharktalents.ai/branding/acme/logo.png",
  "primary_color": "#1a73e8",
  "accent_color": "#fbbc04",
  "font_family": "Montserrat"
}
```

Al generar reporte público ([ClientReport.tsx](../../shark/src/pages/public/ClientReport.tsx)), leer `tenant.branding_config` del response y aplicar estilos dinámicamente.

**Default:** si `branding_config` es null, usar los defaults actuales (verde lima Kuno).

---

## 17. Billing hooks (preparación futura)

Para cuando haya planes pagos, agregar:

- `TokenUsage` scope por tenant → total de tokens por mes → factura
- `Tenants.plan` → límites de features
- Endpoint `/admin/billing/usage` que el admin global de SharkTalents usa para generar invoices

No implementar ahora. Dejar la data capturada.

---

## 18. Checklist de cierre

- [ ] Tabla `Tenants` creada
- [ ] Columna `tenant_id` agregada a todas las tablas del dominio
- [ ] Middleware `requireTenant` implementado
- [ ] `ctx.tenantId` + `ctx.tenant` propagados
- [ ] Todos los módulos `db/` reciben `tenantId` como parámetro
- [ ] Todos los services reciben `tenantId` al crear/modificar
- [ ] Audit log incluye tenant_id
- [ ] Token usage tracked per tenant
- [ ] Rate limiting scopeado por tenant
- [ ] Handler excluye endpoints correctos (`/health`, `/public/*`, `/webhooks/*`)
- [ ] Webhook Clerk → crea Tenant en DB
- [ ] UI: `<OrganizationSwitcher>` en sidebar
- [ ] Migración: tenant "kuno-digital" creado y data existente asignada
- [ ] Tests de isolation manuales pasados
- [ ] Branding config soportado en reporte público (si se quiere en v1)
- [ ] Documentación en `docs/INTEGRATIONS/clerk.md` referencia el modelo tenant

---

## Siguiente paso

→ [14_CLERK_AUTH.md](14_CLERK_AUTH.md) — el partner de este doc: cómo Clerk provee las organizations.
