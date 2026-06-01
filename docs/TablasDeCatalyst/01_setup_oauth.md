# 01 — Setup OAuth Self-Client de Zoho

**Objetivo:** conseguir un `refresh_token` con scopes de Catalyst para autenticar tus requests al API.

**Tiempo estimado:** 10-15 minutos (primera vez).

**Necesitás:**
- Acceso a [api-console.zoho.com](https://api-console.zoho.com) con la misma cuenta de Zoho One donde está tu proyecto Catalyst
- Tu Catalyst Console abierto (para conseguir project_id + org_id)
- Una terminal con `curl`

---

## Paso 1 — Crear Self-Client

1. Abrir [api-console.zoho.com](https://api-console.zoho.com)
2. Click **Add Client** (botón arriba a la derecha)
3. Elegir **Self Client** (no Server-based, no Mobile, no Web)
4. **Client Name:** algo descriptivo, ej: `[NombreProyecto] Catalyst Schema`
5. **Description:** "Para crear tablas de Catalyst via API"
6. Click **CREATE**
7. Te aparecen 2 valores:
   - **Client ID** (algo tipo `1000.PBJFSFM913OR39HJXN8W5LH0CS5CBQ`)
   - **Client Secret** (algo tipo `b610d0c4acdfb958643764769996db3f148ba5f84e`)

8. **Copialos y guardalos seguro** — los vas a necesitar.

> ⚠️ Estos NO son secretos público-shareables. Tratalos como contraseñas. NO commitearlos al repo. Solo van en env vars del backend.

---

## Paso 2 — Generar Authorization Code

Dentro del mismo Self Client que acabás de crear:

1. Tab **Generate Code**
2. **Scope:** pegá esto exacto (sin espacios):
   ```
   ZohoCatalyst.tables.CREATE,ZohoCatalyst.tables.columns.CREATE
   ```
3. **Time Duration:** 10 minutes (es el max permitido, suficiente)
4. **Scope Description:** `Migrate schema` (cualquier descripción válida)
5. Click **CREATE**
6. **Te aparece un popup con el `code`** (string largo tipo `1000.abc123def...`)
7. **Copialo entero** — tenés 10 min antes que expire

> ⚠️ Si el code expira (>10 min), volvés al paso 1 → Generate Code → nuevo code.
> ⚠️ El code es **single-use**: una vez que lo intercambies por tokens, muere.

---

## Paso 3 — Convertir el code en refresh_token

En tu terminal, reemplazá los 3 placeholders con tus valores reales:

```bash
curl -X POST https://accounts.zoho.com/oauth/v2/token \
  -d "grant_type=authorization_code" \
  -d "client_id=PEGAR_TU_CLIENT_ID" \
  -d "client_secret=PEGAR_TU_CLIENT_SECRET" \
  -d "code=PEGAR_EL_CODE_DEL_PASO_2"
```

La response va a ser un JSON tipo:

```json
{
  "access_token": "1000.f36467ff6bf...",     // dura 1h, descartar
  "refresh_token": "1000.b242d4b87481...",   // 🔑 GUARDAR ESTE
  "scope": "ZohoCatalyst.tables.CREATE ZohoCatalyst.tables.columns.CREATE",
  "api_domain": "https://www.zohoapis.com",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**Lo importante: el `refresh_token`.**

- ✅ Es **durable** (nunca expira)
- ✅ Solo lo recibís **una vez** en esta llamada — si lo perdés, hay que repetir desde el paso 1
- ⚠️ Tratalo como password (NO commitear al repo, NO compartir, SOLO env vars)

---

## Paso 4 — Conseguir Project ID + Org ID de Catalyst

Necesitás estos 2 IDs para llamar al API de Catalyst.

### Project ID

1. Abrir Catalyst Console → tu proyecto
2. Mirar la URL del browser, algo tipo:
   ```
   https://console.catalyst.zoho.com/baas/883996440/project/28606000000676053/Development#/...
   ```
3. El número largo **después de `/project/`** es el **Project ID** (en este ejemplo: `28606000000676053`)

### Org ID

1. En el mismo Catalyst Console, **el número antes de `/project/`** es el **Org ID** (en el ejemplo: `883996440`)
2. O alternativamente: Settings → Organization → ID

---

## Paso 5 — Setear todas las env vars

Ahora tenés 5 valores. Te recomiendo setearlos como env vars locales (para el script):

```bash
# En tu shell (o en un .env LOCAL — NO commiteado)
export CATALYST_PROJECT_ID=28606000000676053
export CATALYST_ORG_ID=883996440
export CATALYST_OAUTH_CLIENT_ID=1000.PBJFSFM913OR39HJXN8W5LH0CS5CBQ
export CATALYST_OAUTH_CLIENT_SECRET=b610d0c4acdfb958643764769996db3f148ba5f84e
export CATALYST_OAUTH_REFRESH_TOKEN=1000.b242d4b87481ce17973d7e24a153311d.c932278e8efbcd71112c81a9c196f77c
```

---

## Paso 6 — Verificar que funciona

Antes de correr el script completo, hacé un test rápido:

```bash
# Refresca el access token
curl -sS -X POST https://accounts.zoho.com/oauth/v2/token \
  -d "grant_type=refresh_token" \
  -d "client_id=$CATALYST_OAUTH_CLIENT_ID" \
  -d "client_secret=$CATALYST_OAUTH_CLIENT_SECRET" \
  -d "refresh_token=$CATALYST_OAUTH_REFRESH_TOKEN"
```

Si te devuelve un `access_token` → todo OK, podés continuar.

Si te dice `invalid_client` o `invalid_grant`:
- Revisá que el client_id y secret estén bien copiados (sin espacios al final)
- Revisá que el refresh_token sea el correcto (no el access_token de 1h)

---

## Notas de seguridad

- **Cuando termines la migración**, te recomiendo **revocar el Self-Client** (api-console.zoho.com → tu Self-Client → Delete). Si lo necesitás de nuevo, generás otro. Esto evita que credenciales viejas queden activas.
- **Si vas a usar el refresh_token en producción** (no solo migración one-shot), guardalo en env vars del backend, NUNCA en código.
- **Scopes mínimos:** la guía usa solo `tables.CREATE` y `columns.CREATE`. Si querés también borrar tablas vía API, agregá `ZohoCatalyst.tables.DELETE` — pero **mejor no**, lo destructivo se hace manual.

---

## Siguiente paso

→ [02_endpoints_y_tipos.md](02_endpoints_y_tipos.md) — los 2 endpoints de Catalyst + mapping de tipos.
