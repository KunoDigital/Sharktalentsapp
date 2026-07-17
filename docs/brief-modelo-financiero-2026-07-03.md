# Brief para consultor/CFO — Modelo financiero SharkTalents

**Fecha:** 2026-07-03
**Preparado por:** Cris Palma (con soporte de asistente técnico, no financiero)
**Destinatario:** consultor/experto financiero externo

Este documento contiene TODO el contexto necesario para modelar el negocio sin necesidad de preguntas adicionales a Cris. Si algún dato falta, está explícitamente marcado como "a completar".

---

## 1. Contexto de negocio

**SharkTalents** es una plataforma de reclutamiento con evaluación por IA. Filtra candidatos en 5-6 dimensiones (Conducta/DISC, Cognición/VELNA, Técnica, Integridad, Mentalidad, Emoción) y entrega al cliente 3-4 finalistas con reporte comparativo.

- **Propietaria:** Kuno Digital (4 departamentos, SharkTalents es uno)
- **Operadora principal:** Cris Palma, empleada de Kuno (no dueña, no accionista)
- **Toda la inversión inicial:** Kuno
- **Estado actual (jul-2026):** plataforma técnica lista, 1 lead entrante real, buscando cerrar primer cliente pagando
- **Meta operativa de arranque:** 3 puestos vendidos al mes

---

## 2. Modelo de precio y descomposición confirmados

### 2.1 Precio de venta al cliente

**Fórmula fija:** `Precio_venta = 1.2 × salario_mensual_del_puesto_a_contratar`

**Rango de puestos que se venden:**
- Salario mínimo modelable: **$2,000 USD/mes** (piso operativo)
- Rango normal esperado: $2,000 – $5,000
- Segmento objetivo: C-level, directores, gerentes de área, mandos medios-altos
- No se venden puestos operativos/bajos

**Ejemplos:**
| Salario puesto | Precio venta al cliente |
|---|---|
| $2,000 | $2,400 |
| $3,000 | $3,600 |
| $5,000 | $6,000 |

### 2.2 Descomposición del 100% de la venta (reglas FIJAS, no negociables)

| Bucket | % | Naturaleza | Notas |
|---|---|---|---|
| Costos operativos | **20%** | Techo — nunca sube | Incluye LinkedIn ads, Anthropic API, Zoho, Twilio, storage, salario Cris parcial, creador de contenido, otros costos plataforma |
| Reinversión marketing | **20%** | Fijo | Nueva pauta, contenido, alcance |
| Comisión vendedor externo | **10%** | Fijo, sobre venta bruta | No cambia con volumen ni escenario |
| Comisión Cris | **10%** | Fijo, base variable ↓ | Ver 2.3 |
| **Ganancia neta Kuno** | **40%** | Residual, va al accionista | Retorno de inversión |

**Suma:** 100%.

### 2.3 Comisión de Cris — % fijo, base variable

Cris **siempre** cobra 10%. Lo que cambia es la base:

- **Fase arranque (hoy):** 10% × precio_venta_bruta (100% del ingreso)
- **Fase escalada (a definir):** 10% × ganancia_neta_pre_Cris (ese 50% que queda después de descontar costos, marketing y vendedor)

**Trigger del cambio:** ❓ **A definir por el consultor.** Cris NO tiene claro el momento exacto — ese es uno de los puntos principales a modelar. Su hipótesis inicial: cuando el negocio esté "establecido" y se prefiera alinear su incentivo con rentabilidad total en vez de volumen bruto.

### 2.4 Nota matemática sobre la comisión

Con las reglas actuales, "sobre venta bruta" siempre paga MÁS a Cris que "sobre ganancia":
- 10% del 100% del precio = 10% del precio
- 10% del 50% que queda como ganancia neta pre-Cris = 5% del precio

Por lo tanto, el cambio de base **NUNCA es matemáticamente favorable** para Cris con estas fórmulas. Solo tendría sentido si:
- (a) El % de comisión sube al pasar a "ganancia" (ej: 20% de ganancia > 10% de venta cuando ganancia = 50% del precio)
- (b) El cambio es motivacional/estratégico, no matemático (alinear a Cris con rentabilidad total del negocio)
- (c) El consultor propone otra estructura

**A validar por el consultor.**

---

## 3. Actores y quién cobra qué

| Actor | Cobra | Fuente | Naturaleza |
|---|---|---|---|
| Kuno Digital | Ganancia neta 40% del precio + eventual dividendo | Accionista | Retorno de inversión |
| Cris Palma | Salario base + 10% comisión (venta o ganancia) | Empleada Kuno | Salario ~$1,500/mes; **80% del salario lo paga SharkTalents**, 20% ($300) lo cubre Consultoría (otro depto de Kuno) |
| Vendedor externo (aún no contratado) | 10% comisión sobre venta bruta | Contratista externo | Sin salario base — solo comisión |
| Creador de contenido SharkTalents | Salario/fee fijo mensual | Contratista o empleado | Monto a completar (Cris dice "hay que pensar") |

---

## 4. Costos fijos reales (estimados — REQUIEREN VALIDACIÓN)

