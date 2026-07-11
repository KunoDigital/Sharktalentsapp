# Spec: CRM interno para freelance vendedores

**Fecha:** 2026-07-09
**Estado:** Spec aprobada por Cris + Cristian · pendiente de arranque
**Estimado total:** 3-4 semanas de dev (por fases)
**Prioridad:** Crítica — desbloquea al freelance para operar

---

## 1. Objetivo del proyecto

Crear un CRM interno dentro de la app SharkTalents dedicado a los vendedores freelance. Cada vendedor recibe leads calificados (Meta Ads → Zoho CRM → round-robin) y opera el ciclo completo hasta cerrar el cliente y disparar el contrato.

El vendedor freelance **NO debe ver nada del ATS** (jobs, candidatos, reportes, evaluaciones). Solo ve su CRM comercial: leads asignados, pipeline, ficha del cliente, generar contrato.

---

## 2. Decisiones ya tomadas (recap)

| Decisión | Elección | Notas |
|---|---|---|
| Login y acceso | URL separada `freelance.sharktalents.ai` (o `sharktalents.ai/freelance`) con login propio | Aislamiento visual total del ATS. Menos riesgo de bugs de permisos |
| Tenant | Mismo tenant existente `SharkTalents Marketing` | Los freelance son usuarios nuevos dentro de ese tenant. Aislamiento por ROL, no por tenant |
| Sync con Zoho CRM | Bidireccional | Zoho para facturación e histórico. CRM interno para operación diaria |
| Contrato | Botón "Enviar contrato" en el CRM del freelance → dispara flujo Deluge existente `enviarContratoSharkTalents` → Zoho Sign | Reutiliza infra actual |
| Módulo auditoría RRHH | **NO existe** — el RRHH revisa/modifica preguntas prefiltro y técnicas con lo que ya tiene la app hoy | Cero dev nuevo del lado auditoría |

---

## 3. Alcance

### 3.1 Qué SÍ hace el CRM freelance

- Vendedor recibe leads asignados por round-robin
- Ve pipeline visual con sus leads y estado actual
- Contacta al lead, actualiza estado, agenda demo
- Registra notas y actividades
- Convierte lead a cliente y carga datos completos
- Dispara envío de contrato con un botón
- Ve su historial y comisiones acumuladas
- Panel de estadísticas propio (leads asignados, tasa de conversión, comisiones)

### 3.2 Qué NO hace el CRM freelance (fuera de alcance)

- Ver jobs, candidatos, evaluaciones, reportes del ATS
- Editar preguntas prefiltro o técnicas
- Ver leads de otros vendedores
- Facturar (eso sigue en Zoho)
- Módulo de auditoría RRHH (no aplica)

---

## 4. Arquitectura técnica

### 4.1 Frontend

Aplicación React separada bajo `shark/src/freelance/` o proyecto Vite independiente `freelance-app/`. Comparte:
- Auth (Clerk existente con rol nuevo `freelance`)
- API client base
- Componentes visuales genéricos

No comparte:
- Rutas del admin
- Menú del ATS
- Cualquier vista de jobs/candidatos

Ruta pública: `freelance.sharktalents.ai` (subdominio) o `sharktalents.ai/freelance` (path).

### 4.2 Backend

Endpoints bajo `/api/freelance/*` con middleware que valida rol `freelance` (nuevo).

Datos viven en el mismo Catalyst Datastore, tenant_id = tenant de SharkTalents Marketing. Aislamiento por `assigned_to = <freelance_user_id>` en cada query.

### 4.3 Auth y roles

Nuevo rol en Clerk: `freelance`. Cada usuario freelance se crea manualmente por Cris (invitación por email).

Middleware nuevo `requireFreelance()`:
- Verifica que el usuario tiene rol `freelance`
- Fuerza filtro `assigned_to = ctx.userId` en todos los queries
- Bloquea acceso a endpoints admin

---

## 5. Schema — tablas nuevas y modificaciones

### 5.1 Nueva tabla `FreelanceUsers`

