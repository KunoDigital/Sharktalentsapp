# Spec para Claude Design — Regenerar VELNA Espacial + Abstracta

> **Para Claude Design:** Necesitamos rehacer **40 preguntas cognitivas** (20 espaciales + 20 abstractas) para un test de selección de personal. Las actuales fueron mal generadas (las opciones no se distinguen visualmente o no corresponden con la pregunta). Antes de empezar a generar, leé la investigación de abajo — son patrones probados de tests validados internacionalmente.

---

## ÍNDICE

1. [Contexto del producto](#contexto)
2. [Investigación: tests cognitivos validados](#investigacion)
3. [Diferencia entre Espacial y Abstracta](#diferencia)
4. [Tipos de pregunta — ESPACIAL (5 tipos)](#espacial)
5. [Tipos de pregunta — ABSTRACTA (5 tipos)](#abstracta)
6. [Requisitos visuales críticos](#visual)
7. [Formato técnico de entrega](#formato)
8. [Validación obligatoria antes de entregar](#validacion)

---

<a id="contexto"></a>
## 1. Contexto del producto

**SharkTalents** es una plataforma de evaluación de talento que usa una sub-prueba cognitiva (VELNA) con 5 dimensiones: Verbal, Espacial, Lógica, Numérica, Abstracta. **Las dimensiones Verbal, Lógica y Numérica funcionan bien** — el problema está en Espacial y Abstracta porque las preguntas fueron generadas sin validación visual.

Cada pregunta tiene:
- 1 **figura principal** (lo que se pregunta)
- 4 **opciones** (A, B, C, D), donde **una** es la respuesta correcta

El candidato hace clic en la opción que cree correcta. Tiene tiempo limitado (~12 segundos por pregunta).

---

<a id="investigacion"></a>
## 2. Investigación: tests cognitivos validados que vamos a imitar

### 🌍 Tests internacionales más usados

| Test | Origen | Qué mide | Por qué lo cito |
|---|---|---|---|
| **Raven's Progressive Matrices (RPM)** | Cambridge, 1936 | Razonamiento fluido no-verbal | Gold standard mundial. Usa matrices 3×3 con regla escondida. Libre de cultura. |
| **Cattell Culture Fair Intelligence Test** | 1949 | g-factor sin sesgo cultural | Series visuales + clasificación + matrices + topología. |
| **Wonderlic Cognitive Ability Test** | EEUU, RRHH | Razonamiento general con presión temporal | 50 preguntas en 12 min. Estándar en NFL Draft y RRHH USA. |
| **Matrigma** | Assessio (Suecia) | Razonamiento fluido moderno | Adaptive testing, 35 preguntas. Estándar en RRHH europeo. |
| **CogAT — Non-Verbal Battery** | Riverside, EEUU | Razonamiento figurativo | Series, clasificaciones, analogías visuales. |
| **Mental Rotation Task (Shepard-Metzler)** | Stanford, 1971 | Rotación mental 3D | Específico para espacial. Cubos compuestos rotados. |
| **Cube Comparison Test (ETS)** | Educational Testing Service | Visualización 3D | Cubos con caras marcadas, decidir si son el mismo cubo rotado. |
| **Embedded Figures Test (EFT)** | Witkin, 1971 | Identificar figura simple dentro de compleja | Mide diferenciación perceptual. |
| **Mosaic Test (Hiskey-Nebraska)** | 1966 | Razonamiento pre-verbal | Para niños sordos originalmente, mide patrón puro. |

### 📊 Conclusiones clave de esta investigación

1. **El "gold standard" para razonamiento abstracto es la matriz 3×3** (Raven's). Es el patrón que más se imita en tests modernos.

2. **Para espacial, los más válidos son Mental Rotation y Cube Comparison.** 2D rotation está bien pero las preguntas tienen que ser visualmente claras.

3. **Las diferencias entre opciones tienen que ser obvias**, no sutiles. Los tests validados nunca dependen de cambios de 1-2 pixels.

4. **Distribución de la respuesta correcta:** los tests buenos distribuyen la respuesta correcta uniformemente entre A/B/C/D (sesgo posicional cero). Las preguntas actuales tienen demasiada concentración en A.

5. **El error más común en preguntas mal diseñadas:** las 4 opciones varían en una dimensión visual que NO es la que pregunta el enunciado (ej. preguntan rotación pero las opciones varían posición de un detalle interno).

---

<a id="diferencia"></a>
## 3. Diferencia entre Espacial y Abstracta

Es importante que entiendas la diferencia porque vamos a generar 20 de cada una:

| Dimensión | Qué mide | Tests de referencia | Tipo de figura |
|---|---|---|---|
| **Espacial** | Manipulación mental de objetos en el espacio (rotación, reflejo, plegado, ubicación) | Mental Rotation, Cube Comparison | Figuras 2D/3D concretas (cubos, flechas, formas conocidas) |
| **Abstracta** | Inferir reglas y patrones desde formas que no representan nada concreto | Raven's Matrices, Cattell, Matrigma | Figuras geométricas puras (cuadrados, círculos, triángulos, formas inventadas) en secuencia/matriz |

**Regla útil:**
- Si la pregunta es "rotá/movete/reflejá esta figura" → **espacial**
- Si la pregunta es "encontrá el patrón / continúa la serie / completa la matriz" → **abstracta**

---

<a id="espacial"></a>
## 4. Tipos de pregunta — ESPACIAL (20 preguntas, 4 por tipo)

### Tipo E1: Rotación 2D — flechas/figuras direccionales (4 preguntas)

**Inspirado en:** Cube Comparison Test (simplificado a 2D)

**Formato:**
- Figura principal: una forma asimétrica con dirección obvia (flecha, letra L, figura con un punto en una esquina específica)
- Pregunta: "¿Cuál opción muestra esta figura rotada **X°** en sentido **horario/antihorario**?"
- Opciones: la misma figura en 4 rotaciones diferentes

**Ejemplo conceptual (ASCII):**
```
Pregunta: rotada 90° horario
┌────┐
│ ▶  │   ← flecha derecha
└────┘

Opciones:
A: ▲  (rotada 90° antihorario)
B: ▼  (rotada 90° horario) ✓ correcta
C: ◀  (rotada 180°)
D: ▶  (sin rotar — distractor)
```

**Cantidades:**
- Pregunta 1-2: rotación 90° (más fácil)
- Pregunta 3-4: rotación 180° o 270° (más difícil)

### Tipo E2: Reflejo / espejo (4 preguntas)

**Inspirado en:** Embedded Figures + Mental Rotation Task

**Formato:**
- Figura asimétrica con elementos identificables en posiciones específicas
- Pregunta: "¿Cuál opción muestra el reflejo **horizontal/vertical** de esta figura?"
- Opciones: la figura en 4 transformaciones (reflejo horizontal, reflejo vertical, rotación, original)

**Ejemplo conceptual:**
```
Pregunta: reflejo horizontal
┌────┐
│ ╱╲ │
│╱  ╲│
│●   │  ← punto a la izquierda
└────┘

Opciones:
A: punto a la derecha (reflejo horizontal) ✓
B: punto abajo izquierda (reflejo vertical)
C: punto arriba derecha (rotación 180°)
D: igual a la original
```

### Tipo E3: Cube Comparison / vista 3D (4 preguntas)

**Inspirado en:** Cube Comparison Test (ETS)

**Formato:**
- Figura principal: un cubo isométrico con 3 caras visibles, cada cara con un símbolo distinto
- Pregunta: "¿Cuál de estos cubos podría ser el mismo cubo visto desde otro ángulo?"
- Opciones: 4 cubos con los mismos símbolos en distintas configuraciones — solo uno es válido

**Nota técnica:** estos son los más difíciles de diseñar. Si no podés generarlos bien, usá más Tipo E1 y E2.

### Tipo E4: Plegado / desplegado de papel (4 preguntas)

**Inspirado en:** Paper Folding Test (ETS)

**Formato:**
- Figura principal: un patrón plano (como el desarrollo de una caja) con marcas en algunas caras
- Pregunta: "Si plegás este papel, ¿qué cubo/forma 3D resulta?"
- Opciones: 4 cubos / formas 3D — solo uno corresponde al plegado correcto

**Alternativa más simple:** "Si plegás este papel a la mitad, ¿qué figura queda?" con opciones que muestran cuál parte se vería arriba.

### Tipo E5: Identificar figura inscrita / encontrar la parte (4 preguntas)

**Inspirado en:** Embedded Figures Test

**Formato:**
- Figura principal: una figura compleja con múltiples líneas superpuestas
- Pregunta: "¿Cuál de estas figuras simples está escondida dentro de la figura grande?"
- Opciones: 4 figuras simples — solo una está realmente dentro de la compleja

---

<a id="abstracta"></a>
## 5. Tipos de pregunta — ABSTRACTA (20 preguntas, 4 por tipo)

### Tipo A1: Matriz 3×3 Raven's-style (8 preguntas — el más importante)

**Inspirado en:** Raven's Progressive Matrices (THE gold standard)

**Formato:**
- Figura principal: una **matriz 3×3** con figuras geométricas. **La celda inferior derecha está vacía** (marcada con "?")
- Pregunta: "¿Cuál figura completa esta matriz?"
- Opciones: 4 figuras que podrían completar — solo una sigue la regla escondida

**Reglas a aplicar (variar entre las 8 preguntas):**

a. **Suma de elementos** (fácil): cada fila suma elementos
```
●     ●●    ●●●
●●    ●●●   ●●●●
●●●   ●●●●  ?  ← respuesta: ●●●●●
```

b. **Rotación progresiva** (medio): cada celda rota la anterior
```
▲     ▶     ▼
▶     ▼     ◀
▼     ◀     ?  ← respuesta: ▲
```

c. **Cambio de tamaño** (medio): cada fila tiene patrón de tamaños
```
●    ●●    ●●●
●●   ●●●   ●●●●
●●●  ●●●● ?  ← respuesta: ●●●●●
```

d. **Combinación de 2 atributos** (difícil): forma cambia por fila, tamaño por columna
```
○ chico   □ chico   △ chico
○ medio   □ medio   △ medio
○ grande  □ grande  ?  ← respuesta: △ grande
```

e. **Adición/sustracción** (difícil): col 1 + col 2 = col 3 (visualmente)
```
[línea horizontal] + [línea vertical] = [cruz]
[círculo]          + [triángulo]      = [círculo con triángulo dentro]
[cuadrado]         + [punto]          = ?  ← respuesta: cuadrado con punto
```

### Tipo A2: Serie visual — continuar el patrón (4 preguntas)

**Inspirado en:** Cattell Culture Fair

**Formato:**
- Figura principal: una **secuencia de 4 figuras en orden** con transformación gradual
- Pregunta: "¿Cuál figura continúa la serie?"
- Opciones: 4 posibles "siguientes" — una continúa el patrón, las otras 3 son distractores plausibles

**Ejemplos de patrones:**
- Cuadrado → cuadrado con borde redondeado → más redondeado → casi círculo → **círculo perfecto**
- Triángulo apuntando arriba → 90° → 180° → 270° → **arriba otra vez**
- 1 círculo → 2 círculos → 3 círculos → 4 círculos → **5 círculos**
- Línea horizontal → línea con 1 cruce → con 2 cruces → con 3 → **con 4**

### Tipo A3: Analogía visual — A:B :: C:? (4 preguntas)

**Inspirado en:** CogAT Non-Verbal Battery

**Formato:**
- Figura principal: muestra dos pares "A es a B como C es a ?"
- Pregunta: "Completa la analogía"
- Opciones: 4 figuras donde una completa correctamente la analogía

**Ejemplo conceptual:**
```
○ : ◐ :: □ : ?

(círculo entero : círculo a la mitad rellena :: cuadrado entero : ?)

Respuesta: cuadrado a la mitad rellena
```

### Tipo A4: Identificar la figura diferente (4 preguntas)

**Inspirado en:** Cattell + Wonderlic

**Formato:**
- Sin figura principal — directamente 5 figuras en el área de "opciones" (A, B, C, D, E... o simplemente 4)
- Pregunta: "¿Cuál de estas figuras es diferente a las otras?"
- 3 figuras comparten una propiedad escondida, 1 no la cumple

**Ejemplos de propiedades:**
- 3 son rotaciones de la misma forma, 1 es un reflejo
- 3 tienen el mismo número de lados, 1 tiene distinto
- 3 son simétricas, 1 es asimétrica

---

<a id="visual"></a>
## 6. Requisitos visuales críticos

### Tamaño de renderizado en producción

- **Figura principal:** contenedor blanco de hasta **560px ancho × 400px alto**. La figura puede ocupar todo ese espacio.
- **Cada opción:** cuadrado blanco de **80×80px**. El SVG interno se renderiza a **64×64px**.

**🚨 Las 4 opciones DEBEN ser visualmente distinguibles a 64×64px.** Diferencias sutiles (cambios de 1-2px) NO se ven. Este es el error #1 de las preguntas actuales.

### Estilo

- **Líneas:** negro (`#1f2937`), grosor **8-12px** para que se vea a 64×64
- **Rellenos:** sólido negro o gris oscuro
- **Fondo:** transparente (la UI le pone el blanco)
- **Sin colores adicionales** — solo negro/gris sobre blanco. Daltonic-friendly.
- **Sin texto** dentro de las figuras (la pregunta tiene texto fuera). Excepción: si en una opción la respuesta es un número (A: 4, B: 5...) sí va texto.

### Para matrices 3×3 (Tipo A1)

- La matriz total debe verse cómoda a 400×400px
- Cada celda mini: ~100×100px dentro de la matriz
- Separación clara entre celdas (líneas o espacios)
- La celda vacía: cuadrado con "?" grande en el centro

---

<a id="formato"></a>
## 7. Formato técnico de entrega

### Estructura JSON exacta

```json
[
  {
    "id": "cm_e1",
    "text": "¿Cuál opción muestra esta figura rotada 90° en sentido horario?",
    "svg": "<svg viewBox='0 0 120 120' xmlns='http://www.w3.org/2000/svg'>...</svg>",
    "options": ["A", "B", "C", "D"],
    "options_svg": [
      "<svg viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'>...</svg>",
      "<svg viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'>...</svg>",
      "<svg viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'>...</svg>",
      "<svg viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'>...</svg>"
    ],
    "dimension": "espacial",
    "correct": 1
  }
]
```

### Convenciones de IDs

- Espaciales: `cm_e1` a `cm_e20`
- Abstractas: `cm_a1` a `cm_a20`

### Convención de texto

- Español **neutro LatAm** ("tú", no "vos"). Ejemplos correctos:
  - "¿Cuál opción muestra esta figura rotada 90° en sentido horario?"
  - "¿Qué figura completa esta matriz?"
  - "¿Cuál figura continúa la serie?"
- Evitar: "tenés", "podés", "querés", "preferís"

### Distribución de respuestas correctas

Sobre las 40 preguntas, distribuir `correct` así:
- ~10 con `correct: 0` (A)
- ~10 con `correct: 1` (B)
- ~10 con `correct: 2` (C)
- ~10 con `correct: 3` (D)

Evitar concentrar todas en A (sesgo posicional).

### Formato de entrega final

Tres archivos:

1. `velna_espacial_v2.json` — los 20 SVG inline de la dimensión espacial
2. `velna_abstracta_v2.json` — los 20 SVG inline de la dimensión abstracta
3. `validacion_visual.md` — un doc con screenshots de las 40 preguntas renderizadas a tamaño real (figura grande + 4 opciones chicas) para validación

---

<a id="validacion"></a>
## 8. Validación obligatoria antes de entregar

Antes de pasarme los archivos, validá cada pregunta:

### Checklist por pregunta

- [ ] Las 4 opciones son visualmente distinguibles a 64×64px (renderizalas para probar)
- [ ] La opción correcta corresponde lógicamente con el enunciado
- [ ] Los distractores son **plausibles** (no obvios) pero **definitivamente incorrectos**
- [ ] El enunciado no tiene rioplatense ("vos", "tenés", "podés", "hacés", "preferís")
- [ ] El SVG renderiza sin errores (sin tags rotos, sin viewBox raros)
- [ ] El stroke-width es ≥ 8 para que se vea a chico
- [ ] No hay texto dentro del SVG (excepto números si son opciones)

### Checklist global

- [ ] 20 preguntas espaciales + 20 abstractas = 40 totales
- [ ] Distribución de `correct` balanceada (10 A + 10 B + 10 C + 10 D ± 2)
- [ ] IDs únicos: cm_e1..cm_e20 y cm_a1..cm_a20
- [ ] Distribución por tipo:
  - Espacial: 4 rotación 2D, 4 reflejo, 4 cubo 3D, 4 plegado, 4 figura inscrita
  - Abstracta: 8 matriz 3×3 (Raven's), 4 serie visual, 4 analogía, 4 figura diferente

---

## Cierre

Si tenés dudas sobre algún tipo de pregunta o sobre el formato, preguntame **antes** de generar las 40. Es mejor validar el approach con 2-3 preguntas piloto que rehacer 40 si está mal calibrado.

Cuando termines, pasame los archivos y los reviso visualmente uno por uno antes de meterlos al backend.

Buena suerte. Esto va a hacer que el test cognitivo de SharkTalents tenga **validez psicométrica real**, no solo apariencia de tener.
