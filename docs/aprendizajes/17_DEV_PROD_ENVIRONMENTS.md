# 17 — Entornos DEV y PROD en Catalyst (SharkTalents)

Hasta junio 2026, **todo** SharkTalents V2 corría en el Environment "Development" de Catalyst. Eso incluía pauta de Meta Ads real, el dominio público `app.sharktalents.ai` y los correos a candidatos reales. Es un setup viable para validación temprana, pero a partir de ahora separamos DEV y PROD para poder iterar sin tumbar lo que un cliente real está usando.

Este documento explica **cómo está partida la app**, **qué env vars cambian entre ambientes** y **el flujo para promover cambios de DEV → PROD**.

---

## Lo importante en una frase

**Catalyst separa código y env vars entre Environments, pero NO separa el Datastore.** La base de datos es UNA SOLA para DEV y PROD. Aislamos pruebas via convenciones (tenant_id prefijo `test_*`) y servicios externos en modo sandbox (ZeptoMail test).

---

## Qué se separa y qué no

| Recurso | DEV | PROD | Notas |
|---|---|---|---|
| Código backend (functions/api) | ✅ separado | ✅ separado | `catalyst deploy` siempre va a DEV. Promoción manual desde Console. |
| Código frontend (shark/dist) | ✅ separado | ✅ separado | Mismo flujo de promoción. |
| Variables de entorno | ✅ separado | ✅ separado | Se setean por Environment en Console. |
| Dominio público | `sharktalentsapp-883996440.development.catalystserverless.com` | `app.sharktalents.ai` | Cris configura el custom domain en PROD. |
| **Datastore (tablas)** | ❌ **MISMO** | ❌ **MISMO** | Es por Project, no por Environment. Mismo registros se ven desde ambos. |
| **File Store** | ❌ **MISMO** | ❌ **MISMO** | Idem. Mismas folders. |
| Zoho CRM / Recruit / Sign / Bookings | ❌ MISMO | ❌ MISMO | Una sola cuenta Zoho. |

**Implicación crítica:** si creas un Job de prueba desde DEV, también aparece en PROD. Aislamos con dos técnicas:

1. **Prefijo `test_` en tenant_id de datos de prueba**, y filtramos en queries de admin/reporting cuando hay cliente real.
2. **ZeptoMail con cuenta de pruebas** (no envía correos reales) configurada solo en DEV.

---

## Clasificación de env vars

Hay tres familias: las que **deben ser distintas**, las que **deberían serlo** y las que **deben ser iguales**.

### A — DEBEN ser distintas (secrets y URLs)

| Var | DEV | PROD | Por qué |
|---|---|---|---|
| `APP_BASE_URL` | `https://sharktalentsapp-883996440.development.catalystserverless.com` | `https://app.sharktalents.ai` | URL pública |
| `ALLOWED_ORIGINS` | dominio dev + `http://localhost:3000` | dominio prod solamente | CORS |
| `INTERNAL_API_KEY` | secret A (64 hex) | secret B (64 hex) | Si DEV se filtra, PROD sigue protegido |
| `URL_SIGNING_SECRET` | secret C | secret D | Idem |
| `CRYPTO_MASTER_KEY` | secret E | secret F | Idem (encripta datos sensibles) |
| `CLERK_PUBLISHABLE_KEY` | key de Clerk dev | key de Clerk prod | Clerk separa entornos nativamente |
| `CLERK_SECRET_KEY` | secret Clerk dev | secret Clerk prod | Idem |
| `CLERK_WEBHOOK_SECRET` | webhook secret dev | webhook secret prod | Webhooks distintos por env |
| `CRM_WEBHOOK_SECRET` | secret webhook test | secret webhook real | Zoho CRM hooks |
| `ZOHO_RECRUIT_WEBHOOK_SECRET` | secret webhook test | secret webhook real | |
| `HEYREACH_WEBHOOK_SECRET` | secret webhook test | secret webhook real | |
| `ZOHO_SIGN_WEBHOOK_SECRET` | secret webhook test | secret webhook real | |
| `ZIA_WEBHOOK_SECRET` | secret webhook test | secret webhook real | |
| `ZEPTOMAIL_API_TOKEN` | token cuenta `sharktalents-test` | token cuenta real | Sandbox no manda correos reales |
| `ZEPTOMAIL_FROM_EMAIL` | `test@sharktalents.ai` (sandbox) | `reportes@sharktalents.ai` | |
| `SENTRY_ENV` | `development` | `production` | Para filtrar errores en Sentry |
| `LOG_LEVEL` | `debug` | `info` | Más verbosidad en DEV |

### B — DEBERÍAN ser distintas si quieres segregar costos (opcional)

| Var | Recomendación |
|---|---|
| `ANTHROPIC_API_KEY` | Mismo billing OK al inicio. Crear key separada cuando volumen crezca y quieras ver "cuánto gasto en pruebas vs producción real". |
| `OPENAI_API_KEY` | Idem (cuando arranque video). |
| `HEYREACH_API_KEY` | Idem (cuando se use seriamente). |

### C — DEBEN ser iguales (servicios compartidos)

