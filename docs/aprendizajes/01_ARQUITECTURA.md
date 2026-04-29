# 01 — Arquitectura y Elección de Productos

## Elegir bien el producto de Catalyst desde el día 1

Catalyst tiene **tres productos** que parecen similares pero son **fundamentalmente distintos**. Elegir mal al inicio cuesta semanas de migración.

### Cloud Scale

**Usalo cuando:**
- Tu app tiene workflows (KYC, facturación, ERP, scheduling)
- Necesitás crons con timeouts largos (hasta 15 min)
- Integrás con múltiples sistemas (CRM, WhatsApp, firma digital, etc.)
- Necesitás observability nativa (logs runtime, execution history)
- Event-driven (disparar funciones por eventos de DB)

**Viene con:**
- Advanced I/O Functions (30s timeout, routing complejo)
- Basic I/O Functions (30s timeout, operaciones simples)
- Cron Functions (15 min timeout)
- Event Functions (disparadas por DataStore)
- Integration Functions (Zoho CRM/Books/Desk)
- DataStore, File Store, Client Hosting, API Gateway
- DevOps Logs nativos

**Es lo correcto para:** sistemas KYC/compliance, backoffices con workflows multi-paso, dashboards operativos con polling, apps que integran con múltiples sistemas externos.

### Slate

**Usalo cuando:**
- Estás creando una app **desde cero**
- Frontend-first (SPA, SSG, SSR con Next.js/Astro)
- Deploy via `git push` te importa más que crons nativos
- No tenés ya functions corriendo en Cloud Scale

**Limitaciones importantes:**
- **No tiene logs runtime nativos** — hay que integrar Datadog/Logflare/Axiom
- **No tiene crons nativos** — depende del framework (Next.js + Vercel Cron, etc.)
- **No se integra con proyectos Cloud Scale existentes** — son aplicaciones distintas con dominios distintos → CORS
- **Timeouts menores** que Cloud Scale Cron (60-300s vs 15 min)

**No es:**
- La versión moderna de Cloud Scale
- Compatible con Cloud Scale Functions en mismo dominio
- Adecuado para apps con workflows complejos (crons, events)

### AppSail

Contenedores Docker. Raramente necesario si usás Cloud Scale bien.

### Pipelines

CI/CD propio de Catalyst con YAML. Funciona bien para **cualquier producto** (Cloud Scale, Slate, AppSail). Es el "GitHub Actions" de Catalyst. Cuando el equipo crece y querés tests automáticos + deploys condicionados, migrás acá.

---

## La matriz de decisión

| Necesidad | Cloud Scale | Slate |
|---|---|---|
| API REST compleja | ✅ | ⚠️ (vía framework) |
| Crons con timeout largo | ✅ | ❌ |
| Event triggers en DB | ✅ | ❌ |
| Logs runtime nativos | ✅ | ❌ |
| Git auto-deploy | ⚠️ (DevOps GitHub Integration) | ✅ |
| Frontend estático | ⚠️ (Client Hosting) | ✅ |
| Multi-environment nativo | ⚠️ | ✅ |
| Paradigma fullstack (Next.js) | ❌ | ✅ |
| App complejas de negocio | ✅ | ❌ |

**Regla:** si tenés crons o workflows multi-paso → Cloud Scale. Si es una web con CRUD mínimo → Slate.

---

## Estructura de proyecto recomendada

