# FRAMEWORK: RESOLUCIÓN ESTRUCTURADA DE PROBLEMAS
## Síntesis del curso McKinsey Forward — Para uso en Claude Code

Este framework aplica a cualquier problema del proyecto: bugs, integraciones, errores de datos, flujos rotos, decisiones de arquitectura. El objetivo es llegar a la causa raíz y a una solución alcanzable de forma eficiente, sin saltar directo al código.

---

## PASO 0 — ANTES DE TODO: ¿QUÉ TIPO DE PROBLEMA ES?

No todos los problemas se resuelven igual. Clasificar primero.

### Por naturaleza:
- **Analítico/cuantitativo:** el problema tiene una respuesta objetiva, medible. Se puede confirmar con datos, logs, pruebas. → *Ejemplo: "¿Por qué falla el envío de correos?"*
- **Conceptual/cualitativo:** la respuesta requiere juicio, diseño, criterio. No hay una única respuesta correcta. → *Ejemplo: "¿Cómo debería estructurarse el flujo de aprobación del perfil de cargo?"*

### Por fase de resolución:
- **Convergente:** hay que ir eliminando opciones hasta llegar a UNA respuesta. Aplica cuando el problema es concreto y tiene una causa raíz. → Investigar, descartar, confirmar.
- **Divergente:** hay que abrir el espacio de soluciones antes de elegir. Aplica cuando no está claro cómo resolver algo o cuando hay que diseñar algo nuevo. → Generar opciones primero, luego elegir.

**⚠️ Error común:** aplicar pensamiento analítico/convergente a problemas que necesitan pensamiento conceptual/divergente — o viceversa.

---

## LOS 7 PASOS DEL ENFOQUE DE HIPÓTESIS

Aplica este enfoque para problemas convergentes y analíticos. Para problemas divergentes o conceptuales, usa primero divergencia (generar ideas) y luego converge con estos pasos.

### PASO 1 — DEFINIR EL PROBLEMA (SMART)

Antes de buscar soluciones, asegúrate de que el problema está bien definido. Una mala definición lleva a resolver el problema equivocado.

Aplica el criterio **SMART**:
- **S — Específico:** ¿Qué exactamente está fallando? ¿En qué módulo, qué función, qué condición?
- **M — Medible:** ¿Cómo sabremos que está resuelto? ¿Qué debe cambiar?
- **A — Alcanzable:** ¿Es posible resolverlo con lo que tenemos?
- **R — Relevante:** ¿Es este el problema real, o es síntoma de otro?
- **T — A tiempo:** ¿Qué tan urgente es? ¿Cuánto tiempo hay para resolverlo?

**Preguntas clave para definir:**
- ¿Qué DEBERÍA ocurrir?
- ¿Qué ESTÁ ocurriendo?
- ¿Cuándo empezó? ¿Ocurre siempre o solo en ciertas condiciones?
- ¿Qué cambió antes de que apareciera el problema?

**⚠️ Trampa principal:** el sesgo de acción — saltar a solucionar sin haber definido bien. Si defines mal el problema, toda la solución será incorrecta.

---

### PASO 1B — HOJA DE PLANTEAMIENTO (para problemas complejos)

Cuando el problema es grande o ambiguo, usa estas dimensiones:

1. **Pregunta problema** — ¿Qué se debe resolver? (en forma SMART)
2. **Contexto** — ¿Qué factores rodean el problema? (historial, restricciones del sistema, deuda técnica)
3. **Alcance** — ¿Qué está dentro y fuera del análisis?
4. **Restricciones** — ¿Qué NO puede cambiar? (tiempo, infraestructura, integraciones externas)
5. **Criterios de éxito** — ¿Cómo sabemos que está resuelto?
6. **Partes interesadas** — ¿Quién se ve afectado? ¿Quién debe aprobar la solución?
7. **Fuentes de información** — ¿Logs, base de datos, código existente, documentación de API?

---

### PASO 2 — ESTRUCTURAR EL PROBLEMA (Árbol lógico)

Descomponer el problema en partes más pequeñas y manejables. No ir directo al código.

**Cómo hacerlo:**
1. Toma la pregunta problema del paso 1.
2. Pregunta: ¿En qué grandes categorías puede estar la causa o solución?
3. Divide en ramas. Cada rama es una hipótesis de dónde está el problema.

**Ejemplo para un bug de integración de correos:**
```
¿Por qué no se envían los correos?
├── Problema de configuración (credenciales, variables de entorno)
├── Problema de código (lógica de envío, trigger incorrecto)
├── Problema de proveedor externo (límites de API, servicio caído)
└── Problema de datos (email inválido, template corrupto)
```

**Criterio MECE — verifica que el árbol sea:**
- **Mutuamente Exclusivo:** cada posible causa aparece en UNA sola rama, sin superposición.
- **Colectivamente Exhaustivo:** las ramas cubren TODAS las posibles causas, sin brechas.

