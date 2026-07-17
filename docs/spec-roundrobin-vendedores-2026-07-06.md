# Spec: Round-robin de leads a vendedores externos (sin CRM)

**Fecha:** 2026-07-06
**Estado:** Aprobada por Cris · pendiente de implementación (post-venta)
**Prioridad:** Media — se ejecuta cuando haya ≥2 vendedores contratados
**Estimado:** 4-6 horas de dev

---

## Contexto y decisión

Los vendedores freelance NO tendrán acceso a Zoho CRM ni a ninguna herramienta de Zoho. Los leads de Meta Ads siguen cayendo en Zoho CRM (proceso existente sin cambios), pero desde ahí el backend SharkTalents debe:

1. Elegir el próximo vendedor en la cola (round-robin puro para arranque)
2. Notificar al vendedor por WhatsApp con los datos del lead
3. Trackear si el vendedor recibió y confirmó
4. Reasignar si no confirma en 4h

**Filosofía:** el vendedor solo usa WhatsApp. Cero fricción de aprender herramientas nuevas. El backend hace todo el ruteo silenciosamente.

---

## Flujo técnico completo

```
1. Lead entra Meta Ads Lead Form
2. Lead cae en Zoho CRM (workflow "Enviar PC a shark" ya existe)
3. Zoho workflow dispara webhook → backend `/api/api/webhooks/crm-lead`
4. Backend actual crea fila en `MarketingLeads` (proceso existente)
5. Backend NUEVO: dispatchLeadToVendedor()
   a. SELECT * FROM Vendedores WHERE activo = true ORDER BY leads_asignados ASC LIMIT 1
   b. UPDATE MarketingLeads SET assigned_to = vendedor_id, assigned_at = now()
   c. UPDATE Vendedores SET leads_asignados = leads_asignados + 1
6. Backend envía WhatsApp Twilio al vendedor:
   - Plantilla nueva `lead_asignado_vendedor` (submit a Meta para aprobación)
   - Body: nombre lead, teléfono, dolor, rol, link "confirmar recibí"
7. Backend envía WhatsApp Twilio a Cris (usando plantilla `lead_alerta_cris` existente):
   - Con nota "asignado a: [nombre_vendedor]"
8. Vendedor clickea link → endpoint público `/api/vendedor/confirmar-lead/:token`
   - Marca confirmed_at en MarketingLeads
9. Cron cada hora:
   - Busca leads asignados hace >4h sin confirmar
   - Reasigna al próximo vendedor (llamando dispatchLeadToVendedor de nuevo con exclude=vendedor_anterior)
   - Manda WhatsApp a Cris: "⚠️ Lead X no confirmado por vendedor Y, reasignado a Z"
```

---

## Schema — tabla `Vendedores` (nueva en Catalyst Datastore)

| Columna | Tipo | Detalle |
|---|---|---|
| ROWID | bigint auto | PK |
| CREATEDTIME | datetime auto | |
| MODIFIEDTIME | datetime auto | |
| nombre | varchar(255) | "Juan Pérez" |
| phone | varchar(20) | "+50761234567" (E.164) |
| email | varchar(255) | opcional |
| activo | boolean | pausar sin borrar |
| leads_asignados | bigint | contador acumulado para round-robin |
| leads_confirmados | bigint | contador de confirmados en tiempo |
| leads_reasignados | bigint | contador de perdidos por no confirmar |
| notes_internal | text | anotaciones Cris |
| onboarded_at | datetime | cuándo empezó |

**Nota:** el round-robin puro se implementa con `ORDER BY leads_asignados ASC` (siempre el que tiene menos). Cuando Cris pase a ponderado, se cambia la query para respetar % por vendedor.

---

## Schema — cambios en `MarketingLeads` (ampliar)

Agregar columnas:
- `assigned_to` (varchar) — ROWID del vendedor
- `assigned_at` (datetime)
- `confirmed_at` (datetime, nullable)
- `reassigned_count` (bigint, default 0)

---

## Endpoints nuevos (backend)

