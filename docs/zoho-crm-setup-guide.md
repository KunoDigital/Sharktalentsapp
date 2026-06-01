# Guía de configuración Zoho CRM para SharkTalents

> Para Cris — cuando entres al CRM con tus accesos nuevos, esto es lo que conviene configurar para que el embudo de leads de SharkTalents tenga sentido y se vea limpio.

---

## Qué hace hoy el backend automáticamente

Cada vez que alguien deja sus datos en la landing de SharkTalents, el backend crea un **Lead** en tu Zoho CRM con estos campos:

| Campo Zoho CRM | Valor que manda el backend |
|---|---|
| `Email` | Email del candidato |
| `First_Name` | Primer nombre (si lo dio en el form) |
| `Last_Name` | Apellido (si lo dio, o derivado del email si no) |
| `Company` | Empresa que puso en el form |
| `Phone` | WhatsApp (si lo dio) |
| `Lead_Source` | `SharkTalents Funnel` |
| `Campaign_Source` | UTM campaign (de la pauta de Meta) |
| `Description` | Score de calidad + urgencia + status |
| `Tag` | `SharkTalents` (cuando completa el demo se le suma `Demo Completed`) |
| `Layout` | (opcional — ver más abajo) |

Eso ya funciona sin que toques nada. Lo que sigue es para sacarle más jugo.

---

## 1. Crear una vista filtrada "Leads SharkTalents"

**Para qué:** que cuando entres al CRM veas SOLO los leads de SharkTalents sin mezclarse con los de otros productos de Kuno.

**Pasos:**
1. CRM → Leads → Click en el dropdown de vistas (arriba a la izquierda donde dice "All Leads")
2. **Create View** → New Custom View
3. Nombre: `SharkTalents — Leads`
4. Criteria:
   ```
   Tag contains "SharkTalents"
   ```
   (también podés usar `Lead Source = "SharkTalents Funnel"` o ambas con AND)
5. Columnas a mostrar: Lead Name, Email, Company, Lead Source, Created Time, Lead Status
6. Save

**Tip:** marcala como tu vista por defecto cuando trabajes en SharkTalents.

---

## 2. Crear un Layout dedicado para SharkTalents (opcional pero recomendado)

**Para qué:** los leads de SharkTalents tienen campos relevantes distintos a un lead común de Kuno (score de calidad, urgencia de contratación, salario target, link al reporte del demo). Tener un layout dedicado los muestra ordenados.

**Pasos:**
1. CRM → Setup → Customization → **Layouts** → Module: Leads
2. Click **Clone Layout** desde el Standard
3. Renombralo: `SharkTalents Lead`
4. Agregá campos custom (Setup → Customization → **Fields** → Module: Leads → New Custom Field):
   - `Score Calidad` (Number) — para guardar el score 0-100 del quiz
   - `Urgencia` (Picklist) — valores: `Menos de 30 días`, `1-3 meses`, `3+ meses`, `Exploratorio`
   - `Salario Target USD` (Number) — lo que el cliente está dispuesto a pagar
   - `Demo Report URL` (URL) — link al reporte del demo cuando se complete
   - `Lead Status SharkTalents` (Picklist) — valores: `new`, `eval_requested`, `eval_completed`, `call_booked`, `won`, `lost`
5. Arrastrá los campos custom + los standard (Email, Company, Phone, Lead Source) al nuevo layout
6. Save

**Después:** copiá el Layout ID (sale en la URL del edit, tipo `4500000099887766`) y pasamelo. Lo seteo en la env var `ZOHO_CRM_LEAD_LAYOUT_ID` y desde ahí todos los leads nuevos arrancan con ese layout aplicado.

---

## 3. Configurar el pipeline (Lead Status)

**Para qué:** que cuando veas un lead sepas en qué etapa está sin tener que abrir su detalle.

**Recomendación de estados:**

| Status | Cuándo se aplica | Quién lo cambia |
|---|---|---|
| **Nuevo** | Llega del funnel, todavía no hizo demo | Auto al crear |
| **Demo solicitado** | Pidió hacer la evaluación, links enviados | Auto cuando se crea el Result |
| **Demo en progreso** | Empezó alguna prueba pero no terminó las 2 | Manual (opcional) |
| **Demo completado** | Las 2 pruebas listas, reporte enviado | Auto via webhook (futuro) |
| **Llamada agendada** | Cris/equipo coordinó call para ver servicio completo | Manual o auto via Bookings |
| **Cliente** | Firmó contrato, ahora es Tenant en SharkTalents | Manual o auto via Zoho Sign |
| **No interesado** | Respondió que no le interesa o se enfrió | Manual |