| Columna | Tipo | Detalle |
|---|---|---|
| ROWID | bigint auto | PK |
| CREATEDTIME | datetime auto | |
| MODIFIEDTIME | datetime auto | |
| tenant_id | varchar | SharkTalents Marketing |
| clerk_user_id | varchar(255) | ID en Clerk |
| nombre | varchar(255) | |
| email | varchar(255) | |
| phone | varchar(20) | Para round-robin WhatsApp |
| activo | boolean | Pausar sin borrar |
| leads_asignados | bigint | Contador para round-robin |
| leads_confirmados | bigint | |
| leads_cerrados | bigint | Ventas efectivas |
| comision_acumulada_usd | number | Total ganado |
| onboarded_at | datetime | |
| notes_internal | text | Anotaciones Cris |

### 5.2 Ampliar tabla `MarketingLeads`

Agregar columnas:
- `assigned_to` (varchar) — ROWID del `FreelanceUsers`
- `assigned_at` (datetime)
- `confirmed_at` (datetime, nullable)
- `pipeline_stage` (varchar) — ver 5.3
- `demo_scheduled_at` (datetime, nullable)
- `demo_completed_at` (datetime, nullable)
- `client_converted_at` (datetime, nullable)
- `client_data_json` (text) — datos completos del cliente cargados por freelance
- `zoho_contract_id` (varchar, nullable) — ID del contrato generado
- `zoho_sync_status` (varchar) — `pending / synced / error`
- `zoho_synced_at` (datetime, nullable)

### 5.3 Pipeline stages del CRM freelance

```
nuevo_lead → contactado → demo_agendada → demo_hecha → propuesta_enviada → cerrado_ganado
                                                                        ↘ cerrado_perdido
```

Cualquier stage puede pasar a `cerrado_perdido` con razón obligatoria.

### 5.4 Nueva tabla `FreelanceActivities` (log de actividad)

| Columna | Tipo | Detalle |
|---|---|---|
| ROWID | bigint auto | PK |
| CREATEDTIME | datetime auto | |
| tenant_id | varchar | |
| lead_id | varchar | FK a MarketingLeads |
| freelance_user_id | varchar | Quién ejecutó |
| activity_type | varchar | `contacto / demo / propuesta / nota / cambio_stage` |
| description | text | Detalle libre |
| metadata_json | text | Datos estructurados (ej: fecha_demo si es scheduling) |

### 5.5 Nueva tabla `FreelanceLeadNotes`

Para separar notas privadas del vendedor (no van a Zoho) de los datos oficiales:

| Columna | Tipo | Detalle |
|---|---|---|
| ROWID | bigint auto | PK |
| tenant_id | varchar | |
| lead_id | varchar | |
| freelance_user_id | varchar | |
| note | text | |
| created_at | datetime | |

---

## 6. Endpoints backend nuevos

Todos bajo `/api/freelance/*` con middleware `requireFreelance()`.

### 6.1 Auth y perfil

| Método | Path | Propósito |
|---|---|---|
| GET | `/api/freelance/me` | Datos del vendedor logueado |
| PATCH | `/api/freelance/me` | Editar datos propios (phone, etc.) |
| GET | `/api/freelance/me/stats` | Estadísticas propias (leads asignados, tasa conversión, comisiones) |

### 6.2 Leads asignados

| Método | Path | Propósito |
|---|---|---|
| GET | `/api/freelance/leads` | Lista todos los leads asignados al vendedor (filtrable por stage) |
| GET | `/api/freelance/leads/:id` | Detalle del lead + actividades + notas |
| POST | `/api/freelance/leads/:id/confirm-received` | Freelance confirma que recibió el lead (evita reasignación por cron) |
| PATCH | `/api/freelance/leads/:id/stage` | Cambia stage del pipeline |
| POST | `/api/freelance/leads/:id/activities` | Registra actividad (contacto, demo, propuesta) |
| POST | `/api/freelance/leads/:id/notes` | Nota privada |
| POST | `/api/freelance/leads/:id/convert-to-client` | Convierte lead a cliente con datos completos |
| POST | `/api/freelance/leads/:id/send-contract` | Dispara el flujo del contrato (Deluge → Sign) |

### 6.3 Endpoints admin de gestión (para Cris)