| Método | Path | Auth | Propósito |
|---|---|---|---|
| POST | `/api/admin/vendedores` | admin (X-Internal-Key) | Crear vendedor |
| GET | `/api/admin/vendedores` | admin | Listar todos |
| PATCH | `/api/admin/vendedores/:id` | admin | Activar/pausar/editar |
| DELETE | `/api/admin/vendedores/:id` | admin | Soft-delete |
| GET | `/api/vendedor/confirmar-lead/:token` | public (URL firmada) | Vendedor confirma recepción |
| GET | `/api/admin/dispatch-stats` | admin | Métricas: asignaciones por vendedor + tasa confirmación |

---

## Twilio — plantilla nueva a submitir a Meta

**Nombre:** `lead_asignado_vendedor`
**Categoría:** UTILITY (más fácil de aprobar que Marketing)
**Body:**

```
🎯 Lead nuevo para ti

Nombre: {{1}}
Teléfono: {{2}}
Rol: {{3}}
Dolor: {{4}}

Confirma que lo recibiste: {{5}}

Tienes 4h para confirmar antes de que se reasigne.
```

**5 variables:** nombre, teléfono, rol, dolor, link_confirmar

---

## Cron nuevo — reasignación

`functions/api/src/features/cron.ts` (o similar):

- Frecuencia: cada 1h
- Query: `SELECT * FROM MarketingLeads WHERE assigned_at < now()-4h AND confirmed_at IS NULL`
- Para cada uno:
  1. Excluir vendedor original de la cola
  2. Llamar `dispatchLeadToVendedor(exclude=[prev])`
  3. Incrementar `reassigned_count`
  4. Notificar Cris

---

## Métricas mínimas para admin

Endpoint `GET /api/admin/dispatch-stats` devuelve:

| Métrica | Cálculo |
|---|---|
| Leads asignados por vendedor (últimos 30 días) | COUNT por vendedor |
| Tasa de confirmación en tiempo | confirmados / total × 100 |
| Tasa de reasignación (leads perdidos) | reasignados / total × 100 |
| Vendedor más productivo | max(confirmados) |
| Vendedor menos responsivo | max(reasignados) |

---

## Testing plan

1. Crear 2 vendedores de prueba con teléfonos reales (Cris + Cristian)
2. Correr `_diag-crm-push` con lead falso
3. Verificar: Zoho recibe → webhook → asignación → WhatsApp llega al vendedor → confirmación funciona
4. Simular 8 leads falsos → verificar round-robin equitativo (4 a cada uno)
5. Crear lead sin confirmar → esperar 4h → verificar reasignación

---

## Migración a ponderado (post-arranque, en 60 días)

Después de 8 semanas con datos:

1. Consultar `dispatch-stats` para ver conversion rate por vendedor
2. Agregar campo `weight` (float, default 1.0) a tabla `Vendedores`
3. Cambiar query de dispatchLeadToVendedor a probabilística ponderada por peso
4. Cris ajusta weights manualmente según performance

---

## Dependencias

- Plantilla Twilio `lead_asignado_vendedor` aprobada por Meta (24-48h)
- Meta Business Manager configurado con el número virtual `+5078338754` (ya listo)
- Backend con acceso a Zoho CRM webhook (ya funciona)

---

## Cosas que NO se hacen en esta primera iteración

- Panel web para vendedores (postponer, ver Opción C en propuesta)
- Bot WhatsApp con comandos para status updates
- Integración con Google Form (Opción A de tracking) — se maneja externamente por Cris
- Segmentación por sector/industria (round-robin puro para arranque)
- Cambio dinámico de peso (todos igual en fase 1)

---

## Pendiente decidir (post-implementación fase 1)

- ¿Cómo trackea Cris el pipeline (cierres, propuestas enviadas, etc.)?
  - Google Form manual, o
  - Bot WhatsApp con comandos, o
  - Panel web mínimo
- ¿El vendedor contacta al lead con SU WhatsApp personal o SharkTalents provee número?
- Política de leads: ¿los vendedores saben cuántos son en total o cada uno cree que es exclusivo?
- ¿Cómo se demuestra atribución de comisión (evitar disputas)?
