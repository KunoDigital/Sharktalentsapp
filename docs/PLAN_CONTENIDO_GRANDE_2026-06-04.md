# Plan — contenido grande organizado (transcripciones, drafts, reports)

## Lo que pediste vs. lo que hay hoy

**Lo que pediste:**
> Cuando pego o llega una transcripción larga, que se convierta en archivo JSON, se guarde en el File Store, y desde la tabla se llame con un ID. Que esto pase con TODOS los textos largos. Y que se organice en carpetas con un sistema de ID consistente.

**Lo que ya hay (sorpresa, está más avanzado de lo que esperábamos):**

Hace ~1 mes ya armamos un sistema que hace casi todo eso:

- **Archivo**: [functions/api/src/lib/largeContentStore.ts](functions/api/src/lib/largeContentStore.ts).
- **Cómo funciona hoy**: cada vez que el código intenta guardar un texto >9.500 caracteres, automáticamente lo sube al File Store y guarda en la columna solo una referencia tipo `file:ABC123`. Cuando se lee, detecta esa referencia y lo baja del File Store. Si el texto entra en 9.500, lo deja inline (rápido, no toca File Store).
- **Dónde se usa hoy**: transcripciones de Zia, borradores de perfil del puesto (draft + transcript), preguntas técnicas IA generadas para el puesto, reportes para el cliente (bundle), briefings.

**Lo que falta vs. tu pedido:**

| Pedido | Estado |
|---|---|
| Texto largo → JSON → File Store → llamar por ID | ✅ Ya está, en los 5 lugares más importantes |
| Que aplique cuando vos pegás transcripción en el admin | ⚠️ Existe el endpoint que lo persiste bien, **falta verificar que la UI tenga un campo donde pegues** |
| Que aplique a TODOS los textos largos | ⚠️ Hay otros 5-6 campos que hoy guardan inline pero podrían crecer (notas del candidato pool, análisis IA del video, mensajes outbound LinkedIn) |
| Carpetas organizadas con sistema de IDs | ❌ Esto NO está. Todo va a un folder único llamado "largecontent" con un nombre plano tipo `JobProfileDrafts_transcript_zia__1717525800000.txt`. No se puede entender visualmente qué cliente/qué puesto/qué fecha solo mirando el nombre. |

---

## Roadmap por fases

### Fase 1 — Confirmar que el flujo de "Cris pega transcripción en el admin" funciona (~20 min)

Es la parte que más te urge. Probablemente el endpoint ya está bien, solo falta verificar la UI.

### Fase 2 — Reestructurar el naming/organización (~1-1.5 horas)

Para que los archivos del File Store sean encontrables. Implica decisión tuya sobre el esquema de nombres.

### Fase 3 — Cobertura: pasar otros 5-6 campos al mismo patrón (~1-2 horas)

Para que ningún campo de texto pueda hacer crashear el guardado por exceso de largo. No urgente — solo aplica cuando el texto crezca, pero mejor preventivo.

---

## Análisis problema-por-problema

### Fase 1 — Verificar que pegado manual funciona end-to-end

**Síntoma.** Vos querés tener una caja en el admin donde pegás una transcripción larga (de un Zoom transcript exportado, de un WhatsApp Audio transcrito, de un Word, etc.) y que el sistema la procese sin trabarse.

**Estado actual.**
- **Backend ya está**. El endpoint `POST /api/drafts/jobs` (en `features/jobDrafts.ts:158`) acepta un campo `transcript`. Si vos pegás un texto de 50.000 chars en el body, el código lo agarra y lo guarda usando `persistLargeContent`, que automáticamente lo sube al File Store.
- **UI necesita verificación**. No tengo visibilidad inmediata si hay una pantalla en el admin con un textarea grande donde vos pegues el transcript. Hay que abrir la app después del deploy y mirarlo.

**Qué otras partes tocan esto.**
- El mismo endpoint también lo usa el handler de Zia (cuando Zia transcribe automáticamente).
- Si el endpoint funciona para Zia (que ya estaba probado), debería funcionar para vos pegando.

**Validación antes.**
1. Abrir el admin con la versión deployada hoy.
2. Buscar dónde hay un input para crear/editar un draft del puesto.
3. Si hay un textarea grande etiquetado "Transcripción": Fase 1 está OK, salta a Fase 2.
4. Si NO hay, anotar dónde sería el lugar correcto (probablemente en JobForm o en DraftsList con un botón "Crear draft manual").