```
mi-app/
├── client/                          ← frontend (React/Vue/Astro/etc.)
│   ├── src/
│   │   ├── config.ts                ← API_BASE centralizado acá
│   │   ├── components/
│   │   ├── pages/
│   │   └── services/                ← llamadas al backend
│   ├── public/
│   │   └── client-package.json      ← versión visible en Catalyst
│   ├── package.json
│   └── vite.config.ts
├── functions/
│   ├── api_function/                ← Advanced I/O principal
│   │   ├── index.js                 ← SOLO router + wiring
│   │   ├── catalyst-config.json
│   │   ├── handlers/                ← un archivo por recurso/entidad
│   │   │   ├── auth.js
│   │   │   ├── orders.js
│   │   │   ├── users.js
│   │   │   └── webhooks.js
│   │   ├── services/                ← lógica de negocio
│   │   │   ├── payments.js
│   │   │   ├── notifications.js
│   │   │   └── reports.js
│   │   ├── integrations/            ← wrappers de APIs externas
│   │   │   ├── stripe.js
│   │   │   ├── twilio.js
│   │   │   └── sendgrid.js
│   │   ├── db/                      ← queries + helpers datastore
│   │   │   ├── users.js
│   │   │   ├── orders.js
│   │   │   └── helpers.js           ← normalizeRow, escapeSql, toCatalystDateTime
│   │   ├── middleware/              ← validación, auth, rate limiting
│   │   │   ├── auth.js
│   │   │   ├── rateLimit.js
│   │   │   └── validation.js
│   │   └── lib/                     ← utils genéricos
│   │       ├── hmac.js
│   │       ├── errors.js            ← clases de error custom
│   │       └── retry.js
│   ├── cron_function/               ← jobs programados
│   │   ├── index.js
│   │   ├── jobs/                    ← un archivo por tipo de job
│   │   │   ├── sendReminders.js
│   │   │   ├── cleanupOldData.js
│   │   │   └── checkTimeouts.js
│   │   └── catalyst-config.json
│   ├── proxy_function/              ← Advanced I/O para serving archivos
│   └── event_function/              ← disparado por DataStore triggers
├── docs/
│   ├── ARCHITECTURE.md              ← diagramas de alto nivel
│   ├── INTEGRATIONS/
│   │   ├── stripe.md
│   │   ├── twilio.md
│   │   └── ...
│   ├── RUNBOOKS/                    ← cómo resolver incidentes típicos
│   │   ├── cron-down.md
│   │   └── webhook-failing.md
│   └── ADR/                         ← architecture decision records
│       ├── 001-cloudscale-over-slate.md
│       └── 002-polling-over-websocket.md
├── aprendizajes/                    ← estos documentos
├── scripts/                         ← automation local
│   ├── deploy-frontend.sh
│   └── generate-secret.sh
├── CLAUDE.md                        ← instrucciones para agentes IA
├── README.md
└── .gitignore
```

### Regla de oro

**Una function = una responsabilidad.** No metas cron + HTTP + proxy en la misma function. Son dominios de responsabilidad distintos con timeouts y concurrencia distintos.

---

## Separación de responsabilidades dentro de una function

```
index.js          ← router, entry point
├── handlers/     ← "qué hacer cuando llega una request a X endpoint"
├── services/     ← lógica de dominio ("qué es pagar", "qué es notificar")
├── integrations/ ← "cómo hablamos con cada sistema externo"
├── db/           ← "cómo leemos/escribimos datos"
├── middleware/   ← "checks antes de procesar (auth, rate, validation)"
└── lib/          ← helpers genéricos reutilizables
```

**Regla de dependencia:** solo puede importar hacia "abajo".

```
index.js → handlers → services → integrations
                              → db
handlers → middleware
services → lib
```

`db/` no importa `services/`. `services/` no importa `handlers/`. Esto evita circular dependencies y mantiene la lógica limpia.

---

## ADR (Architecture Decision Records)

Para decisiones importantes, escribí un ADR corto en `docs/ADR/`:

```markdown
# ADR 001 — Cloud Scale sobre Slate

**Fecha:** 2026-04-23
**Status:** Aceptado

## Contexto
Necesitamos un sistema KYC con crons de 15 min, event triggers, logs runtime.

## Decisión
Usamos Cloud Scale Functions + Client Hosting, no Slate.

## Razones
- Slate no tiene crons nativos
- Slate no tiene logs runtime
- Nuestra app necesita 6 functions distintas con responsabilidades distintas

## Consecuencias
- No tenemos auto-deploy con `git push` (hay que usar DevOps GitHub Integration)
- Deploy del frontend es manual (zip a Catalyst Console)
- Versionar con `client-package.json`
```

Te ahorra explicar la misma decisión 20 veces en 2 años.

---

## El error más común: scope creep arquitectónico

❌ **Mal patrón:** empezás con 1 function "api". Agregás un cron adentro. Después un webhook. Después un proxy. A los 6 meses tenés un `index.js` de 3000 líneas.

✅ **Patrón correcto:** al primer nuevo tipo de responsabilidad (cron, proxy, event), creá una function nueva. Catalyst **no te cobra por tener muchas functions** — te cobra por las invocaciones.

---

## Antes de escribir código

Checklist de 5 minutos:

- [ ] ¿Estoy usando el producto Catalyst correcto? (Cloud Scale vs Slate)
- [ ] ¿Dibujé un diagrama de alto nivel? (aunque sea a mano, que exista)
- [ ] ¿Tengo un README.md con los componentes principales?
- [ ] ¿Cada function va a tener una responsabilidad clara?
- [ ] ¿Documenté la decisión arquitectónica en un ADR?
- [ ] ¿El equipo entiende dónde va cada cosa?

Si respondés NO a dos o más, parar. Diseñar primero.
