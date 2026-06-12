# Plan de auditoría — 2026-06-04

## Cómo está armado este doc

El workflow encontró 27 problemas reales en el backend. Acá te dejo:

1. **Un roadmap por fases** — qué tocar primero, qué después, por qué ese orden.
2. **Para cada problema crítico**: análisis con la misma metodología
   - **Síntoma** (qué pasa hoy)
   - **Causa** (por qué pasa)
   - **Fix** (qué cambio se hace)
   - **Qué otras partes tocan esto** (dependencias)
   - **Validación antes** (cómo confirmamos el problema)
   - **Validación después** (cómo confirmamos que no rompimos nada)
   - **Riesgo de romper otra cosa**
   - **Cómo lo deshago si rompe**
   - **Estimación**

No metí un análisis igual para los 21 problemas no-críticos para no abrumar; van listados al final con una nota corta y los abrimos cuando toquemos esa fase.

---

## El roadmap completo

### Fase 1 — Lo que se arregla hoy en la misma sesión (~30 min)

Estos tres tienen **bajo riesgo de romper algo** porque el cambio es chiquito y el patrón ya existe en otro lado del código:

| # | Problema | Por qué primero |
|---|---|---|
| 1 | Puerta trasera de Playwright (auth) | Riesgo más inmediato — la llave acabamos de pegarla |
| 2 | Cron de emails puede mandar 2 veces | Cliente real lo verá si pasa, mala primera impresión |
| 3 | Endpoint de Recruit no chequea de qué cliente es | Tenant B puede manipular datos de Tenant A |

### Fase 2 — Próxima sesión (~30-45 min, requiere verificación previa)

| # | Problema | Por qué después |
|---|---|---|
| 4 | Cualquiera puede secuestrar el tenant SharkTalents | Antes de tocar tengo que verificar quién usa ese endpoint hoy en el admin. Riesgo medio. |

### Fase 3 — Requiere que vos decidas un umbral

| # | Problema | Qué decidís vos |
|---|---|---|
| 5 | Anthropic puede facturar miles sin que nadie note | "Cuántos USD por puesto por día es demasiado" |
| 6 | Borradores de Zia quedan sin dueño | Si querés conservar los borradores que ya hay con dueño=null o borrarlos |

### Fase 4 — Los 21 no-críticos

Los 15 altos + 6 medios los listo al final del doc. Los atacamos en bloques de 3-4 entre el go-live del 2026-05-15 y fin de mayo, después de validar que la fase 1-3 quedó estable.

---

## Análisis problema-por-problema (críticos)

### Crítico #1 — Puerta trasera de Playwright en login

**Síntoma.** Si en Catalyst Console queda activada la variable `E2E_TEST_KEY` (la llave que usa Playwright para los tests), cualquiera que sepa esa llave puede mandar un header desde curl y la app lo deja pasar como si fuera vos.

**Analogía.** Es como dejar la llave maestra del depósito en el felpudo. Cualquiera que pase por el frente entra.

**Causa.** El código de login lee esa variable antes de validar al usuario real. Está pensado solo para tests, pero no tiene candado que diga "esto solo funciona en mi máquina, nunca en producción".