**Validación después.**
- Hacer la prueba real: pegar un transcript de prueba largo (~25.000 chars, puedo darte uno de ejemplo o sacás uno de un Zoom).
- Submit.
- Mirar en el File Store si apareció un archivo.
- Mirar en `DraftsList` si el draft aparece con todo.
- Reabrir el draft: debe mostrar el transcript completo.

**Riesgo de romper.** Bajo. El endpoint ya existe y se usa. Solo agrego UI o señalo dónde está.

**Rollback.** No aplica, no rompemos nada existente.

**Estimación.** 20 min de verificación + 0-30 min de UI si falta.

---

### Fase 2 — Reorganizar nombres/carpetas para que sean encontrables

**Síntoma.** Hoy, si vos entrás al File Store en Catalyst Console y mirás el folder "largecontent", vas a ver una lista de archivos con nombres tipo:

```
JobProfileDrafts_transcript_zia__1717525800000.txt
JobProfileDrafts_draft_payload__1717525810000.txt
JobProfileDrafts_draft_payload__1717525820000.txt
Jobs_tech_questions_cache__1717525830000.txt
ClientReports_bundle_payload__1717525840000.txt
JobProfileDrafts_transcript__1717525850000.txt
...
```

Sin un orden visual claro. Si querés encontrar "la transcripción del briefing con Diego de PixelWeb del 2 de junio" tenés que abrir uno por uno hasta ver cuál es.

**Causa.** El código actual nombra archivos así: `${campoLabel}_${timestamp}.txt`. Sin tenant, sin job, sin fecha legible.

**Limitación importante de Catalyst.** El File Store de Catalyst **no soporta subfolders anidados**. Cada "folder" es un contenedor plano. Para organizar tenemos 2 opciones:

**Opción A — Múltiples folders, uno por tipo.** Crear en Catalyst Console:
- `briefings` (transcripciones de briefings con cliente)
- `drafts` (perfiles del puesto generados por IA)
- `tech-questions` (preguntas técnicas generadas)
- `reports` (bundles de reportes)
- `notes` (notas largas del recruiter)

Pros: agrupación visual en el panel del File Store. Cons: hay que crear cada folder a mano y agregar su `FILESTORE_*_FOLDER_ID` como env var en Catalyst Console.

**Opción B — Un solo folder, naming rico.** Mantener el folder único pero cambiar el filename a algo tipo:

```
briefing__tenant-pixelweb__pmweb-2026-06-04T10-30-00__abc123.txt
draft__tenant-pixelweb__pmweb-2026-06-04T11-00-00__abc124.json
techq__tenant-acme__senior-dev-2026-06-04T14-15-00__abc125.json
```

Pros: cero cambios en Catalyst Console, todo en código. Vas a ver tipo de archivo + cliente + puesto + fecha solo mirando el nombre.

**Opción C — Combinación (mi sugerencia).** Múltiples folders por tipo (Opción A) + naming rico dentro de cada folder (Opción B sin el prefijo de tipo). Da el mejor de los dos: agrupación visual + búsqueda por nombre.

**Decisión que vos tenés que tomar.** ¿Opción A, B o C?

**Implementación de la opción C (asumiendo que la elegís):**

1. Vos creás 5 folders nuevos en Catalyst Console → File Store → Create Folder. Anotás los ROWIDs.
2. Yo agrego env vars: `FILESTORE_BRIEFINGS_FOLDER_ID`, `FILESTORE_DRAFTS_FOLDER_ID`, etc.
3. Refactor de [largeContentStore.ts](functions/api/src/lib/largeContentStore.ts): agregar un parámetro `bucket` ('briefing'|'draft'|'techq'|'report'|'notes') que elija el folder correcto.
4. Refactor del filename: tomar contexto (tenant_slug, job_slug, fecha ISO, hash corto). Ejemplo: `pixelweb_pmweb_2026-06-04T10-30__abc123.json`.
5. Tocar los 5 call sites en outbox.ts, jobs.ts, ziaWebhook.ts, jobDrafts.ts para pasarles `bucket` + contexto.

**Qué otras partes tocan esto.**
- Archivos en el File Store de prod hoy NO se mueven (Catalyst no soporta mover archivos). Los viejos quedan con el naming viejo en el folder "largecontent". Los nuevos arrancan con el naming nuevo en sus folders.
- La función `loadLargeContent` tiene que poder leer de CUALQUIER folder. Como las referencias guardan `file:<id>`, donde `<id>` es global de Catalyst, eso ya funciona — el folder solo importa para el upload.

