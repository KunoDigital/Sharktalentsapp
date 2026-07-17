# Roadmap SharkTalents — Pausa por venta · 2026-07-01

**Orden de Cris:** TODO en pausa hasta cerrar primer cliente pagando. Foco único: presentación versión móvil.

Reemplaza `PENDIENTES_2026-06-22.md`.

---

## 🎯 Foco único ahora

**Mejorar `docs/presentacion-cliente-mobile.html` para que Cris pueda usarla como material de venta.**

---

## ✅ Cerrado entre 22-jun y 30-jun (queda vivo, no se toca)

### Backend v0.1.0 desplegado en Development (que es el productivo)
- Módulo mensajes calibrados: `lib/leadMessageGenerator.ts` con 9 aprobados de Cristian como few-shot
- `lib/secretsCache.ts` para leer keys largas desde tabla `Config` (workaround cap env vars de Catalyst)
- `sendTemplate()` de Twilio integrado en `zohoCrmWebhook.ts` + `marketing.ts` con las 6 variables del template `lead_alerta_cris` aprobado
- `whisperClient.ts` migrado a `OPENAI_API_KEY` (era `WHISPER_API_KEY` legacy)
- Fix crítico `fetchJob`: candidatos reales aplicando por slug daban 500 (ROWID bigint vs string quoted). También en `diagCreateTestCandidate`.
- Nuevo endpoint `_diag-generate-videos-for-app` (bypass auth tenant, usa INTERNAL_API_KEY)
- Fix `extractJson` en `anthropic.ts`: agrega fallback `extractBalancedJsonObject` cuando Claude devuelve JSON + texto extra

### Frontend desplegado
- `CandidateTestEntry.tsx`: agregada fase `video`, removida lista hardcoded de pruebas (Cris pidió no revelar la secuencia al candidato)
- `CandidateVideoTest.tsx`: validación de token acepta backend real (antes solo mock), + estado `submitting` con feedback "⏳ Subiendo..." + botón Detener con estilos rojos inline
- Cambios de tono: `Escribinos` → `Escríbenos`, `Pedile` → `Pídele` (tuteo LatAm)
- Email de contacto candidato: `proyectos@kunodigital.com` (Cris cambiará a sharktalents.ai en el futuro)

### Config operativa (Catalyst)
- Tabla `Config` en Datastore + 1 fila `TWILIO_TPL_LEAD_ALERTA` con SID `HXf3af9ccd5d2611cb6c7b4b7ae99d8bf7`
- Env var `OPENAI_API_KEY` (project key `sk-proj-...` 164 chars)
- Env var `TWILIO_WHATSAPP_FROM` cambiada de sandbox `+14155238886` a virtual `+5078338754`
- Plantilla `lead_alerta_cris` aprobada por Meta (categoría Marketing, 6 variables)
- 4 vars legacy `NEXT_PUBLIC_*` (Next.js) borradas del Catalyst Console
- `_README` sentinel conservado (evita que Catalyst borre env vars en deploys)

### Documentación / assets
- `docs/aprendizajes/18_INVENTARIO_KEYS.md` — inventario de keys (sin valores) + reglas de rotación
- `catalyst-dev.env` en root (ignorado por git) — backup + clasificación A/B/C para PROD
- `docs/presentacion-cliente.html` — refactor entero: 15 slides, paleta navy/beige, tipografías Ubuntu/Oswald, sección garantía de backup restaurada, 6 dimensiones (no 5), personajes DISC + fix Operaciones movido de S a C
- `docs/presentacion-cliente-mobile.html` — versión formato historia IG 9:16
- PDFs generados de ambas (`presentacion-cliente.pdf` landscape + `presentacion-cliente-mobile.pdf` portrait)
- 6 logos clientes en `docs/img/clientes/`: Alpha, Aria, Maxi Gold, Importadora Panamá, Kava, Latam Vaping

### Validación E2E funcionando en producción
- Lead falso `_diag-crm-push` con `dolor` + `role` disparó flujo real: Zoho CRM → workflow → webhook backend → Claude Haiku generó mensaje sugerido → WhatsApp template llegó al `+50763333870` (número personal de Cris)

---

## 🟡 En pausa — retomar POST-VENTA

### 1. Test E2E video/Whisper (crítico técnico)
**Estado:** application `28606000001093083` para chris palma (`chrismarpalma@gmail.com`) tiene stage `videos_pending` con 7 preguntas video generadas. Link válido hasta ~30 jul:
```
https://app.sharktalents.ai/app/#/test/eyJraW5kIjoidGVzdCIsInJlZiI6IjI4NjA2MDAwMDAxMDkzMDgzIiwiZXhwIjoxNzgzOTY4NjUxfQ.8vyssHwQxJnrty7DyTAnaggrGWFX1r9MK7Iubq7M_os
```