**Archivo:** [functions/api/src/lib/auth.ts:20-38](functions/api/src/lib/auth.ts#L20-L38).

**Fix.** Agregar 1 línea al principio de la función: si estamos en producción, ignorar la llave de tests. ~5 líneas en total.

**Qué otras partes tocan esto.** Casi todos los endpoints usan esta función para autenticar. El cambio NO modifica el flujo normal — solo agrega un candado para el escenario "estoy en prod, no escuchar la llave de tests". Cualquier usuario logueado con Clerk sigue funcionando igual.

**Validación antes.**
- Chequear en Catalyst Console → Functions → api → Environment Variables si está seteada `E2E_TEST_KEY`. Si está, hay que considerar la posibilidad de que la llave esté circulando.
- Correr `git log -p tests/.env.local` no aplica porque está en .gitignore. No hay forma de saber si se filtró.

**Validación después.**
- Correr los tests de Playwright contra producción: van a fallar (esperado).
- Confirmar que tu login normal con Clerk sigue andando: abrir la app, login normal → OK.
- Correr los tests locales con `PLAYWRIGHT_BASE_URL=http://localhost:3000` (apuntando a tu dev) → deben seguir andando.

**Riesgo de romper.** Si vos en algún momento querías correr tests contra producción para diagnosticar (no es lo habitual), ya no se va a poder. Lo cual es bueno — eso es exactamente lo que el guard impide.

**Rollback si algo no anda.** Revertir el commit del archivo `auth.ts`. Es un cambio quirúrgico, fácil de revertir.

**Estimación:** 10 min de código + 5 min de prueba.

---

### Crítico #2 — Cron de emails puede mandar el mismo dos veces

**Síntoma.** El cron que procesa la cola de eventos (emails, WhatsApp, etc.) cada 5 minutos puede agarrar los mismos eventos que vos clickeaste "Procesar ahora" en Settings al mismo tiempo. Resultado: el cliente recibe el mismo email dos veces ("Tus finalistas están listos" duplicado).

**Analogía.** Dos personas en la oficina agarran la misma carta del buzón sin avisarse, ambas la mandan. El destinatario recibe el mismo correo certificado dos veces.

**Causa.** Cuando el cron agarra los eventos, no marca "ya estoy trabajando en este, no me lo agarres". La función equivalente para el caso "vos clickeás Procesar ahora" SÍ lo marca bien — solo falta copiar ese patrón.

**Archivo:** [functions/api/src/features/outbox.ts:202-272](functions/api/src/features/outbox.ts#L202-L272). El patrón correcto vive en la misma función pero en línea 169 (`processOutboxFromTenant`).

**Fix.** Copiar 3 líneas del patrón existente al lugar que falta. Antes de despachar el evento, marcarlo como `processing`. Si después del despacho fue OK, marcar `sent`. Si falló, marcar `pending` + razón del fallo.

**Qué otras partes tocan esto.**
- El cron (`/api/admin/outbox/process` con `X-Internal-Key`) que vos vas a configurar mañana en Catalyst Console.
- El botón "Procesar ahora" en Settings.
- El dashboard de "Outbox" que muestra los eventos en cada estado — va a empezar a ver el estado `processing` mientras el evento está en vuelo. Visualmente queda mejor que el estado actual que salta de `pending` directo a `sent`.

**Validación antes.**
- Abrir Settings → Outbox y mirar si hay algún evento `pending` que sea del tipo "email cliente". Si hay, sirve para probar.
- Mandarte un email a vos misma con uno de esos.

**Validación después.**
- Repetir: arrancar el cron Y clickear "Procesar ahora" en Settings simultáneamente.
- Esperar 30 seg.
- Chequear en tu bandeja de entrada: debe llegar UN solo email, no dos.
- Chequear en Settings → Outbox: debe haber UN evento `sent`, no dos.

**Riesgo de romper.** Si el dispatch falla a mitad y dejamos un evento en estado `processing` para siempre (porque el handler murió antes de marcarlo `sent` o `pending`), ese evento queda colgado. Mitigación: el reset que ya hay para eventos `processing` con más de X minutos los devuelve a `pending` automáticamente. Esa lógica ya existe en `processOutboxFromTenant`, la traemos también.

**Rollback.** Revertir el cambio en `outbox.ts`. Vuelve al comportamiento actual (que tampoco es catastrófico — los duplicados son raros, requiere que el cron y vos sean simultáneos al segundo).

**Estimación:** 15 min de código + 10 min de prueba.

---

### Crítico #3 — Endpoint de Recruit no chequea de qué cliente es

**Síntoma.** Hay un endpoint llamado `forceRecruitSync` que sirve para forzar la sincronización de un candidato con Zoho Recruit cuando algo falló. El problema: si yo soy el cliente B y obtengo un identificador de candidato del cliente A (por enumeración de URLs o por accidente), puedo llamar a ese endpoint y mover el candidato de A a otra etapa o cambiar su estado.

**Analogía.** Una secretaria atiende llamadas y cualquier persona que llame diciendo "soy de la empresa X y quiero mover el legajo Y" recibe el cambio sin que la secretaria verifique que efectivamente sea de la empresa X.

**Causa.** El endpoint hace `requireAuth` (verifica que estés logueada) pero NO hace `requireTenant` ni chequea que el candidato pertenezca a tu cliente. Solo agarra el ID que viene en la URL y lo procesa.

**Archivo:** [functions/api/src/features/admin.ts:967-1082](functions/api/src/features/admin.ts#L967-L1082).

**Fix.** Antes de procesar, hacer una consulta: "este `resultId` que me pasaron, ¿pertenece a un Job del tenant del usuario que está llamando?". Si no, devolver 404 "no encontrado". 3 líneas.

**Qué otras partes tocan esto.**
- ¿Quién llama hoy a `forceRecruitSync`? Hay que mirar el frontend. Si hay un botón "Forzar sync con Recruit" en el JobDetail o CandidateDetail, ese botón sigue funcionando porque vos siempre pasás un candidato de TU tenant. El check solo bloquea el caso malicioso (cliente B agarra ID de cliente A).

**Validación antes.**
- Buscar en el frontend dónde se llama `forceRecruitSync`. Si hay un botón, anotar dónde para probarlo después.
- Probar el botón legítimo: clickearlo en un candidato tuyo. Debe funcionar.

**Validación después.**
- El mismo botón legítimo debe seguir funcionando.
- Si tuviera un candidate_id de otro tenant (imposible de obtener en producción, pero simulable con un fake en curl), debería devolver 404.

**Riesgo de romper.** Si el campo `tenant_id` en la tabla `Results` está vacío para candidatos viejos (de antes del multi-tenant), el check los daría como "no del tenant" y los bloquearía. Hay que validar que TODOS los Results tienen tenant_id antes de aplicar el fix. Si hay huérfanos, hay que rellenarlos primero.

**Validación previa adicional (importante):** correr una query rápida `SELECT COUNT(*) FROM Results WHERE tenant_id IS NULL`. Si devuelve > 0, primero rellenamos esos, después aplicamos el fix.

**Rollback.** Revertir el cambio en `admin.ts`. Vuelve al comportamiento actual (vulnerable pero funcional para casos normales).

**Estimación:** 10 min de código + 10 min de validación previa (chequeo de huérfanos) + 5 min de prueba.

---

### Crítico #4 — Cualquiera puede secuestrar el tenant SharkTalents (Fase 2)

**Síntoma.** Hay un endpoint público (`linkMarketingTenant`) que sirve para vincular un lead de marketing a un tenant nuevo en Clerk. El problema: solo está protegido por una "site key" que viaja en el bundle JavaScript del navegador. Cualquier persona que abra la app en su browser, abra DevTools, copie esa key, y haga una llamada manual desde curl puede vincular el tenant "SharkTalents" (el tuyo) a su propia organización de Clerk. A partir de ahí, queda como dueño.

**Analogía.** Es como tener un formulario de "transferir mi empresa" que está protegido solo por una contraseña que está impresa en el cartel de afuera de la oficina.

**Causa.** El endpoint está marcado `auth:'public'` y solo gateado por verificar la site key. Pero la site key es pública por diseño — el frontend público la usa para captar leads, y ese mismo frontend está en JavaScript visible.

**Archivo:** [functions/api/src/features/marketing.ts:2715-2761](functions/api/src/features/marketing.ts#L2715-L2761).

**Fix.** Opciones:
- **A:** borrar el endpoint del router. Hacer el linking de leads vía un script local con tus credenciales reales (como hicimos hoy con las tablas).
- **B:** cambiar el auth a `tenant` (requiere que un usuario logueado de Clerk apriete un botón). Eso es el caso real: vos en el admin clickeás "convertir este lead a tenant".

**Qué otras partes tocan esto — REQUIERE INVESTIGACIÓN PREVIA.**
- ¿El botón "Convertir a Tenant" en MarketingLeads (que recién pusimos en el Kanban) llama a este endpoint o a otro?
- ¿Hay algún flujo automático del backend (cron, webhook) que llame a `linkMarketingTenant` sin un humano detrás?

Si la respuesta a las dos es "no, solo lo llama el botón del admin con usuario logueado", entonces el fix B es seguro y mínimo: cambiar de `public` a `tenant`.

Si la respuesta es "sí hay un flujo automático", el fix B lo rompe — hay que usar el A (script).

**Validación antes.**
- Grep en el código: `linkMarketingTenant` para ver quién lo llama.
- Grep en el frontend: `_link_marketing_tenant` para ver si hay un fetch a esa URL.
- Verificar el flujo "convertir lead a tenant" desde el admin: hacer la conversión completa de un lead de prueba.

**Validación después.**
- Mismo flujo del admin: la conversión sigue funcionando.
- Desde curl con la site key extraída: debe devolver 401/403.

**Riesgo de romper.** ALTO si hay un flujo automático que dependía del endpoint público. MEDIO si solo lo llama el admin. Por eso lo dejo en Fase 2: necesito investigar antes de tocar.

**Rollback.** Revertir router.ts + marketing.ts. Vuelve al estado vulnerable pero funcional.

**Estimación:** 15 min de investigación + 10 min de código + 10 min de prueba = ~35 min.

---

### Crítico #5 — Anthropic puede facturar miles sin que nadie note (Fase 3)

**Síntoma.** Si un bug en el código hace que la cola de eventos reintente una misma generación de IA todo el día (ej: 60 retries/hora × 24h × 30 días × $0.05/llamada = ~$2,160 USD silenciosos), no hay ningún tope que lo detenga. La factura de Anthropic crece sin alarma.

**Analogía.** Es como tener la canilla del agua abierta y nadie mira el medidor. Cuando llega la factura, la sorpresa es muy cara.

**Causa.** El código de Anthropic mide y registra el costo DESPUÉS de cada llamada (en la tabla JobCostEvents que creamos hoy). Pero antes de llamar, no consulta cuánto se gastó ya hoy. Si no consultamos, no podemos parar.

**Archivo:** [functions/api/src/lib/anthropic.ts:154-237](functions/api/src/lib/anthropic.ts#L154-L237).

**Fix.** Agregar un check al principio: "antes de llamar, sumá lo gastado hoy en este puesto. Si pasa de X USD, devolvé error 'cap_exceeded' sin llamar." X es lo que vos definís.

**Qué otras partes tocan esto.** TODAS las llamadas a Anthropic — generación de tech questions, narrativas de reporte, bot decisor, auto-draft del briefing. Si el cap es muy bajo, bloqueamos features legítimas.

**Decisión que vos tenés que tomar:**
1. **Cap por puesto por día.** ¿Cuánto es "demasiado"? Mi sugerencia base: $5/puesto/día. Un puesto razonable gasta < $1 entre todas sus llamadas. Si en un día se pasan $5, algo anda mal. Pero vos sabés mejor las cifras reales de tu negocio.
2. **Qué pasa cuando se pasa el cap.** Opciones:
   - Devolver error y mandarte una alerta (`SystemAlerts` que creamos hoy).
   - Devolver error pero permitir que vos manualmente desbloquees con un botón en el admin.
   - Bloquear todo el puesto hasta el día siguiente.

**Validación antes.**
- Mirar las últimas 30 entradas en `JobCostEvents` (si ya hay datos). Sumar lo gastado por puesto.
- Definir un umbral con margen de seguridad: 2x el peor caso normal.

**Validación después.**
- Forzar el escenario: bajá temporalmente el cap a $0.10. Disparar una generación. Debe devolver error.
- Subir el cap a normal. La misma generación debe funcionar.

**Riesgo de romper.** ALTO si el cap es muy bajo. MEDIO si es razonable pero alguna feature nueva (que no preví) consume mucho. Mitigación: usar la columna `cost_type` para distinguir y aplicar cap diferente por tipo si hace falta.

**Rollback.** Variable de entorno `ANTHROPIC_DAILY_CAP_USD` — si la dejo en `0` o sin definir, el check no aplica. Así desactivás en caliente sin redeploy.

**Estimación:** 5 min de decisión tuya + 15 min de código + 10 min de prueba = ~30 min.

---

### Crítico #6 — Borradores de Zia quedan sin dueño (Fase 3)

**Síntoma.** Cuando Zia (la asistente de Zoho que transcribe reuniones) manda un transcript al backend, este genera un borrador del perfil del puesto con IA y lo guarda. Pero lo guarda SIN tenant_id (sin dueño). Resultado: los borradores existen pero ningún listado los muestra (porque todos filtran por tenant). Quedan en el limbo.

**Analogía.** Es como armar un legajo y guardarlo sin etiquetar a qué archivero pertenece. Existe, pero nadie lo encuentra cuando lo busca.

**Causa.** El handler del evento `briefing.transcript_received` no recibe tenant_id en el payload — Zia manda el evento pero ese campo no se está llenando aguas arriba.

**Archivo:** [functions/api/src/features/outbox.ts:666-677](functions/api/src/features/outbox.ts#L666-L677).

**Fix.** Dos opciones:
1. Hacer que Zia mande `meeting_id` y mapear `meeting_id → tenant_id` en el handler.
2. Inferir el tenant_id del email del cliente que estuvo en la reunión.

Ambas requieren tocar `features/ziaWebhook.ts` además del handler.

**Decisión que vos tenés que tomar:** ¿Hay borradores ya en la tabla con `tenant_id=null` que querés conservar? Si sí, hay que mapearlos a su tenant correcto. Si no, los borramos y aplicamos el fix de aquí en adelante.

**Validación antes.**
- Query: `SELECT COUNT(*) FROM JobProfileDrafts WHERE tenant_id IS NULL`. ¿Cuántos hay?
- Si > 0: mirar uno por uno (`SELECT * FROM JobProfileDrafts WHERE tenant_id IS NULL LIMIT 5`) para entender de qué cliente eran.
- Si = 0: avanzamos directo.

**Validación después.**
- Generar un transcript de prueba en Zia (reunión interna).
- Verificar que aparece en `DraftsList` con tu tenant.

**Riesgo de romper.** Si Zia no manda meeting_id o si el mapeo falla, los próximos borradores también van a quedar sin dueño. Mitigación: si no se puede determinar el tenant, NO crear el borrador y mandarte una alerta — mejor no crear que crear huérfano.

**Rollback.** Revertir los dos archivos. Vuelve al comportamiento actual (huérfanos pero al menos no se pierden eventos).

**Estimación:** 15 min de investigación (cuántos huérfanos) + 30 min de código + 15 min de prueba = ~60 min.

---

## Listado de los 21 no-críticos (resumen)

Estos los atacamos en bloques después de fase 3.

### Altos (15)

| # | Resumen | Archivo |
|---|---|---|
| 7 | (duplicado de #4 en la auditoría) processOutbox no marca processing | outbox.ts:202 |
| 8 | Race condition al disparar "embudo activo" y "finalistas listos" | applications.ts:414 |
| 9 | Token público puede modificar candidatos de otros tenants | publicTest.ts:269 |
| 10 | renameCandidate no chequea tenant | marketing.ts:929 |
| 11 | inspectIntegrityDims lee datos de otros tenants | marketing.ts:906 |
| 12 | forcePublishRecruitJob permite manipular Jobs cross-tenant | jobs.ts:460 |
| 13 | Endpoints diagnósticos públicos permiten borrar leads | marketing.ts:2429 |
| 14 | Dispatchers de emails al cliente devuelven OK aunque falle el email | outbox.ts:1323 |
| 15 | Webhook de Recruit: idempotencia rota por race | zohoRecruitWebhook.ts:181 |
| 16 | Promesas fire-and-forget sin try/catch tumban el proceso | varios |
| 17 | Update Results + insert PipelineTransitions no atómico | publicTest.ts:689 |
| 18 | Reporte hace 10 llamadas Anthropic en paralelo sin cap | reportNarratives.ts:410 |
| 19 | Outbox procesa 20 eventos sequential, mueren a 30s | outbox.ts:202 |
| 20 | Timeout Anthropic 55s pero Catalyst mata a 30s | anthropic.ts:88 |
| 21 | Pool matching trae 8000 candidatos sin LIMIT | candidatePool.ts:311 |

### Medios (6)

| # | Resumen | Archivo |
|---|---|---|
| 22 | GDPR delete no borra OutboxEvents/AuditLog/etc | gdpr.ts:139 |
| 23 | auditLog no persiste tenant_id | auditLog.ts:60 |
| 24 | publishOutboxEvent sin await pierde eventos | marketing.ts:307 |
| 25 | listOutbox devuelve 200 con error en body en vez de 503 | outbox.ts:988 |
| 26 | isTableReady cache no se invalida en cold-start | costTracking.ts:36 |
| 27 | gdpr export hace N+1 queries sin LIMIT | gdpr.ts:57 |

---

## Lo que vos tenés que decidirme antes de arrancar Fase 1

Nada para Fase 1. Los 3 fixes son chicos, bajo riesgo, patrón conocido. Si me decís "dale fase 1", arranco.

## Lo que vos tenés que decidirme para Fase 2

Si querés que primero investigue dónde se usa `linkMarketingTenant` antes de decidir borrar vs cambiar a tenant-auth.

## Lo que vos tenés que decidirme para Fase 3

1. **Cap diario por puesto en USD para Anthropic.** ¿$5? ¿$10? ¿Otro?
2. **Qué pasa cuando se pasa el cap.** ¿Solo alerta? ¿Bloqueo hasta tu OK manual? ¿Bloqueo hasta el día siguiente?
3. **Borradores de Zia con `tenant_id=null` existentes**: ¿hay alguno que querés salvar (te paso lista)? ¿Borramos todos?
