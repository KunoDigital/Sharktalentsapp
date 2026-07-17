# Exchange-token pattern — Marketing funnel (Opción B)

**Status:** code-complete (2026-06-15)
**Endpoint:** `POST /api/marketing/exchange-token`
**Compat:** Opción A (`test_start_url` directo en `eval-request`) sigue funcionando — esta es la migración recomendada, no un breaking change.

## Por qué existe

Hasta hoy, `POST /api/marketing/eval-request` devolvía `test_start_url` con el JWT del test embebido. La página post-submit pintaba ese link como botón "Comenzar test". Funciona, pero el JWT (7 días de TTL) queda en:

- el HTML que el navegador puede cachear
- el referer si el usuario clica un link externo desde esa página
- el historial del navegador si el usuario refresca o navega
- logs de analítica (Hotjar, GA) si no se enmascara con `data-hj-suppress`

La Opción B reemplaza eso con un **session_token** corto (5 min, multi-use) que el frontend cambia por el JWT real al momento del click — vía POST JSON, no via URL — así el JWT solo vive en memoria/sessionStorage del navegador del usuario.

## Cambios en `eval-request`

El response del endpoint existente ahora trae dos campos nuevos:

```json
{
  "request_id": "res_abc123",
  "message": "Evaluación enviada al colaborador",
  "estimated_time_minutes": 20,
  "test_expires_at": "2026-06-22T19:00:00.000Z",
  "test_start_url": "https://app.sharktalents.ai/app/index.html#/test/eyJ...",
  "session_token": "eyJraW5kIjoiZXhjaGFuZ2UiLCJyZWYi...",
  "session_expires_in_seconds": 300
}
```

- `test_start_url` — Opción A. Sigue ahí por compat. Eventualmente lo eliminamos cuando todos los clientes de la API hayan migrado.
- `session_token` — Opción B. Token corto, kind=`exchange`, TTL 5 min, multi-use.
- `session_expires_in_seconds` — siempre `300`, para que el frontend pueda mostrar countdown o decidir cuándo invalidar la sesión local.

## Cómo usarlo desde el frontend de sharktalents.ai

### 1. Recibir y guardar el session_token

```js
const res = await fetch('https://app.sharktalents.ai/api/marketing/eval-request', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Marketing-Site-Key': MARKETING_SITE_KEY,
  },
  body: JSON.stringify({
    captcha_token: turnstileToken,
    lead_email: 'cliente@empresa.com',
    member_to_evaluate: {
      full_name: 'Juan Pérez',
      email: 'juan@empresa.com',
      consent_obtained: true,
    },
  }),
});

const data = await res.json();
// Guardamos en sessionStorage — NO en localStorage (la sesión muere al cerrar la pestaña)
sessionStorage.setItem('st_session_token', data.session_token);
sessionStorage.setItem('st_session_expires_at', String(Date.now() + data.session_expires_in_seconds * 1000));

// Renderizamos el botón sin URL real. El JWT del test NO está en el HTML.
renderStartButton({ enabled: true });
```

### 2. Al click del botón, hacer el exchange

```js
async function startTest() {
  const sessionToken = sessionStorage.getItem('st_session_token');
  if (!sessionToken) {
    showError('Sesión perdida. Recarga la página y vuelve a enviar el formulario.');
    return;
  }

  const res = await fetch('https://app.sharktalents.ai/api/marketing/exchange-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Marketing-Site-Key': MARKETING_SITE_KEY,
    },
    body: JSON.stringify({ session_token: sessionToken }),
  });

  if (res.status === 410) {
    showError('Tu sesión expiró. Por favor vuelve a llenar el formulario.');
    sessionStorage.removeItem('st_session_token');
    return;
  }
  if (!res.ok) {
    showError('No pudimos abrir el test. Intenta de nuevo.');
    return;
  }

  const { test_start_url } = await res.json();

  // Redirect programático — el JWT NO pasa por history.pushState ni location.assign con URL visible.
  // window.location.replace evita que el JWT quede en el botón "back" del navegador.
  window.location.replace(test_start_url);
}
```

### 3. Mitigaciones obligatorias en la página post-submit

Estas SIGUEN aplicando incluso con Opción B (defensa en profundidad — el session_token también es sensible aunque sea de TTL corto):

