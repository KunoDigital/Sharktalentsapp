# 08 — Fase 7: Frontend

**Objetivo:** centralizar config, mover URLs a env vars, agregar error boundaries, versioning visible, limpiar optimistic updates, refactor del cliente HTTP.

**Tiempo estimado:** 1 semana.
**Dependencias:** puede ejecutarse en paralelo a cualquier fase backend (Fase 4+). La API base del backend no debe tener breaking changes mientras esta fase está activa.
**Riesgo:** bajo-medio. Cambios visibles al usuario pero no de lógica crítica.

**Referencias teóricas:** [10_FRONTEND_PATTERNS.md](../aprendizajes/10_FRONTEND_PATTERNS.md).

---

## Deliverables

- [ ] `src/config.ts` con todas las env vars frontend
- [ ] `.env.development` + `.env.production` + `.env.example`
- [ ] Todas las URLs centralizadas (no `window.location.origin` ni `/app/index.html` hardcoded)
- [ ] Fetch wrapper mejorado en `src/lib/api.ts`
- [ ] `ErrorBoundary` en rutas principales
- [ ] Versioning visible en footer
- [ ] URL state para filtros en Pipeline y CompareView
- [ ] Optimistic updates con rollback consistente
- [ ] Cliente usa el `access_token` en URLs de reporte público
- [ ] `X-Trace-Id` generado por el frontend y enviado al backend

---

## 1. `src/config.ts` — centralización

### Problema actual

