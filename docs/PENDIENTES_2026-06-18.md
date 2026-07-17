# Pendientes — Snapshot 2026-06-18

Roadmap del proyecto SharkTalents V2. Reemplaza a `PENDIENTES_2026-06-16.md`.

---

## ✅ Cerrado HOY (2026-06-18)

- **Bug Spec E2E descubierto**: el spec leía `body.tecnica.passed` que no existe en el response — el backend funciona OK, el spec mentía. Arreglado para que consulte `pipeline_stage` real vía `/test/<token>`.
- **Spec 4 candidatos con nombres reales** (`spec-4-candidatos-cris.spec.ts`): Luis Bueno + Andrea Bueno + Marta Medio + Patricia Medio funcionando contra producción.
- **PipelineDashboard rediseñado**: dark mode + sub-columnas dentro de banda + cards con scores numéricos + 3 badges Téc/Inglés/Mindset.
- **Mindset como slider** `R ←—●—→ A` en cards (sustituye al texto "Adaptable/Mixto/Rígido" que no era visual).
- **PipelineDashboard como DEFAULT** (eliminado el feature flag `?new-pipeline=true`).
- **Fix bug fase**: candidatos `prefilter_passed` sin actividad técnica se quedan en Prefiltro (antes saltaban falsamente a Técnica).
- **Fix badges**: siempre se muestran los 3 (con `⏳` placeholder o `—` cuando no aplica).
- **Favicon 🦈** aleta + ondas verde lima.
- **Endpoint `_diag-create-e2e-test-job`**: crea puesto Test E2E con un POST sin tener que llenar el JobForm.
- **Perfil de cargo aprobado visible en JobDetail** (`JobIdealProfilePanel.tsx`): contexto + responsabilidades + DISC + VELNA + competencias + boss + reglas de auto-rechazo + meta. Resuelve el bug que Cris reportó hoy 2026-06-18.

---

## 🟡 Pendientes priorizados

### 🔴 BLOQUEA primer cliente real

1. **Bug correos del candidato — refactor completo** (3-4h)
   - El correo inicial lista TODAS las pruebas en vez de decir "Comienza tu prueba técnica" únicamente.
   - Cada fase debería disparar un correo específico cuando el candidato avanza.
   - Archivos: `lib/emailTemplates.ts` + `features/publicTest.ts`.
   - Hay voseo argentino en plantillas existentes (`Podés`) — limpiar.

2. **UX del Prefilter** (30 min audit + decisión)
   - ¿Es link aparte que llega por correo? ¿O sale inline después del apply?
   - Verificar en `CandidateApply.tsx` + `CandidatePrefilter.tsx`.

3. **Investigar comportamiento del Comparativo** (30 min)
   - `Comparativo.tsx` está implementado pero nunca se ha probado con 3-4 candidatos reales.
   - Validación visual pendiente: ¿cómo se ve el doble eje técnico? ¿Cards llenan bien? ¿Excel export funciona?

### 🟡 Bloquea operación normal pero no urgente

4. **Umbral `buena_impresion` demasiado estricto** (30 min)
   - Hasta los "buenos" del spec caen en `needs_review` (Duda CV) por observaciones en buena_impresion.
   - Ajustar el umbral en `lib/scoring.ts` `INTEGRITY_THRESHOLDS.buena_impresion`.

5. **Bug del spec E2E original — algunos candidatos no completan todos los pasos** (1-2h)
   - Medios solo llegaban a step 3 de 6; Malos a 1-2.
   - Hipótesis: algún endpoint (Inglés? Mindset?) falla con shape específico.
   - **Estado HOY**: revisado con spec nuevo de 4 candidatos. Funciona correcto.
   - Verificar con candidatos reales si surge.

### 🟢 Video — pieza grande (~25h restantes)

6. **Decisión pendiente del servicio de transcripción**:
   - OpenAI Whisper ($0.006/min, necesita cuenta + API key)
   - ElevenLabs Scribe ($0.0067/min, ya tienes cuenta)
   - Deepgram ($0.0043/min, cuenta nueva)

7. **Implementación pendiente del Video**:
   - Endpoint público `POST /jobs/:id/video-questions/generate` (1h)
   - Tabla `VideoQuestions` en Catalyst (manual, 10 min)
   - UI candidato grabar (8h)
   - UI admin aprobar preguntas (4h)
   - Score 1-10 IA comparando transcripción vs respuesta correcta (4h)
   - Detección de evasivas (3h)
   - Orquestación async (transcripción >30s, no entra en handler HTTP) (2h)
   - Tests E2E (3h)

### 🟢 Mejoras nice-to-have (no bloquean)

8. **Niveles de comparación del puesto** (Operativo/Coordinación/Gerencial/Dirección estilo Kudert) — 3-4h
9. **Mindset mismatch alert** cuando el puesto pide perfil específico — 2-3h
10. **Refactor situacional 4→2 opciones** (eliminar rechazo por estilo) — 5-6h, requiere decisión final
11. **Bot decisor con doble eje (Me5)** — 2-3h + columnas Catalyst nuevas
12. **Filtros completos en PipelineDashboard** (search input, filter chips, Exportar CSV) — 2-3h
13. **Job header completo** (selector dropdown de puestos + pills + metadata grid) — 2-3h

---

## 🟢 Validaciones que NO requieren código

- **Capa 4 IA con candidato real**: `docs/pruebas-pendientes.md`. Necesita un candidato con scores completos para probar el análisis IA contextual.
- **PipelineDashboard con 4+ candidatos reales en distintas fases**: validar todas las bandas, sub-columnas, badges, slider Mindset.
- **Comparativo de finalistas**: probar con 2-4 candidatos reales que lleguen a Finalistas. URL: `/jobs/<id>/comparar?candidates=id1,id2,id3,id4`.
- **JobForm bloque VELNA por dimensión**: confirmar que se ve bien y guarda OK.
- **Perfil de cargo visible** (nuevo HOY): validar visualmente al entrar al puesto.

---

## Stats acumuladas

- 8 deploys del backend en últimos 3 días
- 7 builds frontend
- ~1100+ tests pasando
- 19 tests pre-existentes arreglados
- Cero contacto con flujo comercial (verificado)
- Memorias actualizadas: reglas pipeline + catálogo competencias + URLs backend + trabajo paralelo
