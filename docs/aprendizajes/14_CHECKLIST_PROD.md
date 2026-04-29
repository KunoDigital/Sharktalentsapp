# 14 — Checklist antes de Producción

Una lista exhaustiva para pasar antes de cada release mayor. Imprimí, pegá en la pared, pasá cada item antes de hacer click en "deploy".

---

## 🏗️ Arquitectura

- [ ] Usamos el producto Catalyst correcto (Cloud Scale para apps de negocio, Slate solo para apps nuevas fullstack)
- [ ] Cada function tiene una responsabilidad clara (no mezcla HTTP + cron + proxy)
- [ ] Estructura de carpetas consistente (handlers/services/integrations/db/lib/middleware)
- [ ] `index.js` de cada function < 300 líneas
- [ ] ADR escrito para decisiones arquitectónicas importantes
- [ ] README.md describe el sistema para un nuevo dev

---

## 📦 Modularización

- [ ] Handlers en archivos separados por recurso (orders.js, users.js, etc.)
- [ ] Lógica de negocio en `services/`, no en `handlers/`
- [ ] Integraciones externas en `integrations/`, cada una en su archivo
- [ ] Queries de DB en `db/`, no mezcladas con lógica
- [ ] Validaciones en `middleware/validation.js` o similar
- [ ] Helpers genéricos en `lib/`
- [ ] Ningún archivo > 400 líneas sin razón clara
- [ ] Dependencias circulares = 0

---

## 💾 Base de datos

- [ ] Tablas normalizadas (una entidad por tabla)
- [ ] Columnas de estado son state machines explícitas, no flags independientes
- [ ] Historia de cambios en tabla append-only separada
- [ ] `ROWID` usado como PK (no crear uno custom)
- [ ] `CREATEDTIME`/`MODIFIEDTIME` usados (no reinventar)
- [ ] DateTime se lee/escribe con helpers (`parseCatalystDateTime`, `toCatalystDateTime`)
- [ ] Text fields se truncan al escribir (max 4800 chars margen de seguridad)
- [ ] Rows se normalizan al leer (`raw.TableName || raw`)
- [ ] Idempotencia con columna dedicada + check antes de insertar
- [ ] Paginación en listas grandes (LIMIT + OFFSET)
- [ ] No hay JOINs en ZCQL (se hacen en memoria)
- [ ] Archival strategy definida para tablas que crecen lineal

---

## 🔒 Seguridad

### Autenticación
- [ ] Passwords con scrypt + salt (nunca plaintext)
- [ ] `timingSafeEqual` para comparar hashes
- [ ] Sesiones expiran razonablemente (1h access, días refresh)
- [ ] Logout invalida tokens

### Autorización
- [ ] Auth (verificar quién es) separado de Authz (verificar qué puede)
- [ ] RBAC implementado con roles explícitos
- [ ] Nombres de funciones **no mienten** (si valida rol, el nombre lo refleja)
- [ ] Frontend gated por rol + backend valida **siempre**

### Inputs
- [ ] Todos los inputs externos validados (formato, longitud, whitelist)
- [ ] SQL escapado en toda query ZCQL
- [ ] Enums validados contra lista de valores permitidos
- [ ] Idempotencias / IDs validados con regex (`/^\d{3,10}$/`)
- [ ] UUIDs validados con regex

### Webhooks
- [ ] HMAC verificado ANTES de procesar
- [ ] Soporta múltiples versiones de firma (legacy + nuevo)
- [ ] Idempotencia por `event_id`
- [ ] Raw body leído antes de parsear (para verificar firma)
- [ ] Responde 200 rápido, procesa async si es lento

### Secrets
- [ ] Ningún secret hardcodeado en código
- [ ] `.gitignore` incluye `.env*`, `*.pem`, `credentials.*`
- [ ] Secrets en env vars de Catalyst Console (no en catalyst-config.json para prod)
- [ ] Plan de rotation documentado
- [ ] Logs no incluyen secrets (ni fragmentos > 4 chars)