Bajo `/api/admin/freelance/*`:

| Método | Path | Propósito |
|---|---|---|
| POST | `/api/admin/freelance-users` | Crear vendedor nuevo |
| GET | `/api/admin/freelance-users` | Lista todos los vendedores |
| PATCH | `/api/admin/freelance-users/:id` | Activar/pausar/editar |
| DELETE | `/api/admin/freelance-users/:id` | Soft-delete |
| GET | `/api/admin/freelance-users/:id/stats` | Estadísticas por vendedor |
| GET | `/api/admin/dispatch-stats` | Global: distribución round-robin + tasas |

---

## 7. Rutas frontend

### 7.1 Vendedor (subdominio `freelance.sharktalents.ai`)

| Ruta | Vista |
|---|---|
| `/login` | Login Clerk (rol freelance) |
| `/` | Dashboard: mis leads del día + estadísticas del mes |
| `/leads` | Pipeline visual estilo Kanban con todos mis leads |
| `/leads/:id` | Detalle del lead + actividad + notas + botones de acción |
| `/leads/:id/convertir` | Formulario para completar datos de cliente y convertir |
| `/perfil` | Mis datos + estadísticas históricas + comisiones |

### 7.2 Admin (dentro del panel actual de Cris)

Nueva sección `/admin/freelance/`:

| Ruta | Vista |
|---|---|
| `/admin/freelance/vendedores` | Lista de vendedores con acciones |
| `/admin/freelance/vendedores/nuevo` | Crear nuevo vendedor |
| `/admin/freelance/vendedores/:id` | Detalle + estadísticas + activar/pausar |
| `/admin/freelance/pipeline-global` | Vista global de leads y su estado (todos los vendedores) |
| `/admin/freelance/dispatch-stats` | Métricas de round-robin y conversión |

---

## 8. UX/UI que ve el freelance

### 8.1 Header

Logo SharkTalents (versión freelance) · nombre del vendedor · botón "Cerrar sesión". **Sin menú de navegación al ATS.**

### 8.2 Dashboard (home)

- 3 cards arriba: "Leads nuevos hoy" · "En demo esta semana" · "Comisiones del mes"
- Lista de leads recientes con último cambio de stage
- Botón grande: "Ver todo mi pipeline"

### 8.3 Pipeline (Kanban)

Columnas por stage (nuevo_lead, contactado, demo_agendada, demo_hecha, propuesta_enviada, cerrado_ganado, cerrado_perdido). Cada card muestra: nombre lead, empresa, dolor detectado, WhatsApp, fecha última actividad. Drag & drop para cambiar stage o click en botones.

### 8.4 Detalle del lead

- Header con datos del lead (nombre, empresa, WhatsApp, email, dolor, rol)
- Botón "Confirmar recibí" si aún no confirmó
- Botón WhatsApp (abre chat con el número del lead)
- Sección "Actividad" (timeline de contactos, demos, propuestas)
- Sección "Notas privadas" (solo el vendedor las ve)
- Sección "Datos del cliente" (se completa cuando convierte)
- Botón "Enviar contrato" (solo activo si está en stage `propuesta_enviada` y datos del cliente completos)

### 8.5 Formulario de conversión (lead → cliente)

Campos requeridos:
- Razón social
- RUC
- Dirección
- Contacto principal (nombre + cargo)
- Email de facturación
- Teléfono
- Descripción del puesto que van a buscar

Al guardar → automáticamente pasa al stage `propuesta_enviada` y syncan datos a Zoho CRM.

---

## 9. Sync con Zoho CRM (bidireccional)

### 9.1 SharkTalents CRM → Zoho

Eventos que disparan sync:
- Lead confirma recepción del freelance
- Cambio de pipeline_stage
- Registrar actividad importante (demo agendada, propuesta enviada)
- Convertir a cliente (envío de datos completos)
- Contrato enviado

Se usa la tabla `OutboxEvents` existente para desacoplar (mismo patrón que el resto del sistema). Handler nuevo: `syncFreelanceLeadToZoho(leadId, eventType)`.

### 9.2 Zoho → SharkTalents CRM

