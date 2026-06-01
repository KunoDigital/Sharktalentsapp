# 22b — Embudo de Headhunting (Fase 2 — diferida)

**Estado:** decisión tomada el 2026-05-13, ejecución postpuesta a Fase 2.
**Por qué se difiere:** la implementación técnica del video screening automático tiene riesgos (conversión baja del primer DM, fricción para el candidato pasivo, IA sin perfil de referencia claro). El equipo prefiere validar el flow manualmente con una persona dedicada antes de automatizar.

**Contexto:** los jefes de Cris probaron el flow manual (14 entrevistas en una semana para 1 puesto). El insight es válido — candidatos pasivos no responden bien si se les manda directo a pruebas formales — pero el formato manual no escala más allá de 2-3 puestos simultáneos.

---

## Decisión

**Fase 2 — Persona dedicada hace las mini-entrevistas iniciales**, no automatizamos el video screening por ahora. La persona:

1. Hace el sourcing en LinkedIn (manual o asistido por HeyReach)
2. Manda el primer DM personalizado al candidato pasivo
3. Si responde, coordina una **mini-entrevista corta (15-20 min)** por video
4. Graba la sesión (Zoom/Google Meet/Zoho Meeting)
5. Pasa al pipeline de SharkTalents SOLO los candidatos que considera viables después de la conversación

**Cuándo se retoma la automatización:** después de:
- Validar que el flow manual da resultados consistentes (tasa de candidatos viables ≥30% después de entrevista)
- Tener volumen suficiente que justifique automatizar (al menos 5-10 puestos simultáneos con flow de pasivos activo)
- Datos para entrenar el filtro IA con video real

---

## Lo que SÍ se construye en Fase 1 (ahora)

Aunque el video screening automatizado queda diferido, hay piezas que sí se hacen ya porque sirven al flow manual:

### 1. Source tracking en candidatos
Columna `source` en `Candidates`: `linkedin_outbound`, `landing_apply`, `pool_interno`, `referral`. La persona dedicada marca manualmente cuando carga un candidato del headhunting.

### 2. Templates de DM en LinkedIn
Conjunto de templates personalizables que la persona usa para el primer touchpoint. **Críticos:**
- Mensaje específico (nombre del puesto + empresa + rango salarial visible + skill match)
- NO genérico — los DMs frios genéricos tienen <5% de respuesta

### 3. Métricas de funnel headhunting
Dashboard que cuenta:
- DMs enviados
- Respuestas positivas (% conversión del primer DM)
- Entrevistas realizadas
- Candidatos que pasaron a pruebas formales
- Candidatos finalistas

Sin esto no podemos decidir cuándo automatizar.

### 4. Pipeline interno diferenciado
Los candidatos `linkedin_outbound` arrancan en un pre-stage especial:
- `outreach_sent` → DM enviado, esperando respuesta
- `outreach_responded` → candidato respondió positivo
- `screening_call_done` → mini-entrevista completada por la persona dedicada
- A partir de acá entra al pipeline normal (`prefilter_pending` o saltea a `tecnica_completed` si la persona decide)

### 5. Diferenciación en el reporte final al cliente
Ranking unificado con columna `expectativa_salarial` y badge sutil tipo "🔍 Cazado para vos" en los `linkedin_outbound`. **No** dos secciones separadas (eso baja valor percibido, ver doc `docs/embudo-headhunting-analisis.html`).

---

## Lo que queda para Fase 2

### 1. Video screening asíncrono (reemplazo del prefiltro)
Cuando el flow manual esté validado, automatizamos el screening. **NO como primer touchpoint** — sino como reemplazo del prefiltro tradicional, después de que el candidato ya mostró interés.

Flow:
- Candidato responde positivo al DM → recibe link al video screening
- Graba 3 preguntas (configurables por job): experiencia, situación actual, expectativa
- IA analiza contra el `ideal_profile` del Job específico
- Si pasa → manda link a pruebas formales
- Si no pasa → mensaje diplomático + lo deja en pool para futuros jobs

### 2. Integración HeyReach
Automatización del envío de DMs en LinkedIn con sequences. Decisión: invertir esto SOLO cuando los templates manuales hayan demostrado >15% de conversión. Antes es prematuro.

### 3. IA conversacional para qualifying
Si Cris quiere, una segunda etapa de Fase 2 podría tener un bot conversacional (texto, no video) que hace el qualifying inicial automáticamente vía WhatsApp o LinkedIn. Pero esto requiere modelo entrenado en su tipo de conversación — no se hace bien con prompt engineering simple.

---

## Cómo medir éxito del flow manual

Antes de pasar a Fase 2 (automatización), necesitamos números:

| Métrica | Mínimo aceptable | Por qué |
|---|---|---|
| Tasa respuesta primer DM | >15% | Si es menor, el problema es el mensaje (no el flow). Re-iterar templates antes de automatizar. |
| Tasa conversión a entrevista | >50% de los que responden | Si los que dicen "sí me interesa" después no aparecen, hay fricción en el calendar/coordinación. |
| Tasa de viables post-entrevista | >30% | Si menos de 1/3 son viables, el sourcing está mal targeted. La automatización IA va a heredar el problema. |
| Tasa de contratación final | >5% del top del funnel | Validación última. Si los headhunteados no se contratan más que los activos, no vale el esfuerzo. |

Cuando los 4 estén verdes durante 3 meses con la persona dedicada, **ahí sí** automatizamos.

---

## Referencias

- Análisis estratégico completo: [docs/embudo-headhunting-analisis.html](../embudo-headhunting-analisis.html)
- Doc original outbound sourcing: [docs/master-plan/22_OUTBOUND_SOURCING.md](22_OUTBOUND_SOURCING.md)
- Configuración Zoho CRM: [docs/zoho-crm-setup-guide.md](../zoho-crm-setup-guide.md)
