# 27 — Reglas del pipeline candidato (CORE BUSINESS LOGIC)

**Última actualización**: 2026-06-16
**Estado**: Reglas todas confirmadas con Chris Palma (2026-06-12) e implementadas en código.

Documento de referencia oficial. Antes de tocar `pipelineStateMachine.ts`, `applicationAdapter.ts`, `autoRejection.ts` o cualquier UI del pipeline → leer esto.

---

## 1. Estructura del pipeline

**6 fases secuenciales**:

```
Prefiltro → Técnica (Tec + Inglés + Mindset, bloque continuo) → Conductual → Integridad → Video → Finalistas
```

**4 sub-estados por fase**:
- Completado
- Siguiente Etapa
- Rechazado
- Duda CV

**Excepción Finalistas**: tiene su propio sub-estado "Llamar a entrevista".

---

## 2. Reglas por fase

### 2.1 Prefiltro

- Preguntas custom del cliente al armar el perfil
- **Si NO cumple alguna → Rechazado (auto)**
- **Si cumple todas → pasa a Técnica**

Ejemplos reales:
- Aryan: "¿Practicas religión cristiana, católica o evangélica?"
- Zona Libre: "¿Aceptas salario de USD X?" + "¿Estás dispuesto a viajar L-V a Colón?"

### 2.2 Técnica — bloque continuo (Tec + Inglés + Mindset)

Los 3 tests viven dentro del mismo link, secuencialmente. Pausa opcional 5 min entre cada uno o avanzar inmediatamente (mismo patrón UX que VELNA+DISC+Emoción ya implementado).

**Transición única**: cuando los 3 que aplican terminan → `pipeline_stage = 'tecnica_completed'`.

#### Test Técnico (25 preguntas total: 13 técnicas + 12 situacionales)

- **13 preguntas técnicas** (conocimiento del rol):
  - Por debajo del puntaje mínimo del puesto → **Rechazado (auto)**
- **12 preguntas situacionales** (cómo reacciona):
  - **NO rechaza por ESTILO** (diferentes estilos válidos no son fallo)
  - **SÍ rechaza si elige respuestas "malas"** (acciones claramente problemáticas/dañinas)
  - Ejemplo de respuesta mala: "Robar de la caja", "Sabotear el trabajo"

**Propuesta pendiente** (Chris 2026-06-12): simplificar 12 situacionales a SOLO 2 opciones (activa/reactiva) eliminando posibilidad de rechazo. Pendiente decisión final.

#### Test de Inglés (solo si el puesto lo activó)

- Por debajo del mínimo → **Duda CV** (NO auto-rechazo)
- Razón: el inglés puede ser deseable, no siempre obligatorio. Recruiter decide.

#### Test de Mindset (solo si el puesto lo activó)

**🚨 REGLA CRÍTICA**: Mindset **NUNCA rechaza ni va a Duda CV**. Es 100% informativo.

- Candidato SIEMPRE pasa el test
- El recruiter ve el perfil (Adaptable/Mixto/Rígido) en la card como info adicional
- Uso real: el recruiter usa Mindset al decidir entre finalistas
- En UI: badge 🧠 siempre verde con el perfil real (nunca rojo)

### 2.3 Conductual (DISC + VELNA + Emoción)

**🚨 MODELO**: Análisis IA contextual, NO umbrales binarios.

- DISC + VELNA + Emoción **NO auto-rechazan** por umbrales
- La IA recibe el contexto específico del puesto (`context_summary`, competencias requeridas, boss profile) y genera análisis honesto
- Veredicto: `encaja` / `encaja_con_reservas` / `no_encaja`
- El recruiter SIEMPRE decide al final viendo el análisis IA + CV + video

**Por qué**: no existe "perfil ideal universal". Vendedor de Apple (necesita C alto, técnico) vs vendedor de productos femeninos (necesita S/I empático) — mismo título, perfiles opuestos según contexto.

**Capa 4 implementada**: `lib/conductualAnalysis.ts` + endpoint `GET /api/applications/:id/conductual-analysis`.

### 2.4 Integridad

**13 dimensiones evaluadas**:

| Grupo | Dimensiones |
|---|---|
| Riesgo conductual | hurto, soborno, drogas, alcohol, apuestas |
| Carácter | honestidad, confiabilidad, imparcialidad, autenticidad, sencillez, dominio_personal, inteligencia_social |
| Validación | buena_impresion (detecta fingimiento) |

**Reglas de auto-rechazo (5 dimensiones)**:

🔴 Si CUALQUIERA queda en `'bajo'` (= riesgo alto) → **Rechazado (auto)**:
1. Hurto
2. Soborno
3. Drogas
4. Alcohol
5. Confiabilidad

**Reglas de Duda CV (8 dimensiones)**:

🟡 Si CUALQUIERA queda en `'bajo'` → **Duda CV** (recruiter decide):