Hoy el `API_BASE` está en [services/api.ts:5-6](../../shark/src/services/api.ts#L5-L6):

```typescript
const isProd = window.location.hostname !== 'localhost';
const api = axios.create({ baseURL: isProd ? '/server/sharktalents/api' : '/api' });
```

Detecta ambiente por hostname. Funcional pero:
- Si se deploya a staging con otro dominio, `isProd` sería `true` pero no queremos mismo base.
- La path `/server/sharktalents/api` tiene hardcoded el nombre de la function (`sharktalents`). Al renombrar a `api` (Fase 1), habría que tocar aquí también.
- `/app/index.html#` está hardcoded en muchos lugares:
  - [JobCreate.tsx:491](../../shark/src/pages/admin/JobCreate.tsx#L491)
  - [JobDetail.tsx:396](../../shark/src/pages/admin/JobDetail.tsx#L396)
  - [ReportPreparation.tsx:109-110](../../shark/src/pages/admin/ReportPreparation.tsx#L109-L110)
  - [Reportes.tsx:42](../../shark/src/pages/admin/Reportes.tsx#L42)

### Solución — `src/config.ts`

```typescript
// shark/src/config.ts

const DEFAULTS = {
  API_BASE: '/server/api/api',
  APP_VERSION: 'dev',
  APP_BASE_URL: '',   // vacío = usar window.location.origin
  CLIENT_HOSTING_PATH: '/app/index.html',
};

function env(key: keyof typeof DEFAULTS): string {
  const viteKey = `VITE_${key}` as const;
  const value = (import.meta.env as Record<string, string>)[viteKey];
  return value !== undefined && value !== '' ? value : DEFAULTS[key];
}

export const API_BASE = env('API_BASE');
export const APP_VERSION = env('APP_VERSION');
export const APP_BASE_URL = env('APP_BASE_URL') || window.location.origin;
export const CLIENT_HOSTING_PATH = env('CLIENT_HOSTING_PATH');

// URL base para construir links públicos (reportes, tests)
// Ejemplo: buildPublicUrl('/report/acme/dev/abc') → 'https://sharktalents.ai/app/index.html#/report/acme/dev/abc'
export function buildPublicUrl(hashPath: string): string {
  const normalizedPath = hashPath.startsWith('#') ? hashPath : `#${hashPath}`;
  return `${APP_BASE_URL}${CLIENT_HOSTING_PATH}${normalizedPath}`;
}
```

### `shark/.env.development`

```
VITE_API_BASE=http://localhost:3002/api
VITE_APP_VERSION=dev
VITE_APP_BASE_URL=http://localhost:5173
VITE_CLIENT_HOSTING_PATH=
```

### `shark/.env.production`

```
VITE_API_BASE=/server/api/api
VITE_APP_VERSION=${VERSION}  # inyectado por el script de build
VITE_APP_BASE_URL=
VITE_CLIENT_HOSTING_PATH=/app/index.html
```

### `shark/.env.example`

Mismo template con valores dummy y comentarios.

### Uso

Reemplazar en cada archivo:

**Antes** ([ReportPreparation.tsx:109-110](../../shark/src/pages/admin/ReportPreparation.tsx#L109-L110)):
```tsx
const appBase = window.location.pathname.includes('/app') ? '/app/index.html' : '';
const publicUrl = `${window.location.origin}${appBase}#/report/${companySlug}/${jobSlug}/${reportId}`;
```

**Después:**
```tsx
import { buildPublicUrl } from '@/config';
const publicUrl = buildPublicUrl(`/report/${companySlug}/${jobSlug}/${reportId}?token=${accessToken}`);
```

Aplicar en los ~7 lugares con URLs hardcoded.

---

## 2. Fetch wrapper mejorado

### Problema actual

[services/api.ts:9-25](../../shark/src/services/api.ts#L9-L25) usa axios con interceptors. Funcional pero:
- No genera correlation IDs.
- Error handling está esparcido — cada caller hace su try/catch ad-hoc.
- No hay retry para fallos transitorios de red.
- El import masivo de funciones (todas en api.ts) mezcla dominios.

### Refactor — `src/lib/api.ts`

```typescript
// shark/src/lib/api.ts
import { API_BASE } from '@/config';

let authToken: string | null = null;

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: any) {
    super(message);
  }
}

function generateTraceId(): string {
  const bytes = new Uint8Array(8);
  (crypto || (window as any).msCrypto).getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function getStoredToken(): string | null {
  if (authToken !== null) return authToken;
  return localStorage.getItem('shark_token');
}

export function setAuthToken(token: string, username: string): void {
  authToken = token;
  localStorage.setItem('shark_token', token);
  localStorage.setItem('shark_user', username);
}

export function clearAuth(): void {
  authToken = null;
  localStorage.removeItem('shark_token');
  localStorage.removeItem('shark_user');
}

export function getAuthUser(): string | null {
  return localStorage.getItem('shark_user');
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  responseType?: 'json' | 'blob';
  skipAuth?: boolean;
  timeout?: number;
}

export async function apiFetch<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = opts.skipAuth ? null : getStoredToken();
  const headers: Record<string, string> = {
    'X-Trace-Id': generateTraceId(),
  };
  if (token) headers['X-Auth-Token'] = token;
  if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const body = opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)
    ? JSON.stringify(opts.body)
    : opts.body;

  const controller = new AbortController();
  const timeoutMs = opts.timeout || 30000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: opts.method || 'GET',
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.status === 401 && !opts.skipAuth) {
      clearAuth();
      window.location.hash = '#/admin/login';
      throw new ApiError(401, 'No autorizado');
    }

    if (!res.ok) {
      let errBody;
      try { errBody = await res.json(); } catch {}
      throw new ApiError(res.status, errBody?.error || `HTTP ${res.status}`, errBody);
    }

    if (opts.responseType === 'blob') {
      return (await res.blob()) as unknown as T;
    }

    return (await res.json()) as T;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new ApiError(0, 'Timeout');
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, err.message || 'Network error');
  }
}
```

### Módulos por recurso

Dividir [services/api.ts](../../shark/src/services/api.ts) actual (145 líneas, todas las funciones mezcladas) en módulos:

```
shark/src/services/
├── auth.ts           (login, logout, getAuthToken, setAuth)
├── jobs.ts           (getJobs, createJob, updateJob, archiveJob, ...)
├── assessments.ts    (getJobAssessments, getTechnicalQuestions, ...)
├── candidates.ts     (getCandidates, searchCandidates, getCandidateProfile)
├── results.ts        (getComparison, getPipeline, markReviewed, setPipelineStage, ...)
├── library.ts        (getLibrary, createLibraryItem, deleteLibraryItem)
├── reports.ts        (createClientReport, getClientReport, publishReport, ...)
└── publicTest.ts     (getTest, startTest, savePartialAnswers, submitTest)
```

Cada uno usa `apiFetch` de `lib/api.ts`.

---

## 3. Error boundaries

### `components/ErrorBoundary.tsx`

```tsx
import { Component, ReactNode } from 'react';
import { APP_VERSION } from '@/config';