**⚠️ Error común:** eliminar ramas del árbol antes de tiempo. Primero construye el árbol completo, luego prioriza.

---

### PASO 3 — PRIORIZAR (Regla 80-20 + Matriz de priorización)

No puedes investigar todo. Elige qué investigar primero.

**Regla 80-20:** El 80% de los insights vienen del 20% del análisis. Identifica qué rama del árbol tiene mayor probabilidad de contener la causa raíz y empieza por ahí.

**Para bugs / causa raíz:** prioriza por **probabilidad** — ¿cuál rama es más probable que contenga el problema?

**Para decisiones de diseño / soluciones:** usa la **Matriz de priorización**:

| | **Alta factibilidad** | **Baja factibilidad** |
|---|---|---|
| **Alto impacto** | ✅ Hacer primero | ⚠️ Evaluar si vale la pena |
| **Bajo impacto** | 🔵 Victoria rápida | ❌ Evitar |

**⚠️ Error común:** parálisis de análisis — intentar investigar todo al mismo tiempo. Elige una rama, confírmala o descártala, luego avanza.

---

### PASO 4 — PLAN DE ANÁLISIS

Antes de tocar el código, define qué vas a revisar y en qué orden.

Para cada rama priorizada, define:
- **Hipótesis:** ¿Qué crees que está causando el problema?
- **Análisis:** ¿Qué hay que revisar para confirmarla o descartarla? (logs, archivos, endpoints, DB)
- **Fuente:** ¿Dónde está esa información?
- **Producto final:** ¿Qué debe producir este análisis?

**Haz pausas durante el análisis** para verificar: ¿esto me está acercando a la solución, o me estoy perdiendo en los detalles?

---

### PASO 5 — LLEVAR A CABO EL ANÁLISIS

Ahora sí, investiga el código, revisa logs, ejecuta pruebas.

**Regla clave:** hay una diferencia entre el análisis y la respuesta. No confundas encontrar datos con entender qué significan. Pregúntate constantemente: ¿esto me está ayudando a responder la pregunta del paso 1?

---

### PASO 6 — SINTETIZAR (no solo resumir)

**Resumen** = lista de lo que encontraste (qué archivos revisé, qué logs vi, qué errores aparecieron).
**Síntesis** = el "y entonces" — ¿qué significa todo eso? ¿Cuál es la causa raíz real?

Ejemplo:
- ❌ **Resumen:** "Revisé el servicio de email, el .env, el módulo de notificaciones y el log del servidor. Encontré errores 500 en tres ocasiones entre el 10 y el 14 de mayo."
- ✅ **Síntesis:** "El servicio de email falla cuando el campo `to` viene vacío desde el módulo de aprobación de perfiles. Eso ocurre porque el perfil se puede guardar sin email validado."

Una síntesis incluye siempre dos elementos: **perspectiva** (qué aprendimos) + **implicación** (qué debemos hacer).

---

### PASO 7 — RECOMENDACIÓN

La recomendación va más allá de la síntesis. No solo dice cuál es el problema — dice qué hacer, quién lo hace y cómo.

Una buena recomendación es:
- **Alcanzable:** tiene pasos concretos y un responsable claro.
- **Apropiada:** considera el contexto del proyecto — tiempo, recursos, impacto en otras partes del sistema.

---

## REDUCCIÓN DE SESGOS — ANTES DE CONCLUIR

Al analizar problemas, ten en cuenta estos tres sesgos frecuentes:

1. **Sesgo de confirmación:** buscar evidencia que confirme lo que ya creías. → Activamente busca evidencia en contra de tu hipótesis.
2. **Sesgo de confianza:** asumir que la solución que propones no puede fallar. → Pregúntate: ¿qué podría salir mal con este fix?
3. **Sesgo de estabilidad:** usar la misma solución que funcionó antes sin evaluar si aplica aquí. → Libera restricciones: ¿si pudieras hacerlo diferente, cómo sería?

---

## RESUMEN RÁPIDO — ¿CUÁNDO USAR QUÉ?

| Situación | Herramienta |
|-----------|-------------|
| No sé bien qué está fallando | Definición SMART + Árbol lógico |
| El problema es grande y tiene muchas partes | Hoja de planteamiento |
| Tengo muchas posibles causas, poco tiempo | Regla 80-20 + priorización por probabilidad |
| Necesito elegir entre varias soluciones | Matriz de priorización (impacto vs factibilidad) |
| No sé cómo estructurar la solución | Pensamiento divergente → luego convergente |
| Tengo los hallazgos, qué sigue | Síntesis → Recomendación |
| El mismo fix no funciona de nuevo | Verificar sesgo de estabilidad |