### Endpoints internos
- [ ] Function-to-function usa `INTERNAL_API_KEY`
- [ ] `INTERNAL_API_KEY` rotable sin redeploy de consumidores
- [ ] Endpoints internos NO expuestos a frontend

### URLs firmadas
- [ ] Archivos privados servidos via proxy con HMAC + expiración
- [ ] TTL razonable (4h típico)
- [ ] Tokens únicos por recurso (no por user)

### Access tokens por recurso
- [ ] Endpoints públicos que exponen datos sensibles usan token único por registro
- [ ] Tokens generados con `crypto.randomBytes(32)`
- [ ] Tokens en query string o header, nunca en URL path

### Headers de response
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `X-Frame-Options: DENY` (o ALLOW-FROM específico)
- [ ] `Strict-Transport-Security`
- [ ] CORS configurado con whitelist (NO `*` con credentials)

### Rate limiting
- [ ] Endpoints caros tienen rate limit
- [ ] Login tiene rate limit (previene brute force)
- [ ] Webhooks externos rate limited del lado tuyo (si el proveedor cobra)

---

## 🛡️ Reliability

### Idempotencia
- [ ] Webhooks entrantes son idempotentes por `event_id`
- [ ] Operaciones externas chequean estado antes de enviar
- [ ] Idempotency keys en operaciones iniciadas por cliente
- [ ] Re-run de procesos no causa duplicados

### Retry
- [ ] Todas las HTTP calls tienen timeout explícito (nunca sin timeout)
- [ ] Retry con backoff exponencial + jitter
- [ ] Retry solo en errores transitorios (5xx, network, timeout)
- [ ] Retry counter persistente en DB para procesos críticos
- [ ] Max retries configurado (3-5 típico)

### Fallback
- [ ] Cada operación crítica tiene fallback explícito
- [ ] Fallbacks dejan trazabilidad (logs + DB)
- [ ] No hay "silent failures" (try/catch vacíos)
- [ ] Feature flags para desactivar integraciones flakey

### Circuit breaker
- [ ] Servicios externos flakey tienen circuit breaker
- [ ] Threshold configurado (ej. 5 fallos en 60s)
- [ ] Cool-down antes de re-intentar

### Timeouts de negocio
- [ ] Flujos async tienen timeouts explícitos
- [ ] Cron o watchdog detecta flujos colgados
- [ ] Transición a estado "failed" cuando timeout

### Crons
- [ ] Try/catch raíz que NUNCA rethrow
- [ ] Siempre responden 200 (para que Catalyst no los apague)
- [ ] Cada job individual tiene su try/catch
- [ ] Health check / dead-man switch para verificar que corren
- [ ] Monitoring externo consume endpoint y alerta si falla

### Outbox
- [ ] Eventos externos derivados de transacciones pasan por outbox
- [ ] Worker procesa outbox con retry
- [ ] Visible el backlog del outbox en métricas

### Sagas
- [ ] Flujos multi-paso complejos tienen compensación
- [ ] Sagas resumibles (re-run desde donde quedó)

---

## 👁️ Observability

### Logs
- [ ] Prefijos consistentes en todo (`[MODULE-SUBMODULE]`)
- [ ] Niveles correctos (info/warn/error)
- [ ] Contexto suficiente (IDs, operación, duración)
- [ ] No loguea secrets/passwords/PII
- [ ] Errores incluyen stack trace
- [ ] Correlation IDs en flujos multi-step

### Métricas
- [ ] Endpoint `/metrics` con agregados (conteos por estado, backlogs)
- [ ] Accesible solo para admin/monitoring externo

### Health checks
- [ ] Endpoint `/health` público que devuelve 200 si la app funciona
- [ ] Endpoint `/health/detailed` con checks por subsistema (DB, external APIs)
- [ ] Monitoreo externo pingando `/health` cada N min
- [ ] Alertas configuradas (Slack/email)

