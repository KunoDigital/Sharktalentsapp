# Aprendizajes — Construyendo Aplicaciones Serverless Serias en Catalyst

Manual de arquitectura para proyectos en **Zoho Catalyst Cloud Scale**. Reglas, patrones, anti-patterns y casos de estudio destilados de experiencia real.

Cada documento es **autocontenido**: podés leer uno suelto sin necesitar los otros. Los ejemplos usan entidades genéricas (`Order`, `User`, `Payment`, `Notification`, etc.) para que apliquen a cualquier proyecto.

---

## Cómo usar este manual

- **Antes de arrancar un proyecto nuevo:** leer 01 → 05 para los fundamentos
- **Durante desarrollo:** consultar según el tema (06-11)
- **Antes de deploy:** pasar el checklist (14)
- **Cuando algo falla:** mirar casos de estudio (13) y anti-patterns (12)

---

## Índice

| # | Documento | Cuándo leerlo |
|---|---|---|
| [01](01_ARQUITECTURA.md) | Arquitectura y elección de productos | Antes de arrancar |
| [02](02_MODULARIZACION.md) | Modularización: por qué `index.js` no debe crecer | Al estructurar código |
| [03](03_DATABASE_DESIGN.md) | Diseño de base de datos en Catalyst | Al diseñar tablas |
| [04](04_SEGURIDAD.md) | Seguridad: auth, HMAC, tokens, validación | Desde día 1 |
| [05](05_RELIABILITY.md) | Reliability: idempotencia, retry, fallback, circuit breaker | Antes de integrar APIs externas |
| [06](06_OBSERVABILITY.md) | Observability: logs, debugging, health checks | Cuando algo falla |
| [07](07_PERFORMANCE_COSTOS.md) | Performance y costos | Antes de que la factura duela |
| [08](08_INTEGRACIONES_EXTERNAS.md) | Integraciones externas: webhooks, callbacks, APIs | Al agregar un tercero |
| [09](09_ESTADO_Y_FLUJOS.md) | State machines y flujos async diferidos | Al diseñar flujos multi-paso |
| [10](10_FRONTEND_PATTERNS.md) | Patrones de frontend | Al construir el panel |
| [11](11_CICD_Y_DEPLOY.md) | Git workflow, CI/CD y deploys en Catalyst | Al configurar deploys |
| [12](12_ANTIPATTERNS.md) | Anti-patterns con ejemplos | Revisión de código |
| [13](13_CASOS_DE_ESTUDIO.md) | Casos de estudio: bugs reales y lecciones | Al debuggear problemas parecidos |
| [14](14_CHECKLIST_PROD.md) | Checklist antes de producción | Antes de cada release mayor |
| [16](16_AGREGAR_TEST_CANDIDATO.md) | Cómo agregar una nueva prueba para candidato | Al sumar evaluación nueva |
| [17](17_DEV_PROD_ENVIRONMENTS.md) | Entornos DEV y PROD en Catalyst — qué se separa, qué no, cómo promover | Al configurar o promover deploys |

---

## Convenciones de este manual

- **Entidades de ejemplo genéricas:** `Order`, `User`, `Payment`, `Notification`, `Subscription`. Traducí mentalmente a tus entidades del proyecto.
- **Stack asumido:** Zoho Catalyst Cloud Scale + Node.js + SPA frontend. La mayoría de principios aplican a otros serverless (AWS Lambda, Vercel, etc.) — los detalles específicos de Catalyst están marcados.
- **❌** marca anti-patterns. **✅** marca patterns recomendados.
- Los ejemplos están simplificados — en producción agregá más try/catch, logs, etc.
- Cuando un ejemplo requiere contexto, lo explico en prosa antes del código.

---

## Filosofía general

### 1. Boring technology wins

La elección correcta casi siempre es la más aburrida. Stack probado, patrones conocidos, librerías maduras. Innovar en el negocio, no en la infra.

### 2. El costo real no es el código, es el mantenimiento

Escribir una feature toma días; mantenerla, años. Cada línea es una responsabilidad futura.

### 3. La observability no es opcional

Si no podés debuggear un incidente a las 3am, la app no está lista para producción.

### 4. Idempotencia es la moneda de reliability

Todo proceso que pueda correr dos veces debe dar el mismo resultado. Si no lo diseñás así desde el inicio, pagás con data duplicada, cobros doble, notificaciones spam.

### 5. Seguridad desde la primera línea

Hashing, HMAC, validación de inputs. No se agrega "después" — o está desde día 1 o se olvida.

### 6. Documentá mientras construís

Si una feature sale sin doc, en 6 meses nadie entiende por qué decidiste X. Doc antes del código, no después.

### 7. YAGNI (You Aren't Gonna Need It)

Antes de agregar una capa, una abstracción, una feature, un flag — preguntá: ¿lo necesito ahora? El código que no escribís no tiene bugs.

---

## Qué NO cubre este manual

- Tutorial básico de Node.js / React
- Onboarding con Zoho Catalyst (ver docs.catalyst.zoho.com)
- Tests automatizados (hay un gap — este manual asume que los agregás aparte)
- Performance de frontend (bundling, lazy loading profundo)

Para esos, usá docs oficiales o libros especializados.

---

## Actualizá este manual

Cuando encuentres un bug, un patrón nuevo, una lección — **agregala**. Un manual vivo vale 10× más que uno congelado en el tiempo.

Cada regla acá tiene una cicatriz detrás. Agregá las tuyas.
