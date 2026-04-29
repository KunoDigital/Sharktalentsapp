# 10 — Patrones de Frontend

El frontend es la cara visible de tu app. Si funciona mal, el usuario lo nota inmediatamente. Estos patrones aplican a cualquier SPA (React/Vue/Svelte) que consume un backend serverless.

---

## API_BASE centralizado

El anti-pattern más común: hardcodear la URL del backend en cada archivo.

### ❌ Mal — 3 archivos con la misma constante

```ts
// App.tsx
const API_BASE = '/server/api_function'

// SlaPanel.tsx
const API_BASE = '/server/api_function'

// PanelContainer.tsx
const API_BASE = '/server/api_function'
```

Cuando toca cambiar (ej. servir desde otro dominio), toca encontrar y cambiar en todos lados. Inevitablemente alguien se olvida de uno.

### ✅ Bien — un archivo de config

```ts
// client/src/config.ts
export const API_BASE = import.meta.env.VITE_API_BASE || '/server/api_function';
export const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'dev';
export const POLLING_INTERVAL_MS = Number(import.meta.env.VITE_POLLING_MS) || 90000;
```

Todos los demás archivos importan:

```ts
import { API_BASE } from '@/config';

const res = await fetch(`${API_BASE}/orders`);
```

**Ventajas:**
- Cambiar en un solo lugar
- Configurable via env vars al build time
- Permite servir desde dominio distinto si algún día hace falta
- Testeable (mockear el config en tests)

---

## Fetch wrapper con manejo de errores

Repetir try/catch + error handling en cada fetch es tedioso y fácil de equivocar. Wrapper común:

```ts
// client/src/api/client.ts
import { API_BASE } from '@/config';

interface FetchOptions extends RequestInit {
    authRequired?: boolean;
}

export class ApiError extends Error {
    constructor(public status: number, message: string, public body?: any) {
        super(message);
    }
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
    const auth = localStorage.getItem('auth');
    const headers = new Headers(options.headers);

    if (options.authRequired !== false && auth) {
        headers.set('Authorization', auth);
    }
    if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
        headers.set('Content-Type', 'application/json');
    }

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

    if (res.status === 401) {
        // Auth expirado, forzar logout
        localStorage.removeItem('auth');
        window.location.href = '/login';
        throw new ApiError(401, 'Unauthorized');
    }

    if (!res.ok) {
        let body;
        try { body = await res.json(); } catch {}
        throw new ApiError(res.status, body?.error || `HTTP ${res.status}`, body);
    }

    return res.json() as Promise<T>;
}
```

Uso:

```ts
try {
    const orders = await apiFetch<Order[]>('/orders');
} catch (err) {
    if (err instanceof ApiError && err.status === 403) {
        showError('No tenés permisos');
    } else {
        showError('Error cargando órdenes');
    }
}
```

---

## Polling inteligente

### Regla fundamental

**La cadencia de polling debe ser tan lenta como el UX tolere.**

- Dashboard operativo: 60-90 seg
- Datos semi-en-vivo: 30 seg
- Notificaciones críticas: mejor webhooks/SSE, no polling

### Pausar cuando tab no está visible

Gran ahorro: si el usuario no mira la pantalla, no necesitás pollear.

```tsx
function useVisibilityAwareInterval(callback: () => void, intervalMs: number) {
    useEffect(() => {
        let interval: NodeJS.Timeout | null = null;

        const start = () => {
            if (interval) return;
            interval = setInterval(callback, intervalMs);
        };
        const stop = () => {
            if (interval) clearInterval(interval);
            interval = null;
        };

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
    }, [callback, intervalMs]);
}

// Uso
function DashboardPage() {
    const fetchData = useCallback(async () => {
        const data = await apiFetch('/metrics');
        setMetrics(data);
    }, []);

    useVisibilityAwareInterval(fetchData, POLLING_INTERVAL_MS);
    // ...
}
```

Si el usuario deja la tab abierta en background 2 horas, no hacés 80 requests a la DB.

### Exponential backoff en errores

Si el backend está caído, reducir la frecuencia progresivamente:

```tsx
function useResilientPolling(callback: () => Promise<void>, baseIntervalMs: number) {
    const [failures, setFailures] = useState(0);

    useEffect(() => {
        const delay = Math.min(baseIntervalMs * Math.pow(2, failures), 10 * 60_000);
        const interval = setInterval(async () => {
            try {
                await callback();
                setFailures(0);  // reset si funciona
            } catch (err) {
                setFailures(f => f + 1);
            }
        }, delay);
        return () => clearInterval(interval);
    }, [callback, baseIntervalMs, failures]);
}
```

---

## RBAC en frontend (con backend como fuente de verdad)

### Ocultar UI que el user no puede usar

Mejora UX, pero **nunca como único control** — el backend DEBE validar.

```tsx
{userRole === 'admin' && (
    <button onClick={deleteOrder}>Eliminar</button>
)}
```

### Anti-pattern: filtrar data en frontend

