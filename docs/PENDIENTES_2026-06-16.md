# Pendientes — sesión 2026-06-16

Snapshot al cierre del día. Estado del proyecto y qué falta para que el flujo del candidato esté listo para clientes reales.

---

## ✅ Lo que se cerró HOY

### Implementación (en working tree, falta zip por subir)

- **PipelineDashboard nuevo es DEFAULT** (Cris aprobó al ver feature flag)
- 5 aliases de duplicaciones en catálogo Kudert + 19 tests
- velna_per_dimension UI en JobForm
- Documentación master-plan/27 — reglas pipeline completas
- Voseo argentino limpio: ~130 strings en 45 archivos
- Bug K verificado (ya estaba resuelto desde 2026-06-09)
- Tests pre-existentes limpiados: 19 → 0 fallidos
- M3 Comparativo de finalistas reescrito + botón en PipelineDashboard
- Backend Video Pieza 1 + 2 (preguntas IA + transcripción Whisper)
- Me2 anti-sesgo correcta=más larga + 13 tests
- Favicon 🦈 (aleta + ondas verde lima)
- Endpoint `_diag-create-e2e-test-job` para Playwright sin llenar form
- Capa 4 IA Conductual contextual (ConductualAnalysisPanel)
- autoRejection Integridad por dimensión (5 hard rejects + 8 duda CV)

### Deployado HOY

- Backend a Development (productivo)
- `FILESTORE_CV_FOLDER_ID = 28606000000921306` setada por Cris (resolvió bug de apply)
- Spec B Fase 2 ejecutado end-to-end con 10 candidatos sintéticos:
  - Apply + Prefilter + Técnica + DISC + VELNA + Emoción + Integridad + Mindset + Inglés → todos pasan
  - autoRejection con dimensiones de Integridad → funciona
  - needs_review (Duda CV) viniendo del backend → funciona
- Test job + 10 candidatos sintéticos → cleanup OK (wipe-all-test-data)

---

## 🔴 Pendiente AHORA — Cris

1. **Subir zip nuevo** que está listo: `shark/sharktalents-frontend-0.1.0.zip`
   - Catalyst Console → Cloud Scale → Web Client Hosting → Upload
   - Activa: PipelineDashboard como default + favicon + voseo limpio + Comparativo

---

## 🟡 Pendientes operativos

### 1. Correos del candidato — refactor completo

**Problema actual** (observado por Cris hoy):
- El correo inicial lista TODAS las pruebas (Conductual + Integridad + Técnica)
- Debería decir SOLO "Comienza tu prueba técnica"

**Diseño deseado**:
- Apply → correo "Comienza tu prueba técnica" (solo técnica)
- Pasa técnica → correo "Comienza Conductual"
- Pasa Conductual → correo "Comienza Integridad"
- etc.

**Archivos a tocar**:
- `functions/api/src/lib/emailTemplates.ts` — separar la plantilla actual en 4-5 plantillas distintas
- `functions/api/src/features/publicTest.ts` — disparar el email correcto al pasar cada fase
- Hay voseo en la plantilla actual ("Podés") — limpiar

**Tiempo estimado**: 3-4h

### 2. Pendiente investigar: UX del Prefilter

**Pregunta de Cris**: ¿el prefilter es link aparte o sale al registrarse?

Estado: el código del backend tiene los endpoints. Hay que verificar el frontend (`CandidateApply.tsx` + `CandidatePrefilter.tsx`) para confirmar el flujo real. Posible que se redirija al prefilter inmediatamente después del apply.

### 3. Bug observado en spec E2E (no urgente)

- Los Medios solo llegaron a step 3 de 6
- Los Malos solo llegaron a step 1-2 de 6
- Hipótesis: algún endpoint (Inglés? Mindset?) falla con shape específico
- El flow básico de los Buenos (6/6 pasos) sí funciona

**Tiempo estimado**: 1-2h para encontrar y arreglar

### 4. buena_impresion umbral muy estricto

Incluso los candidatos "Buenos" del spec quedaron en `needs_review` por observación en `buena_impresion`. Posiblemente el umbral es demasiado estricto.

**Tiempo estimado**: 30 min para ajustar umbrales

---

## 🟢 Video — la pieza grande

### Decisión pendiente

**Servicio de transcripción**:
- OpenAI Whisper ($0.006/min, requiere `OPENAI_API_KEY`)
- ElevenLabs Scribe ($0.0067/min, ya tenés cuenta ElevenLabs)
- Deepgram ($0.0043/min, cuenta nueva)

### Implementación pendiente (~25h)

- Endpoint público `POST /jobs/:id/video-questions/generate` (1h)
- Tabla `VideoQuestions` en Catalyst (manual, 10 min)
- UI candidato grabar (8h)
- UI admin aprobar preguntas (4h)
- Score 1-10 IA comparando transcripción vs respuesta correcta (4h)
- Detección de evasivas (3h)
- Orquestación async (transcripción >30s, no entra en handler HTTP) (2h)
- Tests E2E (3h)

---

## 🟢 Mejoras nice-to-have

- **Niveles de comparación del puesto** (Operativo/Coordinación/Gerencial/Dirección estilo Kudert) — 3-4h
- **Mindset mismatch alert** cuando el puesto pide perfil específico — 2-3h
- **Refactor situacional 4→2 opciones** (eliminar rechazo por estilo) — 5-6h, decisión final
- **Bot decisor con doble eje (Me5)** — 2-3h + columnas Catalyst
- **Opción B exchange-token** del flujo de demo gratuita — Cristian la migra cuando quiera

---

## 🟢 Validaciones pendientes (no requieren código)

- **Capa 4 IA con candidato real**: en `docs/pruebas-pendientes.md`. Necesita un candidato real con scores completos para probar el análisis IA contextual
- **Probar la vista nueva del Pipeline en producción**: después que Cris suba el zip, navegar a `JobDetail` y validar que se ve bien
- **Probar el Comparativo de finalistas**: URL `/jobs/<id>/comparar?candidates=id1,id2,id3,id4`
- **Probar JobForm con bloque VELNA por dimensión**: confirmar que se ve bien y guarda OK

---

## Memorias actualizadas hoy

- `project_reglas_pipeline_candidato.md` — fuente de verdad de las reglas (las 6 fases, autoRejection, Capa 4)
- `project_competencias_catalogo_cerrado.md` — 5 aliases consolidados
- `reference_backend_urls.md` — recordatorio del doble `/api/api/`
- `feedback_trabajo_paralelo_y_entrega_resultados.md` — regla de trabajo en paralelo

---

## Stats del día

- **107+ tests nuevos** pasando (35 velna + 13 Me2 + 25 Video Pieza 1 + 21 Video Pieza 2 + 19 Kudert aliases)
- **19 tests pre-existentes** arreglados (de fallidos a pasando)
- **3 subagentes background** ejecutados en paralelo
- **2 deploys backend** + **2 builds frontend**
- **Cero contacto con flujo comercial** (verificado)
- **Cero datos productivos perdidos** (cleanup limpio)