- Honestidad
- Imparcialidad
- Autenticidad
- Sencillez
- Dominio_personal
- Inteligencia_social
- Apuestas
- buena_impresion

**Bastan 1 sola dimensión** en bajo para disparar la regla.

**🚨 REGLA DE NAMING confirmada**: Backend y frontend usan vocabulario OPUESTO.

| Backend (`scoring.ts`) | Frontend (UI) | Color | Significado humano |
|---|---|---|---|
| `classification: 'bajo'` (pct bajo) | **🔴 RIESGO ALTO** | Rojo | Mucho riesgo |
| `classification: 'medio'` | **🟡 RIESGO MEDIO** | Amarillo | Observaciones |
| `classification: 'alto'` (pct alto) | **🟢 SIN RIESGO** | Verde | Limpio |

NO se invierte el backend porque cambiar el código rompe tablas Scores existentes con datos productivos. La capa de traducción vive en `applicationAdapter.ts` o en el componente de Integridad del frontend.

### 2.5 Video — Entrevista en video con análisis IA

**Cuándo se manda el link**:
- Automático cuando el candidato pasa Integridad sin alertas
- Manual cuando el recruiter pasa un candidato desde Duda CV a la siguiente fase

**Generación de preguntas**:
- IA genera (mix técnicas + conductuales + integridad)
- Cris aprueba/edita cada pregunta antes de enviar
- Cada pregunta lleva justificación interna (qué evalúa, por qué) visible solo al admin
- 5-7 preguntas, 60-90 seg por respuesta
- Una pregunta a la vez con timer (anti-fraude)

**Validación de identidad**: pregunta 1 obligatoria — "Presentate diciendo tu nombre completo y por qué te interesa el puesto" (anti grabación pre-hecha).

**Análisis IA**:
1. Transcripción del audio (Whisper)
2. Comparación de transcripción vs "respuesta correcta interna" → score 0-10
3. Detección de evasivas (candidato que da vueltas sin responder)
4. Síntesis final: lista de "cosas buenas" + "cosas malas/observaciones"

**Acción sobre pipeline**: 🟢 **100% informativo, NUNCA rechaza** (por ahora). Recruiter decide. Cuando el bot decisor "aprenda" con data acumulada, se podrá habilitar auto-rechazo por umbrales.

**Costo estimado**: ~$0.20/candidato. 10 finalistas/puesto = ~$2 (debajo del 20% del fee).

**Pendiente decisión**: servicio de transcripción (OpenAI Whisper vs ElevenLabs Scribe vs Deepgram).

### 2.6 Finalistas

- El recruiter llama y decide si presentar al cliente
- Sub-estado único: "Llamar a entrevista"
- Esta es la fase donde el recruiter humano hace el trabajo principal

---

## 3. VELNA por dimensión (cada puesto define sus umbrales)

**🚨 REGLA CRÍTICA**: NO hay reglas hardcoded por tipo de puesto ("vendedor siempre verbal alto"). Cada **draft del puesto** define explícitamente:

- Qué dimensiones VELNA son críticas
- Qué umbral mínimo tiene cada una

Ejemplos:
- Contable → Numérica crítica con umbral 70%
- Vendedor → Verbal crítica con umbral 65%
- Asistente operativo → ninguna VELNA crítica

**Backend**: `auto_rejection_rules.velna_per_dimension: { verbal?, espacial?, logica?, numerica?, abstracta? }` (cada uno opcional).

**Frontend**: sección "VELNA por dimensión" en el JobForm (implementada 2026-06-16) permite a Cris setear los umbrales que tenga sentido para cada puesto.

**Aclaración del modelo VELNA**: VELNA verbal mide **razonamiento verbal** (sinónimos, antónimos, comprensión), NO oratoria. Un candidato puede ser persuasivo con verbal bajo. La metodología Kudert lo refleja en los factores agregados de cada competencia.

---

## 4. Cálculo de competencias

**Modelo Kudert** (basado en McBer, Martha Alles, Lominger, Foro Económico Mundial):

- 54-57 competencias en catálogo cerrado
- Cada competencia tiene un array de **factores** que aportan: DISC + cognitivos + emocionales
- Score = **promedio simple** de los factores

**Limitación conocida**: el promedio simple NO está validado por la certificación oficial — es la mejor aproximación con la información disponible. Si en el futuro Chris consigue la fórmula exacta de la certificación, se puede refinar.

**"Destaca en:"** funcionalidad heredada de V1 — lista competencias del candidato con score >75% que NO están en el perfil ideal del puesto. Abre la puerta a "este no encaja acá, pero quizás encaja en otro puesto abierto". Umbral configurable por puesto (no global como en V1).

