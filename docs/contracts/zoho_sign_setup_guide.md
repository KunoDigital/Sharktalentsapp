# Guía: subir el contrato a Zoho Sign como Template

**Última actualización:** 2026-05-11
**Para mañana, paso a paso.**

---

## 1. Convertir el `.md` a PDF/Word

El template está en [contrato_sharktalents_TEMPLATE.md](contrato_sharktalents_TEMPLATE.md) — markdown con espacios en blanco (líneas largas `_______`).

**Opción A — Google Docs (recomendado, 2 min):**

1. Abrí el archivo `contrato_sharktalents_TEMPLATE.md` en cualquier editor de texto
2. **Copy → paste** todo el contenido en un Google Doc nuevo
3. Google Doc renderiza el markdown bien (títulos, listas, bold)
4. Ajustá lo que veas raro (espaciado, márgenes)
5. **Archivo → Descargar → PDF (.pdf)**

**Opción B — Word:**

1. Lo mismo pero en Microsoft Word
2. **Save As → PDF**

**Opción C — Pandoc (terminal, instant):**

```bash
cd docs/contracts
pandoc contrato_sharktalents_TEMPLATE.md -o contrato_sharktalents_TEMPLATE.pdf
```

Si no tenés pandoc: `brew install pandoc` (en Mac).

---

## 2. Subir a Zoho Sign

1. Zoho Sign Console → tu cuenta
2. Sidebar izquierdo → **Templates** → **Create Template**
3. Click **Upload Document** → seleccioná el PDF
4. **Template Name:** `SharkTalents — Contrato de Servicios v1`
5. Continuar al editor

---

## 3. Configurar Signers (los firmantes)

En el editor, configurás **2 firmantes**:

| Recipient | Rol | Quién |
|---|---|---|
| **Recipient 1** | Sign First | EL PROVEEDOR (vos / Cristian) |
| **Recipient 2** | Sign Second | EL CLIENTE |

---

## 4. Arrastrar Fields sobre el PDF

En el editor de Sign, vas a ver un panel a la derecha con tipos de campo (Text, Date, Signature, Checkbox, etc.). Los arrastrás sobre el PDF en cada línea vacía `___________`.

**Cada Field necesita:**
- **Field Name** (importante — la API usa este nombre): pegá exacto de la tabla de abajo
- **Recipient:** quién lo va a ver/llenar
- **Type:** Text / Signature / Date

### Fields a arrastrar (en orden de aparición en el contrato):

| Field Name (exacto) | Tipo | Recipient | Pre-filled / Manual |
|---|---|---|---|
| `cliente_nombre_representante` | Text | Recipient 2 (Cliente) | Pre-filled by API |
| `cliente_empresa` | Text | Recipient 2 | Pre-filled by API |
| `cliente_ruc_nit_ein` | Text | Recipient 2 | Pre-filled by API |
| `cliente_direccion` | Text | Recipient 2 | Pre-filled by API |
| `cliente_email` | Text | Recipient 2 | Pre-filled by API |
| `cliente_telefono` | Text | Recipient 2 | Pre-filled by API |
| `puesto_nombre` | Text | None (Pre-filled) | Pre-filled by API |
| `plazo_min_dias` | Text | None (Pre-filled) | Pre-filled by API (default 14) |
| `plazo_max_dias` | Text | None (Pre-filled) | Pre-filled by API (default 30) |
| `fee_total_usd` | Text | None (Pre-filled) | Pre-filled by API |
| `puesto_salario_usd` | Text | None (Pre-filled) | Pre-filled by API |
| `fee_tracto_1_usd` | Text | None (Pre-filled) | Pre-filled by API |
| `fee_tracto_2_usd` | Text | None (Pre-filled) | Pre-filled by API |
| `fecha_firma` | **Date** | Auto (Sign nativo) | Auto |
| `firma_proveedor` | **Signature** | Recipient 1 (vos) | Firma vos |
| `firma_cliente` | **Signature** | Recipient 2 (Cliente) | Firma cliente |
| `tarjeta_ultimos_4` | Text | Recipient 2 (Cliente) | Escribe el cliente al firmar |
| `tarjeta_titular` | Text | Recipient 2 (Cliente) | Escribe el cliente al firmar |
| `firma_titular_tarjeta` | **Signature** | Recipient 2 (Cliente) | Firma cliente |

### Diferencia importante: "Pre-filled by API" vs "Manual"

- **Pre-filled by API:** la app SharkTalents le pasa el valor cuando dispara el contrato (ej: nombre empresa, fee total). El cliente ve esos campos ya llenados y NO los puede modificar.
- **Manual (Recipient 2):** el cliente los completa al firmar (ej: últimos 4 dígitos tarjeta).
- **Signature:** la firma electrónica nativa de Sign.
- **Date (auto):** Sign pone la fecha automática cuando firma cada parte.

---

## 5. Configurar el orden de firmas (opcional)

Recomendado: **Recipient 1 (vos) firma primero**, después se manda al cliente.

- Sign Console → Template → Workflow → **Sign in order**

---

## 6. Save Template + copiar el Template ID

1. Click **Save Template**
2. Sign te da un **Template ID** (un string tipo `4567890abc...`)
3. **Anotalo** y pasámelo

---

## 7. Yo lo conecto a la app

Cuando me pases el Template ID:

1. Lo seteamos como env var `ZOHO_SIGN_CONTRACT_TEMPLATE_ID` en Catalyst Console
2. Construyo el botón "📤 Mandar contrato" en el admin (probablemente en Settings → 📥 Leads → detalle del lead, junto a "Convertir a cliente")
3. Click en ese botón → la app pre-llena todos los fields automáticos + manda a firmar al cliente
4. Cuando el cliente firma → webhook de Sign → app automáticamente:
   - Crea el Tenant (si no existe)
   - Crea el Job desde el draft aprobado
   - Manda email al cliente con link al portal
   - Marca el lead como `status='won'`

---

## 8. Tips de UX en Sign

- Probá el template con vos mismo de Recipient 2 (mandate el contrato a tu otro email) antes de mandarlo a clientes reales
- Sign permite previsualizar el contrato con valores de prueba — usalo para verificar que todos los fields se rellenan bien
- Si hay campos que no se ven (cubiertos por texto, etc), arrastralos un poco más hacia abajo o ajustá el tamaño

---

## 9. Decisiones tomadas (NO modificar sin orden explícita)

Estas decisiones están guardadas en memoria. Si un cliente las cuestiona, son tus términos:

- **NO** hay cláusula de "hire-around" (si te contratan después por otra vía, no cobrás)
- **NO** hay garantía de reemplazo por renuncia
- **NO** hay SLA hard al cliente para entrevistar (solo defensiva: si demoran y candidatos se retiran, no es tu culpa)
- 50% al firmar = **NUNCA reembolsable**
- 50% solo se cobra al entregar el reporte
- Fee = 1.2 salarios mensuales brutos del puesto

Si algún cliente nuevo pide alguna de estas protecciones, **consultá con vos misma** antes de aceptar — son tus términos comerciales.

---

## 10. Cuando termines

Pasame:
1. El **Template ID** de Sign
2. Cualquier ajuste que hayas hecho al template (para que actualice mi memoria)

Y yo construyo el botón "Mandar contrato" en la app.
