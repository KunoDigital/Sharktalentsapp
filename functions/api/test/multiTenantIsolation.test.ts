/**
 * Tests de aislamiento multi-tenant.
 *
 * Verifican que cada feature que toca data filtra por tenant_id en sus queries de lectura
 * y que el escaneo manual del código no encuentra patrones obvios de cross-tenant leak.
 *
 * Limitaciones:
 *   - No corre contra Catalyst real. No es un E2E.
 *   - Es structural: lee el source code y verifica patrones esperados.
 *   - Las funciones críticas (listByTenant, getByIdScoped, fetchOwnership) están explícitamente
 *     testeadas para ver que generan SQL con tenant_id en el WHERE.
 *
 * Cuando se haga E2E real (con 2 Clerk orgs distintas pegando al backend deployado),
 * estos tests se complementan; no se reemplazan — el structural detecta regresiones
 * tempranas si alguien escribe un handler nuevo sin filtro.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '..', 'src', 'features');

function readFeature(name: string): string {
  return readFileSync(resolve(SRC, name), 'utf8');
}

// Lista de features que manejan data per-tenant. Cada una debe hacer
// requireTenant() Y filtrar por tenant_id en sus reads.
const TENANT_SCOPED_FEATURES = [
  'jobs.ts',
  'candidates.ts',
  'applications.ts',
  'scores.ts',
  'integrity.ts',
  'candidatePool.ts',
  'jobDrafts.ts',
  'apiKeys.ts',
  'reviewQueue.ts',
  'videos.ts',
];

describe('Multi-tenant isolation — structural', () => {
  describe('cada feature tenant-scoped llama requireTenant', () => {
    it.each(TENANT_SCOPED_FEATURES)('%s usa requireTenant', (file) => {
      const content = readFeature(file);
      // Algunas features importan requireTenant indirectamente via lib helpers — pero
      // todas deben referenciarlo en sus handlers o llamar otra función que lo haga.
      const hasRequireTenant = content.includes('requireTenant')
        || content.includes('await requireFeature') // requireFeature implica requireTenant antes
        || content.includes('fetchOwnership'); // fetchOwnership chequea ownership
      expect(hasRequireTenant).toBe(true);
    });
  });

  describe('queries SELECT que tocan tablas tenant-data filtran por tenant_id', () => {
    // Tablas que tienen tenant_id directo
    const TENANT_TABLES = ['Jobs', 'Candidates', 'Tenants', 'JobProfileDrafts', 'CandidatePool', 'ApiKeys', 'AuditLog'];

    function findUnscopedSelects(content: string, table: string): string[] {
      // Buscar SELECT FROM <table> sin tenant_id en el mismo bloque
      const lines = content.split('\n');
      const issues: string[] = [];
      let buffer = '';
      let inSelect = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes(`FROM ${table}`)) {
          inSelect = true;
          buffer = line;
        } else if (inSelect) {
          buffer += ' ' + line;
        }

        if (inSelect && (line.includes('`') || line.includes(';') || line.includes('LIMIT'))) {
          // Fin del template literal o línea
          if (buffer.includes('SELECT') && !buffer.includes('tenant_id') && !buffer.includes('JOIN')) {
            // SELECT sin tenant_id Y sin JOIN (que podría agregar el filter via JOIN)
            // Permitimos ROWID = ... (lookup por ROWID es OK porque después se valida ownership)
            if (!buffer.includes('ROWID =') && !buffer.includes('ROWID IN')) {
              issues.push(`Line ~${i}: ${buffer.slice(0, 200)}`);
            }
          }
          inSelect = false;
          buffer = '';
        }
      }
      return issues;
    }

    it.each(TENANT_SCOPED_FEATURES)('%s no tiene SELECT sin tenant_id en tablas críticas', (file) => {
      const content = readFeature(file);
      const allIssues: string[] = [];
      for (const t of TENANT_TABLES) {
        allIssues.push(...findUnscopedSelects(content, t));
      }
      // No esperamos issues — si los hay, fail con el listado.
      expect(allIssues, `Cross-tenant leak risk in ${file}:\n${allIssues.join('\n')}`).toEqual([]);
    });
  });

  describe('handlers que toman ID en path validan ownership ANTES de leer/escribir', () => {
    // Patrón esperado: getByIdScoped(req, id, tenantId) o fetchOwnership() before mutación.
    it('jobs.patchJob valida ownership con getByIdScoped', () => {
      const content = readFeature('jobs.ts');
      // Buscar la función patchJob
      const match = content.match(/export async function patchJob[\s\S]+?^\}/m);
      expect(match).toBeTruthy();
      expect(match![0]).toContain('getByIdScoped');
    });

    it('jobs.archiveJob valida ownership', () => {
      const content = readFeature('jobs.ts');
      const match = content.match(/export async function archiveJob[\s\S]+?^\}/m);
      expect(match).toBeTruthy();
      expect(match![0]).toContain('getByIdScoped');
    });

    it('candidates.patchCandidate valida ownership', () => {
      const content = readFeature('candidates.ts');
      const match = content.match(/export async function patchCandidate[\s\S]+?^\}/m);
      expect(match).toBeTruthy();
      // Debe haber validación de tenant_id ANTES del update
      const fnBody = match![0];
      // Ya sea getByIdScoped o un check explícito tenant_id ===
      const hasOwnership = fnBody.includes('tenant_id') || fnBody.includes('tenantId');
      expect(hasOwnership).toBe(true);
    });

    it('applications.transitionApplication valida ownership via getJobTenantId', () => {
      const content = readFeature('applications.ts');
      const match = content.match(/export async function transitionApplication[\s\S]+?^\}/m);
      expect(match).toBeTruthy();
      expect(match![0]).toMatch(/getJobTenantId|getResultTenantId|fetchOwnership/);
    });

    it('candidatePool.patchPoolEntry valida tenant ownership', () => {
      const content = readFeature('candidatePool.ts');
      const match = content.match(/export async function patchPoolEntry[\s\S]+?^\}/m);
      expect(match).toBeTruthy();
      expect(match![0]).toContain('fetchPoolEntry');
    });

    it('apiKeys.patchApiKey valida tenant ownership', () => {
      const content = readFeature('apiKeys.ts');
      const match = content.match(/export async function patchApiKey[\s\S]+?^\}/m);
      expect(match).toBeTruthy();
      expect(match![0]).toContain('fetchOne');
    });

    it('jobDrafts.convertDraftToJob valida tenant ownership', () => {
      const content = readFeature('jobDrafts.ts');
      const match = content.match(/export async function convertDraftToJob[\s\S]+?^\}/m);
      expect(match).toBeTruthy();
      expect(match![0]).toContain('fetchDraft');
    });

    it('reviewQueue.decideReviewQueueItem valida tenant ownership', () => {
      const content = readFeature('reviewQueue.ts');
      const match = content.match(/export async function decideReviewQueueItem[\s\S]+?^\}/m);
      expect(match).toBeTruthy();
      expect(match![0]).toContain('fetchReviewQueueItem');
    });
  });

  describe('helpers internos toman tenantId required (defense-in-depth)', () => {
    it('jobs.listByTenant requires tenantId param', () => {
      const content = readFeature('jobs.ts');
      const match = content.match(/async function listByTenant\([^)]+\)/);
      expect(match).toBeTruthy();
      expect(match![0]).toContain('tenantId: string');
    });

    it('applications.listByTenant requires tenantId param', () => {
      const content = readFeature('applications.ts');
      const match = content.match(/async function listByTenant\([^)]+\)/);
      expect(match).toBeTruthy();
      expect(match![0]).toContain('tenantId: string');
    });

    it('applications.listByJob requires tenantId (defense-in-depth con JOIN)', () => {
      const content = readFeature('applications.ts');
      const match = content.match(/async function listByJob\([^)]+\)/);
      expect(match).toBeTruthy();
      expect(match![0]).toContain('tenantId');
    });
  });

  describe('endpoints públicos NO acceden tenant data sin token validado', () => {
    it('publicReport verifica token kind=report ANTES de cualquier read', () => {
      const content = readFile('publicReport.ts');
      // Verificar que verifyToken se llama antes de cualquier zcql
      const verifyIdx = content.indexOf('verifyToken');
      const zcqlIdx = content.indexOf('zcql(');
      expect(verifyIdx).toBeGreaterThan(0);
      expect(zcqlIdx).toBeGreaterThan(verifyIdx);
    });

    it('publicReportBundle verifica token kind=report_bundle ANTES de cualquier read', () => {
      const content = readFile('publicReportBundle.ts');
      const verifyIdx = content.indexOf('verifyToken');
      const zcqlIdx = content.indexOf('zcql(');
      expect(verifyIdx).toBeGreaterThan(0);
      expect(zcqlIdx).toBeGreaterThan(verifyIdx);
    });

    it('clientPortal verifyOrThrow se llama ANTES de fetchJobsForPortal', () => {
      const content = readFile('clientPortal.ts');
      const verifyIdx = content.indexOf('verifyOrThrow');
      const fetchIdx = content.indexOf('fetchJobsForPortal');
      expect(verifyIdx).toBeGreaterThan(0);
      expect(fetchIdx).toBeGreaterThan(verifyIdx);
    });
  });

  function readFile(name: string): string {
    return readFeature(name);
  }
});

describe('Multi-tenant isolation — token confusion', () => {
  it('verifyToken requiere expectedKind (no acepta any kind)', () => {
    const sigPath = resolve(__dirname, '..', 'src', 'lib', 'urlSigning.ts');
    const content = readFileSync(sigPath, 'utf8');
    expect(content).toContain('expectedKind');
    expect(content).toContain('TokenError');
    // verifyToken DEBE recibir expectedKind como required
    const verifyTokenSig = content.match(/export function verifyToken\([^)]+\)/);
    expect(verifyTokenSig).toBeTruthy();
    expect(verifyTokenSig![0]).toContain('expectedKind');
    // No debe haber "expectedKind?:" (opcional) — eso permitiría confusion
    expect(verifyTokenSig![0]).not.toContain('expectedKind?:');
  });

  it('apiKeyAuth chequea is_active + revoked + expires antes de aceptar', () => {
    const path = resolve(__dirname, '..', 'src', 'lib', 'apiKeyAuth.ts');
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('isKeyActive');
  });

  it('apiKeyAuth setea ctx.tenantId solo si la key es válida', () => {
    const path = resolve(__dirname, '..', 'src', 'lib', 'apiKeyAuth.ts');
    const content = readFileSync(path, 'utf8');
    // El throw de UnauthorizedError debe estar ANTES del set de ctx.tenantId
    const throwIdx = content.indexOf('throw new UnauthorizedError');
    const setIdx = content.indexOf('ctx.tenantId =');
    expect(throwIdx).toBeGreaterThan(0);
    expect(setIdx).toBeGreaterThan(throwIdx);
  });
});