Estos son costos que hay que pagar aunque en el mes se venda 0 puestos:

| Concepto | Estimado mensual | Estado |
|---|---|---|
| Salario Cris (80% que paga SharkTalents) | $1,200 | Confirmado por Cris |
| Zoho suite (compartido entre 4 depts de Kuno, ~25% para SharkTalents) | $150 | **Estimación — Cris debe confirmar prorrateo real** |
| LinkedIn Sales Navigator + campañas base | $200 | **Estimación — Cris debe confirmar plan/tarifa real** |
| Creador contenido SharkTalents | $400 | **Estimación — Cris dice "hay que pensar"** |
| Anthropic API + Twilio + Catalyst storage (base sin volumen) | $100 | Estimación conservadora |
| Contador / gestión administrativa | ❓ | **Falta dato** |
| Hosting web / dominio | ❓ | **Falta dato** |
| Buffer/imprevistos | $100 | Convención |
| **Total estimado** | **$2,150** | **Requiere validación línea por línea** |

**Nota:** Los costos operativos VARIABLES (Anthropic API por candidato evaluado, LinkedIn ads por puesto publicado, WhatsApp por lead atendido) crecen con volumen. En el modelo confirmado están DENTRO del 20% de "costos operativos" designado del precio de venta. El consultor debe validar si esa asignación cierra o hace falta separar fijos y variables.

---

## 5. Meta operativa

**Corto plazo (Q3-Q4 2026):** cerrar y facturar 3 puestos por mes.

**Volumen esperado por escenario (a definir por el consultor):**
- Pesimista mes 1-3: ❓ (Cris no lo tiene claro, sugerencia: 1 puesto/mes)
- Base mes 3-6: 3 puestos/mes
- Optimista mes 6+: ❓ (5? 7? 10?)

**Segmento de precio esperado:** mezcla — la mayoría rondando $2,500-$3,500 salario del puesto.

---

## 6. Verdades incómodas detectadas (para validar con el consultor)

### 6.1 El 20% designado a "costos operativos" puede NO cubrir los fijos reales

Con 3 puestos × $2,500 al mes:
- Ingreso mensual: $9,000
- 20% "costos operativos" designado: $1,800
- Costos fijos reales estimados: **$2,150**
- **Faltante: $350/mes**

**Implicancia:** el modelo Cristian asume que el 20% designado cubre TODOS los costos. Con los fijos estimados actuales y volumen de 3 puestos, no cierra. Se cubre a partir de:
- ~4 puestos de $2,500 al mes
- ~3 puestos de $3,500 al mes
- (Cálculos simples, no auditados profesionalmente.)

**A validar:** ¿el modelo Cristian de 20% asume un VOLUMEN mínimo específico donde sí cierra? ¿Es necesario separar costos fijos "reales" fuera del 20% del ingreso?

### 6.2 Comisión vendedor externo sobre VENTA (no margen) transfiere riesgo a Kuno

Si el vendedor cobra 10% del precio bruto **antes** de descontar costos:
- En meses con costos por encima de lo esperado, Kuno paga la comisión con margen ya erosionado
- En meses malos con cero venta, no hay costo (bien) pero tampoco incentivo alineado

Cris ACEPTÓ esta estructura para priorizar velocidad de ventas en el arranque. **El consultor debe validar** si el riesgo es asumible o si conviene:
- (a) Base garantizada + comisión reducida
- (b) Comisión escalonada por volumen
- (c) Mantener como está

### 6.3 El salario de Cris se comporta como fijo pero pesa 55% de los fijos totales

$1,200 de $2,150 = 56% del total de costos fijos. Si SharkTalents fracasa, Cris pierde parte de su salario (Consultoría cubre solo 20% del total). Esta concentración de riesgo salarial vale considerarla en el modelo.

### 6.4 No hay dato sobre impuestos

El modelo actual llega hasta "ganancia neta Kuno = 40%". No hay descuento explícito por:
- ITBMS Panamá (7% si aplica facturación local)
- Impuesto sobre la renta corporativo
- Cargas sociales sobre el salario de Cris

**A modelar:** cuánto queda REALMENTE para Kuno después de impuestos.

---

## 7. Preguntas abiertas que Cris quiere que el consultor resuelva

1. **Trigger objetivo para cambio de base de comisión Cris** (de "sobre venta" a "sobre ganancia"): ¿cantidad de puestos/mes? ¿Ingreso anual acumulado? ¿Punto de break-even multiplicado por N?

2. **¿La comisión Cris al cambiar de base debería ser el mismo 10% o subir?** Ver nota matemática en 2.4.

3. **¿El 20% "costos operativos" incluye costos fijos + variables o solo variables?** Si solo variables, dónde se pagan los fijos ($2,150/mes).

4. **¿Cuál es el break-even mensual real** considerando fijos + volumen medio de venta?

5. **Escenarios de sensibilidad** — cómo se comporta el modelo si:
   - Un mes cae a 0 puestos (¿cuántos meses de reserva se necesitan?)
   - Costos fijos suben 20% (creador contenido pide aumento, más pauta LinkedIn)
   - Un puesto se cae después de facturado (¿hay política de rebúsqueda con costo?)

