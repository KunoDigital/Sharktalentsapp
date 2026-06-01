# Marketing Funnel — Embudo de Adquisición

**Status:** `LIVE EN DEV` (2026-05-11) — los 5 endpoints están desplegados, la landing en Slate ya pega al backend, falta solo activar bridge a Zoho CRM (tarea de Cristian).
**Fecha de captura:** 2026-05-02
**Última actualización:** 2026-05-11

---

## Estado actual al 2026-05-11

**Backend (Catalyst Development):**
- ✅ Tabla `MarketingLeads` con 27 columnas (incluye attribution: visit_id, meta_event_id, UTMs, deletion_token_hash, etc.)
- ✅ 5 endpoints públicos: `POST /lead`, `POST /eval-request`, `GET /lead-status`, `POST /lead/request-deletion`, `DELETE /lead`
- ✅ `MARKETING_SITE_KEY` validada en cada request (header `X-Marketing-Site-Key`)
- ✅ CORS abierto a `https://www.sharktalents.ai`, `https://sharktalents.ai`, `http://localhost:3000`, `http://localhost:4322`
- ✅ Cloudflare Turnstile wireado en `/eval-request` con secret real
- ✅ Honeypot anti-bot en `/lead` (campo `website`)
- ✅ UPSERT por email (no duplicados)
- ✅ Outbox event `lead.captured` enquea sync a Zoho CRM (con tag `SharkTalents` automático)

**Landing (Catalyst Slate, sharktalents.ai):**
- ✅ `NEXT_PUBLIC_API_BASE` + `NEXT_PUBLIC_MARKETING_SITE_KEY` seteadas
- ✅ Sync hecho, landing pega al backend

**Probado end-to-end:**
- Lead test `test@test.com` (ROWID 28606000000784192) creado via POST con response correcto
- CORS preflight desde `https://www.sharktalents.ai` devuelve `Access-Control-Allow-Origin` correcto
- Turnstile rechaza tokens falsos con `403 invalid_captcha`

**Bloqueos:**
- ✅ `/eval-request` auto-crea tenant interno + Job demo en la primera llamada (`ensureMarketingDemoSetup` en `marketing.ts:402`). Sin bloqueo.
- ⚠️ Push al CRM no funciona hasta que Cris regenere `ZOHO_OAUTH_REFRESH_TOKEN` con scope CRM agregado + setee `ZOHO_CRM_API_URL` (ver CRISTIAN_HANDOFF.md §1). Mientras tanto los leads se guardan OK en `MarketingLeads` y los ves en Settings → 📥 Leads.

---

---

## Por qué existe este documento

Hoy SharkTalents tiene una página informativa típica con CTA a WhatsApp. No tiene flujo
de adquisición real — un prospecto frío de Meta Ads no puede llegar, entender el valor,
y decidir comprar sin hablar primero con Cris.

Cris probó un prototipo HTML de embudo gamificado (ver
[24_MARKETING_FUNNEL_prototype.html](24_MARKETING_FUNNEL_prototype.html)) que combina:

1. Quiz de 5 preguntas que califica al lead
2. Calculadora de riesgo personalizada (costo de mala contratación vs fee SharkTalents)
3. Lead magnet: evaluación gratuita DISC + Cognición + Integridad de un miembro actual
4. Cierre con garantía real del contrato (Cláusula 8 — repetir proceso sin costo, no
   garantizar desempeño del candidato)

Este documento captura la decisión arquitectónica y el plan de integración con la
plataforma existente para cuando llegue el momento de implementarlo.

---

## Decisión arquitectónica: landing separada + endpoints en plataforma

### Recomendación: **landing separada** (Astro / Next.js static / HTML+JS)

**Razones críticas:**

1. **Performance y Meta Ads quality score.** Bundle actual de la plataforma es 656KB.
   Meta/Google miden Core Web Vitals. Una landing static con LCP <1s baja CPC ~30-50%.
   Importa solo si vas a hacer paid traffic — pero el plan inicial **es** Meta Ads.

2. **SEO real.** SPA de React con Vite no rankea en Google. Si algún día querés tráfico
   orgánico ("evaluación candidatos panama"), la landing static sí rankea.

