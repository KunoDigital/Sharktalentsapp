# Roadmap SharkTalents V2 — 2026-06-19

Reemplaza a `PENDIENTES_2026-06-18.md`.

---

## 🎯 Meta única: llegar al primer cliente real funcionando

Cuatro hitos definen "estamos listos":

| # | Hito | Estado | Tiempo restante | Bloqueador |
|---|---|---|---|---|
| 1 | **Comparativo de candidatos funcionando** | 🟡 Construido, sin validar | ~1.5h | Ninguno — siguiente paso |
| 2 | **Production en Catalyst** | 🔴 Sin iniciar | ~2-3h (Cris) | Setup mañana 20-jun |
| 3 | **WhatsApp candidato** | 🔴 Sin iniciar | ~4h código + config | Número de Cris bloqueado en Meta (Cristian destraba) |
| 4 | **Videos del candidato** | 🔴 Sin iniciar | ~25h | Cris decide servicio (OpenAI / Deepgram / ElevenLabs) |

**Total para llegar a cliente real:** ~32h código + decisiones externas.

---

## ✅ Cerrado hoy (2026-06-19)

- **Tooltips en reportes V2** ([PublicReport.tsx](shark/src/pages/public/PublicReport.tsx), [Comparativo.tsx](shark/src/pages/Comparativo.tsx)): glosario extendido con 9 términos (mindset, doble eje, match con jefe, validez situacional, CEFR, etc.) en lenguaje de negocio. Resuelve feedback directo de Harry "no entiendo qué es VELNA". Commit `60aa966`.
- **Preparación setup DEV/PROD Catalyst**: [docs/aprendizajes/17_DEV_PROD_ENVIRONMENTS.md](docs/aprendizajes/17_DEV_PROD_ENVIRONMENTS.md) + scripts deploy + 8 secrets nuevos generados. Listo para que Cris ejecute en Catalyst Console mañana. Commit `644d2db`.
- **Brief Cristian respondido**: contratos, endpoints, eventos del backend que toca la landing pública. Cero coordinación necesaria salvo si renombra enums o `/unsubscribe`.
- **Reescritura editorial MARKETING_LEAD_THANKS**: 4 bloques al tono executive (subject sin "gratuitas", encabezado institucional, cuerpo más adulto, cierre con "consultor te contacta"). Commit `2933d52` (incluye también snapshot de 5 templates candidato pendientes de commit).

## ✅ Cerrado ayer (2026-06-18)

- 5 correos del candidato refactorizados por fase (Prefiltro / Técnica / Conductual / Integridad / Video) con CTA única
- Perfil de cargo visible en JobDetail (`JobIdealProfilePanel.tsx`)
- Buena_impresion: lógica Lie scale invertida (alto = Duda CV, bajo/medio = OK)
- PipelineDashboard rediseñado dark mode + sub-columnas + slider Mindset
- Script `deploy-frontend.sh` ahora sube automático con `catalyst deploy --only client`
- CandidateTestEntry con 4 fases (agregada Prefiltro como paso 1)
- 9 commits en últimos 3 días

---

## 🎯 Hitos detallados

### 1. 🟡 Comparativo de candidatos funcionando

**Por qué es lo siguiente:** está construido pero nunca se vio con datos reales. Cliente que ve finalistas, lo primero que abre es Comparativo. Si está roto, pierdes credibilidad en el momento más caro.

**Pasos:**
- [ ] Extender `spec-4-candidatos-cris.spec.ts` para que al menos 1 candidato llegue a `finalist` (~30 min)
- [ ] Correr spec contra DEV, capturar URL del Comparativo con datos reales (~10 min)
- [ ] Validar visualmente: botón "Comparar" aparece, tabla se ve bien con tooltips, exportar CSV funciona (~30 min)
- [ ] Si hay bugs visuales, fix (~variable)

**Tiempo total:** ~1.5h.

### 2. 🔴 Production en Catalyst

**Por qué importa:** hoy todo corre en Development con pauta real. Cualquier cambio que rompemos en DEV afecta al cliente que llega. PROD aparte = libertad de iterar.

**Pasos (Cris hace en Console, mañana):**
- [ ] Crear Environment Production
- [ ] Crear cuenta ZeptoMail test
- [ ] Setear env vars de PROD (8 secrets nuevos generados ya)
- [ ] Primer deployment DEV→PROD
- [ ] Conectar `app.sharktalents.ai` a PROD
- [ ] Yo: refactor de admin queries para filtrar `tenant_id` con prefijo `test_*`

**Tiempo total:** ~30 min activos Cris + ~2h yo (refactor queries) + propagación DNS.

