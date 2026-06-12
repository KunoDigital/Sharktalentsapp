# Bugs y feedback — flujo web E2E (2026-06-05)

Cris probó el flujo Web completo (web → demo → cliente aprueba). Lista de hallazgos.

## 🔴 P0 — Bloqueantes (sin esto el flujo NO funciona end-to-end)

### 1. Job creado al aprobar NO tiene `recruit_job_id`
- **Detectado por:** logs (no Cris)
- **Trace:** `trc_mq1j1cjs17h3os` — warn `[JOB_DRAFTS] recruit job opening created but no id returned`
- **Impacto:** cuando el cliente apruebe el draft → se crea el Job y se publica en Recruit, PERO el Job en SharkTalents no tiene `recruit_job_id` poblado. Cuando un candidato aplique vía Recruit, el webhook va a buscar el Job por `recruit_job_id` o `recruit_job_slug` y NO va a encontrarlo → la Application NUNCA se crea.
- **Es el bug exactamente inverso al que arreglamos antes con `recruit_job_slug`.**
- **Fix:** investigar por qué `retryRecruitSync` (o equivalente que corre dentro de `convertDraftInternal`) no está guardando el ID que devuelve Recruit. Probablemente cambió el shape del response de Recruit o hay un bug en el código.

### 2. No hay envío automático de contrato post-aprobación
- **Cris preguntó:** "en qué momento se manda el contrato?"
- **Hoy:** después que el cliente aprueba el draft → llegan los emails de confirmación a Cris, PERO NO se dispara el envío del contrato a Zoho Sign.
- **Lo que existía (memoria):** integración con Zoho Sign via Deluge function (`enviarContratoSharkTalents`) ya está armada. Falta cablearlo al flow.
- **Fix:** después del `approveDraftPublic` agregar publish outbox event `contract.send` que llame la Deluge function.

## 🟡 P1 — Visibles al cliente, afectan credibilidad

### 3. Email "Hola gerente de ventas" (debe decir nombre del cliente)
- **Cris reportó:** "el correo para aprobación dice hola gerente de ventas que es el puesto no el nombre del cliente"
- **Probable causa:** el template está usando `{{job_title}}` o similar en el saludo en lugar de `{{client_name}}`.
- **Fix:** revisar `lib/emailTemplates.ts` template del email al cliente para aprobar draft. Cambiar el saludo a `{{client_name}}` (debe venir del lead asociado o del campo client_name del draft).

### 4. Demo report en móvil — cuadros de integridad cortados
- **Cris tiene capture.**
- **Fix:** CSS responsive en `DemoReport.tsx` para los cuadros de IntegrityDimensions. Probablemente falta `flex-wrap` o `grid-template-columns` adaptativo.

### 5. Demo report NO tiene link para agendar al final
- **Cris reportó:** "tambien deberia estar el link para agendar al final"
- **Fix:** agregar al final del componente DemoReport un CTA grande "Agendar reunión" que use `MARKETING_BOOKING_URL`.

## 🟡 P2 — Operativos, mejoran UX para Cris

### 6. Vista previa en draft no funciona
- **Cris reportó:** "el vista previa en draft no funciona"
- **Fix:** investigar el botón "Vista previa" en DraftReview.tsx, probablemente está sin onClick o el endpoint devuelve algo mal.

### 7. IA genera más de 5 competencias → cliente NO puede enviar
- **Cris reportó:** "el draft genero 7 competencias y tenemos el bloqueo de maximo 5 por puesto asi que no me dejo enviar al cliente tengo que borrar 2"
- **Backend dice:** `400 validation_error: máximo 5 competencias por puesto` al hacer PATCH al draft
- **Issues:**
  - La IA debería **generar máximo 5** desde el principio (instrucción en el prompt)
  - Si la IA genera más de 5, el backend debería **filtrar a las top 5** automáticamente en lugar de devolver 400
  - O el frontend debería avisar visualmente que solo se enviarán 5
- **Fix recomendado:** ajustar el prompt de Anthropic en `dispatchBriefingAutoDraft` para que genere máximo 5 competencias (instrucción explícita).

## ✨ Sugerencias UX (post-venta primera)

### 8. Workflow enforcement / process gating
- **Cris reportó:** "tampoco me obliga a poner el costo del puesto. necesitamos algo así como blueprint que obligue a seguir ciertos pasos con el cliente y puesto, como el poner el salario, el enviar el contrato"
- **Es:** validación dura del flujo. Hoy se puede saltar pasos.
- **MVP propuesto (3h):**
  - Validar `fee_usd > 0` antes de send-to-client
  - Validar `salary_range_max_usd > 0` antes de send-to-client
  - Disparar envío de contrato Zoho Sign al aprobar el draft (cubre P0-#2)
- **v2 grande:**
  - Tabla `JobChecklist` con todos los pasos requeridos
  - UI wizard/checklist visible por Job
  - Validaciones por endpoint con estados explícitos

### 9. Botón "Pegar transcript" en Marketing Leads
- **Cris sugirió:** "seria mas facil entrar en marketing leads y que uno de los botones sea pegar transcrip y eso se creara en draft"
- **Beneficio:** flujo natural — Cris ya está mirando al lead específico, evita el paso "ir a /drafts → seleccionar lead → pegar"
- **Fix:** agregar botón en cada card del kanban de MarketingLeads o en el detalle del lead. Re-usa el mismo endpoint `/api/drafts/generate`.

---

## Orden recomendado de fix

| # | Tiempo estimado | Por qué primero |
|---|---|---|
| 1 (recruit_job_id) | 1-2h | Sin esto, los candidatos no aparecen — el flujo principal de tu primer cliente se cae |
| 2 (contrato auto) | 2-3h | Sin esto, el proceso comercial queda colgado después que el cliente aprueba |
| 3 (email saludo) | 30 min | Visible al cliente, daña percepción |
| 4 (demo mobile) | 1h | Solo si el lead lo abre en celular se ve mal |
| 5 (demo agendar) | 30 min | Aumenta conversión del demo |
| 7 (IA max 5 competencias) | 30 min | Bug fácil de prompt |
| 6 (vista previa) | 1h | Operativo, no bloqueante |
| 8 (botón en MarketingLeads) | 2h | Mejora UX pero el flujo actual funciona |

**Total P0 + P1: ~6-8 horas concentradas. P2 opcional.**