3. **Iteración del funnel ≠ iteración de la plataforma.** El equipo de
   marketing/sales debería poder cambiar copy, A/B testear imágenes, agregar
   testimonios — semanal. Sin tocar el repo de Catalyst ni redeployar.

4. **Audiencia distinta, prioridades distintas.** La plataforma optimiza para
   "recruiter trabajando 8h, no rompas mi flujo". La landing optimiza para "prospecto
   frío en mobile, 30 segundos para decidir dejar email". Mismo bundle = empate al peor.

5. **Aislamiento de riesgo.** Si la plataforma cae, la landing sigue captando leads.

### Tradeoff aceptado

Doble codebase. Dos repos. Pero el "puente" entre ambos son solo 2 endpoints públicos
en la plataforma (~150 líneas de código nuevo).

### Stack recomendado para la landing

**Astro** (preferido):
- Genera HTML estático puro
- Hidrata solo "islas" interactivas (quiz, calculadora)
- Permite reusar componentes React si se quiere
- Hosting: Cloudflare Pages o Vercel (free tier)
- Meta tags, OG cards, sitemap, robots.txt automáticos

Alternativas: Next.js static export, Eleventy, HTML+JS vanilla.

---

## Cómo se comunica landing ↔ plataforma

```
Landing (Astro/static)
   │
   │ POST /api/marketing/lead
   │ { quiz_data, calculator_data, contact, utm_* }
   ▼
Plataforma — features/marketing.ts (nuevo, ~200 líneas)
   │
   ├─→ Inserta MarketingLead en tabla MarketingLeads
   ├─→ Outbox event: lead.captured → Zoho CRM
   └─→ Outbox event: email.send_pending → "gracias, agendá llamada"

   ────────────────────────────────────

Lead pide eval gratuita en otra pantalla:
Landing
   │
   │ POST /api/marketing/eval-request
   │ { lead_email, member_to_evaluate: { name, email } }
   ▼
features/marketing.ts
   │
   ├─→ Busca/crea Candidate (el miembro a evaluar)
   ├─→ Crea Result asociado al Job "Evaluación Demo"
   ├─→ Firma token kind=test, ref=resultId, exp=7d
   └─→ Outbox: email al member_to_evaluate.email con link del test

   ────────────────────────────────────

Member hace click en email → /test/<token>
   │
   ▼
Test corre solo DISC + Cognición + Integridad (job.assessment_modules)
   │
   ▼
Al terminar → pipeline_stage = 'demo_completed'
   │
   ▼
Trigger automático: genera reporte demo + email al lead
"Acá está la evaluación de tu miembro — así se ve con tus candidatos reales"
```

---

## Tenant especial: "SharkTalents Marketing"

Crear un tenant interno tuyo (no facturable, no entra en stats globales). Razones:

- **Aislamiento:** si querés cerrar el funnel un día, suspendés ese tenant sin tocar
  clientes reales
- **Métricas:** podés saber "este mes captamos X prospectos via funnel" filtrando
  por `tenant_id`
- **Permisos:** vos sos único admin. Si en el futuro hay alguien de marketing, le
  das acceso solo a ese tenant

Dentro del tenant: un Job especial **"Evaluación Demo"** con:

```ts
{
  title: "Evaluación Demo",
  company: "SharkTalents Marketing",
  assessment_modules: ['disc', 'velna', 'integrity'],  // los 3 que el lead magnet usa
  cognitive_level: 'mid',
  is_active: true,
  // sin tech_prompt, sin auto_rejection_rules
}
```

---

## Los 4 cambios mínimos en la plataforma

### 1. Campo `assessment_modules` en Job

```ts
type Job = {
  ...
  assessment_modules: ('disc' | 'velna' | 'integrity' | 'emotional' | 'technical' | 'video')[];
}
```

Default: `['disc','velna','integrity','emotional','technical']` (lo de hoy = todos).
Para demo: `['disc','velna','integrity']`.

`publicTest.ts` lee este campo y skipea los módulos no incluidos. ~30 líneas.

### 2. Reporte tolerante a secciones faltantes

