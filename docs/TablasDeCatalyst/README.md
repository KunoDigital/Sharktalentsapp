# 📊 Crear tablas en Catalyst Datastore vía API

**Guía operativa para el equipo de Kuno + agentes Claude Code.**

> Última actualización: 2026-05-11
> Fuente del aprendizaje: proceso real ejecutado en el proyecto SharkTalents donde creamos 7 tablas + 11 columnas en ~1 hora.

---

## ¿Para qué sirve esta guía?

Catalyst Datastore te deja crear tablas y columnas:

1. **Manualmente** desde la UI de Catalyst Console (lento, 30 min por tabla, propenso a errores)
2. **Vía REST API** (rápido, repetible, scriptable, ideal para schemas grandes)

Esta guía documenta el camino **#2 (API)** completo: setup, scripts, quirks, troubleshooting.

---

## ¿Cuándo conviene cada camino?

| Situación | Recomendación |
|---|---|
| 1-3 tablas, schema simple | UI Console (es más rápido en volumen bajo) |
| 5+ tablas, o migración entre proyectos | **API + script** (esta guía) |
| Schema en TypeScript/JSON y querés mantener sync | **API + script** |
| Vas a replicar el mismo schema en dev/prod/sandbox | **API + script** |
| Tu agente Claude Code tiene que crear tablas | **API** (esta guía está pensada para ti) |

---

## Estructura de esta guía

| Documento | Contenido |
|---|---|
| **[01_setup_oauth.md](01_setup_oauth.md)** | Paso a paso: cómo generar OAuth Self-Client + refresh token (~10 min) |
| **[02_endpoints_y_tipos.md](02_endpoints_y_tipos.md)** | Los 2 endpoints de Catalyst + mapping de tipos de datos |
| **[03_quirks_y_bugs.md](03_quirks_y_bugs.md)** | ⚠️ **CRÍTICO** — Eventual consistency, nombres envenenados, restricciones que vas a encontrar |
| **[04_manifest_json.md](04_manifest_json.md)** | Cómo armar el JSON manifest con tu schema completo |
| **[05_script_paso_a_paso.md](05_script_paso_a_paso.md)** | Cómo correr el script principal + comandos comunes |
| **[06_troubleshooting.md](06_troubleshooting.md)** | Errores comunes + cómo resolverlos |
| **[07_para_agentes_ai.md](07_para_agentes_ai.md)** | **Especial para Claude Code / otros agentes AI** — qué leer primero y orden de ejecución |
| **[templates/](templates/)** | Scripts y JSON ejemplo listos para copiar |

---

## Decision tree rápido

```
¿Necesitás crear tablas en Catalyst?
│
├─ ¿Es 1-2 tablas chicas? → UI Console y listo (no leas esto)
│
└─ ¿Es schema grande / repetible / scriptable?
   │
   ├─ ¿Ya tenés OAuth Self-Client de Zoho con scopes Catalyst?
   │   ├─ NO → leer 01_setup_oauth.md
   │   └─ SÍ → continuar
   │
   ├─ ¿Tenés el schema en JSON (manifest)?
   │   ├─ NO → leer 04_manifest_json.md
   │   └─ SÍ → continuar
   │
   ├─ Correr el script en dry-run primero
   │   └─ leer 05_script_paso_a_paso.md
   │
   └─ Si falla algo → leer 06_troubleshooting.md
```

---

## TL;DR (resumen ejecutivo)

**Lo que vas a hacer:**

1. Generar OAuth Self-Client en [api-console.zoho.com](https://api-console.zoho.com) con scopes `ZohoCatalyst.tables.CREATE,ZohoCatalyst.tables.columns.CREATE` (10 min)
2. Convertir el code de Zoho en un refresh_token con un curl
3. Conseguir el `project_id` + `org_id` de tu Catalyst Console
4. Armar tu schema en JSON (o usar el helper para extraerlo de TypeScript)
5. Correr el script `create-catalyst-tables.ts` con dry-run, después con --execute
6. Cuando aparezcan los quirks (eventual consistency 5-60s, nombres "envenenados") → seguir el troubleshooting

**Tiempo estimado total:**
- Setup OAuth: ~15 min (primera vez)
- Por tabla nueva: ~30 seg automático
- 10 tablas: ~5-10 min de ejecución

---

## ⚠️ 3 cosas críticas que vas a aprender (de la peor forma si no leés)

1. **Eventual consistency 5-60s** — Catalyst tarda hasta 60 segundos en propagar una tabla recién creada. Si tu script no espera suficiente, la tabla queda "huérfana" (existe pero su `table_id` queda permanentemente roto). [Ver 03_quirks_y_bugs.md](03_quirks_y_bugs.md)

2. **Nombres envenenados** — Si una tabla quedó huérfana tras un timeout, ese nombre queda **permanentemente reservado** y rechazado. Solución: **renombrá la tabla en tu código**. Caso real: `PrefilterQuestions` → `PrefQuestions`.

3. **Booleans van como string** — La API recibe `"true"`/`"false"` como strings, NO como booleans reales. Si mandás `true` (boolean) te rechaza el request.

---

## Caso de éxito: SharkTalents (2026-05-11)

Lo que logramos en una mañana:
- **7 tablas creadas vía API:** EnglishTestSessions, JobTrackingSnapshots, TokenUsage, MarketingLeads, PrefilterAnswers, MindsetScores, PrefQuestions
- **11 columnas agregadas** a tabla existente (MarketingLeads extendida)
- **Tiempo total:** ~1 hora incluyendo aprender los quirks
- **Sin downtime** ni interrupción al servicio
- **Schema mantenido** como manifest JSON sincronizado con el código TypeScript

Equivalente manual en UI Console: ~3-4 horas de clicks repetitivos + mayor probabilidad de typos.