**Falta:** que Cris grabe 1-2 videos, verificar que Whisper transcribe + Claude analiza + resultado aparece en `CandidateVideosPanel` del admin. Después limpiar test job + application + candidato.

### 2. PROD setup en Catalyst
**Estado:** Cristian iba a mandar MD con comando CLI exacto para primer deploy PROD + estrategia env vars. **NO llegó todavía** (o Cris no lo pasó).

Cuando llegue:
- Crear Environment Production en Catalyst Console
- Duplicar env vars marcadas A (43 vars) con valores distintos, C con mismos valores (ver `catalyst-dev.env`)
- Sub-account ZeptoMail para tests separado de producción
- Cambiar Twilio `TWILIO_WHATSAPP_FROM` según env (mismo en dev y prod, Twilio es cuenta única)
- Primer deploy backend + frontend a PROD
- Conectar `app.sharktalents.ai` a PROD

Doc de referencia: `docs/aprendizajes/17_DEV_PROD_ENVIRONMENTS.md`

### 3. Refinar 27 mensajes pendientes de Cristian
Del `review-mensajes-2026-06-22.json`: 36 mensajes redactados, 9 aprobados, **27 sin revisar**. Cuando Cristian vuelva a mirar el HTML de review, procesar aprobados/rechazados. Los aprobados nuevos se agregan al `leadMessageGenerator.ts` como few-shot examples.

### 4. Bug menor `_diag-crm-push`
No propaga `dolor` ni `role` al lead que crea en CRM. Los leads reales de Meta sí los mandan (via custom_fields), pero los tests via diag no. Fix: agregar 2 campos al body + al `customFields` object. ~10 min.

### 5. Limpiar Zoho CRM
- Lead falso "Test E2E 29Jun" con email `test-e2e-29jun@sharktalents.ai`
- Application/Candidate falsos "chris palma" job "Test Whisper - Asistente de Operaciones"
- Job de test creado 29-jun `id=28606000001089063`
- Otros jobs de test `28606000001047009`, `28606000000790158`, etc.

### 6. Frontend admin — bug NO investigado
La lista de pruebas del candidato (`CandidateTestEntry`) era hardcoded a 4 pruebas. Removida por petición de Cris. Pero **NO hay campo backend `applicable_phases`** para el puesto. Si en el futuro se quiere mostrar dinámicamente qué pruebas aplica un job (incluyendo Inglés/Mindset), agregar ese campo al `Jobs` schema + endpoint.

### 7. WhatsApp candidato/cliente (posterior a venta)
Twilio hoy solo manda a Cris (`OPS_ALERT_PHONE`). Falta:
- Plantillas UTILITY para candidato: `evaluacion_lista_candidato`, `recordatorio_evaluacion`, `reporte_listo_cliente`
- Submit + aprobación Meta de cada una
- Decidir auto-reply cuando cliente responde al número virtual

### 8. Video del candidato — otras integraciones pendientes
- Servicio de video hosting (si videos grandes exceden Catalyst File Store)
- Retención 30 días automática (código GDPR ya existe, verificar cron)

### 9. LinkedIn SharkTalents
Sin fecha, no urgente. Ver memoria `project_linkedin_sharktalents.md`.

---

## 🎯 Meta única mientras esté en pausa

**Cerrar primer cliente pagando.** Para eso, la presentación móvil tiene que ser:
- Impecable visualmente (sin bugs de layout, tipografía, contraste)
- Rápida de compartir (formato que Cris pueda mandar por WhatsApp / IG story / link)
- Con narrativa clara que empuje a la venta

---

## Stats del ciclo 22-jun a 01-jul

- **Commits backend:** ~15
- **Deploys backend:** ~4
- **Deploys frontend:** ~5
- **Bugs críticos fixed:** 6 (slug 500, Whisper API key, JSON parsing, CSS Detener, feedback Subiendo, tokens video)
- **Docs nuevos:** 3 (INVENTARIO_KEYS, PENDIENTES_07-01, catalyst-dev.env)
- **Leads reales entrantes:** 1-2 (test E2E)
- **Pauta Meta:** en pausa
- **Plantillas Twilio aprobadas:** 1

---

## Cómo retomar post-venta

1. Leer este doc + `PENDIENTES_2026-06-22.md` (contexto ciclo anterior)
2. Chequear `git log --oneline -20` para ver últimos cambios
3. Priorizar: PROD setup (bloqueante) → limpiar CRM → Test video E2E → refinar mensajes → bug menor
