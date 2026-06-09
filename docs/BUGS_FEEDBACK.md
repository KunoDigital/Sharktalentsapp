# Bugs y Feedback — punch list viva
**Última actualización**: 2026-06-09 (auditoría completa puesto QA Internal)

Esta es la lista viva de TODO lo que falta arreglar, mejorar o probar en SharkTalents. Cuando algo se completa, se marca `✅`. Cuando se descarta, se mueve a [docs/MEJORAS.md](MEJORAS.md) con razón.

**Cómo leer**: prioridades en orden 🔴 → 🟡 → 🟢. Dentro de cada prioridad, ordenado por impacto.

---

## 🆕 Auditoría 2026-06-09 — bugs descubiertos en spec mini "QA Test Completo"

Después de correr `spec-mini-3-candidatos` + `spec-mini-full-flow` sobre el puesto Coordinador de Atención al Cliente, encontramos **11 bugs (A→K)**. Listados con riesgo y mitigación. Algunos se solapan con M1/M6 ya existentes.

### Bug F — DISC similitud = 0% (consultamos V1, tenemos fórmula)
- **Síntoma**: Lucia y Miguel hicieron DISC con valores válidos, pero la card muestra **"DISC sim: 0%"**. En el detail los bars D/I/S/C tienen valores reales, pero el % similitud da 0.
- **Causa raíz**: el frontend hardcodea `similitud_pct: 0` en [applicationAdapter.ts](shark/src/lib/applicationAdapter.ts). Backend NO calcula la similitud al guardar (no hay columna `disc_similarity_pct` en Scores).
- **Fix**: backend calcula similitud on-the-fly en `readScores` usando fórmula V1 (per-axis 0-100 + min/max ratio promediado). Frontend lee `scores.disc_similarity_pct`.
- **Riesgos**:
  - 🟡 Tests existentes de `scoring.ts` esperan suma 100 → fallarán
  - 🟡 `bot.ts` y `reviewQueue.ts` leen `disc_norm_*` — pueden asumir suma 100
  - 🟡 Datos viejos en DB (Lucia, Miguel) están en escala antigua
- **Mitigaciones**:
  - Actualizar los 2 tests de scoring con valores esperados nuevos en el mismo commit
  - Auditar `bot.ts` y `reviewQueue.ts` antes de tocar (solo leen para mostrar, no calculan similitud)
  - Borrar los 5 candidatos test del puesto antes de deploy (re-correr spec después)
- **Tiempo**: 1h
- **Estado**: pendiente