| Mitigación | Dónde | Por qué |
|---|---|---|
| `Cache-Control: no-store, no-cache, must-revalidate` | Header HTTP de la página post-submit | Evita que el HTML quede en cache del navegador o de proxies intermedios |
| `<meta name="robots" content="noindex, nofollow">` | `<head>` | Evita que Google indexe la página y, peor, archive la versión con el token visible |
| `data-hj-suppress` | En el wrapper del botón "Comenzar test" | Hotjar/FullStory/LogRocket no graban el contenido del botón en session replay |
| `Referrer-Policy: no-referrer` | Header HTTP o `<meta>` | Si el usuario clica un link externo, no se filtra la URL post-submit |
| Limpiar `sessionStorage` al `beforeunload` | JS | Si el usuario navega fuera de la página, el session_token se borra |

```html
<!-- Ejemplo del header de la página post-submit -->
<!DOCTYPE html>
<html>
<head>
  <meta name="robots" content="noindex, nofollow">
  <meta name="referrer" content="no-referrer">
  <!-- En el Worker/Server: Cache-Control: no-store, Referrer-Policy: no-referrer -->
</head>
<body>
  <div data-hj-suppress>
    <button onclick="startTest()">Comenzar test</button>
  </div>
  <script>
    window.addEventListener('beforeunload', () => {
      sessionStorage.removeItem('st_session_token');
      sessionStorage.removeItem('st_session_expires_at');
    });
  </script>
</body>
</html>
```

## Cómo migrar de Opción A a Opción B sin downtime

1. **Hoy (post-deploy):** backend devuelve ambos — `test_start_url` y `session_token`. Frontend sigue usando `test_start_url`. Nada cambia para el usuario.
2. **Siguiente release del frontend:** Cristian cambia el frontend para usar `session_token` + `/exchange-token`. Hace pruebas en sharktalents.ai.
3. **Validación:** monitorear `[MARKETING] exchange-token success` en logs del backend. Si el volumen sube y los errores 401/410 son bajos (<2%), la migración va bien.
4. **Cleanup (futuro, opcional):** una vez que ningún cliente usa `test_start_url`, podemos quitarlo del response — pero no es urgente; el costo de tenerlo es solo unos bytes extra.

## Casos de error y cómo manejarlos en el frontend

| Status | code | Significado | Acción |
|---|---|---|---|
| 200 | — | OK | Redirect a `test_start_url` |
| 400 | `validation_error` | `session_token` ausente en el body | Bug del frontend — verificar que se lee bien de sessionStorage |
| 401 | `invalid_session_token` | Firma mala, kind incorrecto, payload corrupto | Pedir al usuario que vuelva a enviar el formulario |
| 410 | `session_expired` | TTL de 5 min vencido | Mostrar "Tu sesión expiró" + botón para volver a llenar formulario |
| 403 | `validation_error` (site-key) | Falta o no coincide `X-Marketing-Site-Key` | Bug del frontend — verificar el bundle |

## Seguridad: por qué el session_token es seguro aunque vaya por JSON

- Firmado con HMAC-SHA256 usando `URL_SIGNING_SECRET` del backend. Si un atacante intercepta el response (TLS roto), igual no puede generar otros tokens.
- TTL 5 minutos — la ventana de abuso es estrecha.
- `kind='exchange'` distinto de `kind='test'` — un atacante que robe el session_token NO puede usarlo como JWT del test directamente; tiene que pasar por el backend (que solo lo cambia por un test_url).
- Multi-use intencional — permite refresh y múltiples pestañas, pero el atacante no gana nada con eso porque el JWT del test se firma de nuevo en cada exchange y siempre apunta al mismo `result_id`.
- Lo que SÍ sigue siendo sensible: `result_id`. No lo expongas en el HTML público.

## Referencias en código

- Handler: `functions/api/src/features/marketing.ts` → `exchangeMarketingToken`
- Función pura testeable: `functions/api/src/features/marketing.ts` → `_verifyExchangeAndBuildTestUrl`
- Ruta: `functions/api/src/router.ts` (buscar `exchange-token`)
- Tests: `functions/api/test/marketingExchangeToken.test.ts`
- Token kind agregado: `functions/api/src/lib/urlSigning.ts` (TokenClaims kind union)