### 3. 🔴 WhatsApp candidato

**Por qué importa:** los candidatos prefieren WhatsApp a email. Email se pierde, WhatsApp se lee.

**Bloqueador externo:** el número actual de Cris está bloqueado en Meta (caso conocido — Meta dice "está en otro Business Manager" pero la búsqueda muestra que no). Cristian está intentando destrabarlo o moverá a chip de Karina.

**Pasos (cuando se destrabe):**
- [ ] Configurar WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN en env vars
- [ ] Crear plantillas aprobadas en Meta Business (1 por fase: prefilter, técnica, conductual, integridad, video) (~3h)
- [ ] Cambiar en `lib/candidateNotifier.ts` la rama de `whatsapp.send_text` a `whatsapp.send_template` con cada plantilla aprobada (~1h)
- [ ] Tests E2E que validan que se manda WhatsApp (~30 min)

**Tiempo total:** ~4h cuando se destrabe Meta. Hoy no se puede arrancar.

### 4. 🔴 Videos del candidato

**Por qué importa:** prueba diferencial — el cliente ve la cara y voz, no solo números. Es lo que más cierra ventas según observación de Cris.

**Bloqueador interno:** decidir qué servicio usar para transcripción + análisis.

| Servicio | Costo audio | Calidad | Tiempo implementar |
|---|---|---|---|
| OpenAI Whisper + Claude | $0.006/min | Alta | ~15h (semi-armado) |
| Deepgram | $0.0043/min | Alta + rápido | ~20h (cambiar SDK) |
| ElevenLabs Scribe | $0.0067/min | Muy alta + voces | ~25h |

**Pasos (después de la decisión):**
- [ ] Configurar API key del servicio elegido
- [ ] Endpoint público `POST /jobs/:id/video-questions/generate` (1h)
- [ ] Tabla `VideoQuestions` en Catalyst (10 min — agregar a tablas pendientes)
- [ ] UI candidato grabar (8h)
- [ ] UI admin aprobar preguntas (4h)
- [ ] Score 1-10 IA comparando transcripción vs respuesta correcta (4h)
- [ ] Detección de evasivas (3h)
- [ ] Orquestación async (transcripción >30s no entra en handler HTTP) (2h)
- [ ] Tests E2E (3h)

**Tiempo total:** ~25h después de la decisión.

---

## 🟢 Cosas que NO bloquean primer cliente (post-meta)

| Pendiente | Tiempo | Cuándo |
|---|---|---|
| Bot decisor entrenado con datos reales | ~6h | Cuando tengamos cliente |
| Niveles de comparación del puesto (Op/Coord/Ger/Dir estilo Kudert) | ~4h | Mejora post-primer cliente |
| Mindset mismatch alert | ~3h | Mejora post-primer cliente |
| Refactor situacional 4→2 opciones | ~6h | Requiere decisión final |
| Bot decisor con doble eje (Me5) | ~3h + tablas | Post-cliente |
| Filtros completos en PipelineDashboard | ~3h | Post-cliente |
| Job header completo (dropdown + pills) | ~3h | Post-cliente |
| Cleanup wipe-all-test-data | 5 min | Cuando Cris confirme validación |

---

## 🚫 Externos (no son código mío)

| Tema | Quién resuelve |
|---|---|
| Destrabar número WhatsApp en Meta | Cristian |
| Marca Instagram tono executive | Cris + equipo contenido |
| Reescritura landing pública sharktalentsweb | Cristian (en curso) |
| Plataforma marketing interna (Strategist + Performance) | Cristian (paralelo) |
| Prospección activa estilo Sandro Meléndez | Cris |
| Activar red de contactos para warm leads | Cris |
| Recargar Nano Banana (~$25/mes) | Cris |

---

## Stats

- **Commits últimos 4 días:** 13 (5ee2007 → 2933d52)
- **Deploys backend últimos 4 días:** 10
- **Deploys frontend últimos 4 días:** 8
- **Tests pasando:** ~1100+
- **Tablas Catalyst pendientes:** ver `docs/TABLAS_PENDIENTES_CATALYST.md`
- **Estado venta:** 0 prospectos cerrados, ~$300 en pauta gastada, 0 leads calificados que respondieron

---

## ¿Cómo leer este documento?

- **Si abres una sesión nueva**: lee la sección "Meta única" arriba y la tabla de 4 hitos. Eso es todo lo que importa hoy.
- **Si quieres avanzar algo concreto**: el hito 1 (Comparativo) es el único que se puede arrancar hoy sin bloqueadores.
- **Si dudas si algo es prioritario**: si no está en los 4 hitos, no es prioritario para llegar a cliente.
