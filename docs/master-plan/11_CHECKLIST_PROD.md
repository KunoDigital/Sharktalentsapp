# 11 — Checklist de Producción

Lista exhaustiva para:
1. Cerrar cada fase del refactor
2. Antes de cada release a producción
3. Post-release (primeras 24h de monitoring)

Imprimí, pegá en la pared o en un Notion, y pasá cada ítem antes de hacer click en "deploy". Sin excepciones.

Basada en [docs/aprendizajes/14_CHECKLIST_PROD.md](../aprendizajes/14_CHECKLIST_PROD.md), aplicada al contexto SharkTalents.

---

## Go / No-Go final antes de deploy a prod

**Si cualquier item crítico (🔴) no está ✅ → abortar y arreglar primero.**

---

## 🏗️ Arquitectura

- [ ] 🔴 Catalyst Cloud Scale (no Slate) — [ADR-001](01_PRINCIPIOS_Y_ALCANCE.md#adr-001)
- [ ] Function única `api` de tipo Advanced I/O
- [ ] Function `cron` separada para jobs async (si aplica)
- [ ] `index.js` de cada function < 300 líneas
- [ ] README.md actualizado

---

## 📦 Modularización backend

- [ ] `handlers/` con archivos por recurso
- [ ] `services/` sin imports de `http`/`req`/`res`
- [ ] `db/` con un archivo por tabla
- [ ] `integrations/` separado de `services/`
- [ ] `middleware/` reutilizable
- [ ] `lib/` con utils genéricos (errors, logger, retry, circuitBreaker, env)
- [ ] Ningún archivo > 400 líneas sin razón
- [ ] 0 dependencias circulares
- [ ] `ctx` object usado consistentemente

---

## 💾 Base de datos

### Schema
- [ ] 🔴 Todas las tablas normalizadas (26 tablas del schema nuevo)
- [ ] 🔴 Results.score JSON eliminado
- [ ] 🔴 pipeline_stage es enum, no string libre
- [ ] ScreenExits separada a tabla append-only
- [ ] PipelineTransitions append-only con historial completo
- [ ] Tablas de infra creadas: ProcessedEvents, OutboxEvents, AuditLog, TokenUsage, CircuitBreakers, Config, HealthChecks
- [ ] JobProfiles, JobCompetencias, JobCostConfig extraídas del mega-blob

### Convenciones
- [ ] Nombres de tabla en PascalCase plural
- [ ] Columnas en snake_case
- [ ] Booleans con prefijo `is_` o `has_`
- [ ] Timestamps con sufijo `_at`
- [ ] Enums en snake_case para valores

### Integridad
- [ ] FKs válidas (no orphans)
- [ ] Idempotencia en inserts con clave natural
- [ ] Paginación en listados
- [ ] Text fields con truncate al escribir (max 4800 chars)

---

## 🔒 Seguridad

### Autenticación
- [ ] 🔴 Passwords con scrypt + salt (no SHA256)
- [ ] 🔴 `timingSafeEqual` para comparar hashes/tokens
- [ ] Sesiones expiran en 24h
- [ ] JWT signing con `JWT_SECRET` dedicado (no hash del password)

### Autorización
- [ ] Auth separado de Authz en middleware
- [ ] Nombres de funciones **no mienten** sobre lo que hacen
- [ ] Frontend gated por rol + backend valida siempre
- [ ] Admin único tiene rol explícito

### Inputs
- [ ] 🔴 Todos los inputs externos validados
- [ ] 🔴 SQL escapado (`db.esc()`) en TODA query ZCQL
- [ ] Enums validados contra whitelist
- [ ] IDs validados con regex antes de SQL
- [ ] `tech_prompt` sanitizado antes de Anthropic
- [ ] Shape de response de Anthropic validado

### Webhooks / URLs
- [ ] URLs firmadas con HMAC + expiración para File Store
- [ ] TTL razonable (4h típico)
- [ ] Internal API key para function-to-function
- [ ] `INTERNAL_API_KEY` rotable sin redeploy

### Access tokens
- [ ] 🔴 `ClientReports.access_token` para endpoints públicos
- [ ] Tokens con `crypto.randomBytes(32)`
- [ ] Frontend genera URL con token al publicar

### Secrets
- [ ] 🔴 Ningún secret hardcodeado en código
- [ ] 🔴 `.gitignore` incluye `.env*`, `*.pem`, `credentials.*`
- [ ] Secrets en env vars de Catalyst Console para prod
- [ ] Plan de rotation documentado en `docs/RUNBOOKS/rotation-secrets.md`
- [ ] Logs no incluyen secrets (fragmentos solo)

### Headers
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `X-Frame-Options: DENY`
- [ ] `Strict-Transport-Security`
- [ ] CORS whitelist explícito (no `*` con credentials)

### Rate limiting
- [ ] `/admin/login` con rate limit (5 tries / 5 min por user)
- [ ] `/public/test/*/start` rate limited (5 / 1 min por IP)
- [ ] `/public/test/*/submit` rate limited (3 / 1 min por IP)
- [ ] Endpoints Anthropic (regenerate-technical, generate-explanations) rate limited por usuario

---

## 🛡️ Reliability

### Idempotencia
- [ ] 🔴 `/submit` idempotente (chequeo `already_completed`)
- [ ] `/generate-explanations` skippa candidates ya generados
- [ ] `/publish` idempotente

### Retry
- [ ] 🔴 Todas las HTTP calls tienen timeout explícito
- [ ] Anthropic calls con retry backoff exponencial (3 max)
- [ ] Retry solo en errores transitorios (5xx, 429, timeout, network)

### Fallback
- [ ] No hay `catch {}` vacíos (silent failures)
- [ ] Cada error loguea con contexto
- [ ] Feature flags para desactivar Anthropic rápido

### Circuit breaker
- [ ] 🔴 Anthropic protegido con circuit breaker
- [ ] Threshold = 5 fallos, cooldown = 60s
- [ ] Estado persistido en tabla CircuitBreakers

### Timeouts de negocio
- [ ] Flujos que esperan respuesta externa tienen timeout
- [ ] Cron detecta flujos colgados (en el futuro)

### Crons
- [ ] 🔴 Try/catch raíz que NUNCA rethrow
- [ ] Siempre responden 200
- [ ] Cada job individual tiene su try/catch
- [ ] Dead-man switch implementado (HealthChecks)

### Outbox
- [ ] OutboxEvents procesa translations, futuros emails
- [ ] Worker retry con backoff
- [ ] Backlog visible en `/admin/metrics`

---

## 👁️ Observability

### Logs
- [ ] 🔴 Prefijos consistentes en TODOS los módulos
- [ ] Niveles correctos (info / warn / error)
- [ ] Contexto suficiente (IDs, operación, duration)
- [ ] 🔴 No loguea secrets/passwords/PII
- [ ] Errores con stack trace
- [ ] `traceId` en logs de cada request
- [ ] `lib/logger.ts` en uso (no `console.log` directo)

### Endpoints
- [ ] 🔴 `/health` público funciona
- [ ] `/health/detailed` con checks por subsistema (protegido)
- [ ] `/admin/metrics` expone agregados

### Monitoring externo
- [ ] UptimeRobot o similar configurado contra `/health`
- [ ] Alerta email/Slack si `/health` falla > 15 min

### Audit log
- [ ] Operaciones admin clave con audit log
- [ ] Tabla AuditLog append-only
- [ ] Incluye actor, action, resource, changes

### Runbooks
- [ ] `docs/RUNBOOKS/smoke-tests.md`
- [ ] `docs/RUNBOOKS/anthropic-caido.md`
- [ ] `docs/RUNBOOKS/cron-detenido.md`
- [ ] `docs/RUNBOOKS/reporte-publico-404.md`
- [ ] `docs/RUNBOOKS/data-store-lento.md`
- [ ] `docs/RUNBOOKS/costo-catalyst-alto.md`
- [ ] `docs/RUNBOOKS/rotation-secrets.md`
- [ ] `docs/RUNBOOKS/rollback.md`

---

## ⚡ Performance y costos

- [ ] 🔴 0 queries N+1 en endpoints admin (ver medición post-refactor)
- [ ] Queries consolidadas donde posible
- [ ] Polling frontend — no hay polling activo, OK
- [ ] Listas paginadas
- [ ] Queries con columnas específicas, no `SELECT *` en hot paths
- [ ] Cache de seeds en memoria
- [ ] Archival strategy: evaluar si alguna tabla crece > 10k rows/mes
- [ ] Costos proyectados documentados en `docs/master-plan/`
- [ ] Monitor de factura Catalyst mensual

---

## 🔌 Integración Anthropic

- [ ] Documentada en `docs/INTEGRATIONS/anthropic.md`
- [ ] Runbook `docs/RUNBOOKS/anthropic-caido.md`
- [ ] API key en env var
- [ ] 🔴 Timeout en todas las calls
- [ ] Retry configurado
- [ ] Circuit breaker
- [ ] Feature flag `ANTHROPIC_ENABLED`
- [ ] Prompt caching habilitado
- [ ] System prompts extraídos a constantes
- [ ] Token usage persiste en tabla TokenUsage
- [ ] Logs de request + response (sin secrets)
- [ ] Validación de shape de response

---

## 🎨 Frontend

### Arquitectura
- [ ] 🔴 `API_BASE` centralizado en `src/config.ts`
- [ ] 🔴 `buildPublicUrl()` usado en todos los links públicos
- [ ] Fetch wrapper con manejo de 401/403/errores
- [ ] Services divididos por dominio

### UX
- [ ] 4 estados: loading / error / empty / success (donde aplique)
- [ ] Skeletons en lugar de spinners
- [ ] Confirmación en acciones destructivas (archivar job, publicar reporte)

### Performance
- [ ] Bundle size < 800 KB gzipped (medir con `vite build --report`)
- [ ] No polling activo

### Seguridad
- [ ] RBAC en UI (por ahora admin único)
- [ ] NO confiar solo en frontend — backend valida
- [ ] 0 secrets en `VITE_*` vars

### Errores
- [ ] ErrorBoundary en App.tsx
- [ ] Error boundaries locales en rutas críticas

### Versioning
- [ ] Versión visible en footer sidebar + en reportes públicos
- [ ] Bump de versión en cada deploy prod
- [ ] CHANGELOG.md actualizado

### Accesibilidad mínima
- [ ] `<button>` para acciones
- [ ] `aria-label` en icon buttons
- [ ] Contraste AA
- [ ] Focus visible
- [ ] `<label>` en inputs

---

## 🚀 Deploy

### Git
- [ ] Branch `main` refleja prod
- [ ] Tags para releases (v2.0.0 post-refactor, por ejemplo)
- [ ] Commits descriptivos
- [ ] Archive branches para pre-cambios grandes

### Pre-deploy
- [ ] 🔴 Build del backend sin errores
- [ ] 🔴 Build del frontend sin errores
- [ ] 🔴 No hay `console.log` de debug
- [ ] 🔴 No hay secrets hardcoded (grep manual)
- [ ] Env vars nuevas documentadas en `.env.example`
- [ ] DB migrations aplicadas en el ambiente target
- [ ] Revisión del diff completo (especialmente de cambios sensibles)

### Orden de deploy
- [ ] 🔴 DB changes primero
- [ ] 🔴 Backend después
- [ ] 🔴 Frontend al final
- [ ] 🔴 Backend retro-compatible con frontend actual

### Post-deploy (primeros 30 min)
- [ ] 🔴 `/health` devuelve OK
- [ ] 🔴 Smoke test manual del flow crítico
- [ ] Logs sin errores nuevos
- [ ] Métricas normales
- [ ] Capacity to rollback confirmada

### Rollback preparado
- [ ] Plan documentado
- [ ] Último release taggeado
- [ ] Versión anterior del zip disponible
- [ ] Capacidad de `git revert` + redeploy

---

## 📝 Documentación

- [ ] README.md raíz con setup y overview
- [ ] CLAUDE.md con convenciones para agentes IA
- [ ] `docs/master-plan/` completo (estos 12 docs)
- [ ] `docs/aprendizajes/` del manual interno
- [ ] `docs/ADR/` con decisiones arquitectónicas importantes
- [ ] `docs/INTEGRATIONS/anthropic.md`
- [ ] `docs/INTEGRATIONS/catalyst-file-store.md` (si se documenta)
- [ ] `docs/RUNBOOKS/*.md` (mínimo 5)
- [ ] `CHANGELOG.md` con historial
- [ ] `.env.example` actualizado

---

## 👥 Proceso

- [ ] Plan de rotation de secrets conocido
- [ ] Credenciales en password manager (1Password/Bitwarden)
- [ ] Al menos una persona puede hacer rollback
- [ ] Runbooks accesibles sin login

---

## 📊 Monitoring externo

- [ ] UptimeRobot / Better Stack activo
- [ ] Health check pingeado cada 5 min
- [ ] Alertas a email/Slack

---

## 🎯 Smoke tests manuales

### Flujo principal admin
- [ ] Login con credenciales admin → /admin
- [ ] Crear puesto nuevo completo
- [ ] Generar técnica con IA → 25 preguntas
- [ ] Editar 1 pregunta técnica → guarda OK
- [ ] Ver pipeline de puesto (vacío)
- [ ] Ver comparación (vacía)

### Flujo candidato
- [ ] Abrir link kudert en incógnito
- [ ] Completar terms + registro
- [ ] Responder DISC → siguiente sección
- [ ] Sección cognitiva con timer → cuenta regresiva visible
- [ ] Section emocional → termina OK
- [ ] "Prueba completada" page

### Flujo reportes
- [ ] Ir a Compare → seleccionar 3 candidatos
- [ ] Preparar reporte → generar explicaciones (~60s)
- [ ] Pegar transcripción → analizar
- [ ] Publicar → obtener URL
- [ ] Abrir URL público con `?token=...` → ve OK
- [ ] Cambiar `?lang=en` → ve traducido

### Seguridad
- [ ] `curl` sin token en admin → 401
- [ ] `curl` con token inválido → 401
- [ ] URL de reporte público sin `token=` → 401/403
- [ ] SQL injection attempt en query param → 400/safe
- [ ] Doble submit del test → idempotente

### Performance
- [ ] Lista de 100 candidatos carga en < 2s
- [ ] /admin/jobs/:id/comparison carga en < 3s
- [ ] Generar reporte para 3 candidatos → < 120s

---

## 🏁 Go / No-Go

Antes de hacer click en "Deploy":

- [ ] Todos los items 🔴 críticos ✅
- [ ] Team notificado
- [ ] Window apropiado (no viernes 5pm, no cerca de deadlines de clientes)
- [ ] Rollback plan accesible
- [ ] Monitoring activo para la ventana post-deploy

**Si cualquier item crítico (🔴) está ❌ → abortar.**

---

## Después del deploy

- [ ] Deploy exitoso confirmado (smoke tests pasados)
- [ ] Tag git creado y pushed: `git tag v<version> && git push --tags`
- [ ] CHANGELOG.md actualizado
- [ ] Equipo notificado del release exitoso
- [ ] 30 min de watch-time cumplidos sin incidents
- [ ] Primeros 24h: monitoring cada 4h
- [ ] 7 días: review de métricas y factura Catalyst

---

## Siguiente paso

→ [12_ROADMAP_EJECUCION.md](12_ROADMAP_EJECUCION.md) — cronograma tentativo con dependencies entre fases.