interface Props { children: ReactNode }
interface State { hasError: boolean; error?: Error }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
    // Opcional: enviar al backend
    // apiFetch('/errors/report', { method: 'POST', body: { error: error.message, stack: error.stack, info } });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, maxWidth: 600, margin: '80px auto', textAlign: 'center' }}>
          <h1 style={{ fontSize: 24, color: 'var(--kuno-cream)' }}>Algo salió mal</h1>
          <p style={{ color: 'var(--kuno-text-muted)', marginTop: 12 }}>
            Ocurrió un error inesperado. Probá recargar la página.
          </p>
          <details style={{ marginTop: 24, textAlign: 'left' }}>
            <summary style={{ color: 'var(--kuno-text-muted)', cursor: 'pointer' }}>
              Detalles técnicos
            </summary>
            <pre style={{ fontSize: 11, color: 'var(--kuno-text-muted)', overflow: 'auto' }}>
              {this.state.error?.message}
              {'\n'}
              {this.state.error?.stack}
            </pre>
          </details>
          <div style={{ marginTop: 32 }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: 'var(--kuno-lime)',
                color: 'var(--kuno-dark)',
                fontWeight: 600,
                padding: '10px 24px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Recargar
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--kuno-text-muted)', marginTop: 40 }}>
            SharkTalents v{APP_VERSION}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
```

### Uso en `App.tsx`

```tsx
import ErrorBoundary from './components/ErrorBoundary';

export default function App() {
  return (
    <HashRouter>
      <ErrorBoundary>
        <Routes>
          {/* ... */}
        </Routes>
      </ErrorBoundary>
    </HashRouter>
  );
}
```

Idealmente, agregar `ErrorBoundary` local a rutas críticas (ej. en [JobPipeline.tsx](../../shark/src/pages/admin/JobPipeline.tsx)) para que un bug allí no rompa toda la app admin.

---

## 4. Versioning visible

### Footer global

Agregar en `AdminLayout.tsx`:

```tsx
import { APP_VERSION } from '@/config';

<div style={{
  position: 'absolute',
  bottom: 12,
  left: 16,
  right: 16,
  fontSize: 10,
  color: 'var(--kuno-text-muted)',
  opacity: 0.5,
  textAlign: 'center',
}}>
  v{APP_VERSION}
</div>
```

Y en `TestEntry.tsx` / `ClientReport.tsx` (footer ya existe — solo agregar `v{APP_VERSION}`).

### Inyección al build

Script `scripts/deploy-frontend.sh` debería inyectar la versión:

```bash
# Leer versión desde package.json
VERSION=$(node -p "require('./package.json').version")

# Sobrescribir .env.production temporalmente
export VITE_APP_VERSION=$VERSION

cd frontend && npm run build
```

O usar Vite define:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import pkg from './package.json';

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
  // ...
});
```

---

## 5. URL state para filtros

### Pipeline actual