| Var | Por qué |
|---|---|
| `ZOHO_RECRUIT_API_URL`, `ZOHO_RECRUIT_OAUTH_TOKEN` | Una sola cuenta Recruit |
| `ZOHO_CRM_API_URL`, `ZOHO_CRM_*` | Un solo CRM |
| `ZOHO_BOOKINGS_*` | Un solo Bookings |
| `ZOHO_SIGN_API_URL`, `ZOHO_SIGN_OAUTH_TOKEN`, `ZOHO_SIGN_CONTRACT_TEMPLATE_ID` | Una sola cuenta Sign |
| `FILESTORE_*_FOLDER_ID` | Mismas folders del File Store del proyecto |
| Todos los `*_TIMEOUT_MS`, `*_MAX_RETRIES`, `*_THRESHOLD` | Config de tuning idéntica |
| `FEE_MULTIPLIER`, `BOT_*`, `RATE_LIMIT_*` | Lógica de negocio idéntica |
| `ANTHROPIC_MODEL`, `OPENAI_WHISPER_MODEL` | Mismo modelo |

---

## Flujo para promover DEV → PROD

```
1. Cris (o yo) trabaja en local
        ↓
2. catalyst deploy → DEV (siempre, no hay flag para ir directo a PROD)
        ↓
3. Validación en https://sharktalentsapp-883996440...development.catalystserverless.com
        ↓
4. Cris promueve manualmente en Catalyst Console:
   Settings → Environments → Deployments → "Generate Diff" → "Deploy to Production"
        ↓
5. PROD queda actualizado en https://app.sharktalents.ai
```

**Importante:** el script `scripts/deploy-backend.sh` y `scripts/deploy-frontend.sh` despliegan a DEV. No existe forma desde CLI de saltar a PROD; siempre pasa por Console. Esto es **intencional** (gate humano antes de tocar prod).

---

## Setup inicial (una sola vez)

### Lo que hace Cris desde Catalyst Console

1. **Crear Environment Production:**
   - Console → `Sharktalentsapp` → arriba derecha donde dice "Development", click → "Create Environment"
   - Nombre: `Production`
   - Type: `Production`
2. **Crear el primer Deployment de DEV → PROD:**
   - Settings → Environments → Deployments → "Create Deployment"
   - Source: Development → Target: Production
   - Incluir: Serverless Functions, Cloud Scale (Client), DevOps, Settings
   - Click "Generate Diff" y luego "Deploy"
3. **Setear env vars de Production:**
   - Functions → `api` → Environment Variables → switch to Production
   - Pegar los valores de la columna PROD de la tabla A de arriba
   - Generar nuevos secrets con `./scripts/generate-secret.sh` (3 distintos para INTERNAL_API_KEY, URL_SIGNING_SECRET, CRYPTO_MASTER_KEY)
4. **Conectar dominio:**
   - Cloud Scale → Web Client Hosting → Custom Domain → mover `app.sharktalents.ai` al Environment Production
5. **Crear cuenta ZeptoMail de pruebas:**
   - ZeptoMail Console → Add Account → nombre `sharktalents-test`
   - Copiar el API Token, pegarlo SOLO en las env vars de Development (no de Production)

### Lo que hago yo desde código

- ✅ Actualizar scripts deploy con mensaje claro de "esto va a DEV, después promover en Console"
- ✅ Documentar este flujo (este documento)
- ✅ Verificar que `lib/env.ts` no tiene defaults peligrosos para PROD
- 🔜 Cuando empecemos a usar la separación: refactor de queries admin para filtrar tenant_id `test_*` cuando hay cliente real

---

## Anti-patterns a evitar

### ❌ Usar `NODE_ENV === 'production'` o `CATALYST_ENVIRONMENT === 'Production'` como guard de seguridad

No funciona confiablemente. Catalyst no garantiza qué valor inyecta. Como vimos durante todo 2026, la app real corre en el environment llamado "Development" y eso es por diseño.

**Patrón correcto:** flags opt-in explícitos. Ejemplo:

```ts
// ❌ MAL
if (process.env.NODE_ENV !== 'production') {
  // backdoor de test...
}

// ✅ BIEN
if (process.env.E2E_BACKDOOR_ALLOWED === 'true') {
  // backdoor de test, solo si Cris explícitamente lo activó
}
```

### ❌ Confiar en que la DB está aislada entre DEV y PROD

No lo está. Si haces `INSERT INTO Jobs ...` desde DEV, el record aparece en PROD también. Para datos de prueba, marca con `tenant_id` prefijo `test_` y filtra en las pantallas administrativas.

### ❌ Setear secrets reales en `catalyst-config.json`

Esa configuración se sube al repo y se sobreescribe en cada deploy. Los secrets siempre en Catalyst Console → Functions → api → Environment Variables.

---

## Casos comunes

### "Quiero probar un cambio de backend sin afectar al cliente real"

1. `./scripts/deploy-backend.sh` → va a DEV automáticamente
2. Probar en `https://sharktalentsapp-883996440.development.catalystserverless.com/server/api/...`
3. Si funciona, ir a Console y promover a PROD

### "Necesito enviar correos de prueba sin mandar a candidatos reales"

DEV ya tiene ZeptoMail test configurado — los correos se simulan, no salen. Probar con cualquier email; revisar resultado en ZeptoMail Console → Logs → cuenta `sharktalents-test`.

### "Quiero rollback de PROD a una versión anterior"

Catalyst Console → Settings → Environments → Deployments → ver historial de deployments → "Rollback to this version". También se puede hacer un deploy nuevo a DEV con código viejo y promover.

### "PROD está roto y necesito arreglarlo YA"

Hotfix flow:
1. Fix en `main` local
2. `./scripts/deploy-backend.sh` → DEV (validar 30s)
3. Console → promover a PROD inmediato
4. Tag de git con `hotfix-YYYY-MM-DD-XX` para auditoría
