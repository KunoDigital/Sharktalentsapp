# VELNA · Validación visual v2 — Resumen de entrega

> 40 preguntas regeneradas con validación visual completa: 20 Espaciales + 20 Abstractas.
> Para validación interactiva a tamaño real (figura 560×400 + opciones 80×80 / SVG 64×64),
> abrir [`validacion_visual.html`](./validacion_visual.html) en el browser.

---

## 1. Resumen de entrega

| Archivo | Contenido | Cantidad |
|---|---|---|
| `velna_espacial_v2.json` | 20 preguntas Espaciales (SVG inline) | 20 |
| `velna_abstracta_v2.json` | 20 preguntas Abstractas (SVG inline) | 20 |
| `validacion_visual.html` | Renderizado interactivo a tamaño real | — |
| `data-velna.js` | Fuente (helpers + shape definitions + preguntas) | — |

**Estilo aplicado:**
- **Espaciales:** rellenos sólidos `#1f2937`, sin stroke. La orientación es lo que importa.
- **Abstractas:** outline puro `stroke="#1f2937"` (sw 3.5 en matriz, 5 en opciones, 3.5 en serie/analogía). La regla es lo que importa.

---

## 2. Distribución `correct` (objetivo 10/10/10/10)

| Dimensión | A (0) | B (1) | C (2) | D (3) | Total |
|---|---:|---:|---:|---:|---:|
| Espacial   | 5 | 5 | 5 | 5 | 20 |
| Abstracta  | 5 | 5 | 5 | 5 | 20 |
| **Total**  | **10** | **10** | **10** | **10** | **40** |

✅ Distribución perfectamente balanceada — sesgo posicional nulo.

---

## 3. Distribución por tipo

### Espacial (20)
| Tipo | Cantidad | Esperado |
|---|---:|---:|
| Rotación 2D | 8 | 8 |
| Reflejo | 8 | 8 |
| Figura inscrita | 4 | 4 |