[JobPipeline.tsx:54](../../shark/src/pages/admin/JobPipeline.tsx#L54) usa estado local para `activeTab` y `sortBy`. Si el admin refresca, pierde el filtro.

### Refactor con `useSearchParams`

```tsx
import { useSearchParams } from 'react-router-dom';

const [searchParams, setSearchParams] = useSearchParams();
const activeTab = searchParams.get('tab') || 'technical';
const sortBy = (searchParams.get('sort') || 'default') as SortKey;

const setActiveTab = (tab: string) => {
  setSearchParams(prev => {
    prev.set('tab', tab);
    return prev;
  });
};
```

Beneficios:
- Refresh preserva estado.
- Links compartibles entre admins ("mirá el pipeline con tab kudert: `#/admin/jobs/123/pipeline?tab=kudert`").
- Back/forward del browser funciona.

Aplicar en:
- Pipeline: `?tab=technical&sort=score`
- CompareView: `?candidates=1,2,3`
- CandidateList: `?search=juan`

---

## 6. Optimistic updates — mejor rollback

### Problema actual

[JobPipeline.tsx:68-88](../../shark/src/pages/admin/JobPipeline.tsx#L68-L88) hace optimistic update, y si falla, llama `refreshPipeline()` que re-fetch todo. OK, pero:
- Re-fetch de 500 candidatos es caro para revertir 1 cambio.
- Durante el re-fetch, la UI parpadea.

### Patrón más limpio

Guardar el estado previo y revertir localmente si falla:

```tsx
const handleMove = async (resultId: number, stage: string | null) => {
  const previousPipeline = pipeline;  // snapshot

  // Optimistic
  setPipeline(prev => {
    if (!prev) return prev;
    const updated = { ...prev };
    for (const type of Object.keys(updated)) {
      updated[type] = {
        ...updated[type],
        candidates: updated[type].candidates.map(c =>
          c.result_id === resultId ? { ...c, pipeline_stage: stage || null } : c
        ),
      };
    }
    return updated;
  });

  try {
    await setPipelineStage(resultId, stage);
  } catch (err) {
    setPipeline(previousPipeline);  // revert local sin re-fetch
    alert('No se pudo cambiar la etapa');
  }
};
```

---

## 7. Loading / error / empty states consistentes

### Patrón

Hoy cada componente maneja estados distinto — algunos con flag `loading`, otros con condicionales. Unificar:

```tsx
// components/DataState.tsx
import { ReactNode } from 'react';

interface Props<T> {
  loading: boolean;
  error?: string;
  data?: T;
  empty?: (data: T) => boolean;
  onRetry?: () => void;
  renderLoading?: () => ReactNode;
  renderError?: (err: string, onRetry?: () => void) => ReactNode;
  renderEmpty?: () => ReactNode;
  children: (data: T) => ReactNode;
}

export default function DataState<T>({
  loading, error, data, empty,
  onRetry, renderLoading, renderError, renderEmpty, children
}: Props<T>) {
  if (loading) return <>{renderLoading ? renderLoading() : <DefaultSkeleton />}</>;
  if (error) return <>{renderError ? renderError(error, onRetry) : <DefaultError err={error} onRetry={onRetry} />}</>;
  if (!data || (empty && empty(data))) return <>{renderEmpty ? renderEmpty() : <DefaultEmpty />}</>;
  return <>{children(data)}</>;
}

function DefaultSkeleton() {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--kuno-text-muted)' }}>
      Cargando...
    </div>
  );
}

function DefaultError({ err, onRetry }: { err: string; onRetry?: () => void }) {
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <p style={{ color: 'var(--kuno-danger)' }}>{err}</p>
      {onRetry && (
        <button onClick={onRetry} style={{ marginTop: 16 }}>Reintentar</button>
      )}
    </div>
  );
}

function DefaultEmpty() {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--kuno-text-muted)' }}>
      No hay datos para mostrar.
    </div>
  );
}
```

Uso:

```tsx
<DataState
  loading={loading}
  error={error}
  data={candidates}
  empty={c => c.length === 0}
  onRetry={refetch}
>
  {data => (
    <table>
      {data.map(c => <CandidateRow key={c.id} c={c} />)}
    </table>
  )}
</DataState>
```

Refactor incremental — aplicar a páginas nuevas primero, las existentes cuando se tocan.

---

## 8. Access token en URLs de reporte público

Del cambio en Fase 3: el reporte público requiere `?token=...`. Ajustar frontend.

### ReportPreparation.tsx — mostrar URL correcto

```tsx
// Al publicar, el backend devuelve el access_token
const result = await publishReport(report.report_id);
const publicUrl = buildPublicUrl(
  `/report/${report.company_slug}/${report.job_slug}/${report.report_id}?token=${result.access_token}`
);

// Mostrar el URL con el token copiable
```

### ClientReport.tsx — validar token al cargar

La ruta es `/report/:companySlug/:jobSlug/:reportId`. Extraer token de query:

```tsx
const [searchParams] = useSearchParams();
const token = searchParams.get('token');

useEffect(() => {
  if (!token) {
    setError('Falta token de acceso');
    return;
  }
  getPublicReport(companySlug, jobSlug, reportId, token, lang)
    .then(setData)
    .catch(() => setError('Reporte no encontrado'));
}, [companySlug, jobSlug, reportId, token, lang]);
```

Ajustar `services/publicReport.ts` para pasar `token` al backend.

---

## 9. Visibility-aware polling

Hoy el frontend **no hace polling** activo — todas las updates son manuales o al navegar. OK por ahora.

Si en el futuro se agrega polling (ej. pipeline que se actualiza cada N segundos cuando nuevos candidatos llegan), usar este patrón:

```tsx
function useVisibilityAwareInterval(callback: () => void, ms: number) {
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    const start = () => { if (!interval) interval = setInterval(callback, ms); };
    const stop = () => { if (interval) { clearInterval(interval); interval = null; } };

    if (!document.hidden) start();

    const handleVisibility = () => {
      if (document.hidden) stop();
      else { callback(); start(); }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      stop();
    };
  }, [callback, ms]);
}
```

**Por ahora, no se agrega polling — documentado por si aparece necesidad.**

---

## 10. Accesibilidad mínima

- `<button>` para acciones (no `<div onClick>`)
- `<a href>` para navegación (React Router `<Link>` genera `<a>`)
- `aria-label` en botones icon-only (ej. "X" de cerrar modal)
- `<label>` asociado a cada `<input>`
- Contraste mínimo AA: comprobar visualmente o con plugin de Chrome
- Navegación con teclado: Tab → Enter funciona en formularios
- Focus visible: outline en elementos interactivos

Auditar componentes principales:
- `Login.tsx` — sí tiene labels ✓
- `JobCreate.tsx` — tiene labels ✓, pero sliders de DISC podrían faltar aria-label
- `TestQuestions.tsx` — opciones son `<button>` ✓
- Modales (integrity, technical questions): agregar botón cerrar con `aria-label="Cerrar"`

No hace falta full WCAG AAA. 1 hora de cleanup con gran retorno.

---

## 11. Build con versión dinámica

Actualizar `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  plugins: [react()],
  base: '/app/',
  build: {
    outDir: 'build',
    assetsDir: 'static',
  },
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
});
```

Bumpeo de versión manual en `package.json` antes de cada deploy a prod. Semántico: major.minor.patch.

---

## 12. Checklist de cierre Fase 7

- [ ] `src/config.ts` creado con todas las env vars
- [ ] `.env.development`, `.env.production`, `.env.example` commiteados (el .example)
- [ ] 0 matches en `grep -rn "window.location.origin" shark/src/`
- [ ] 0 matches en `grep -rn "/app/index.html" shark/src/` (excepto en `config.ts`)
- [ ] 0 matches en `grep -rn "localhost" shark/src/` (excepto en comentarios)
- [ ] `src/lib/api.ts` reemplaza `src/services/api.ts`
- [ ] Services divididos en módulos por recurso
- [ ] `ErrorBoundary` en `App.tsx`
- [ ] Version visible en sidebar admin + footer reportes
- [ ] URL state: `?tab=`, `?sort=`, `?search=` en Pipeline, CompareView, CandidateList
- [ ] Optimistic updates con snapshot + revert local
- [ ] Access token en URL de reporte público
- [ ] `X-Trace-Id` auto-generado en `apiFetch`
- [ ] Smoke test: crear puesto → copiar link → abrir → funciona
- [ ] Smoke test: reporte publicado → URL con token correcto → carga OK
- [ ] Smoke test: reporte sin token → error UI bien manejado
- [ ] Deploy a dev exitoso

---

## Siguiente paso

→ [09_FASE8_CICD_DEPLOY.md](09_FASE8_CICD_DEPLOY.md) — git workflow, scripts, orden de deploy, rollback.