**Validación antes.**
1. Listar (manual o vía script) cuántos archivos hay en el folder "largecontent" actual y cuánto pesan. Te lo paso.
2. Confirmar que la referencia `file:<id>` apunta al archivo independiente del folder (sí, el ID es global en Catalyst).

**Validación después.**
1. Crear un draft nuevo desde el admin con transcript largo. Mirar que el archivo aparece en el folder "drafts" (no en "largecontent").
2. Reabrir el draft anterior (de antes del cambio): debe seguir cargando OK (porque la referencia file:<id> es global).
3. Generar tech_questions de un puesto: debe ir a "tech-questions".
4. Generar un reporte: debe ir a "reports".

**Riesgo de romper.**
- Bajo si el patrón de bucket se aplica bien y la función `loadLargeContent` no cambia.
- Medio si me olvido de algún call site → ese sigue subiendo al folder viejo. Mitigación: hacer el parámetro `bucket` obligatorio (sin default) → TypeScript fuerza tocar todos los call sites.

**Rollback.**
- Si el refactor rompe algo, revertir el commit del refactor. Los archivos ya subidos a los folders nuevos quedan ahí (no se borran), pero el código vuelve a usar el folder viejo. Cero data loss.

**Estimación.**
- Tu parte: 10 min en Catalyst Console (crear 5 folders, copiar ROWIDs).
- Mi parte: 45-60 min de refactor + tests.

---

### Fase 3 — Cobertura: pasar otros campos al mismo patrón

**Síntoma.** Hay 5-6 campos hoy que guardan inline (sin File Store) y tienen riesgo de crecer:

| Campo | Hoy | Riesgo de crecer |
|---|---|---|
| `analysis_json` (VideoResponses) | 8.000 chars inline | Análisis IA del video puede crecer con prompts más detallados |
| `body` (OutreachInbox / Templates) | 4.000 chars inline | Si pegas un email largo de LinkedIn o un template HTML |
| `ideal_profile` (Jobs) | 8.000 chars inline | DISC + VELNA + competencias + boss profile — puede crecer con catálogo nuevo |
| `notes_internal` (CandidatePool) | 4.000 chars inline | Notas del recruiter con observaciones detalladas |
| `payload` (OutboxEvents) | 8.000 chars inline | Si un evento lleva un transcript adentro |

**Síntoma cuando se rompe.** Catalyst silenciosamente trunca o devuelve error 500 sin mensaje claro cuando un campo Text excede 10.000 chars. El usuario ve "algo no funcionó" sin explicación.

**Causa.** Hoy se trunca defensivamente con `truncate()`. Cuando trunca, se pierde info silenciosamente.

**Fix propuesto.** Aplicar el mismo patrón `persistLargeContent` a estos campos. Si entra inline → inline (sin cambio); si excede → File Store automáticamente.

**Qué otras partes tocan esto.** Cada campo tiene sus propios call sites de lectura y escritura. Hay que migrar uno por uno.

**Validación antes.**
- Por campo: query `SELECT MAX(LENGTH(campo)) FROM Tabla`. ¿Cuál es el largo máximo histórico?
- Si MAX < 5.000 → no urgente, dejar.
- Si MAX > 7.000 → ya está cerca del límite, migrar.

**Validación después.**
- Insertar un valor de 15.000 chars en ese campo. Debe ir al File Store.
- Leerlo: debe traer los 15.000 chars completos.
- Insertar uno de 3.000 chars. Debe quedar inline.

**Riesgo de romper.** Bajo, el patrón ya está probado. Medio si el lector inflado (el que hace `SELECT campo FROM tabla`) no usa `loadLargeContent` — vería literalmente `file:abc123` en vez del contenido. Mitigación: TypeScript me obliga a usar `loadLargeContent`.

**Rollback.** Revertir el commit de cada campo. Los datos viejos siguen siendo legibles porque `loadLargeContent` también acepta strings inline (devuelve tal cual si no empieza con `file:`).

**Estimación.** Por campo: ~15 min. Total: 1.5-2 horas para los 5.

---

## Lo que vos tenés que decidirme

**Para Fase 2:**
1. Opción A (múltiples folders), B (un folder + naming rico), o C (combinación)? Mi sugerencia es C.
2. Si elegís C: vos creás los 5 folders en Catalyst Console y me pegás los ROWIDs.

**Para Fase 3:**
- ¿La hacemos toda junta o solo los campos con riesgo real (los que MAX > 7.000 hoy)?

**Para Fase 1:**
- Nada. Cuando deployes el frontend, abrí `/marketing/leads` y `/drafts`, y decime si ves un campo donde pegar transcripción. Yo armo el resto si falta.