### Abstracta (20)
| Tipo | Cantidad | Esperado |
|---|---:|---:|
| Matriz 3×3 (Raven's) | 8 | 8 |
| Serie visual | 4 | 4 |
| Analogía visual | 4 | 4 |
| Figura diferente | 4 | 4 |

---

## 4. Decisiones de diseño aplicadas

### Notas del spec ya implementadas

- **Cubos 3D y plegado descartados** → reemplazados con más rotación + reflejo.
- **Estilo por dimensión** → outline puro en abstractas (Raven's), relleno sólido en espaciales (Mental Rotation).
- **ViewBox amplios:** matrices 3×3 en `0 0 320 320` con celdas de 100×100; series y analogías en `0 0 400 80`.
- **Stroke-width pensado por escala:** sw 5 en opciones (60×60 → render 64×64), sw 3.5 en matriz, sw 3.5 en serie/analogía.
- **16 figuras espaciales únicas:** 8 figuras exclusivas para rotación (E1–E8) y 8 figuras distintas para reflejo (E9–E16). Sin reutilización entre tipos.
  - **Rotación:** bandera, L, F, triángulo-con-ojo, J, P, martillo, T-asimétrica.
  - **Reflejo:** casa, velero, bota, silla, letra R, rayo, flecha-asimétrica, llave.
- **Distractores plausibles pero inequívocos:** rotación opuesta, reflejo opuesto, original sin transformar, rotación 180°.
- **Español neutro LatAm** ("tú") en todos los enunciados — sin "vos / tenés / podés".

### Reglas de las 8 matrices

| ID | Regla |
|---|---|
| `cm_a1` | Forma por fila (▲ □ ○) + cantidad por columna (1/2/3). Faltante: 3 ○ |
| `cm_a2` | Rotación progresiva: celda(r,c) = (r+c)·45°. Faltante: 180° |
| `cm_a3` | Suma de elementos: celda(r,c) = r+c+1 puntos. Faltante: 5 puntos |
| `cm_a4` | Tamaño creciente: radio = 7 + (r+c)·5. Faltante: r=27 (xxl) |
| `cm_a5` | Forma por col + tamaño por fila. Faltante: triángulo grande |
| `cm_a6` | Adición visual: col1 ⊕ col2 = col3. Faltante: cuadrado con punto |
| `cm_a7` | Latin square de relleno (out / half / full) ciclando. Faltante: half |
| `cm_a8` | Rotación por fila + tamaño por columna. Faltante: triángulo abajo grande |

---

## 5. Inventario completo

| ID | Dimensión | Tipo | Correct | Enunciado |
|---|---|---|:---:|---|
| `cm_e1` | espacial | Rotación 2D | 1 (B) | ¿Cuál opción muestra esta figura rotada 90° en sentido horario? |
| `cm_e2` | espacial | Rotación 2D | 0 (A) | ¿Cuál opción muestra esta figura rotada 90° en sentido antihorario? |
| `cm_e3` | espacial | Rotación 2D | 1 (B) | ¿Cuál opción muestra esta figura rotada 180°? |
| `cm_e4` | espacial | Rotación 2D | 2 (C) | ¿Cuál opción muestra esta figura rotada 90° en sentido horario? |
| `cm_e5` | espacial | Rotación 2D | 3 (D) | ¿Cuál opción muestra esta figura rotada 180°? |
| `cm_e6` | espacial | Rotación 2D | 0 (A) | ¿Cuál opción muestra esta figura rotada 90° en sentido horario? |
| `cm_e7` | espacial | Rotación 2D | 2 (C) | ¿Cuál opción muestra esta figura rotada 90° en sentido antihorario? |
| `cm_e8` | espacial | Rotación 2D | 3 (D) | ¿Cuál opción muestra esta figura rotada 180°? |
| `cm_e9` | espacial | Reflejo | 2 (C) | ¿Cuál opción muestra el reflejo horizontal de esta figura? |
| `cm_e10` | espacial | Reflejo | 0 (A) | ¿Cuál opción muestra el reflejo vertical de esta figura? |
| `cm_e11` | espacial | Reflejo | 3 (D) | ¿Cuál opción muestra el reflejo horizontal de esta figura? |
| `cm_e12` | espacial | Reflejo | 1 (B) | ¿Cuál opción muestra el reflejo vertical de esta figura? |
| `cm_e13` | espacial | Reflejo | 0 (A) | ¿Cuál opción muestra el reflejo horizontal de esta figura? |
| `cm_e14` | espacial | Reflejo | 2 (C) | ¿Cuál opción muestra el reflejo vertical de esta figura? |
| `cm_e15` | espacial | Reflejo | 1 (B) | ¿Cuál opción muestra el reflejo horizontal de esta figura? |
| `cm_e16` | espacial | Reflejo | 3 (D) | ¿Cuál opción muestra el reflejo vertical de esta figura? |
| `cm_e17` | espacial | Figura inscrita | 3 (D) | ¿Cuál de estas figuras simples está escondida dentro de la figura compleja? |
| `cm_e18` | espacial | Figura inscrita | 0 (A) | ¿Cuál de estas figuras simples está escondida dentro de la figura compleja? |
| `cm_e19` | espacial | Figura inscrita | 2 (C) | ¿Cuál de estas figuras simples está escondida dentro de la figura compleja? |
| `cm_e20` | espacial | Figura inscrita | 1 (B) | ¿Cuál de estas figuras simples está escondida dentro de la figura compleja? |
| `cm_a1` | abstracta | Matriz 3×3 (Raven's) | 2 (C) | ¿Qué figura completa esta matriz? |
| `cm_a2` | abstracta | Matriz 3×3 (Raven's) | 0 (A) | ¿Qué figura completa esta matriz? |
| `cm_a3` | abstracta | Matriz 3×3 (Raven's) | 1 (B) | ¿Qué figura completa esta matriz? |
| `cm_a4` | abstracta | Matriz 3×3 (Raven's) | 3 (D) | ¿Qué figura completa esta matriz? |
| `cm_a5` | abstracta | Matriz 3×3 (Raven's) | 0 (A) | ¿Qué figura completa esta matriz? |
| `cm_a6` | abstracta | Matriz 3×3 (Raven's) | 2 (C) | ¿Qué figura completa esta matriz? |
| `cm_a7` | abstracta | Matriz 3×3 (Raven's) | 1 (B) | ¿Qué figura completa esta matriz? |
| `cm_a8` | abstracta | Matriz 3×3 (Raven's) | 3 (D) | ¿Qué figura completa esta matriz? |
| `cm_a9` | abstracta | Serie visual | 1 (B) | ¿Cuál figura continúa la serie? |
| `cm_a10` | abstracta | Serie visual | 3 (D) | ¿Cuál figura continúa la serie? |
| `cm_a11` | abstracta | Serie visual | 0 (A) | ¿Cuál figura continúa la serie? |
| `cm_a12` | abstracta | Serie visual | 2 (C) | ¿Cuál figura continúa la serie? |
| `cm_a13` | abstracta | Analogía | 1 (B) | Completa la analogía: ¿qué figura corresponde al lugar del signo de interrogación? |
| `cm_a14` | abstracta | Analogía | 2 (C) | Completa la analogía: ¿qué figura corresponde al lugar del signo de interrogación? |
| `cm_a15` | abstracta | Analogía | 0 (A) | Completa la analogía: ¿qué figura corresponde al lugar del signo de interrogación? |
| `cm_a16` | abstracta | Analogía | 3 (D) | Completa la analogía: ¿qué figura corresponde al lugar del signo de interrogación? |
| `cm_a17` | abstracta | Figura diferente | 2 (C) | ¿Cuál de estas figuras es diferente a las otras tres? |
| `cm_a18` | abstracta | Figura diferente | 0 (A) | ¿Cuál de estas figuras es diferente a las otras tres? |
| `cm_a19` | abstracta | Figura diferente | 1 (B) | ¿Cuál de estas figuras es diferente a las otras tres? |
| `cm_a20` | abstracta | Figura diferente | 3 (D) | ¿Cuál de estas figuras es diferente a las otras tres? |

> Tabla completa: 40 preguntas · IDs únicos: 40

---

## 6. Checklist de validación

### Por pregunta (verificado programáticamente)
- [x] Las 4 opciones renderizadas a 64×64 son visualmente distinguibles (validado en `validacion_visual.html`)
- [x] Cada opción correcta corresponde lógicamente con el enunciado
- [x] Los distractores son plausibles pero inequívocamente incorrectos
- [x] Enunciados en español neutro LatAm (sin "vos", "tenés", "podés", "querés", "preferís")
- [x] Todos los SVG cierran tags correctamente; `viewBox` coherente
- [x] `stroke-width` ≥ 3.5 en outline; rellenos sólidos en espacial
- [x] Sin texto dentro del SVG salvo "?" en placeholders de matriz/serie/analogía

### Global (verificado programáticamente)
- [x] 20 Espaciales + 20 Abstractas = 40 totales
- [x] Distribución `correct` balanceada: **10 A / 10 B / 10 C / 10 D** (exacto)
- [x] IDs únicos: `cm_e1`..`cm_e20` y `cm_a1`..`cm_a20`
- [x] Distribución por tipo coincide con el spec
- [x] **16 figuras espaciales únicas: 8 para rotación + 8 distintas para reflejo (overlap = 0)**
- [x] JSON válido en ambos archivos
- [x] Console limpio en el HTML de validación

---

## 7. Cómo abrir la validación visual

```bash
# Desde la raíz del proyecto:
open velna/validacion_visual.html
```

La página tiene navegación interna por tipo de pregunta (sticky en el top). Cada tarjeta muestra:

1. **ID** y **tags** (dimensión + tipo)
2. **Enunciado** tal como lo verá el candidato
3. **Figura principal** a tamaño real
4. **4 opciones** en cuadrados 80×80 con SVG 64×64
5. **Opción correcta** marcada en verde con ✓
6. **Footer** con `correct`, `dimension` y `tipo` técnicos

---

*Generado automáticamente · Si una pregunta necesita ajuste, marcala en la HTML de validación y la regeneramos puntual.*