Eventos que disparan sync desde Zoho:
- Contrato firmado por cliente (viene del webhook de Zoho Sign)
- Factura pagada (cliente activo)
- Deal cerrado como perdido en Zoho (por si Cris lo cierra desde ahí)

Webhook nuevo `/api/webhooks/zoho-crm/deal-updated` con validación de secret.

### 9.3 Resolución de conflictos

Master field por campo:
- Datos del lead original (nombre, email, WhatsApp del interesado): master = Zoho CRM
- Pipeline_stage y actividades del freelance: master = CRM interno
- Datos de facturación del cliente convertido: master = CRM interno (donde el freelance los cargó)
- Estado de contrato firmado: master = Zoho Sign (via webhook)

Idempotencia: hash del payload en la tabla `ProcessedEvents` existente.

---

## 10. Flujo del contrato

1. Freelance completa datos del cliente y stage pasa a `propuesta_enviada`
2. Se syncan a Zoho CRM como Deal
3. Freelance click botón "Enviar contrato"
4. Backend → POST al Deluge function `enviarContratoSharkTalents` (existente) con el ID del deal en Zoho
5. Deluge dispara Zoho Sign
6. Zoho Sign manda contrato al cliente
7. Cliente firma → webhook Zoho Sign → backend actualiza `zoho_contract_id` y stage pasa a `cerrado_ganado`
8. Trigger comisión: se registra en `FreelanceUsers.comision_acumulada_usd`

---

## 11. Round-robin (ya con spec previa)

Ver [spec-roundrobin-vendedores-2026-07-06.md](spec-roundrobin-vendedores-2026-07-06.md).

Ajustes menores por este proyecto:
- La tabla `Vendedores` de esa spec pasa a ser `FreelanceUsers`
- Al confirmar recepción del lead, el vendedor entra por el CRM (no por link firmado en WhatsApp)
- Notificación por WhatsApp Twilio sigue igual, pero incluye link al CRM del freelance en vez de link de confirmación aislado

---

## 12. Roadmap por fases

### Fase 1 — Fundación (semana 1)
- Setup del subdominio `freelance.sharktalents.ai`
- Auth con rol `freelance` (Clerk)
- Middleware `requireFreelance()`
- Tabla `FreelanceUsers` + endpoints admin de gestión
- Panel admin para crear/editar vendedores
- Login del freelance (redirect si no tiene rol correcto)

**Milestone:** Cris puede crear un vendedor y ese vendedor loguea a una pantalla vacía.

### Fase 2 — Round-robin y recepción de leads (semana 1-2)
- Ampliar `MarketingLeads` con columnas nuevas
- Round-robin en el webhook Zoho CRM (ya lo dispara todo hoy)
- WhatsApp a vendedor asignado (plantilla `lead_asignado_vendedor` — submit a Meta para aprobación 24-48h)
- Endpoint confirmar recepción
- Cron reasignación 4h

**Milestone:** entra un lead de Meta Ads y aparece en el CRM del vendedor asignado + le llega WhatsApp.

### Fase 3 — Pipeline visual y actividades (semana 2)
- Vista Kanban del pipeline
- Vista detalle de lead
- Cambio de stage
- Registro de actividades y notas
- Timeline visual

**Milestone:** vendedor puede operar el ciclo comercial completo hasta antes de convertir a cliente.

### Fase 4 — Conversión y contrato (semana 3)
- Formulario de conversión (lead → cliente)
- Sync bidireccional con Zoho CRM
- Botón "Enviar contrato" que dispara Deluge existente
- Manejo del webhook de contrato firmado
- Actualización automática de comisión

**Milestone:** vendedor cierra un cliente end-to-end, contrato se envía y se firma, comisión se acredita.

### Fase 5 — Estadísticas y refinamiento (semana 3-4)
- Dashboard con estadísticas propias del vendedor
- Dashboard admin con métricas globales
- Sistema de alertas (leads sin contactar > 24h, demos sin realizar, etc.)
- Filtros y búsqueda en el pipeline
- Testing E2E completo

**Milestone:** producto listo para operar con múltiples vendedores en paralelo.