```tsx
// ❌ Mal — el backend manda TODA la data, el frontend filtra
const allOrders = await fetch('/orders');
const visibleOrders = allOrders.filter(o => user.role === 'admin' || !o.is_sensitive);
```

Problema: la data sensible viaja al browser. Cualquiera con DevTools la ve.

```tsx
// ✅ Bien — el backend ya filtra según rol
const orders = await fetch('/orders');  // el backend sabe el rol del user (via auth) y solo manda lo permitido
```

### Useful pattern: claims del user visible

```tsx
interface UserClaims {
    id: string;
    username: string;
    role: 'admin' | 'cumplimiento' | 'supervisor';
    permissions: string[];  // ['orders.delete', 'users.create', ...]
}

// Context provider
const UserContext = React.createContext<UserClaims | null>(null);

// Hook util
function useCan(permission: string): boolean {
    const user = useContext(UserContext);
    return user?.permissions.includes(permission) || false;
}

// Uso declarativo en componentes
function OrderRow({ order }) {
    const canDelete = useCan('orders.delete');
    return (
        <tr>
            <td>{order.id}</td>
            {canDelete && <td><button onClick={() => del(order.id)}>X</button></td>}
        </tr>
    );
}
```

Backend responde con `permissions` derivadas del rol en `/me`. Frontend simplemente respeta.

---

## Estados de loading / error / empty / success

Todo componente que fetchea datos debe manejar **4 estados**:

```tsx
function OrdersList() {
    const [state, setState] = useState<{
        status: 'loading' | 'error' | 'empty' | 'success';
        data?: Order[];
        error?: string;
    }>({ status: 'loading' });

    useEffect(() => {
        apiFetch<Order[]>('/orders')
            .then(data => setState({
                status: data.length === 0 ? 'empty' : 'success',
                data
            }))
            .catch(err => setState({ status: 'error', error: err.message }));
    }, []);

    if (state.status === 'loading') return <Skeleton />;
    if (state.status === 'error') return <ErrorState error={state.error} onRetry={() => /* refetch */} />;
    if (state.status === 'empty') return <EmptyState message="No hay órdenes" />;
    return <OrdersTable orders={state.data!} />;
}
```

### Skeleton > Spinner

En vez de un spinner genérico, hacé un skeleton que imite la estructura final. Mejor percepción de performance.

```tsx
function Skeleton() {
    return (
        <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-gray-200 animate-pulse rounded" />
            ))}
        </div>
    );
}
```

---

## Optimistic UI updates

Para acciones que son "casi siempre exitosas", actualizá la UI inmediatamente y revertí si falla:

```tsx
async function toggleArchive(order: Order) {
    // Optimistic update
    setOrders(prev => prev.map(o =>
        o.id === order.id ? { ...o, archived: !o.archived } : o
    ));

    try {
        await apiFetch(`/orders/${order.id}/archive`, { method: 'POST' });
    } catch (err) {
        // Revertir
        setOrders(prev => prev.map(o =>
            o.id === order.id ? { ...o, archived: order.archived } : o
        ));
        showError('No se pudo archivar');
    }
}
```

UX se siente 100× más responsivo. Riesgo: si el rollback lógico es complejo, mejor esperar confirmación del backend.

---

## Confirmación en acciones peligrosas

Nunca permitas deleciones sin doble confirmación:

```tsx
function DeleteButton({ order, onDeleted }) {
    const [confirming, setConfirming] = useState(false);

    const handleDelete = async () => {
        if (!confirming) {
            setConfirming(true);
            setTimeout(() => setConfirming(false), 3000);  // resetear después de 3s
            return;
        }
        await apiFetch(`/orders/${order.id}`, { method: 'DELETE' });
        onDeleted();
    };

    return (
        <button
            onClick={handleDelete}
            className={confirming ? 'bg-red-500' : 'bg-gray-200'}
        >
            {confirming ? '¿Confirmar?' : 'Eliminar'}
        </button>
    );
}
```

Mejor que modal: los modales interrumpen flow. Este patrón "double-click to confirm" es menos molesto.

Para deleciones masivas o acciones destructivas serias, sí usar modal con texto explícito:

```
Escribí DELETE para confirmar: [_______]
```

---

## Versioning del frontend visible

Mostrar la versión en algún lado de la UI (footer, settings):

```tsx
function AppFooter() {
    return (
        <footer className="text-xs text-gray-500">
            v{APP_VERSION} · {new Date().toLocaleDateString()}
        </footer>
    );
}
```

Cuando un user reporta bug, pedirle la versión. Si dice "2.4.4" y vos sabés que el bug fue fixeado en 2.5.1, sabés que su browser tiene cache viejo o el deploy no se completó.

---

## Notification permission request — con control

Anti-pattern: pedir permiso de notifications al cargar la app. El usuario sin contexto dice "no" y perdés la oportunidad para siempre.