`reportNarratives.ts.describeCandidate()` **ya** es tolerante (`if (s.disc_norm_d != null)`
antes de incluir DISC en el prompt). Falta validar `PublicReport.tsx` frontend:
cada sección debe hacer guard `if (candidate.disc) render section`. Hoy probablemente
asume todas presentes y se rompe si son `undefined`. ~1h de chequeo.

### 3. Pipeline stage `demo_completed`

Agregar al state machine en `lib/pipelineStateMachine.ts`. Es terminal — no transiciona
a finalist. El bot decisor lo skipea. Auto-rejection rules no aplican.

### 4. Tag `Tenants.is_internal: boolean`

Tenants marcados `is_internal=true` quedan excluidos de:
- Stats globales (`/admin/stats`)
- Quotas billing del cliente real
- Outbox `sync.recruit` (no querés que el CRM Zoho se llene de prospectos como candidatos)

---

## Tabla nueva: `MarketingLeads`

Pendiente para la sesión batch de creación de tablas.

```
MarketingLeads
─────────────────────────────────────────────
ROWID            (auto)
email            string (255)
contact_name     string (255)
company          string (255)?
whatsapp         string (50)?
quiz_data        Text (4000)   - JSON serializado del quiz
calculator_data  Text (4000)   - JSON con cálculo de riesgo
score_quality    int           - 0-100, derivado del quiz
urgency          string (50)   - 'less_30d' | '1-3m' | '3m+' | 'exploring'
salary_target    int?          - USD/mes del puesto que considera
source           string (50)   - 'meta_ads' | 'google' | 'organic' | 'referral'
utm_source       string (255)?
utm_medium       string (255)?
utm_campaign     string (255)?
status           string (30)   - 'new' | 'eval_requested' | 'eval_completed' | 'call_booked' | 'won' | 'lost'
eval_result_id   string (40)?  - FK a Results si pidió eval gratuita
zoho_crm_lead_id string (40)?  - ID del lead en Zoho CRM (sync via outbox)
created_at       timestamp
updated_at       timestamp
```

---

## Las 6 etapas del funnel (del prototipo de Cris)

### Acto 1 — El Gancho (Meta Ad)

Activa el dolor de mala contratación. NO menciona DISC, dimensiones, IA, precio.
CTA: "calcular el riesgo".

### Acto 2 — La Inmersión (Landing + Quiz)

H1: "Antes de contratar, mide el riesgo"
Quiz de 5 preguntas:
1. Tipo de puesto (técnico/ventas/operativo/directivo)
2. Cómo contratan actualmente
3. Historial de malas contrataciones
4. Urgencia
5. Salario mensual del puesto ($500-$6000)

Captura nombre/empresa/email **antes** de mostrar resultados → lead entra a CRM.

### Acto 3 — La Revelación (Calculadora + Lead Magnet)

Calculadora: pide salario reclutador + salario entrenador. Calcula:
- Tiempo del reclutador (1 mes)
- Costo del entrenador (30% × 3 meses)
- Productividad perdida del nuevo (55% × 3 meses)
- Si mala contratación: proceso × 2 + 1 mes liquidación

Compara contra fee SharkTalents (1.2× salario).

Lead magnet: eval gratuita DISC + Cognición + Integridad de un miembro actual.

Bifurcación según urgencia (P4 del quiz):
- `< 30 días` → CTA agendar llamada inmediata
- `1-3 meses` → primero prueba gratuita → nurturing → llamada
- `Solo explorando` → reporte quiz + retargeting Meta

### Acto 4 — El Momento Clave (Entrega del reporte)

Email con PDF del reporte parcial. El lead ve que DISC describe **exactamente** cómo
trabaja alguien que conoce de años → producto se vendió solo. CTA: agendar llamada 30min.

Bifurcación:
- Agenda → Acto 5
- 48h sin responder → secuencia 3 emails (Acto 6)
- "Interesante pero no ahora" → CRM tag tibia, retargeting 30d

### Acto 5 — El Cierre (Llamada 30min)