**Análisis contextual (Capa 4)**: la IA recibe scores Capa 1 (competencias) + Capa 2 (match vs ideal) + Capa 3 (destaca en) + context_summary del puesto y genera el veredicto. Reemplaza el análisis manual que hace Cris hoy.

---

## 5. Resumen visual: qué dispara cada estado

| Fase / Test | Falla → | Razón |
|---|---|---|
| Prefiltro | 🔴 Rechazado (auto) | Cliente filtró desde el inicio |
| Técnico (13 preg.) | 🔴 Rechazado (auto) | Sin conocimiento mínimo del rol |
| Situacional (12 preg.) | 🔴 Rechazado solo si respuestas dañinas | Estilo distinto NO rechaza |
| Inglés | 🟡 Duda CV (manual) | Puede ser deseable, no obligatorio |
| Mindset | 🟢 Siempre pasa | Solo informativo |
| Conductual (DISC+VELNA+Emo) | 🟢 Siempre pasa | Análisis IA contextual, no umbrales |
| Integridad — 5 hard rejects | 🔴 Rechazado (auto) | Hurto/Soborno/Drogas/Alcohol/Confiabilidad |
| Integridad — 8 dudas | 🟡 Duda CV (manual) | Las otras dimensiones |
| Video | 🟢 Pendiente si no graba | No rechaza por ahora |
| VELNA por dimensión | 🔴 Rechazado (auto) si setado | Cada puesto define cuáles son críticas |

---

## 6. Cambios implementados 2026-06-16

| Cambio | Archivo | Estado |
|---|---|---|
| `autoRejection.ts` extendido con 5 hard rejects Integridad + 8 duda CV | `lib/autoRejection.ts` | ✅ Deploy a Development |
| `autoRejection.ts` Inglés bajo → Duda CV (no rechazo) | `lib/autoRejection.ts` | ✅ Deploy a Development |
| `velna_per_dimension` agregado a `auto_rejection_rules` | `features/jobs.ts` + `lib/autoRejection.ts` + 8 tests nuevos | ✅ Tests pasan, deploy pendiente |
| Capa 4 IA Conductual contextual | `lib/conductualAnalysis.ts` + `features/applications.ts` + endpoint nuevo | ✅ Deploy a Development |
| Frontend velna UI en JobForm | `pages/JobForm.tsx` + `lib/jobAdapter.ts` + tipo `AutoRejectionRules` | ✅ Build limpio |
| PipelineDashboard nuevo (tabla densa + tablero) | `components/PipelineDashboard.tsx` | ✅ Con feature flag `?new-pipeline=true` |
| 3 badges Téc/Inglés/Mindset en card | `pages/JobDetail.tsx` + adapter | ✅ |
| Comparativo de finalistas reescrito | `pages/Comparativo.tsx` + botón en PipelineDashboard | ✅ |
| Backend Video Pieza 1 (preguntas IA) | `lib/videoQuestionGen.ts` + 25 tests | ✅ Implementado, no deployado |
| Backend Video Pieza 2 (transcripción) | `lib/videoTranscription.ts` + 21 tests | ✅ Implementado, no deployado (pendiente decidir servicio) |
| Spec B Fase 2 E2E (10 candidatos) | `tests/e2e/spec-b-candidatos-fase2.spec.ts` | ✅ Sintaxis validada, no corrido en local |

---

## 7. Cosas que todavía faltan

### Decisión pendiente de Chris

- **Servicio de transcripción** para Video (OpenAI Whisper vs ElevenLabs Scribe vs Deepgram)
- **Refactor situacional 4→2 opciones** (eliminar rechazo por estilo)
- **Mindset "perfil deseado"** del puesto (campo nuevo en draft para detectar mismatch)
- **Niveles de comparación** del puesto (Operativo/Coordinación/Gerencial/Dirección estilo Kudert)

### Por implementar

- Video completo (UI candidato grabar, score 1-10, detección evasivas, tabla `VideoQuestions`, orquestación async)
- Endpoint público de generación de preguntas Video
- Bot decisor con doble eje (Me5)
- Limpieza de candidatos huérfanos en prefilter (M2)

### Validaciones pendientes

- Capa 4 IA con candidato real (anotada en `docs/pruebas-pendientes.md`)
- PipelineDashboard local con `npm run dev`
- Spec B Fase 2 con backend local + puesto con prefilter + técnicas generadas

---

## 8. Memorias relacionadas

- `project_reglas_pipeline_candidato.md` — fuente de verdad, actualizada con cada decisión
- `project_disc_per_axis_0_100.md` — modelo DISC per axis
- `project_competencias_catalogo_cerrado.md` — 54 competencias Kudert
- `project_doble_eje_modelo_confirmado.md` — 12 técnicas + 13 situacionales
- `project_presupuesto_20_porciento.md` — cap del 20% del fee
- `feedback_usar_tu_no_vos.md` — tuteo neutral LatAm
