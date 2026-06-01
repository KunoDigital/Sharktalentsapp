# Custom domain setup — sharktalents.ai

Tutorial para conectar el dominio `sharktalents.ai` al deploy de Catalyst.
Cris ejecuta esto cuando estás listo/a para salir de la URL `*.development.catalystserverless.com`.

**Tiempo estimado:** 30-90 min (depende de DNS propagation, que puede tardar de minutos a horas)

**Pre-requisitos:**
- Dominio `sharktalents.ai` ya comprado y administrado por vos
- Acceso al panel DNS del registrar (donde compraste el dominio)
- Acceso a Catalyst Console como admin del proyecto

---

## Paso 1 — Decidir el subdominio (5 min)

¿Querés usar `sharktalents.ai` directo (apex) o un subdominio?

| Opción | URL final | Pros | Contras |
|---|---|---|---|
| **Apex (root)** | `https://sharktalents.ai/app/` | Más limpio, marca | Algunos DNS providers no permiten ALIAS/ANAME al apex |
| **www subdomain** | `https://www.sharktalents.ai/app/` | Estándar, fácil DNS | URL más larga |
| **app subdomain** | `https://app.sharktalents.ai/` | Limpio, separa marketing del producto | Necesitás landing en `sharktalents.ai` también |

**Mi recomendación:** **`app.sharktalents.ai`** si vas a tener la landing de marketing en el apex. Sino usá apex directo.

Asumiré `app.sharktalents.ai` para el resto del tutorial. Ajustá si elegís otro.

---

## Paso 2 — Catalyst Console: agregar custom domain (5 min)

1. **Catalyst Console** → tu proyecto SharkTalentsApp
2. Sidebar izquierdo: **Cloud Scale → Web Client Hosting**
3. Pestaña **Settings** o **Domain**
4. Click **Add Custom Domain**
5. Ingresar: `app.sharktalents.ai`
6. Catalyst te muestra **un valor CNAME** que tenés que agregar en tu DNS — algo como:
   ```
   app.sharktalents.ai  CNAME  sharktalentsapp-883996440.development.catalystserverless.com
   ```
7. **Copiá el valor del CNAME** (lo necesitás para el paso 3)

---

## Paso 3 — Configurar DNS en tu registrar (10 min)

Andá al panel de tu registrar (Namecheap, GoDaddy, Cloudflare, Google Domains, etc.). Buscá la sección de **DNS records** o **Manage DNS**.

### Si elegiste un subdominio (app.sharktalents.ai)

Agregar un registro:
- **Type:** `CNAME`
- **Host/Name:** `app`
- **Value/Target:** el valor que te dio Catalyst en paso 2 (ej: `sharktalentsapp-883996440.development.catalystserverless.com`)
- **TTL:** `Automatic` o `300` (5 minutos)

### Si elegiste apex (sharktalents.ai sin subdominio)

Catalyst pide CNAME pero el apex de un dominio NO puede tener CNAME (limitación DNS). Usar:
- **ALIAS** o **ANAME** record si tu registrar lo soporta (Cloudflare, DNSimple)
- O **A record** apuntando a la IP que te dé Catalyst (preguntar en soporte si no sale automático)

**Si tu registrar no soporta ALIAS:** cambiate a Cloudflare (gratis), es lo más limpio.

---

## Paso 4 — Esperar propagación + verificar (15-60 min)

DNS propagation puede tardar 5-30 minutos en general, hasta 24h en casos raros.

**Verificar manualmente:**
```bash
dig app.sharktalents.ai +short
# Debería resolver al CNAME de Catalyst
```

O usar:
- https://www.whatsmydns.net/ → ingresar `app.sharktalents.ai` → ver propagación global

**En Catalyst Console:**
- Vuelve a **Web Client Hosting → Custom Domain**
- Debería decir **Verified ✓** después de la propagación
- Si dice **Pending**, esperá 10 min más y refrescá

---

## Paso 5 — SSL Certificate (automático, 5 min)

Una vez que el dominio está verified, Catalyst genera el SSL cert automáticamente (Let's Encrypt).

1. Refrescá la pantalla de Custom Domain
2. Status debería pasar a **SSL Active ✓**
3. Probar: abrir `https://app.sharktalents.ai/app/` en browser
4. Verificar candado verde + cert válido

---

## Paso 6 — Actualizar env vars + frontend (10 min)

### En Catalyst Console → Functions → api → Environment Variables:

Cambiá estas vars al nuevo dominio:

| Key | Value (antes) | Value (nuevo) |
|---|---|---|
| `APP_BASE_URL` | `https://sharktalentsapp-883996440.development.catalystserverless.com` | `https://app.sharktalents.ai` |
| `ALLOWED_ORIGINS` | `http://localhost:3000,https://sharktalents.ai` | `http://localhost:3000,https://app.sharktalents.ai,https://sharktalents.ai` |

### En tu repo local:

Actualizar `shark/.env.production`:

```diff
- VITE_APP_BASE_URL=https://sharktalentsapp-883996440.development.catalystserverless.com
+ VITE_APP_BASE_URL=https://app.sharktalents.ai
```

Re-deploy del frontend:
```bash
./scripts/deploy-frontend.sh
# Subí el ZIP nuevo a Catalyst Web Client Hosting
```

---

## Paso 7 — Configurar Clerk (5 min)

Clerk necesita saber del nuevo dominio para que los redirects post-login funcionen.

1. Ir a [Clerk Dashboard](https://dashboard.clerk.com) → tu app
2. Sección **Domains**
3. Add domain: `app.sharktalents.ai`
4. En **Paths** (sección de configuración de tu app en Clerk), configurar:
   - **After sign in:** `https://app.sharktalents.ai/app/`
   - **After sign up:** `https://app.sharktalents.ai/app/`
   - **Allowed origins:** `https://app.sharktalents.ai`

---

## Paso 8 — Smoke test (5 min)

```bash
# Health check del backend
curl -s https://app.sharktalents.ai/server/api/health | python3 -m json.tool

# Frontend
open https://app.sharktalents.ai/app/
```

Esperado:
- Health: `"status": "ok"`
- Frontend: carga login Clerk + podés entrar normal

---

## Si algo falla

### "DNS_PROBE_FINISHED_NXDOMAIN"
DNS no propagó todavía. Esperar 10-30 min más. Verificar con `dig`.

### "Your connection is not private" (cert SSL)
Catalyst aún no generó el cert. Esperar 5 min después de la verificación del dominio.

### Login redirige a la URL vieja de Catalyst development
Clerk no fue actualizado. Volver al Paso 7.

### CORS errors en console del browser
`ALLOWED_ORIGINS` no incluye el nuevo dominio. Volver al Paso 6 + redeploy backend (`./scripts/deploy-backend.sh`).

### "Domain not verified" después de 24h
DNS provider mal configurado. Probar con [whatsmydns.net](https://whatsmydns.net) — si globalmente sigue NXDOMAIN, eliminar el record y volver a crearlo en el provider.

---

## Después del deploy con custom domain

✅ Actualizá [docs/PUNCH_LIST.md](../PUNCH_LIST.md) marcando custom domain como hecho.
✅ Actualizá el ROADMAP visual (mueve "Custom domain SSL" de 🔴 a 🟢).
✅ Avisá a Cristian que el dominio cambió — algunos hardcodes pueden necesitar update.
✅ Avisá a usuarios beta del nuevo URL.