6. **Punto óptimo para contratar segundo vendedor externo** — a partir de qué facturación mensual el ROI de un vendedor adicional es positivo.

7. **Estructura fiscal recomendada** — ¿SharkTalents debe facturar bajo Kuno Digital o entidad separada? Impacto tributario.

8. **KPIs para monitorear el modelo** — qué métricas debe ver Cris mensualmente para saber si el negocio va bien (más allá de "vendí X puestos").

---

## 8. Escenarios que Cris quiere modelar (pedido de Cristian)

**Precios de puesto a simular:** $2,000 · $3,000 · $5,000
**Cantidades a simular:** 1 · 2 · 3 · 4 puestos por mes
**Base de comisión:** ambas (sobre venta y sobre ganancia)

**Entregable esperado del consultor:**
- Tabla comparativa con las 12 combinaciones (3 precios × 4 cantidades)
- Ganancia neta Kuno para cada combinación
- Comisión Cris para cada combinación (con ambas bases)
- Alerta visual de meses donde no se cubren costos fijos
- Punto de break-even claro
- Trigger definido para el cambio de base de comisión
- Recomendación sobre estructura fiscal
- Presupuesto para reserva de emergencia (meses sin venta)

---

## 9. Herramientas ya construidas (referencia técnica)

Existe un simulador HTML interactivo con lo que Cris pudo modelar sin consultor: [docs/modelo-financiero-2026-07-03.html](modelo-financiero-2026-07-03.html)

**Advertencia:** ese simulador implementa las reglas confirmadas pero NO fue auditado por experto. Sirve como base de discusión, no como decisión final.

---

## 10. Costo real de IA por puesto (auditoría técnica 2026-07-03)

Auditoría exhaustiva del código backend para responder "¿cuánto cuesta la IA por puesto?":

### Modelo usado
- **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) — el modelo más barato de Anthropic
- Pricing hardcoded en el código: $1/1M input · $5/1M output · $0.10/1M cache read
- Prompt caching activado por default (reduce costo de system prompts largos)

### Volumen aproximado por puesto (60 candidatos aplicando)
Con embudo típico: 60 aplican → 36 pasan prescreening → 22 pasan técnica → 18 llegan al final del funnel (video + análisis completo)

| Etapa | Llamadas Claude |
|---|---|
| Setup del puesto (draft + preguntas técnicas + prefilter) | 7-9 |
| Por candidato del final del funnel (conductual + video preguntas + video análisis × 7 + bot + writing si aplica) | ~10-11 c/u × 18 = ~180 |
| Reporte final (narrativas + conclusión) | 5-6 |
| **Total llamadas Claude por puesto** | **~185-195** |

### Costo estimado por puesto

| Componente | Tokens totales | Costo USD |
|---|---|---|
| Claude Haiku (input + output) | ~560,000 tokens | ~$1.10 - $1.30 |
| OpenAI Whisper (18 cand × 9 min × $0.006) | — | ~$0.97 |
| **Total IA por puesto** | | **~$2.10 - $2.30** |

**Como % del precio de venta:**
- Puesto de $2,500 salario (venta $3,000): 0.07%
- Puesto de $5,000 salario (venta $6,000): 0.035%

**Conclusión:** el costo de IA es TRIVIAL frente al 20% de "costos operativos" designado. Cabe ~1000 veces dentro del margen. El foco de costos NO es la IA — son los fijos (salario Cris, creador de contenido, LinkedIn Sales Navigator, Zoho compartido).

### Hallazgo importante — observabilidad de IA está rota

Existe infra completa para trackear consumo (tabla `TokenUsage` + cliente `recordTokenUsage` + dashboard `JobCosts`) pero **solo 3 de ~15 features de IA están instrumentadas**. La feature más cara (`auto_draft` con prompt de 8-15k tokens) NO registra. Recomendación: taggear las 12 features restantes con `feature:` para tener observabilidad real antes de escalar.

### Nota sobre las "6 pruebas"

De las 6 dimensiones evaluadas (Conducta, Cognición, Técnica, Integridad, Mentalidad, Emoción), **solo Conducta/DISC usa IA por candidato**. Las otras 5 son scoring 100% determinístico (bien para costos, pero técnicamente el pitch de venta "6 pruebas con IA" es inexacto). La IA por candidato se concentra en video (~15 llamadas), bot decisor (1) y narrativa del reporte (1 si es finalista).

---

## 11. Estado de infraestructura y datos disponibles
</invoke>

- Cuenta Mercury (banco USD) activa — Cris tiene acceso a transacciones históricas
- Zoho Books activo — puede exportar balances y P&L
- LinkedIn Sales Navigator activo
- Sistema de facturación pendiente de definir (probablemente Zoho Books)

Si el consultor necesita datos históricos de gasto real (últimos 3-6 meses), Cris puede exportar desde Mercury y Zoho Books.

---

## 12. Cómo contactar a Cris

- Email: proyectos@kunodigital.com (o correo personal a definir)
- Prioridad: cerrar primer cliente pagando antes de expandir infraestructura

---

**Fin del brief.**