### Audit log
- [ ] Operaciones críticas registradas (who/what/when)
- [ ] Tabla AuditLog append-only
- [ ] Panel admin permite consultar audit log

### Runbooks
- [ ] Runbooks para los 5-10 incidents más comunes
- [ ] Ubicación: `docs/RUNBOOKS/`
- [ ] Actualizados cuando incident nuevo

---

## ⚡ Performance y costos

- [ ] Ningún handler hace N+1 queries
- [ ] Queries consolidadas donde posible
- [ ] Cron corriendo la cadencia MÁS LENTA aceptable
- [ ] Polling frontend >= 60 seg (90+ recomendado)
- [ ] Pausa polling cuando tab no visible
- [ ] Listas tienen paginación
- [ ] Queries especifican columnas (no `SELECT *` a menos que necesites todo)
- [ ] Cache en memoria para config/lookups
- [ ] Archival strategy implementada
- [ ] Costos proyectados antes de deploy
- [ ] Monitoreo de factura mensual
- [ ] Alertas a threshold de factura

---

## 🔌 Integraciones

### Para cada integración externa
- [ ] Documentada en `docs/INTEGRATIONS/<provider>.md`
- [ ] Credentials en env vars
- [ ] Timeouts explícitos
- [ ] Retry configurado
- [ ] Circuit breaker (si aplica)
- [ ] Feature flag para desactivar rápido
- [ ] Logs de request + response (sin secrets)
- [ ] OAuth con refresh + cache + mutex (si aplica)
- [ ] Rate limiting del lado tuyo si el proveedor cobra por uso
- [ ] Tests con fixtures reales

### Webhooks entrantes
- [ ] URL del webhook documentada
- [ ] HMAC secret configurado
- [ ] Evento procesado idempotente por event_id
- [ ] Log de evento raw guardado en DB
- [ ] Response 200 rápido

### APIs salientes
- [ ] Base URL configurable via env var
- [ ] Versioning explícito en URL (`/v2/`)
- [ ] Headers estándar (Auth, Content-Type)
- [ ] Monitor de success rate
- [ ] Alerta cuando failure rate > threshold

---

## 🎨 Frontend

### Arquitectura
- [ ] `API_BASE` centralizado en un solo archivo
- [ ] Fetch wrapper con manejo de 401/403/errores
- [ ] Usando librería de data fetching (SWR/React Query) si aplica

### UX
- [ ] 4 estados: loading / error / empty / success en cada componente con data
- [ ] Skeletons en lugar de spinners
- [ ] Confirmación en acciones destructivas
- [ ] Notificaciones opt-in, no al cargar
- [ ] Sonidos opt-in
- [ ] Polling pausado cuando tab no visible

### Performance
- [ ] Bundle size < 500 KB gzipped
- [ ] Lazy loading de rutas pesadas
- [ ] Polling con intervalo razonable

### Seguridad
- [ ] RBAC en UI (ocultar botones)
- [ ] NO confiar solo en frontend (backend valida)
- [ ] Secrets NUNCA en `VITE_*` vars
- [ ] Sanitización de user input antes de render

### Errores
- [ ] Error boundary en rutas principales
- [ ] Logging a console + envío a backend para monitoring

### Versioning
- [ ] Versión visible en UI (footer)
- [ ] Bumpeo consistente de versión al deploy
- [ ] Changelog descriptivo en cada deploy

### Accesibilidad
- [ ] `<button>` para acciones, `<a>` para navegación
- [ ] `aria-label` en iconos sin texto
- [ ] Contraste WCAG AA
- [ ] Navegación con teclado funcional
- [ ] Focus visible en interactivos
- [ ] `<label>` asociado a `<input>`

---

## 🚀 Deploy

### Git
- [ ] Branch `main` refleja prod
- [ ] Tags para releases (`v2.5.2`)
- [ ] Archive branches para pre-refactors
- [ ] Commits descriptivos

