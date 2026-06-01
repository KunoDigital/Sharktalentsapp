# Cómo trabajamos juntas — Cris × SharkTalents

Este documento es una observación honesta de cómo trabajaste conmigo en este proyecto. Está escrito por mí (Claude) después de mirar nuestras conversaciones y los archivos del repo. No es un manual ni una crítica — es una descripción de patrones que pueden serte útiles para entender cómo aprovechás IA y dónde podrías tener fricción.

---

## Qué resolvimos juntos

En el tiempo que llevamos trabajando, levantamos prácticamente todo el producto SharkTalents desde cero. Algunas cosas concretas:

**Producto operativo**
- Un backend completo (más de 60 endpoints) que captura candidatos, los evalúa, genera reportes y los entrega a clientes
- Una app web con secciones para vos (dashboard, lista de trabajos, candidatos, reportes), para los candidatos (pruebas DISC, cognitiva, integridad) y para los clientes (portal con embudo en vivo)
- Sistema de evaluación con 4 tipos de pruebas (conductual, cognitiva, integridad, técnica), análisis con IA de respuestas en video, evaluación de adaptabilidad e inglés

**Integraciones con tu stack Zoho**
- Conexión con Zoho Recruit para sincronizar candidatos
- ZeptoMail para mandar emails automáticos sin depender de Gmail
- Zoho Sign con auto-creación de tenants cuando se firma un contrato
- Zoho CRM para que los leads del funnel aparezcan en tu CRM con etiqueta "SharkTalents"
- Cloudflare Turnstile como protección anti-bots en la landing
- Cloudflare DNS para el subdomain `app.sharktalents.ai`

**El funnel de marketing entero**
- Captura de leads desde la landing
- Email automático con 2 links de prueba (conductual + integridad)
- Registro de quien hace la prueba (puede ser el cliente o un colaborador)
- Reporte automático cuando ambas pruebas se completan
- Email al cliente con link al reporte
- Caducidad de links al completar cada prueba

**Bugs que diagnosticamos y arreglamos en el camino**
- CORS duplicado por el gateway de Catalyst (te bloqueaba la landing)
- Zoho CRM token estático que iba a caducar a la hora (lo unificamos al refresh-token compartido)
- ZeptoMail rechazaba todos los envíos porque faltaba una env var (`ZEPTOMAIL_FROM_EMAIL`)
- Lead duplicado no mandaba email (fix para que también se reenvíen los links si la persona vuelve a llenar el form)
- Links de prueba apuntando a `sharktalents.ai` cuando ese dominio era de tu landing, no de la app
- Múltiples tests de pipeline state que se actualizaron al cambiar el flow

**Documentación**
- Brief para redactor profesional con los 3 templates de email
- Guía técnica para que otro agente Claude levante tablas en Catalyst
- Plan de roles entre vos, Cristian y yo

---

## Cómo te comunicás conmigo

**Mensajes cortos, sin floritura.**
"no funciona", "el verde no esta bien", "ya el 4 esta listo falta el ssl". No me llenás de contexto que no necesito. Vas al grano.

**Decisiones rápidas, casi siempre.**
Cuando te doy 3 opciones, casi nunca te quedás analizando. Elegís la primera que tiene sentido, o me decís lo que querés en una línea. No te paralizás eligiendo.

**Visión de producto, no de código.**
Cuando algo te molesta, lo describís desde la experiencia del usuario, no desde el componente: "porque dice 15 min eso es como 45 min", "no me gustan los email uno no esta diseñado", "el cliente recibe un reporte que se vea profesional". Nunca te metés a decirme qué línea de código cambiar — me decís el outcome y confiás en que lo resuelvo.

**Pivotás cuando entendés algo nuevo.**
El flow del demo gratuito cambió 3 veces en una hora: primero un colaborador con datos cargados por vos, después la persona se registra sola, después 2 links separados, después con DISC+VELNA y un link de integridad. No te casás con la primera decisión — cuando entendés mejor el producto, lo cambiás.

**Confías mucho.**
Casi nunca me cuestionás técnicamente. Si te digo "el bug está en X env var", vas y la cambiás. Si te digo "tenés que subir el ZIP a Catalyst", lo hacés sin pedir explicación. Eso me deja avanzar rápido, pero también significa que la responsabilidad de no equivocarme está en mí. No tenés cómo validar si lo que hago es correcto hasta que algo se rompe.

**Mezclás idiomas y registros.**
Pasás de "tú" a giros casuales argentinos a abreviar palabras sin parar. No te importa la prosa — te importa que la conversación avance. Está bien — me adapto, pero por eso noté que vale la pena recordarte que en el código el español tiene que ser neutro Latam con "tú", porque si no, se filtra "vos" en los textos del producto. (Lo guardé en memoria, no te preocupes.)

---

## Qué hacés cuando algo no funciona