Estos los configurás en: **CRM → Setup → Customization → Layouts → SharkTalents Lead → Lead Status field → Edit picklist values**.

> **Importante:** los estados del CRM son visuales para vos, son **independientes** de lo que el backend maneja internamente. La sincronización auto del status CRM ↔ backend está code-complete pero requiere un webhook que todavía no está activo. Por ahora moverás manual o me decís cuándo querés activarlo.

---

## 4. Tag estratégico

Hoy el backend pone tag `SharkTalents` a todos. Cuando el lead completa el demo, le suma tag `Demo Completed`.

**Tags que conviene agregar manualmente cuando corresponda:**
- `Cliente Pago` — cuando firme contrato
- `Demo Cancelado` — si abandona antes de terminar
- `Reactivar Q3` — para los que no compraron pero dijeron "tal vez después"

---

## 5. Workflow automation recomendada (opcional)

**Para qué:** que el CRM te avise cuando algo importante pasa sin que tengas que mirar manualmente.

**Workflows sugeridos** (CRM → Setup → Automation → Workflows):

1. **Nuevo lead alto score** → notificación a Cris (Slack/email)
   - Trigger: Lead created
   - Criteria: Score Calidad ≥ 70
   - Acción: Send email notification a `cuentas@kunodigital.com`

2. **Demo completado → call to action**
   - Trigger: Lead Status changes to "Demo completado"
   - Acción: Send email task a Cris "Coordinar llamada de venta con [lead]"

3. **Lead frío** → recordatorio de follow-up
   - Trigger: Modified Time = 7 días sin cambios
   - Criteria: Lead Status = "Demo solicitado"
   - Acción: Send email task "Lead sin actividad — considerar follow-up"

---

## 6. Dashboard "SharkTalents Funnel"

**Para qué:** ver en una sola pantalla cómo viene el embudo (cuántos leads, cuántos completaron demo, conversión por etapa).

**Pasos:**
1. CRM → Reports & Dashboards → **New Dashboard** → `SharkTalents Funnel`
2. Agregar widgets:
   - **Funnel chart** con dimension `Lead Status` y filter `Tag contains "SharkTalents"`
   - **Counter** "Leads este mes" — Created Time = This Month + Tag SharkTalents
   - **Counter** "Demos completados" — Tag contains "Demo Completed"
   - **Tabla** "Top 10 leads recientes" — ordenado por Created Time desc
   - **Line chart** "Leads por día" — agrupado por Created Time, últimos 30 días

---

## 7. Webhook reverso (segunda etapa)

Hoy el backend manda info AL CRM. **No** lee info DEL CRM. Si en algún momento querés que el cambio de status manual en CRM se refleje en SharkTalents (ej. marcás "Cliente Pago" en CRM y eso crea automáticamente el Tenant en SharkTalents), eso es trabajo nuevo que estimamos cuando lo necesites.

Por ahora la dirección es one-way: SharkTalents → CRM.

---

## Checklist rápida cuando entres al CRM

- [ ] Verificar que aparece tu primer lead de prueba (`cpalma+pruebafinal@kunodigital.com`)
- [ ] Crear vista filtrada `SharkTalents — Leads`
- [ ] Crear los 5 campos custom para el layout
- [ ] Clonar layout standard → `SharkTalents Lead`
- [ ] Configurar valores de Lead Status
- [ ] (Opcional) Crear dashboard funnel
- [ ] Pasarme el Layout ID si lo creaste
- [ ] (Opcional) Configurar los 3 workflows automáticos

Cuando termines avísame y verificamos que el lead nuevo se renderice bien con el layout custom.

---

## Si te encontrás con algo raro

Cualquier campo que el backend manda y no aparece en CRM, probablemente es porque el campo no existe en tu CRM o tiene otro nombre. Mandame screenshot y lo ajustamos del lado del backend (`functions/api/src/lib/zohoCrmClient.ts`).