- Min 0-5: validación del reporte ("¿fue preciso?")
- Min 5-15: escuchar dolor del puesto actual
- Min 15-25: presentar proceso adaptado al perfil del quiz
- Min 25-30: precio en contexto + garantía + firma

**Garantía real del contrato (Cláusula 8):** "Repetimos el proceso sin costo si los
candidatos entregados no cumplen el perfil acordado." NO garantiza desempeño del
contratado (Cláusula 7.4 — eso depende de gestión interna).

### Acto 6 — Nurturing + KPIs

Secuencia 3 emails (14 días) para los que no agendaron:
- Día 3: insight del reporte + conexión con próxima contratación
- Día 7: caso real beta + CTA llamada 15min
- Día 14: urgencia (slots disponibles)

**Métricas objetivo:**
- Ad → Quiz: 2-4%
- Quiz completado: 70%+
- Quiz → Acepta prueba gratis: 40-60%
- Empleado completa pruebas: 70%+
- Reporte → Agenda llamada: 35-50%
- Llamada → Contrato: 40-60%

---

## Flujo operativo de Cris (pendiente de completar)

> Cris dijo "te comento como sería mi flujo" pero el mensaje cortó.
> Cuando vuelva con el detalle, esta sección se completa con:
> - Cómo se ve el "puesto" Clientes Potenciales en el dashboard
> - Quién dispara el envío del link DISC + Integridad
> - Qué pasa cuando el reporte se genera (revisión manual vs automática)
> - Cómo se cierra el loop con la llamada de venta

---

## Esfuerzo de implementación cuando llegue el momento

**Día 1 — Backend platform changes:**
- Campo `assessment_modules` en Jobs (~30 líneas en publicTest.ts + tests)
- Pipeline stage `demo_completed` (~10 líneas en pipelineStateMachine.ts + tests)
- `Tenants.is_internal` flag (~5 líneas + filter en stats endpoint)
- Guards en `PublicReport.tsx` para secciones opcionales (~1h)

**Día 2 — Marketing feature:**
- `features/marketing.ts` con 2 endpoints (lead capture + eval request)
- Tabla `MarketingLeads`
- Integración Zoho CRM via outbox event `lead.captured`
- Email automático con reporte demo via outbox

**Repo separado de la landing:**
- Astro project con estructura de quiz + calculadora
- Meta Pixel + Conversion API
- Hosting en Cloudflare Pages

**Total:** ~2 días dev en plataforma + 2-3 días en landing.

---

## Decisiones que Cris tiene que tomar

1. **¿Tenant aparte o flag `is_internal` en uno existente?**
   Recomendación: tenant aparte ("SharkTalents Marketing").

2. **¿Reporte demo se manda automático o lo revisás antes?**
   Recomendación: automático (las narrativas IA con DISC + Integridad son seguras —
   no podés meter la pata). Si lo revisás, perdés momentum.

3. **¿Qué cron de follow-up para prospectos que no completan?**
   Sugerencia: 48h sin completar → recordatorio. 7 días → notificar a Cris para
   llamada manual.

4. **¿Quién paga la API Anthropic?** Cris. Cada eval demo cuesta ~$0.05 USD. 100
   leads/mes con 20 evals = $1/mes. Despreciable.

---

## Costo Anthropic estimado

Por eval demo (DISC + Integridad narrativas IA):
- 1 prompt candidato: ~1500 tokens out × $1/M = $0.0015
- 1 prompt conclusión: ~500 tokens out × $1/M = $0.0005
- Cache hit del system prompt: ~free
- Total: ~$0.05 USD por eval (incluye contexto generoso)

Volumen target: 100 leads/mes × 20% pide eval = 20 evals/mes = **$1/mes**.

---

## Referencias

- Prototipo HTML: [24_MARKETING_FUNNEL_prototype.html](24_MARKETING_FUNNEL_prototype.html)
- Master plan operativo: [18_PIPELINE_OPERATIVO.md](18_PIPELINE_OPERATIVO.md)
- Reporte cliente: [17_PORTAL_CLIENTE.md](17_PORTAL_CLIENTE.md)
- Integraciones Zoho: [23_INTEGRACIONES_ZOHO.md](23_INTEGRACIONES_ZOHO.md)