---

## 13. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Sync bidireccional Zoho ↔ SharkTalents genera loops o duplicados | Alta | Alto | Usar `OutboxEvents` con idempotencia + hash payload + tabla `ProcessedEvents`. Master field explícito por campo |
| Bug de permisos: vendedor ve leads de otro | Media | Alto | Middleware `requireFreelance()` fuerza filter `assigned_to = ctx.userId` en TODOS los queries. Tests E2E que validen el aislamiento explícitamente |
| Cambio de stage por drag & drop sin confirmar rompe estado | Media | Medio | Confirmar cambios sensibles (cerrado_ganado / cerrado_perdido) con modal. Log en `FreelanceActivities` de cada cambio |
| Plantilla Twilio `lead_asignado_vendedor` no aprobada por Meta | Alta | Medio | Categoría UTILITY (más fácil aprobación que Marketing). Preparar antes de la Fase 2 para tener 24-48h de margen |
| Volumen alto de leads paraliza el round-robin | Baja | Medio | Backpressure con Outbox + retry con jitter. Alerta a Cris si vendedores tienen >20 leads sin confirmar |
| Freelance abandona proyecto y quedan leads huérfanos | Media | Medio | Endpoint admin para reasignar en batch. Cron detecta vendedor inactivo (>7 días sin login) y avisa |

---

## 14. Dependencias externas

- Aprobación Meta plantilla `lead_asignado_vendedor` (24-48h)
- Clerk soporta creación programática de usuarios con rol custom (confirmado, ya lo hace hoy con otros tenants)
- Subdominio `freelance.sharktalents.ai` configurado en DNS + Catalyst (redirect a Vite build)

---

## 15. Testing plan

### 15.1 Unit tests
- Middleware `requireFreelance()`: 5 casos (sin auth, rol incorrecto, rol correcto, tenant mismatch, usuario inactivo)
- Round-robin: 3 casos (distribución equitativa, exclude vendedor original, todos pausados)
- Sync bidireccional: 4 casos (evento nuevo, evento repetido, conflicto de campos, fallo en Zoho)

### 15.2 E2E tests (Playwright)
- Vendedor loguea y ve solo sus leads (no ve los de otros)
- Vendedor confirma recepción → cambio de estado en DB + WhatsApp registrado en log
- Vendedor mueve lead a `demo_agendada` → aparece en columna correcta
- Vendedor convierte lead → datos syncan a Zoho CRM (validar con mock de Zoho)
- Vendedor envía contrato → Deluge disparado + `zoho_contract_id` guardado

### 15.3 Manual smoke test
- Crear vendedor real de prueba con email de Cris
- Simular lead con `_diag-crm-push`
- Recorrer flujo completo: recibir → contactar → demo → propuesta → convertir → contrato
- Validar sync con Zoho en cada paso

---

## 16. Métricas de éxito

Al terminar Fase 5, el CRM freelance debe:
- Soportar al menos 5 vendedores simultáneos sin degradación de UX
- Round-robin distribuir leads con desvío estándar &lt; 10% en 2 semanas
- Sync bidireccional Zoho con &lt; 1% de errores por semana
- Tiempo medio de "lead entra → vendedor confirma" &lt; 30 min
- Cero incidentes de acceso indebido (vendedor viendo lead de otro)

---

## 17. Decisiones tomadas (2026-07-09)

1. **URL:** `sharktalents.ai/freelance` (path, no subdominio). Más rápido de setup para arranque.
2. **Comisión:** 10% del salario del puesto vendido. Cris paga directamente al vendedor.
3. **Notificaciones por email:** SÍ, usando ZeptoMail existente.

---

## 18. Fuera de alcance de esta spec (para futuros proyectos)

- App móvil nativa para vendedores
- Chat interno vendedor-Cris
- Módulo de capacitación de vendedores dentro del CRM
- Integración con Google Calendar para agendar demos
- Grabaciones de demo con análisis IA (post-venta)
- Compensación multi-nivel (referidos)

Estas ideas se retoman una vez el MVP esté estable con 3+ vendedores activos.

---

**Fin de la spec.**