```tsx
// ❌ Mal
useEffect(() => {
    Notification.requestPermission();  // al cargar la app
}, []);

// ✅ Bien — pedir cuando el user hace una acción que se beneficia
function EnableNotificationsButton() {
    const [permission, setPermission] = useState(Notification.permission);

    const handleEnable = async () => {
        const result = await Notification.requestPermission();
        setPermission(result);
    };

    if (permission === 'granted') return <span>✓ Notificaciones activas</span>;
    if (permission === 'denied') return <span>Notificaciones bloqueadas (habilitá en config del browser)</span>;

    return (
        <button onClick={handleEnable}>
            Activar notificaciones
        </button>
    );
}
```

---

## Sonido y animaciones: con respect to user preferences

```tsx
// Usar prefers-reduced-motion
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!prefersReducedMotion) {
    // animar
}

// Para sonidos, pedir opt-in
const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('sound_enabled') === 'true';
});
```

---

## Cache de fetch con SWR / React Query

Para apps con muchas fetches, considerá librerías como SWR o React Query:

```tsx
import useSWR from 'swr';

function OrdersList() {
    const { data, error, isLoading, mutate } = useSWR('/orders', apiFetch, {
        refreshInterval: 90_000,
        revalidateOnFocus: true,
        revalidateOnReconnect: true
    });

    if (isLoading) return <Skeleton />;
    if (error) return <ErrorState error={error} />;
    return <OrdersTable orders={data} />;
}
```

**Ventajas:**
- Deduplicación automática (si 3 componentes fetchean `/orders` al mismo tiempo, se hace 1 sola request)
- Cache con invalidación (otro component hace POST, invalida cache, refetch)
- Optimistic updates con rollback
- Revalidate on focus (user vuelve a la tab → data fresh)

Para apps grandes esto te ahorra mucho boilerplate.

---

## URL state vs React state

Preservá el estado en la URL cuando es compartible/recuperable:

```tsx
// Filtros en URL: /orders?status=pending&page=2
const [searchParams, setSearchParams] = useSearchParams();
const status = searchParams.get('status');
const page = parseInt(searchParams.get('page') || '1', 10);

const handleStatusChange = (newStatus) => {
    setSearchParams({ status: newStatus, page: '1' });
};
```

**Ventaja:** el user puede compartir la URL, F5 preserva el state, back/forward funciona.

---

## Error boundaries

Un error en un componente no debe romper toda la app:

```tsx
class ErrorBoundary extends React.Component<{}, { hasError: boolean; error?: Error }> {
    state = { hasError: false };

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('[ErrorBoundary]', error, info);
        // Opcional: enviar al backend para monitoring
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="p-8">
                    <h1>Algo salió mal</h1>
                    <button onClick={() => window.location.reload()}>Recargar</button>
                </div>
            );
        }
        return this.props.children;
    }
}

// Envolvé tus routes principales
<ErrorBoundary>
    <OrdersList />
</ErrorBoundary>
```

---

## Accesibilidad mínima

- `<button>` para acciones, `<a>` para navegación
- `aria-label` en iconos sin texto
- Contraste suficiente (WCAG AA mínimo)
- Navegación con teclado funciona (Tab, Enter, Escape)
- Focus visible en elementos interactivos
- `<label>` asociado a `<input>`

No hace falta ir full WCAG AAA pero el mínimo es 1h de trabajo con gran retorno.

---

## Local development con backend remoto

Si el frontend en dev apunta a backend remoto (común con Catalyst Cloud Scale), configurar proxy en Vite:

```ts
// vite.config.ts
export default {
    server: {
        proxy: {
            '/server': {
                target: 'https://myapp.development.catalystserverless.com',
                changeOrigin: true,
                secure: true
            }
        }
    }
};
```

Así las llamadas relativas `/server/api_function/*` funcionan en `npm run dev` sin CORS.

---

## Build time env vars

Vite soporta `.env.*` files:

```
# client/.env.development
VITE_API_BASE=https://myapp.development.catalystserverless.com/server/api_function
VITE_APP_VERSION=dev

# client/.env.production
VITE_API_BASE=/server/api_function
VITE_APP_VERSION=$npm_package_version
```

Las vars con prefijo `VITE_` se inyectan al bundle. Otras no (evita leak accidental).

**⚠️ Importante:** `VITE_*` vars son **visibles en el JS bundle final**. NUNCA pongas secrets ahí. Son configuración pública.

---

## Checklist de frontend

- [ ] `API_BASE` centralizado en `config.ts`
- [ ] Fetch wrapper con manejo de 401, 403, errores de red
- [ ] Polling inteligente (visibility aware, backoff en errors)
- [ ] Filtrado de data en backend, no en frontend
- [ ] UI gated por rol pero backend valida también
- [ ] 4 estados: loading / error / empty / success
- [ ] Skeletons en lugar de spinners
- [ ] Optimistic updates con rollback
- [ ] Confirmación en acciones destructivas
- [ ] Versión visible en UI
- [ ] Error boundaries en rutas principales
- [ ] URL state para filtros/paginación
- [ ] Proxy configurado para dev local
- [ ] Ningún secret en `VITE_*` vars
- [ ] Notifications / sounds opt-in, no al cargar