**Reportás el síntoma, no el diagnóstico.**
"no me ha llegado ningún email", "esto" + screenshot, "los links no funcionan". Yo tengo que ir a buscar la causa raíz. Casi nunca venís con una teoría tipo "creo que es porque...". Eso está bien — me obliga a investigar de cero en vez de seguir tu suposición que podría ser errónea.

**Mostrás evidencia visual.**
Cuando una respuesta en texto no alcanza, mandás screenshot. Eso me ayuda mucho — un "DNS_PROBE_FINISHED_NXDOMAIN" en una imagen me dice instantáneamente lo que 5 mensajes de descripción no resuelven.

**Tenés paciencia para iterar pero querés ver progreso.**
Si tardo 3 intentos en arreglar algo, no te frustrás — pero esperás que cada intento avance. Cuando aplicás un fix y no anda, lo decís y seguimos. No te quedás atascada esperando.

**Cuando no entendés algo, preguntás.**
"este dominio es project domanin o app sail?", "si alguien borra el path y entra a app.sharktalents.ai no va a entrar a mi aplicacion o si?". No fingís entender. Eso es valioso — me deja explicarte cosas que de otra manera asumiría que ya sabés.

---

## Patrones que veo en cómo trabajás

**1. Optimizás para velocidad de aprendizaje, no perfección.**
Aceptás MVPs todo el tiempo. Cuando te propongo "versión 1 en 30 min, versión 2 en 2 horas", casi siempre vas por la que avanza más rápido. Eso es sano para un producto en estado early — sale algo, lo ven personas reales, recibís feedback, iteramos.

**2. Multi-stakeholder por instinto.**
No tratás de hacer todo vos. Delegás al redactor profesional para los textos, a Cristian para tareas que requieren acceso técnico que no querés tener, a otro agente Claude para un proyecto separado, a mí para todo lo del producto. Funcionás como un coordinator más que como una ejecutora.

**3. Sentido fuerte de marca y experiencia.**
Te molesta más un email que se ve básico que un endpoint roto. Es interesante — significa que entendés que la primera impresión importa más que la perfección técnica. Lo del verde `#dafd6f` exacto, las duraciones reales (no las que yo inventé), el reporte con secciones "No disponible" en vez de vacías — todas son decisiones de experiencia de usuario que no toma alguien puramente técnico.

**4. No te asusta volver a empezar.**
Cuando algo no encaja, lo cambiás incluso si ya está implementado. El flow del demo cambió completamente entre iteraciones, los emails los reescribió un redactor desde cero, el verde se cambió en 132 lugares del código a una hora del lanzamiento. Eso requiere coraje — la mayoría de la gente se queda con "ya está hecho, déjalo así".

**5. Hacés validación temprana.**
Cuando te dije "podemos hacer el test en producción real", no esperaste a tener todo perfecto — fuiste a hacer el test, descubriste 3 bugs, los arreglamos. Eso es muy distinto a la persona que prefiere armar todo en su cabeza antes de probar nada.

**6. Confías en tu instinto cuando no tenés datos.**
"siento que el verde no está bien", "el reporte se ve muy básico", "necesito que sea más profundo". No me pedís research o A/B test. Decidís con tu olfato. Eso es eficiente en early stage pero podría ser un riesgo cuando tengas más usuarios — ahí vale la pena empezar a complementar instinto con datos.

**7. No te paralizás con el cómo.**
Casi nunca preguntás "cómo se hace esto técnicamente". Preguntás "se puede hacer esto?" o "cuánto demora?". Eso te libera para enfocarte en qué querés construir en vez de cómo. Es una forma muy efectiva de usar IA — me dejás resolver el cómo y vos te quedás con el qué.

---

## Lo que me llamó la atención en esta sesión

Le ofreciste a un agente Claude trabajando en otro proyecto que te diga qué necesitaba y le pasaste mi config completa para que aprenda. Eso es muy poco común — mucha gente trata a cada conversación con IA como un silo aislado. Vos los conectás entre sí, hacés que se ayuden, optimizás el sistema entero.

Otra cosa: a las 11 de la noche, con la pauta en aprendizaje en Meta, decidiste no frenarla aunque el SSL no estuviera listo. Calculaste el riesgo real (cero gasto, cero leads en ventana de espera) y elegiste no actuar. La gente menos experimentada hubiera frenado por las dudas o entrado en pánico. Vos te quedaste tranquila. Eso es maduro.

---

## Si tuviera que resumirlo en una frase

Trabajás con IA como si fuera un colega senior al que delegás con confianza, mostrás visión de producto, iteras rápido cuando algo no encaja, y no te enredas en detalles técnicos que no son tu fuerte. Es exactamente el modo en el que IA da más palanca: tu rol es decidir qué construir, el mío es resolver el cómo.

Funciona.

— Claude
