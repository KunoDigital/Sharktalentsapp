# Mejoras Pendientes — SharkTalents

Archivo para documentar mejoras identificadas que se implementarán cuando los puestos actuales terminen o en futuras versiones. No modificar lo que está en producción hasta que se indique.

---

## 1. DISC v2 — Corrección de mapeo de preguntas

**Estado:** Pendiente — implementar cuando terminen los puestos actuales
**Impacto:** ~6% de opciones con mapeo cuestionable (9 de 160)
**Archivo afectado:** `functions/sharktalents/seeds/disc.json`

### Opciones a corregir:

| Pregunta | Opción | Texto actual | Asignada | Debería ser | Acción |
|----------|--------|-------------|----------|-------------|--------|
| d1-B | "Le explico lo que tengo y le propongo qué puedo mover para cumplir" | C | D o I | Reescribir para que sea C: ej "Reviso mis pendientes y hago una lista de prioridades para reorganizar" |
| d1-C | "Le pido que me ayude a decidir qué es más importante" | I | S | Reescribir para que sea I: ej "Hablo con mi jefe para convencerlo de ajustar los plazos" |
| d6-B | "Observo cómo funcionan las cosas antes de hablar mucho" | D | C o S | Reescribir para que sea D: ej "Busco al jefe para presentarme y preguntarle qué necesita de mí ya" |
| d15-C | "Pido ayuda a alguien para dividir el trabajo" | I | S | Reescribir para que sea I: ej "Motivo a compañeros para que entre todos saquemos el trabajo" |
| d18-B | "Voy preguntando a cada uno qué piensa" | S | I | Reescribir para que sea S: ej "Espero pacientemente a que alguien se anime a hablar primero" |
| d31-B | "Me motivo y doy todo para sacar todo adelante" | I | D | Reescribir para que sea I: ej "Animo al equipo para que entre todos saquemos el trabajo adelante" |
| d34-A | "Me anoto de inmediato, quiero participar y que me vean" | D | I | Reescribir para que sea D: ej "Me anoto porque quiero liderar la actividad y organizarla" |
| d36-C | "Acepto solo si no afecta mis propias cosas" | I | D o C | Reescribir para que sea I: ej "Acepto porque quiero mantener buena relación con mi compañero" |
| d38-D | "Me mantengo al margen a menos que me pidan ayuda" | C | S | Reescribir para que sea C: ej "Analizo la situación objetivamente y propongo una solución si me preguntan" |

### Plan de implementación:
1. Crear `disc_v2.json` con las correcciones
2. Modificar `loadQuestions.ts` para que puestos nuevos usen v2
3. Los puestos existentes siguen con v1 (sus resultados no se tocan)
4. Recalcular DISC de candidatos nuevos no es necesario — v2 se aplica desde la prueba

---

## 2. Normalización DISC

**Estado:** Pendiente de evaluación
**Detalle:** Actualmente usamos raw × 5 (cap 100) para normalizar DISC. Kudert usa un algoritmo propio más sofisticado con selección de palabras, doble perfil (natural/adaptado) y situaciones con imágenes. Nuestra normalización es una aproximación.
**Consideración:** Evaluar si vale la pena implementar una normalización más sofisticada o si el patrón actual es suficiente.

---

## 3. Subida de curriculum PDF al reporte

**Estado:** Pendiente
**Detalle:** El reporte para cliente necesita poder adjuntar el CV del candidato. Requiere integrar Catalyst File Store para subir/descargar PDFs.
**Archivos afectados:** `adminReports.ts`, `publicReport.ts`, `ReportPreparation.tsx`, `ClientReport.tsx`

---

## 4. Preguntas de entrevista sugeridas

**Estado:** Pendiente
**Detalle:** En el HTML de referencia (portal_cliente_sharktalents.html) cada candidato tiene preguntas sugeridas para la entrevista basadas en sus resultados. Claude puede generarlas con contexto del puesto + debilidades detectadas.

---

## 5. Bonus de ganancia en VELNA numérica

**Estado:** Descartado por equidad
**Detalle:** Se consideró dar 2 puntos (en vez de 1) por acertar preguntas de tabla de ganancia. Se descartó porque afectaría solo a candidatos nuevos y sería injusto con los existentes.

---

## 6. Descarga de Excel con datos de candidatos

**Estado:** Pendiente
**Detalle:** Botón para descargar un Excel (CSV) con todos los datos numéricos de los candidatos de un puesto: DISC raw y normalizado, cognitivo por dimensión, emocional, técnica, integridad por dimensión, y las 54 competencias con sus scores. Similar a la matriz de Kudert. Sirve para auditar que los cálculos del comparativo son correctos.
**Ubicación sugerida:** Botón en CompareView o JobDetail
**Columnas:** Nombre, Email, D, I, S, C, D_norm, I_norm, S_norm, C_norm, PK, Verbal, Espacial, Lógico, Numérico, Abstracto, IC, Emoción_score, Emoción_perfil, Técnica_%, Integridad_overall, Integridad_%, + 9 dimensiones integridad + 54 competencias

---

## 7. Preguntas de entrevista sugeridas en el reporte

**Estado:** Pendiente
**Detalle:** En la vista de perfil completo del reporte para el cliente, agregar una sección de preguntas sugeridas para la entrevista. Cada pregunta debe estar basada en las debilidades o áreas de observación del candidato (ej: si tiene alerta en soborno, sugerir una pregunta que explore eso). Claude las genera con contexto del puesto + datos del candidato. Formato: pregunta + qué evalúa (como en el HTML de referencia portal_cliente_sharktalents.html).

---

## 8. Competencias en el reporte del cliente (perfil completo)

**Estado:** Pendiente
**Detalle:** En la vista de perfil completo del reporte para el cliente, agregar una sección de competencias que muestre las competencias del puesto con su ponderación y una explicación de cada una. Mostrar cómo está el candidato vs lo esperado con una visualización clara (barras o escala tipo la que usamos en el comparativo).

---

## Fecha de creación: 2026-04-07
## Última actualización: 2026-04-07