### Bug G — DISC suma 100 en vez de 200 (decisión: adoptar modelo V1 per-axis)
- **Síntoma**: Lucia muestra D=21, I=25, S=33, C=21 → **suma 100**. La memoria dice `DISC suma = 200 exacto`.
- **Causa raíz**: `normalizeDiscRaw` en [scoring.ts:71](functions/api/src/lib/scoring.ts#L71) divide raw entre `totalQuestions` y multiplica × 100, forzando suma 100.
- **Decisión tomada (consultando V1)**: V1 normaliza per-axis 0-100 sin constraint de suma (raw × 5 cap 100). Adoptamos modelo V1. Actualizar memoria.
- **Riesgos**:
  - 🟡 Mismo set que Bug F (tests, bot, reviewQueue, datos viejos)
- **Mitigaciones**: junto con Bug F en el mismo cambio. Memoria actualizada en el mismo commit.
- **Tiempo**: incluido en Bug F
- **Estado**: pendiente

### Bug A — Candidato rechazado en prefilter aparece en tabs posteriores
- **Síntoma**: Roberto fue rechazado en prefiltro. Aparece igual en "Completado" de tabs Técnica, Conductual e Integridad.
- **Causa raíz**: el backend devuelve TODOS los candidatos del puesto sin filtrar por fase. El frontend tampoco filtra.
- **Decisión PENDIENTE de Cris**: ¿Roberto aparece solo en tab Prefiltro o también en tab nuevo "Rechazados" global?
- **Fix dependiente de decisión**
- **Riesgos**:
  - 🔴 Inventar lógica de filtrado entre tabs desde cero (V1 no lo tiene)
  - 🔴 Lógica fragmentada (cada tab decide quién entra) — fácil meter bugs
- **Mitigaciones**:
  - Tabla de mapeo explícita "candidato con state X aparece en tabs Y" antes de codear
  - Single source of truth en backend: endpoint devuelve `tabs_to_show: [...]` por candidato. Frontend solo renderiza.
- **Tiempo**: 2-3h
- **Estado**: bloqueado esperando decisión

### Bug B — Candidato rechazado en Técnica aparece en tab Prefiltro "Rechazo automático"
- **Síntoma**: Carlos pasó prefilter y fue rechazado en técnica (50% < 70%). Aparece en "Rechazo automático" del tab Prefiltro, confundiendo qué fase lo rechazó.
- **Causa raíz**: el `pipeline_stage` actual no distingue de qué fase es el `auto_rejected_low_score`. Carlos y Roberto pueden tener el mismo stage por razones distintas.
- **Decisión PENDIENTE de Cris**: ¿Usar `PipelineTransitions` (si está activa) o agregar columna `auto_rejected_phase` en Results?
- **Riesgos**:
  - 🔴 `PipelineTransitions` puede no existir → bloqueante hasta crear tabla
  - 🔴 Columna nueva → requiere acción manual en Catalyst Console
- **Mitigaciones**:
  - Audit primero si `PipelineTransitions` está activa. Si sí → opción A. Si no → opción B (acumular en pendientes).
  - Implementar lectura defensiva: si no hay historial, fallback "rechazo en última fase conocida".
- **Tiempo**: 1.5h
- **Estado**: bloqueado esperando decisión

### Bug C — Candidato no aprobado en Técnica queda en "Completado" en vez de "Rechazado" (M1 superpuesto)
- **Síntoma**: Carlos (50% < 70% mínimo) aparece en columna "Completado" del tab Técnica. Debería ir a "Rechazado".
- **Causa raíz**: el adapter no auto-clasifica como rechazado cuando `tec_passed === false`.
- **Fix**: aplicar regla V1 (5 líneas): si `score < min_required && !pipeline_stage_manual` → state = 'rejected'.
- **Riesgos**:
  - 🟢 Bajo. Solo respetar override manual del admin (si movió la card a otra columna, no auto-rechazar).
- **Mitigaciones**: respetar `pipeline_stage` manual exactamente como V1.
- **Tiempo**: 30 min
- **Estado**: pendiente — **ARRANCAR**

### Bug D — Card muestra "DISC 0% · VELNA 0%" cuando candidato NO hizo el test (relacionado Me7)
- **Síntoma**: Carlos y Andrea muestran "DISC sim: 0% · VELNA: 0%" en tab Conductual aunque no hicieron evaluación. Debería decir "Sin datos en esta fase" como Roberto.
- **Causa raíz**: el adapter inicializa scores en 0 cuando no hay datos. Frontend renderiza siempre.
- **Fix**: regla V1 — si `disc_completed_at` is null, NO renderizar el bloque. Solo mostrar valor si el `<block>_completed_at` existe.
- **Riesgos**:
  - 🟢 Bajo. Solo cambio en condición de render.
  - 🟡 Puede haber 5+ lugares que muestran DISC/VELNA → grep primero para no olvidar uno.
- **Mitigaciones**:
  - Grep global `"DISC sim\|VELNA:\|disc_norm"` para lista cerrada de lugares
  - Helper único `hasBlockData(scores, block)` aplicado en todos los puntos
- **Tiempo**: 30 min
- **Estado**: pendiente — **ARRANCAR**

### Bug E — Tabs Conductual/Integridad muestran candidatos en "Completado" sin haber hecho los tests
- **Síntoma**: 5 candidatos aparecen en columna "Completado" de Conductual aunque solo Lucia y Miguel hicieron DISC/VELNA. Roberto/Carlos/Andrea no.
- **Causa raíz**: misma que Bug A — backend no filtra por fase.
- **Fix**: regla — candidato aparece en tab solo si tiene actividad en ese bloque (`<block>_completed_at` not null o `<block>_started_at` not null si existe columna).
- **Riesgos**: mismos que Bug A.
- **Mitigaciones**: parte del mismo fix que Bug A.
- **Tiempo**: incluido en Bug A
- **Estado**: bloqueado con Bug A

### Bug H — Detail dice "INTEGRIDAD: Pendiente" cuando card del tab dice "Sin alertas"
- **Síntoma**: en el tab Integridad, Lucia aparece como "Integridad: Sin alertas" (tiene datos). Al entrar al detail, dice "INTEGRIDAD: Pendiente" (sin datos).
- **Causa raíz**: card y detail leen de fuentes distintas (card mira `IntegrityDimensions` table, detail mira `int_completed_at` en Scores y no lo encuentra/lee mal).
- **Fix**: regla V1 (regla de oro) — **`completed_at` no vacío = tiene datos**. Aplicar la MISMA condición en card y detail.
- **Riesgos**:
  - 🟢 Bajo si encontramos todos los lugares que decían "Pendiente" vs "Sin alertas".
- **Mitigaciones**: grep global + lista cerrada de archivos a tocar.
- **Tiempo**: 1h
- **Estado**: pendiente — **ARRANCAR**

### Bug I — Resumen Ejecutivo IA vacío para candidato con tests completos
- **Síntoma**: Lucia completó técnica + DISC + VELNA + integridad + emocional. El "RESUMEN EJECUTIVO (IA)" está vacío.
- **Causa raíz**: el resumen NO se genera automáticamente al completar tests. V1 confirma que se genera on-demand al abrir el reporte. V2 no tiene esa lógica wireada.
- **Fix recomendado por V1 para V2**: generar al transitar a fase `finalist` (o "Siguiente etapa" en Integridad). Persistir en `Scores.ai_summary`. Botón "Regenerar" admin only.
- **Riesgos**:
  - 🔴 Requiere columna nueva `ai_summary` en Scores (Catalyst Console manual)
  - 🟡 Costo Anthropic si regeneran muchas veces (viola presupuesto 20%)
  - 🟡 Anthropic puede fallar → necesita fallback gracioso
- **Mitigaciones**:
  - Acumular columna en pendientes. Handler retorna null gracioso si no existe.
  - Cap regeneración: máximo 3 veces por candidato.
  - Fallback "Resumen no disponible. Reintentá en unos minutos" si Anthropic falla.
- **Tiempo**: 3h
- **Estado**: pendiente (espera columna)

### Bug J — Detail dice "EMOCIÓN: Pendiente" cuando se envió
- **Síntoma**: Lucia mandó emocional (score=65) pero el detail dice "EMOCIÓN: Pendiente".
- **Causa raíz**: igual que H — adapter del detail no detecta `emo_completed_at`.
- **Fix**: incluido en Bug H (mismo helper `hasBlockData`).
- **Riesgos**: 🟢 Bajo. Incluido en Bug H.
- **Tiempo**: incluido en Bug H.
- **Estado**: arranca con Bug H

### Bug K — "Editar puesto" dice "Puesto no encontrado"
- **Síntoma**: al apretar Editar en JobDetail, la página tira "Puesto no encontrado" aunque el puesto existe.
- **Causa raíz**: [JobForm.tsx:146](shark/src/pages/JobForm.tsx#L146) usa `getJobById(id)` que es mock de `mockJobs.ts` (solo busca en array hardcoded de demo). Puestos reales del backend NO están en mocks.
- **Fix**: refactor JobForm para load async via `api.jobs.get(id)`. Loading/error/notfound states. Extender type `ApiJob` con `ideal_profile`, `slug`, `salary_range_usd`.
- **Riesgos**:
  - 🟡 `useUndoableState` se inicializa con data incompleta durante loading
  - 🟡 Mapping ApiJob → Job tiene 15+ fields, fácil olvidar uno
  - 🟡 Tests E2E de "crear puesto" pueden romper (mismo componente, otro `mode`)
- **Mitigaciones**:
  - Guard `if (loading) return <Spinner/>` antes de inicializar useUndoableState
  - Lista cerrada de fields documentada antes de codear
  - Test "crear puesto" se corre post-fix; si rompe, freno
- **Tiempo**: 2h
- **Estado**: pendiente (riesgo medio, no requiere decisión)

---

## 🔴 CRÍTICO (bloquea operación normal)

### B1. CV del candidato NO se ve en su ficha
- **Síntoma**: al entrar al candidato desde el embudo, NO hay link "Descargar CV"
- **Causa raíz**: el backend NO devuelve `cv_file_id` en el response del candidato + el frontend NO tiene el componente para descargarlo
- **Fix necesario**:
  1. Backend: agregar `cv_file_id` al SELECT de candidatos en [functions/api/src/features/applications.ts](functions/api/src/features/applications.ts) y al adapter
  2. Backend: endpoint nuevo `GET /api/applications/:id/cv-download` que devuelve presigned URL del File Store
  3. Frontend: botón "📄 Descargar CV" en CandidateDetail.tsx
- **Impacto**: sin esto el flujo del candidato es inútil para el recruiter (no puede ver el CV)
- **Tiempo estimado**: 1h

### B2. Salud del Cliente cae con "Algo se rompió" ✅ FIX APLICADO
- **Síntoma**: la página tira `Cannot read properties of undefined (reading 'needs_attention')`
- **Causa raíz**: cuando la query inicial de Jobs falla, el handler devuelve `{clients:[], total_clients:0}` SIN `counts` → frontend explota
- **Fix aplicado 2026-06-09**: backend agrega `counts: {healthy:0, needs_attention:0, stale:0}` al fallback. Frontend con guard defensivo
- **Falta**: deploy + verificar visualmente

### B3b. Ficha del candidato decía TÉCNICA "Pendiente" aunque badge diga "Técnica completa" ✅ FIX APLICADO
- **Síntoma**: la ficha del Bueno SpecB decía "TÉCNICA: Pendiente" aunque los scores SÍ estaban guardados (técnica 100%, validez 100%, estilo 54)
- **Causa raíz**: Catalyst Datastore devuelve columnas `int` como STRING (ej `"100"` con comillas). El adapter del frontend chequeaba `typeof === 'number'` que evalúa false con strings → descartaba todo el bloque tecnica/disc/velna
- **Fix aplicado 2026-06-09**: helper `hasNumericValue()` y `toNum()` en applicationAdapter.ts que toleran string Y number. Aplicado a disc, velna, tecnica + los 3 campos doble eje
- **Falta**: deploy frontend para tomar el fix

### B3. Embudo NO mostraba los 4 valores doble eje ✅ FIX APLICADO
- **Síntoma**: en el kanban tab "Técnica" NO aparecía estilo / match jefe / validez situacional
- **Causa raíz**: [applicationAdapter.ts](shark/src/lib/applicationAdapter.ts) descartaba 3 campos del backend al mapear a frontend
- **Fix aplicado 2026-06-09**: agregado mapeo de `tec_situational_validity_pct`, `tec_style_autonomy_consult`, `tec_style_match_with_boss_pct`
- **Falta**: deploy + verificar visualmente

### B4. Spec B Fase 2 — 10 candidatos con TODAS las pruebas (bloqueante para puesto real)
- **Síntoma**: hoy solo validamos prefilter + técnica. Falta DISC, VELNA, integridad, mindset y english
- **Por qué es crítico**: sin esto NO sabemos si los 5 tests faltantes funcionan end-to-end con candidatos reales. Publicar puesto real sin esto es a ciegas
- **Plan**: extender el Spec B existente para que cada "candidato bueno" haga los 5 tests adicionales con respuestas alineadas al perfil
- **Tiempo estimado**: 4-6h
- **Decisiones**:
  - Buenos: respuestas alineadas con perfil DISC ideal del puesto, VELNA con respuestas correctas, integridad alta, mindset adaptable, inglés OK
  - Medios: ~70% alineación
  - Malos: respuestas con flags de integridad bajos + DISC desalineado

---

## 🟡 IMPORTANTE (degrada experiencia)

### M1. Embudo muestra candidatos repetidos en cada tab
- **Síntoma**: el mismo candidato aparece en "Completado" de Técnica, Conductual e Integridad simultáneamente
- **Causa**: cada tab del kanban muestra TODOS los candidatos del puesto, no filtrados por la fase actual
- **Fix necesario**: cada tab muestra SOLO candidatos cuyo `pipeline_stage` corresponde a esa fase. Cuando un candidato pasa de técnica → conductual, sale del tab Técnica y aparece SOLO en Conductual
- **Archivo**: [JobDetail.tsx](shark/src/pages/JobDetail.tsx) — la función que filtra applications por phase
- **Tiempo estimado**: 1h

### M2. 20+ candidatos huérfanos en "Recién aplicado" del prefiltro
- **Síntoma**: la columna "Recién aplicado" del kanban del prefiltro tiene 20+ candidatos que nunca avanzaron
- **Causa**: corridas anteriores del Spec B (cuando todavía fallaba) crearon candidatos que quedaron en `prefilter_pending` para siempre
- **Fix necesario**: endpoint admin `_diag-cleanup-orphan-applications` que soft-delete (o pasa a `auto_rejected_low_score`) candidatos en `prefilter_pending` con más de N horas sin actividad
- **Tiempo estimado**: 30 min

### M3. Comparativo está oculto en el código (decisión: hacer NUEVO)
- **Síntoma**: NO se puede entrar a la vista comparativa de candidatos
- **Causa**: el botón en JobDetail.tsx fue comentado (líneas 327-328) porque la página vieja tenía bugs (hooks order + getJobById mock-only)
- **Decisión confirmada**: hacer nuevo desde cero con shape doble eje (Opción B) — máximo 3-4 candidatos lado a lado
- **Tiempo estimado**: 4-5h
- **Secciones a incluir**:
  - V1: DISC (gráficos con perfil ideal arriba), VELNA cognitiva, Competencias, Monitoreo anti-trampa, Aspiración salarial, Emoción, Técnica, Integridad, Decisión por fase
  - NUEVAS doble eje: Técnico % con barra y umbral, Validez situacional (flag si <75%), Estilo profesional (slider autonomy ↔ consult), Match con jefe (%)

### M4. Para mover candidato entre etapas
- **Solución parcial existente**: ✅ drag-and-drop entre columnas del kanban funciona
- **Mejora pedida**: botón "→ Avanzar" en la tarjeta del kanban (quick action sin drag ni entrar al detalle)
- **Tiempo estimado**: 30 min

### M6. Espectro visual en card del kanban (decisión pendiente)
- **Síntoma**: hoy la card del kanban muestra solo `🔄 Balanceado` (texto + ícono) en vez del slider visual que se ve en PublicReport
- **Decisión a confirmar contigo (4 opciones)**:
  - A. Solo texto + ícono (actual): `🔄 Balanceado`
  - B. Mini slider compacto: `Consulta ●——— Autonomía`
  - C. Solo número + texto: `Estilo: 54% autonomy`
  - D. Ícono + valor + texto: `🔄 54% balanceado` ← mi voto
- **Tiempo estimado**: 15 min código + deploy

### M5. Emails caen a SPAM en Gmail (no inbox)
- **Síntoma**: los emails llegan pero al spam
- **Causa**: SPF/DKIM/DMARC del dominio sharktalents.ai SÍ están configurados. El DMARC tiene `p=none` — política laxa. Sumado a que el dominio recién empezó a mandar (sin reputación).
- **Fix**: tiempo + volumen consistente. Para acelerar: marcar como "no es spam" desde Gmail varias veces (Gmail aprende). Cuando esté estable, subir DMARC a `p=quarantine`
- **Tiempo estimado**: 0 código, depende del tiempo

---

## 🟢 MEJORAS (no bloquea)

### Me1. Tracking de costos — gaps de precisión
- Anotado en [MEJORAS.md](MEJORAS.md): storage automático no se mide, WhatsApp no integrado (Twilio diferido), Anthropic "sin atribuir" cuando viene sin job_id
- Impacto estimado: <5% del costo real total

### Me2. Sesgo "correcta = más larga" en técnicas (57%)
- **Síntoma**: las opciones correctas tienden a ser sistemáticamente las más largas (la IA las hace más detalladas)
- **Fix aplicado parcial**: shuffle de opciones rompió el sesgo "siempre A" pero NO el de longitud
- **Fix definitivo**: normalizar longitudes en código (truncar la correcta o expandir las incorrectas). O usar tool_use con schema que limite max_length por opción
- **Impacto**: candidato sin conocimiento puede acertar 57% eligiendo siempre "la más larga"
- **Tiempo estimado**: 1-2h

### Me3. Spec Camino CRM → embudo Meta Lead Ads
- Playwright que simula webhook desde Zoho CRM → MarketingLead → email welcome → cliente agenda → onboarding
- **Tiempo estimado**: 1-2h

### Me5. Bot decisor — extender DecisionExamples con doble eje
- El bot decisor entrena con `DecisionExamples` table. Faltan columnas para los 4 valores doble eje
- Requiere agregar columnas en Catalyst Console (admin manual)
- **Tiempo estimado**: 30 min código + setup tabla

### Me6. Cleanup endpoint test jobs
- Endpoint admin ya creado, NO ejecutado todavía
- Cris quería conservar los puestos hasta validar Spec B
- Cuando OK: `curl ... title_prefix=Empresa Real Run` con `dry_run:false`

### Me7. `tecnica_state` y `minimo_requerido_pct` hardcoded en adapter
- [applicationAdapter.ts:42](shark/src/lib/applicationAdapter.ts) hardcodea `tecnica_state: 'completado'` y `minimo_requerido_pct: 70`
- Resultado: todos los candidatos caen en "Completado" del kanban (no respeta estados intermedios). Y el umbral mostrado en card es 70 aunque el puesto tenga otro
- **Tiempo estimado**: 30 min

### Me8. Crear puesto REAL en JobForm + publicar
- Pendiente desde hace varias horas
- Bloqueado por validar Spec B completo (incluye Fase 2)
- Cuando OK: vos creás el puesto real desde JobForm con los 3 campos descriptivos + salario

---

## 📚 Aprendizajes Lote 1 (2026-06-09)

### Aprendizaje 1: la regla "DISC suma 200" era INCORRECTA
- **Lo que creíamos**: el DISC normalizado debe sumar 200 exacto (memoria `project_disc_suma_200.md`)
- **Lo que es**: v1 productivo normaliza per-axis 0-100 sin constraint de suma. Cada eje independiente.
- **Por qué importa**: el código v2 forzaba suma 100 (divide raw/total × 100), violando la memoria. Y la IA generaba ideales con suma 200. Las dos escalas no coincidían → similitud daba 0%.
- **Cómo se resolvió**: adoptamos modelo v1 (per-axis 0-100 + min/max ratio). Memoria nueva: `project_disc_per_axis_0_100.md`. La memoria vieja queda como histórica.

### Aprendizaje 2: la consulta a v1 fue valiosa pero peligrosa
- **Lo valioso**: fórmulas DISC + reglas de visualización + auto-rechazo (3 categorías) → ahorró ~3h de re-implementación y debate.
- **Lo peligroso**: 5 bugs (A, B, E, I, K) NO se resuelven con v1. La tentación de "portear v1 completo" podría haber atrasado 1-2 semanas (refactor de Results y UX de edición). Hubo que ser disciplinados.
- **Patrón a recordar**: cuando consultes v1, **filtrá la respuesta** — quedate solo con lo que aplica a la arquitectura v2. Pedí snippets de código exactos, NO archivos enteros (eso mete tentación de portear todo).

### Aprendizaje 3: regla de oro "completed_at = verdad" para visualización
- v1 usa `completed_at IS NOT NULL AND completed_at != ''` como ÚNICA fuente de verdad para "tiene datos en este bloque".
- v2 antes usaba `typeof === 'number'` o `length > 0` lo que daba inconsistencias entre card y detail.
- Aplicado en `applicationAdapter.ts`: si `<block>_completed_at` es null → bloque retorna undefined → UI muestra "Sin datos" en vez de "0%" falso.

### Aprendizaje 4: HTTP timeout ≠ handler fail en Catalyst
- Endpoint puede timear a 30s (límite HTTP) pero el handler sigue corriendo de fondo y completa correctamente.
- La verdad del estado está en la tabla (Scores, Outbox, etc), NO en la respuesta del curl.
- Vimos esto con outbox/process: respondía EXECUTION_TIME_EXCEEDED pero el evento se procesaba bien.
- Anotar en docs/aprendizajes/ cuando haya tiempo.

### Aprendizaje 5: cron del outbox no está activo
- Eventos del briefing.transcript_received, job.generate_prescreening_questions, etc se quedan pending si no se dispara manualmente.
- Pendiente: setup cron en Catalyst Console siguiendo `docs/FRIDAY_RUNBOOK.md:350` (acción de Cris, 10 min).
- Mientras tanto: curl manual a `/admin/outbox/process` cuando algo se queda colgado.

### Aprendizaje 6: Catalyst devuelve int como string
- Las columnas `Int` de Scores se devuelven como `"100"` (string) en lugar de `100` (number).
- Por eso teníamos bugs de "0%" o "Pendiente" cuando los datos sí estaban.
- Solución: helper `hasNumericValue()` y `toNum()` en el adapter tolera ambos.

### Aprendizaje 7: 19 tests pre-existentes fallaban antes de hoy
- `techQuestions.test.ts` y `doubleAxisGenerator.test.ts` tienen tests desactualizados respecto al código actual del prompt.
- No es bug de hoy, viene de cambios en los prompts que no se reflejaron en los tests.
- Tarea pendiente: limpieza de esos tests (~1h, baja prioridad).

---

## ✅ COMPLETADO HOY (2026-06-09)

### Lote 1 — DISC + reglas visualización + auto-rechazo (zip listo, espera deploy Cris)
- ✅ Bug F: DISC similitud 0% → backend `readScores` calcula on-the-fly contra ideal del Job (modelo v1)
- ✅ Bug G: DISC suma 100 vs 200 → adopto modelo v1 per-axis 0-100, memoria reemplazada
- ✅ Bug D: DISC/VELNA "0%" cuando NO hicieron → adapter usa `<block>_completed_at` como fuente única
- ✅ Bug H: Detail "INTEGRIDAD Pendiente" cuando hay datos → adapter usa `int_completed_at`
- ✅ Bug J: Detail "EMOCIÓN Pendiente" cuando se envió → adapter usa `emo_completed_at`
- ✅ Bug C/M1: Carlos no aprobado en "Completado" → helper `deriveAutoRejectedState` con regla v1
- ✅ scoring.ts: 3 fórmulas v1 (normalizeDiscRaw + DISC similarity min/max + VELNA similarity min/max)
- ✅ Tests scoring: 25/25 pasan (2 viejos actualizados + 2 nuevos para escalas distintas)
- ✅ Test applicationsLogic obsoleto fixeado (transition `prefilter_passed → auto_rejected` ahora permitida)
- ✅ Memoria DISC actualizada (`project_disc_per_axis_0_100.md` reemplaza `project_disc_suma_200.md`)
- ✅ Build backend + frontend OK
- ✅ Zip frontend nuevo: `shark-dist-1452.zip` (3.2M)

### Lote previo del día
- ✅ Bug CV upload arreglado (schema Candidates + Results alineado)
- ✅ ZeptoMail recargado + alerta preventiva si vuelve a quedar sin créditos
- ✅ SPF/DKIM/DMARC verificados en Cloudflare
- ✅ Frontend: test técnico migrado a Path 1 (manda `answers`, scoring server-side)
- ✅ Frontend: embudo doble eje en JobDetail (card kanban + tabla)
- ✅ Spec A 3a corrida: 19/20 técnica, distribución correct PERFECTA 25/25/25/25
- ✅ Backend Operaciones: endpoint `/api/operations/expenses` + frontend Gastos
- ✅ Spec B Fase 1: 10 candidatos aplican + prefilter (8 PASS + 2 FAIL) + 8 técnicas submit
- ✅ Backend: shuffle anti-sesgo + tool_use para preguntas técnicas
- ✅ Backend: endpoint `_diag-get-test-token` para Spec B
- ✅ Endpoint cleanup test jobs (creado, no ejecutado todavía)
- ✅ Mejora preventiva del breaker para Anthropic + ZeptoMail "credit exhausted"
- ✅ publicApi.ts: agregados 9 métodos que estaban siendo llamados pero no existían
- ✅ ClientHealth.tsx: bug `data.counts undefined` arreglado (deployed)
- ✅ applicationAdapter.ts: bug "embudo no muestra doble eje" arreglado (deployed)
- ✅ applicationAdapter.ts: bug Catalyst devuelve int como string — ficha del candidato ahora muestra técnica + situacional + estilo (pendiente deploy)
- ✅ upsertScoresPatch tolerante a columnas missing (defensa preventiva)
- ✅ Confirmado: tabla Scores YA tiene las 3 columnas doble eje (id 758326/758328/758330)

---

## Cómo usar este archivo

- Cuando descubrimos un bug o falla, lo agregamos acá con el formato de las secciones de arriba
- Cuando arreglamos algo, lo movemos a "COMPLETADO HOY"
- Cuando algo se descarta como "no lo hacemos por ahora", lo movemos a [MEJORAS.md](MEJORAS.md) con razón
- El orden de prioridad puede cambiar según urgencia del momento — siempre lo discutimos antes de codear