### Pre-deploy
- [ ] Tests pasan (si existen)
- [ ] Build sin errores
- [ ] No hay `console.log` de debug
- [ ] Revisión del diff completo
- [ ] Env vars nuevas documentadas
- [ ] DB migrations aplicadas en el ambiente target

### Orden de deploys
- [ ] DB changes primero (columnas nuevas, tablas)
- [ ] Backend después (usa las columnas)
- [ ] Frontend al final (muestra las columnas)
- [ ] Backend es backward-compatible con frontend actual

### Post-deploy (primeros 30 min)
- [ ] Health checks devuelven OK
- [ ] Smoke test manual del flow crítico
- [ ] Logs sin errores nuevos
- [ ] Métricas normales (request rate, error rate, latencia)

### Rollback
- [ ] Plan documentado
- [ ] Último release taggeado y conocido
- [ ] Versión anterior del zip disponible (frontend)
- [ ] Capacidad de `git revert` + redeploy (backend)

---

## 📝 Documentación

- [ ] `README.md` en la raíz
- [ ] `CLAUDE.md` para agentes IA
- [ ] `docs/ARCHITECTURE.md` con diagramas
- [ ] `docs/INTEGRATIONS/` con una doc por integración
- [ ] `docs/RUNBOOKS/` con procedimientos de incident
- [ ] `docs/ADR/` con decisiones arquitectónicas
- [ ] `CHANGELOG.md` con historial de releases
- [ ] Env vars documentadas con descripción + si son secret

---

## 👥 Equipo / proceso

- [ ] Al menos 2 personas con acceso a Catalyst Console
- [ ] Al menos 2 personas saben hacer rollback
- [ ] Credentials/secrets guardados en password manager compartido (1Password, Bitwarden)
- [ ] Procedimiento de on-call conocido
- [ ] Procedimiento de rotation de secrets documentado
- [ ] Runbooks accesibles sin login

---

## 📊 Monitoring externo

- [ ] UptimeRobot / Better Stack / Pingdom configurado
- [ ] Health checks pingeados cada 5 min
- [ ] Alertas a Slack/email cuando falla
- [ ] Dashboard de métricas accesible al equipo

---

## 🎯 Smoke tests manuales (antes de cada release mayor)

### Flujo principal
- [ ] Login con user admin funciona
- [ ] Login con user operador funciona
- [ ] Login con credenciales malas rechaza
- [ ] Crear registro end-to-end (happy path completo)
- [ ] Cada step del flujo dispara correctamente
- [ ] Webhooks externos responden 200 y procesan

### Edge cases
- [ ] Retry funciona cuando integración falla
- [ ] Timeout dispara fallback
- [ ] Archivado funciona
- [ ] Restoración funciona (si aplica)
- [ ] Eliminar NO elimina si no autorizado

### Performance
- [ ] Lista de registros carga en < 2 seg
- [ ] Refresh de dashboard no lagguea
- [ ] Navegación entre rutas es fluida

### Seguridad
- [ ] Endpoint admin sin auth → 401
- [ ] Endpoint admin con role usuario → 403
- [ ] Webhook con firma inválida → 401
- [ ] Query con `'` en parámetro → no inyecta

---

## 🏁 Go/No-Go

Antes de hacer click en "Deploy":

- [ ] Todos los items de este checklist ✅
- [ ] El equipo sabe que va el deploy (comunicación)
- [ ] Window de deploy es apropiado (no viernes 5pm salvo emergencia)
- [ ] Rollback plan claro y accesible
- [ ] Monitoring activo durante la ventana post-deploy

Si **cualquier item crítico** no está ✅ → **abortar y arreglar primero**.

---

## Después del deploy

- [ ] Deploy exitoso confirmado (smoke tests pasados)
- [ ] Tag git creado y pusheado
- [ ] Version bumpeada
- [ ] CHANGELOG actualizado
- [ ] Team notificado (Slack/email)
- [ ] 30 min de watch-time cumplidos sin incidents
- [ ] Retroalimentación capturada para próximo release
