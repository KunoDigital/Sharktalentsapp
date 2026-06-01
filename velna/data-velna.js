/* ========================================================================
   VELNA · SharkTalents — Cognitivo v2
   40 preguntas: 20 Espaciales + 20 Abstractas
   - Espaciales: rellenos sólidos (#1f2937), viewBox 60×60 (escalado 2× para figura principal)
   - Abstractas: outline puro, matrices 320×320, series/analogías 400×80, opciones 60×60
   - Distribución correct planificada: 10 A · 10 B · 10 C · 10 D
   ======================================================================== */
(function(){
  const FILL   = "#1f2937";
  const FAINT  = "#9ca3af";
  const CELL   = "#d1d5db";
  const SW_OPT = 5;     // stroke-width para opciones abstractas (renderizadas 60→64)
  const SW_MAT = 3.5;   // stroke-width dentro de la matriz 320×320

  /* -------- transform helpers (en viewBox 60×60, centro 30,30) -------- */
  const rot   = (d,   s) => `<g transform="rotate(${d} 30 30)">${s}</g>`;
  const flipH = (s)      => `<g transform="translate(60 0) scale(-1 1)">${s}</g>`;
  const flipV = (s)      => `<g transform="translate(0 60) scale(1 -1)">${s}</g>`;

  /* -------- SVG wrappers -------- */
  const svgSm  = inner => `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  const svgBig = inner => `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"><g transform="scale(2)">${inner}</g></svg>`;
  const svgMat = inner => `<svg viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  const svgSer = inner => `<svg viewBox="0 0 400 80" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  const svgAna = inner => `<svg viewBox="0 0 400 80" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  const svgPlh = inner => `<svg viewBox="0 0 320 80" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

  const outlineSm = inner =>
    `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="${FILL}" stroke-width="${SW_OPT}" stroke-linejoin="round" stroke-linecap="round">${inner}</g></svg>`;

  /* ==================================================================
     1 · SHAPES ESPACIALES — viewBox 60×60, centro (30,30), fill sólido
     ================================================================== */
  const SH = {
    flag:    `<rect x="22" y="10" width="6" height="40" fill="${FILL}"/><polygon points="28,10 50,20 28,30" fill="${FILL}"/>`,
    L:       `<rect x="20" y="15" width="7" height="30" fill="${FILL}"/><rect x="20" y="38" width="20" height="7" fill="${FILL}"/>`,
    F:       `<rect x="20" y="15" width="7" height="30" fill="${FILL}"/><rect x="20" y="15" width="20" height="6" fill="${FILL}"/><rect x="20" y="26" width="15" height="6" fill="${FILL}"/>`,
    triPt:   `<polygon points="30,12 48,44 12,44" fill="${FILL}"/><circle cx="42" cy="40" r="3.5" fill="white"/>`,
    J:       `<rect x="32" y="12" width="7" height="28" fill="${FILL}"/><rect x="20" y="33" width="19" height="7" fill="${FILL}"/><rect x="20" y="27" width="7" height="13" fill="${FILL}"/>`,
    P:       `<path d="M20,12 L40,12 L40,28 L28,28 L28,45 L20,45 Z" fill="${FILL}"/>`,
    hammer:  `<rect x="27" y="18" width="6" height="27" fill="${FILL}"/><rect x="16" y="12" width="22" height="8" fill="${FILL}"/>`,
    tAsym:   `<rect x="13" y="15" width="30" height="6" fill="${FILL}"/><rect x="22" y="21" width="6" height="24" fill="${FILL}"/>`,

    /* --- 8 figuras EXCLUSIVAS para reflejos (E9–E16). No se repiten con las de rotación. --- */
    // casa con chimenea asimétrica a la derecha
    house:    `<polygon points="12,28 30,12 48,28 48,46 12,46" fill="${FILL}"/><rect x="38" y="14" width="5" height="10" fill="${FILL}"/>`,
    // velero: casco trapezoidal + mástil + vela triangular a la derecha
    sailboat: `<polygon points="10,42 50,42 44,50 16,50" fill="${FILL}"/><rect x="29" y="12" width="2" height="30" fill="${FILL}"/><polygon points="31,12 31,40 46,40" fill="${FILL}"/>`,
    // bota: caña vertical + pie hacia la derecha
    boot:     `<rect x="22" y="10" width="12" height="28" fill="${FILL}"/><rect x="22" y="32" width="24" height="8" fill="${FILL}"/>`,
    // silla: respaldo a la izquierda + asiento + 2 patas
    chair:    `<rect x="14" y="22" width="22" height="4" fill="${FILL}"/><rect x="14" y="12" width="4" height="14" fill="${FILL}"/><rect x="16" y="26" width="3" height="20" fill="${FILL}"/><rect x="31" y="26" width="3" height="20" fill="${FILL}"/>`,
    // letra R blocky (con kick a la derecha-abajo)
    letterR:  `<rect x="18" y="12" width="7" height="34" fill="${FILL}"/><rect x="18" y="12" width="20" height="7" fill="${FILL}"/><rect x="31" y="12" width="7" height="17" fill="${FILL}"/><rect x="18" y="22" width="20" height="7" fill="${FILL}"/><polygon points="25,29 31,29 42,46 36,46" fill="${FILL}"/>`,
    // rayo / lightning bolt asimétrico
    lightning:`<polygon points="32,8 18,28 28,28 22,46 40,22 30,22 36,8" fill="${FILL}"/>`,
    // flecha asimétrica: asta horizontal + cabeza derecha + apéndice abajo izquierda
    arrowAs:  `<polygon points="10,24 34,24 34,16 48,30 34,44 34,36 18,36 18,46 10,46" fill="${FILL}"/>`,
    // llave: mango circular a la izquierda + cuerpo + 2 dientes a la derecha-abajo
    key:      `<circle cx="16" cy="30" r="6" fill="${FILL}"/><circle cx="16" cy="30" r="2.2" fill="white"/><rect x="22" y="28" width="22" height="4" fill="${FILL}"/><rect x="32" y="32" width="3" height="6" fill="${FILL}"/><rect x="40" y="32" width="3" height="6" fill="${FILL}"/>`,
  };

  /* ==================================================================
     2 · ESPACIAL — 20 preguntas
     ================================================================== */
  const espacial = [];

  // ---------- ROTACIONES (8) ----------
  // E1 · bandera · 90° horario → B
  espacial.push({
    id: "cm_e1", dimension: "espacial", tipo: "rotacion",
    text: "¿Cuál opción muestra esta figura rotada 90° en sentido horario?",
    svg: svgBig(SH.flag),
    options: ["A","B","C","D"],
    options_svg: [
      svgSm(rot(-90, SH.flag)),  // A: 90° antihorario
      svgSm(rot( 90, SH.flag)),  // B: 90° horario ✓
      svgSm(rot(180, SH.flag)),  // C: 180°
      svgSm(SH.flag),            // D: original
    ],
    correct: 1
  });

  // E2 · L · 90° antihorario → A
  espacial.push({
    id: "cm_e2", dimension: "espacial", tipo: "rotacion",
    text: "¿Cuál opción muestra esta figura rotada 90° en sentido antihorario?",
    svg: svgBig(SH.L),
    options: ["A","B","C","D"],
    options_svg: [
      svgSm(rot(-90, SH.L)),  // A: 90° antihorario ✓
      svgSm(rot( 90, SH.L)),  // B: 90° horario
      svgSm(rot(180, SH.L)),  // C: 180°
      svgSm(SH.L),            // D: original
    ],
    correct: 0
  });

  // E3 · F · 180° → B
  espacial.push({
    id: "cm_e3", dimension: "espacial", tipo: "rotacion",
    text: "¿Cuál opción muestra esta figura rotada 180°?",
    svg: svgBig(SH.F),
    options: ["A","B","C","D"],
    options_svg: [
      svgSm(SH.F),              // A: original
      svgSm(rot(180, SH.F)),    // B: 180° ✓
      svgSm(rot( 90, SH.F)),    // C: 90° horario
      svgSm(rot(-90, SH.F)),    // D: 90° antihorario
    ],
    correct: 1
  });

  // E4 · triángulo con punto · 90° horario → C
  espacial.push({
    id: "cm_e4", dimension: "espacial", tipo: "rotacion",
    text: "¿Cuál opción muestra esta figura rotada 90° en sentido horario?",
    svg: svgBig(SH.triPt),
    options: ["A","B","C","D"],
    options_svg: [
      svgSm(rot(180, SH.triPt)), // A: 180°
      svgSm(SH.triPt),           // B: original
      svgSm(rot( 90, SH.triPt)), // C: 90° horario ✓
      svgSm(rot(-90, SH.triPt)), // D: 90° antihorario
    ],
    correct: 2
  });

  // E5 · J · 180° → D
  espacial.push({
    id: "cm_e5", dimension: "espacial", tipo: "rotacion",
    text: "¿Cuál opción muestra esta figura rotada 180°?",
    svg: svgBig(SH.J),
    options: ["A","B","C","D"],
    options_svg: [
      svgSm(SH.J),              // A: original
      svgSm(rot( 90, SH.J)),    // B: 90° horario
      svgSm(rot(-90, SH.J)),    // C: 90° antihorario
      svgSm(rot(180, SH.J)),    // D: 180° ✓
    ],
    correct: 3
  });

  // E6 · P · 90° horario → A
  espacial.push({
    id: "cm_e6", dimension: "espacial", tipo: "rotacion",
    text: "¿Cuál opción muestra esta figura rotada 90° en sentido horario?",
    svg: svgBig(SH.P),
    options: ["A","B","C","D"],
    options_svg: [
      svgSm(rot( 90, SH.P)),    // A: 90° horario ✓
      svgSm(rot(180, SH.P)),    // B: 180°
      svgSm(SH.P),              // C: original
      svgSm(rot(-90, SH.P)),    // D: 90° antihorario
    ],
    correct: 0
  });

  // E7 · martillo · 90° antihorario → C
  espacial.push({
    id: "cm_e7", dimension: "espacial", tipo: "rotacion",
    text: "¿Cuál opción muestra esta figura rotada 90° en sentido antihorario?",
    svg: svgBig(SH.hammer),
    options: ["A","B","C","D"],
    options_svg: [
      svgSm(rot(180, SH.hammer)),  // A: 180°
      svgSm(rot( 90, SH.hammer)),  // B: 90° horario
      svgSm(rot(-90, SH.hammer)),  // C: 90° antihorario ✓
      svgSm(SH.hammer),            // D: original
    ],
    correct: 2
  });

  // E8 · T asimétrica · 180° → D
  espacial.push({
    id: "cm_e8", dimension: "espacial", tipo: "rotacion",
    text: "¿Cuál opción muestra esta figura rotada 180°?",
    svg: svgBig(SH.tAsym),
    options: ["A","B","C","D"],
    options_svg: [
      svgSm(SH.tAsym),              // A: original
      svgSm(rot( 90, SH.tAsym)),    // B: 90° horario
      svgSm(rot(-90, SH.tAsym)),    // C: 90° antihorario
      svgSm(rot(180, SH.tAsym)),    // D: 180° ✓
    ],
    correct: 3
  });

  // ---------- REFLEJOS (8) — figuras EXCLUSIVAS, no repetidas con rotación ----------
  // E9 · casa · reflejo horizontal → C
  espacial.push({
    id: "cm_e9", dimension: "espacial", tipo: "reflejo",
    text: "¿Cuál opción muestra el reflejo horizontal de esta figura?",
    svg: svgBig(SH.house),
    options: ["A","B","C","D"],
    options_svg: [
      svgSm(SH.house),             // A: original
      svgSm(flipV(SH.house)),      // B: reflejo vertical
      svgSm(flipH(SH.house)),      // C: reflejo horizontal ✓
      svgSm(rot(180, SH.house)),   // D: rotada 180°
    ],
    correct: 2
  });

  // E10 · velero · reflejo vertical → A
  espacial.push({
    id: "cm_e10", dimension: "espacial", tipo: "reflejo",
    text: "¿Cuál opción muestra el reflejo vertical de esta figura?",
    svg: svgBig(SH.sailboat),
    options: ["A","B","C","D"],
    options_svg: [
      svgSm(flipV(SH.sailboat)),       // A: reflejo vertical ✓
      svgSm(flipH(SH.sailboat)),       // B: reflejo horizontal
      svgSm(SH.sailboat),              // C: original
      svgSm(rot(180, SH.sailboat)),    // D: rotada 180°
    ],
    correct: 0
  });

  // E11 · bota · reflejo horizontal → D
  espacial.push({
    id: "cm_e11", dimension: "espacial", tipo: "reflejo",
    text: "¿Cuál opción muestra el reflejo horizontal de esta figura?",
    svg: svgBig(SH.boot),
    options: ["A","B","C","D"],
    options_svg: [
      svgSm(rot(90, SH.boot)),        // A: rotada 90°
      svgSm(SH.boot),                  // B: original
      svgSm(flipV(SH.boot)),           // C: reflejo vertical
      svgSm(flipH(SH.boot)),           // D: reflejo horizontal ✓
    ],
    correct: 3
  });

  // E12 · silla · reflejo vertical → B
  espacial.push({
    id: "cm_e12", dimension: "espacial", tipo: "reflejo",
    text: "¿Cuál opción muestra el reflejo vertical de esta figura?",
    svg: svgBig(SH.chair),
    options: ["A","B","C","D"],
    options_svg: [
      svgSm(flipH(SH.chair)),          // A: reflejo horizontal
      svgSm(flipV(SH.chair)),          // B: reflejo vertical ✓
      svgSm(SH.chair),                 // C: original
      svgSm(rot(180, SH.chair)),       // D: rotada 180°
    ],
    correct: 1
  });

  // E13 · letra R · reflejo horizontal → A
  espacial.push({
    id: "cm_e13", dimension: "espacial", tipo: "reflejo",
    text: "¿Cuál opción muestra el reflejo horizontal de esta figura?",
    svg: svgBig(SH.letterR),
    options: ["A","B","C","D"],
    options_svg: [
      svgSm(flipH(SH.letterR)),        // A: reflejo horizontal ✓
      svgSm(flipV(SH.letterR)),        // B: reflejo vertical
      svgSm(rot(180, SH.letterR)),     // C: rotada 180°
      svgSm(SH.letterR),               // D: original
    ],
    correct: 0
  });

  // E14 · rayo · reflejo vertical → C
  espacial.push({
    id: "cm_e14", dimension: "espacial", tipo: "reflejo",
    text: "¿Cuál opción muestra el reflejo vertical de esta figura?",
    svg: svgBig(SH.lightning),
    options: ["A","B","C","D"],
    options_svg: [
      svgSm(SH.lightning),             // A: original
      svgSm(flipH(SH.lightning)),      // B: reflejo horizontal
      svgSm(flipV(SH.lightning)),      // C: reflejo vertical ✓
      svgSm(rot(180, SH.lightning)),   // D: rotada 180°
    ],
    correct: 2
  });

  // E15 · flecha asimétrica · reflejo horizontal → B
  espacial.push({
    id: "cm_e15", dimension: "espacial", tipo: "reflejo",
    text: "¿Cuál opción muestra el reflejo horizontal de esta figura?",
    svg: svgBig(SH.arrowAs),
    options: ["A","B","C","D"],
    options_svg: [
      svgSm(SH.arrowAs),               // A: original
      svgSm(flipH(SH.arrowAs)),        // B: reflejo horizontal ✓
      svgSm(flipV(SH.arrowAs)),        // C: reflejo vertical
      svgSm(rot(90, SH.arrowAs)),      // D: rotada 90°
    ],
    correct: 1
  });

  // E16 · llave · reflejo vertical → D
  espacial.push({
    id: "cm_e16", dimension: "espacial", tipo: "reflejo",
    text: "¿Cuál opción muestra el reflejo vertical de esta figura?",
    svg: svgBig(SH.key),
    options: ["A","B","C","D"],
    options_svg: [
      svgSm(rot(180, SH.key)),         // A: rotada 180°
      svgSm(SH.key),                   // B: original
      svgSm(flipH(SH.key)),            // C: reflejo horizontal
      svgSm(flipV(SH.key)),            // D: reflejo vertical ✓
    ],
    correct: 3
  });

  /* ---------- FIGURA INSCRITA (4) — Embedded Figures Test style ----------
     Cada figura compleja se construye como superposición visible. Una y solo
     una de las 4 opciones tiene contorno presente dentro de la compleja.
     Estilo: la figura compleja usa outline (líneas), las opciones también.
  -------------------------------------------------------------------------- */

  // Helper: figura compleja con grupo outline. Misma config que abstractas.
  const complexFig = inner =>
    `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="${FILL}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">${inner}</g></svg>`;

  // Pequeñas shapes outline para las opciones (viewBox 60x60)
  const SHO = {
    hex:   `<polygon points="30,10 47,20 47,40 30,50 13,40 13,20"/>`,
    sqr:   `<rect x="15" y="15" width="30" height="30"/>`,
    pent:  `<polygon points="30,12 48,25 41,46 19,46 12,25"/>`,
    tri:   `<polygon points="30,12 48,46 12,46"/>`,
    rhomb: `<polygon points="30,10 50,30 30,50 10,30"/>`,
    arrow: `<path d="M10,28 L34,28 L34,20 L50,30 L34,40 L34,32 L10,32 Z"/>`,
    circle:`<circle cx="30" cy="30" r="18"/>`,
  };

  // E17 · rombo escondido → D
  // Compleja: rombo grande + círculo intersecando + línea diagonal cortando
  espacial.push({
    id: "cm_e17", dimension: "espacial", tipo: "figura_inscrita",
    text: "¿Cuál de estas figuras simples está escondida dentro de la figura compleja?",
    svg: complexFig(`
      <polygon points="60,18 102,60 60,102 18,60"/>
      <circle cx="92" cy="58" r="22"/>
      <line x1="20" y1="20" x2="100" y2="100"/>
    `),
    options: ["A","B","C","D"],
    options_svg: [
      outlineSm(SHO.hex),     // A: hexágono — NO
      outlineSm(SHO.tri),     // B: triángulo — NO
      outlineSm(SHO.pent),    // C: pentágono — NO
      outlineSm(SHO.rhomb),   // D: rombo ✓
    ],
    correct: 3
  });

  // E18 · hexágono escondido → A
  // Compleja: círculo + hexágono inscrito + línea horizontal
  espacial.push({
    id: "cm_e18", dimension: "espacial", tipo: "figura_inscrita",
    text: "¿Cuál de estas figuras simples está escondida dentro de la figura compleja?",
    svg: complexFig(`
      <circle cx="60" cy="60" r="42"/>
      <polygon points="60,20 95,40 95,80 60,100 25,80 25,40"/>
      <line x1="10" y1="60" x2="110" y2="60"/>
    `),
    options: ["A","B","C","D"],
    options_svg: [
      outlineSm(SHO.hex),     // A: hexágono ✓
      outlineSm(SHO.pent),    // B: pentágono — NO
      outlineSm(SHO.sqr),     // C: cuadrado — NO
      outlineSm(SHO.tri),     // D: triángulo — NO
    ],
    correct: 0
  });

  // E19 · pentágono escondido → C
  // Compleja: estrella de 5 puntas (puntos exteriores) + pentágono interno + diagonales
  espacial.push({
    id: "cm_e19", dimension: "espacial", tipo: "figura_inscrita",
    text: "¿Cuál de estas figuras simples está escondida dentro de la figura compleja?",
    svg: complexFig(`
      <polygon points="60,15 75,52 115,52 84,75 95,113 60,90 25,113 36,75 5,52 45,52"/>
      <polygon points="60,30 88,50 78,82 42,82 32,50"/>
      <line x1="20" y1="100" x2="100" y2="100"/>
    `),
    options: ["A","B","C","D"],
    options_svg: [
      outlineSm(SHO.hex),     // A
      outlineSm(SHO.sqr),     // B
      outlineSm(SHO.pent),    // C ✓
      outlineSm(SHO.tri),     // D
    ],
    correct: 2
  });

  // E20 · flecha escondida → B
  // Compleja: flecha apuntando a la derecha + círculo grande + línea diagonal
  espacial.push({
    id: "cm_e20", dimension: "espacial", tipo: "figura_inscrita",
    text: "¿Cuál de estas figuras simples está escondida dentro de la figura compleja?",
    svg: complexFig(`
      <path d="M14,52 L70,52 L70,36 L104,60 L70,84 L70,68 L14,68 Z"/>
      <circle cx="70" cy="60" r="38"/>
      <line x1="20" y1="105" x2="100" y2="15"/>
    `),
    options: ["A","B","C","D"],
    options_svg: [
      outlineSm(SHO.sqr),     // A
      outlineSm(SHO.arrow),   // B ✓
      outlineSm(SHO.hex),     // C
      outlineSm(SHO.tri),     // D
    ],
    correct: 1
  });

  /* ==================================================================
     3 · ABSTRACTA — 20 preguntas (outline puro estilo Raven's)
     ================================================================== */
  const abstracta = [];

  /* ---------- helpers para matriz 3×3 (viewBox 320×320) ---------- */
  const matrixGrid = () => `
    <g fill="none" stroke="${CELL}" stroke-width="1.5">
      <rect x="0"   y="0"   width="100" height="100"/>
      <rect x="110" y="0"   width="100" height="100"/>
      <rect x="220" y="0"   width="100" height="100"/>
      <rect x="0"   y="110" width="100" height="100"/>
      <rect x="110" y="110" width="100" height="100"/>
      <rect x="220" y="110" width="100" height="100"/>
      <rect x="0"   y="220" width="100" height="100"/>
      <rect x="110" y="220" width="100" height="100"/>
      <rect x="220" y="220" width="100" height="100"/>
    </g>`;

  // Marca "?" en la celda inferior derecha
  const qMark = (cx=270, cy=287, size=56) =>
    `<text x="${cx}" y="${cy}" text-anchor="middle" font-family="ui-sans-serif, system-ui, Helvetica, Arial, sans-serif" font-size="${size}" font-weight="600" fill="${FAINT}">?</text>`;

  // Celda con shapes: centro de cada celda
  // col 0,1,2 → x = 50, 160, 270 ; row 0,1,2 → y = 50, 160, 270
  const cellC = (col,row) => ({ cx: 50 + col*110, cy: 50 + row*110 });

  // Genera 1/2/3 elementos en una celda con tamaño y forma dados
  // count = 1: centrado; count = 2: lado a lado; count = 3: tres en fila
  function multiInCell(col, row, count, drawOne) {
    const {cx, cy} = cellC(col, row);
    const out = [];
    if (count === 1) {
      out.push(drawOne(cx, cy, 1));
    } else if (count === 2) {
      out.push(drawOne(cx - 18, cy, 2));
      out.push(drawOne(cx + 18, cy, 2));
    } else if (count === 3) {
      out.push(drawOne(cx - 25, cy, 3));
      out.push(drawOne(cx,       cy, 3));
      out.push(drawOne(cx + 25, cy, 3));
    } else if (count === 4) {
      out.push(drawOne(cx - 30, cy, 4));
      out.push(drawOne(cx - 10, cy, 4));
      out.push(drawOne(cx + 10, cy, 4));
      out.push(drawOne(cx + 30, cy, 4));
    } else if (count === 5) {
      out.push(drawOne(cx - 32, cy, 5));
      out.push(drawOne(cx - 16, cy, 5));
      out.push(drawOne(cx,       cy, 5));
      out.push(drawOne(cx + 16, cy, 5));
      out.push(drawOne(cx + 32, cy, 5));
    }
    return out.join("");
  }

  const drawCircle  = (r) => (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
  const drawSquare  = (s) => (cx, cy) => `<rect x="${cx-s/2}" y="${cy-s/2}" width="${s}" height="${s}"/>`;
  const drawTri     = (s) => (cx, cy) => `<polygon points="${cx},${cy-s*0.6} ${cx+s*0.55},${cy+s*0.45} ${cx-s*0.55},${cy+s*0.45}"/>`;
  const drawDot     = (r) => (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${FILL}"/>`;

  // tamaños por cantidad (para que quepa)
  const triByCount  = (n) => n===1 ? 28 : n===2 ? 18 : 13;
  const sqByCount   = (n) => n===1 ? 36 : n===2 ? 22 : 15;
  const cirByCount  = (n) => n===1 ? 20 : n===2 ? 14 : 10;
  const dotByCount  = (n) => n===1 ? 10 : n===2 ? 7  : n===3 ? 6 : n===4 ? 5 : 4;

  const matMain = inner =>
    `<g fill="none" stroke="${FILL}" stroke-width="${SW_MAT}" stroke-linejoin="round" stroke-linecap="round">${inner}</g>`;

  /* ============= MATRICES (A1–A8) ============= */

  // A1 · forma por fila (▲ □ ○) + cantidad por columna (1,2,3) · faltante = 3 círculos → C
  (function(){
    const cells = [];
    // fila 0: triángulos (1, 2, 3)
    cells.push(multiInCell(0,0,1, (cx,cy,n)=>drawTri(triByCount(n))(cx,cy)));
    cells.push(multiInCell(1,0,2, (cx,cy,n)=>drawTri(triByCount(n))(cx,cy)));
    cells.push(multiInCell(2,0,3, (cx,cy,n)=>drawTri(triByCount(n))(cx,cy)));
    // fila 1: cuadrados
    cells.push(multiInCell(0,1,1, (cx,cy,n)=>drawSquare(sqByCount(n))(cx,cy)));
    cells.push(multiInCell(1,1,2, (cx,cy,n)=>drawSquare(sqByCount(n))(cx,cy)));
    cells.push(multiInCell(2,1,3, (cx,cy,n)=>drawSquare(sqByCount(n))(cx,cy)));
    // fila 2: círculos (1, 2, ?)
    cells.push(multiInCell(0,2,1, (cx,cy,n)=>drawCircle(cirByCount(n))(cx,cy)));
    cells.push(multiInCell(1,2,2, (cx,cy,n)=>drawCircle(cirByCount(n))(cx,cy)));
    const mainInner = matrixGrid() + matMain(cells.join("")) + qMark();

    // opciones (viewBox 60×60, 3 círculos / 2 círculos / 3 cuadrados / 3 triángulos)
    const opt = inner => outlineSm(inner);
    abstracta.push({
      id: "cm_a1", dimension: "abstracta", tipo: "matriz_3x3",
      text: "¿Qué figura completa esta matriz?",
      svg: svgMat(mainInner),
      options: ["A","B","C","D"],
      options_svg: [
        opt(`<rect x="7" y="23" width="14" height="14"/><rect x="23" y="23" width="14" height="14"/><rect x="39" y="23" width="14" height="14"/>`), // 3 cuadrados
        opt(`<circle cx="40" cy="30" r="14"/><circle cx="20" cy="30" r="14"/>`), // 2 círculos
        opt(`<circle cx="15" cy="30" r="9"/><circle cx="30" cy="30" r="9"/><circle cx="45" cy="30" r="9"/>`), // 3 círculos ✓
        opt(`<polygon points="15,40 23,22 7,22"/><polygon points="30,40 38,22 22,22"/><polygon points="45,40 53,22 37,22"/>`), // 3 triángulos
      ],
      correct: 2
    });
  })();

  // A2 · rotación progresiva · cada celda = anterior + 45° → A
  (function(){
    // valores de rotación: fila r, col c -> (r*3 + c) * 45 ?  Demasiado.
    // Más simple: cada celda = rotación creciente del triángulo en pasos de 45°
    // Pos lineal (r*3 + c): 0,1,2,3,4,5,6,7,?  Rotación = pos*45°
    // Faltante = 8 * 45° = 360° = 0°
    // Hmm, mejor: pasos de 30° → pos*30°, faltante = 240°. Más rico.
    // Vamos con: por fila, cada col rota +45°. La regla intra-celda es por fila.
    // fila 0: 0, 45, 90; fila 1: 45, 90, 135; fila 2: 90, 135, ?=180
    // Cada celda(r,c) = (r+c)*45°
    const cells = [];
    for (let r=0; r<3; r++) {
      for (let c=0; c<3; c++) {
        if (r===2 && c===2) continue; // celda faltante
        const ang = (r+c) * 45;
        const {cx, cy} = cellC(c, r);
        cells.push(`<g transform="rotate(${ang} ${cx} ${cy})"><polygon points="${cx},${cy-22} ${cx+19},${cy+15} ${cx-19},${cy+15}"/></g>`);
      }
    }
    const mainInner = matrixGrid() + matMain(cells.join("")) + qMark();

    const triRot = (a)=>`<g transform="rotate(${a} 30 30)"><polygon points="30,12 48,42 12,42"/></g>`;
    abstracta.push({
      id: "cm_a2", dimension: "abstracta", tipo: "matriz_3x3",
      text: "¿Qué figura completa esta matriz?",
      svg: svgMat(mainInner),
      options: ["A","B","C","D"],
      options_svg: [
        outlineSm(triRot(180)),  // A: ✓ (faltante = 180°)
        outlineSm(triRot(135)),  // B: repite celda anterior
        outlineSm(triRot(0)),    // C: vuelve al inicio
        outlineSm(triRot(225)),  // D: pasada
      ],
      correct: 0
    });
  })();

  // A3 · suma de elementos (puntos por celda crece +1 por fila y por columna) → B
  // celda(r,c) = (r + c + 1) puntos. Faltante = 5
  (function(){
    const cells = [];
    for (let r=0; r<3; r++) {
      for (let c=0; c<3; c++) {
        if (r===2 && c===2) continue;
        const n = r + c + 1;
        cells.push(multiInCell(c, r, n, (cx,cy,nn)=>drawDot(dotByCount(nn))(cx,cy)));
      }
    }
    const mainInner = matrixGrid() + matMain(cells.join("")) + qMark();

    const dotsRow = (n, r=5)=>{
      const pts = [];
      const step = n === 1 ? 0 : (n === 2 ? 12 : n === 3 ? 11 : n === 4 ? 9 : 8);
      const startOffset = -(n-1) * step / 2;
      for (let i=0; i<n; i++) {
        pts.push(`<circle cx="${30 + startOffset + i*step}" cy="30" r="${r}" fill="${FILL}"/>`);
      }
      return pts.join("");
    };
    abstracta.push({
      id: "cm_a3", dimension: "abstracta", tipo: "matriz_3x3",
      text: "¿Qué figura completa esta matriz?",
      svg: svgMat(mainInner),
      options: ["A","B","C","D"],
      options_svg: [
        outlineSm(dotsRow(4, 4)),  // A: 4 puntos
        outlineSm(dotsRow(5, 4)),  // B: 5 puntos ✓
        outlineSm(dotsRow(3, 5)),  // C: 3 puntos
        outlineSm(dotsRow(6, 3.5)),// D: 6 puntos
      ],
      correct: 1
    });
  })();

  // A4 · tamaño creciente · círculo crece por fila y por col → D
  // size index: r + c → 0..4, radio = 7+idx*5 (7,12,17,22,27)
  // Faltante (2,2) → idx 4 → radio 27 (xxl)
  (function(){
    const cells = [];
    for (let r=0; r<3; r++) {
      for (let c=0; c<3; c++) {
        if (r===2 && c===2) continue;
        const idx = r + c;
        const radio = 7 + idx * 5;
        const {cx, cy} = cellC(c, r);
        cells.push(`<circle cx="${cx}" cy="${cy}" r="${radio}"/>`);
      }
    }
    const mainInner = matrixGrid() + matMain(cells.join("")) + qMark();

    const cir = r => `<circle cx="30" cy="30" r="${r}"/>`;
    abstracta.push({
      id: "cm_a4", dimension: "abstracta", tipo: "matriz_3x3",
      text: "¿Qué figura completa esta matriz?",
      svg: svgMat(mainInner),
      options: ["A","B","C","D"],
      options_svg: [
        outlineSm(cir(7)),    // A: chico
        outlineSm(cir(13)),   // B: medio
        outlineSm(cir(19)),   // C: grande (penúltimo)
        outlineSm(cir(25)),   // D: xxl ✓
      ],
      correct: 3
    });
  })();

  // A5 · forma por col + tamaño por fila → A
  // col 0=círculo, 1=cuadrado, 2=triángulo
  // fila 0=chico, 1=medio, 2=grande. Faltante (2,2) = triángulo grande.
  (function(){
    const sizes = [10, 16, 22]; // chico, medio, grande
    const cells = [];
    for (let r=0; r<3; r++) {
      for (let c=0; c<3; c++) {
        if (r===2 && c===2) continue;
        const {cx, cy} = cellC(c, r);
        const s = sizes[r];
        if (c === 0) cells.push(`<circle cx="${cx}" cy="${cy}" r="${s}"/>`);
        else if (c === 1) cells.push(`<rect x="${cx-s}" y="${cy-s}" width="${s*2}" height="${s*2}"/>`);
        else cells.push(`<polygon points="${cx},${cy-s*1.05} ${cx+s*0.95},${cy+s*0.8} ${cx-s*0.95},${cy+s*0.8}"/>`);
      }
    }
    const mainInner = matrixGrid() + matMain(cells.join("")) + qMark();

    abstracta.push({
      id: "cm_a5", dimension: "abstracta", tipo: "matriz_3x3",
      text: "¿Qué figura completa esta matriz?",
      svg: svgMat(mainInner),
      options: ["A","B","C","D"],
      options_svg: [
        outlineSm(`<polygon points="30,9 50,48 10,48"/>`),  // A: triángulo grande ✓
        outlineSm(`<polygon points="30,18 42,42 18,42"/>`), // B: triángulo chico
        outlineSm(`<rect x="10" y="10" width="40" height="40"/>`), // C: cuadrado grande
        outlineSm(`<circle cx="30" cy="30" r="22"/>`),      // D: círculo grande
      ],
      correct: 0
    });
  })();

  // A6 · adición de formas (col1 + col2 = col3) → C
  // fila 0: línea horizontal + línea vertical = cruz
  // fila 1: círculo + triángulo = círculo con triángulo inscrito
  // fila 2: cuadrado + punto = cuadrado con punto
  (function(){
    const cells = [];
    // (0,0) línea horizontal
    cells.push(`<line x1="22" y1="50" x2="78" y2="50"/>`);
    // (1,0) línea vertical
    cells.push(`<line x1="160" y1="22" x2="160" y2="78"/>`);
    // (2,0) cruz
    cells.push(`<line x1="242" y1="50" x2="298" y2="50"/><line x1="270" y1="22" x2="270" y2="78"/>`);
    // (0,1) círculo
    cells.push(`<circle cx="50" cy="160" r="22"/>`);
    // (1,1) triángulo
    cells.push(`<polygon points="160,138 184,180 136,180"/>`);
    // (2,1) círculo con triángulo
    cells.push(`<circle cx="270" cy="160" r="24"/><polygon points="270,144 286,176 254,176"/>`);
    // (0,2) cuadrado
    cells.push(`<rect x="30" y="240" width="40" height="40"/>`);
    // (1,2) punto
    cells.push(`<circle cx="160" cy="270" r="6" fill="${FILL}"/>`);
    // (2,2) ?
    const mainInner = matrixGrid() + matMain(cells.join("")) + qMark();

    abstracta.push({
      id: "cm_a6", dimension: "abstracta", tipo: "matriz_3x3",
      text: "¿Qué figura completa esta matriz?",
      svg: svgMat(mainInner),
      options: ["A","B","C","D"],
      options_svg: [
        outlineSm(`<rect x="13" y="13" width="34" height="34"/>`),  // A: cuadrado vacío
        outlineSm(`<circle cx="30" cy="30" r="5" fill="${FILL}"/>`), // B: punto solo
        outlineSm(`<rect x="13" y="13" width="34" height="34"/><circle cx="30" cy="30" r="4" fill="${FILL}"/>`), // C: cuadrado con punto ✓
        outlineSm(`<rect x="13" y="13" width="34" height="34"/><circle cx="20" cy="20" r="3" fill="${FILL}"/><circle cx="40" cy="40" r="3" fill="${FILL}"/><circle cx="40" cy="20" r="3" fill="${FILL}"/>`), // D: cuadrado con varios puntos
      ],
      correct: 2
    });
  })();

  // A7 · Latin square: alternancia de relleno (vacío, mitad, lleno) por fila/col → B
  // cell(r,c): patrón cicla. fila 0: out, half, full | fila 1: half, full, out | fila 2: full, out, ?=half
  (function(){
    const states = ["out", "half", "full"]; // 0,1,2
    const cells = [];
    for (let r=0; r<3; r++) {
      for (let c=0; c<3; c++) {
        if (r===2 && c===2) continue;
        const stateIdx = (r + c) % 3;
        const state = states[stateIdx];
        const {cx, cy} = cellC(c, r);
        if (state === "out") {
          cells.push(`<circle cx="${cx}" cy="${cy}" r="22"/>`);
        } else if (state === "half") {
          cells.push(`<circle cx="${cx}" cy="${cy}" r="22"/><path d="M${cx} ${cy-22} A 22 22 0 0 1 ${cx} ${cy+22} Z" fill="${FILL}"/>`);
        } else {
          cells.push(`<circle cx="${cx}" cy="${cy}" r="22" fill="${FILL}"/>`);
        }
      }
    }
    const mainInner = matrixGrid() + matMain(cells.join("")) + qMark();

    abstracta.push({
      id: "cm_a7", dimension: "abstracta", tipo: "matriz_3x3",
      text: "¿Qué figura completa esta matriz?",
      svg: svgMat(mainInner),
      options: ["A","B","C","D"],
      options_svg: [
        outlineSm(`<circle cx="30" cy="30" r="18"/>`),  // A: outline (out)
        outlineSm(`<circle cx="30" cy="30" r="18"/><path d="M30 12 A 18 18 0 0 1 30 48 Z" fill="${FILL}"/>`), // B: half ✓
        outlineSm(`<circle cx="30" cy="30" r="18" fill="${FILL}"/>`),  // C: full
        outlineSm(`<rect x="12" y="12" width="36" height="36"/><path d="M30 12 L48 30 L30 48 L12 30 Z" fill="${FILL}"/>`), // D: cuadrado con rombo — distractor de forma
      ],
      correct: 1
    });
  })();

  // A8 · forma + rotación · triángulo rota por fila, tamaño por columna → D
  // fila r → rotación r*90°; col c → tamaño chico/med/grande
  // Faltante (2,2) → tri rotado 180° grande
  (function(){
    const sizes = [10, 16, 22];
    const cells = [];
    for (let r=0; r<3; r++) {
      for (let c=0; c<3; c++) {
        if (r===2 && c===2) continue;
        const {cx, cy} = cellC(c, r);
        const s = sizes[c];
        const ang = r * 90;
        cells.push(`<g transform="rotate(${ang} ${cx} ${cy})"><polygon points="${cx},${cy-s*1.05} ${cx+s*0.95},${cy+s*0.85} ${cx-s*0.95},${cy+s*0.85}"/></g>`);
      }
    }
    const mainInner = matrixGrid() + matMain(cells.join("")) + qMark();

    const triR = (s, ang) => `<g transform="rotate(${ang} 30 30)"><polygon points="30,${30-s*1.05} ${30+s*0.95},${30+s*0.8} ${30-s*0.95},${30+s*0.8}"/></g>`;
    abstracta.push({
      id: "cm_a8", dimension: "abstracta", tipo: "matriz_3x3",
      text: "¿Qué figura completa esta matriz?",
      svg: svgMat(mainInner),
      options: ["A","B","C","D"],
      options_svg: [
        outlineSm(triR(20, 0)),    // A: triángulo grande arriba (rotación incorrecta)
        outlineSm(triR(10, 180)),  // B: triángulo chico abajo (tamaño incorrecto)
        outlineSm(triR(20, 90)),   // C: triángulo grande derecha (rotación incorrecta)
        outlineSm(triR(20, 180)),  // D: triángulo grande abajo ✓
      ],
      correct: 3
    });
  })();

  /* ============= SERIES (A9–A12) ============= */

  // Helper: cell con borde dashed + "?" para placeholder de serie/analogía
  const placeholderQ = (x, y, w=60, h=60) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${CELL}" stroke-width="1.5" stroke-dasharray="4 3"/><text x="${x+w/2}" y="${y+h*0.7}" text-anchor="middle" font-family="ui-sans-serif, system-ui, Helvetica, Arial, sans-serif" font-size="${Math.round(h*0.6)}" font-weight="600" fill="${FAINT}">?</text>`;

  const serMain = inner =>
    `<g fill="none" stroke="${FILL}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round">${inner}</g>`;

  // A9 · rotación triángulo 45° por paso → B (mismo que piloto)
  (function(){
    const angles = [0, 45, 90, 135];
    const tris = angles.map((a, i) => {
      const cx = 40 + i*80;
      return `<g transform="rotate(${a} ${cx} 40)"><polygon points="${cx},16 ${cx+22},58 ${cx-22},58"/></g>`;
    }).join("");
    const main = serMain(tris) + placeholderQ(336, 8, 56, 64);

    const triRot = a => `<g transform="rotate(${a} 30 30)"><polygon points="30,12 48,42 12,42"/></g>`;
    abstracta.push({
      id: "cm_a9", dimension: "abstracta", tipo: "serie",
      text: "¿Cuál figura continúa la serie?",
      svg: svgSer(main),
      options: ["A","B","C","D"],
      options_svg: [
        outlineSm(triRot(0)),     // A: vuelve al inicio
        outlineSm(triRot(180)),   // B: 180° ✓
        outlineSm(triRot(225)),   // C: pasada
        outlineSm(triRot(270)),   // D: salto
      ],
      correct: 1
    });
  })();

  // A10 · número creciente → D (5 elementos)
  (function(){
    function row(n, cx, cy=40) {
      const r = 6;
      const step = 11;
      const parts = [];
      const startX = cx - (n-1)*step/2;
      for (let i=0; i<n; i++) parts.push(`<circle cx="${startX + i*step}" cy="${cy}" r="${r}"/>`);
      return parts.join("");
    }
    const series = [1,2,3,4].map((n,i)=> row(n, 40 + i*80)).join("");
    const main = serMain(series) + placeholderQ(336, 8, 56, 64);

    function smRow(n) {
      const r = n <= 3 ? 7 : n === 4 ? 6 : 5;
      const step = n === 1 ? 0 : n === 2 ? 16 : n === 3 ? 13 : n === 4 ? 11 : 9;
      const parts = [];
      const startX = 30 - (n-1)*step/2;
      for (let i=0; i<n; i++) parts.push(`<circle cx="${startX + i*step}" cy="30" r="${r}"/>`);
      return parts.join("");
    }
    abstracta.push({
      id: "cm_a10", dimension: "abstracta", tipo: "serie",
      text: "¿Cuál figura continúa la serie?",
      svg: svgSer(main),
      options: ["A","B","C","D"],
      options_svg: [
        outlineSm(smRow(3)),   // A: 3
        outlineSm(smRow(4)),   // B: 4 (igual al anterior)
        outlineSm(smRow(6)),   // C: 6 (pasada)
        outlineSm(smRow(5)),   // D: 5 ✓
      ],
      correct: 3
    });
  })();

  // A11 · tamaño creciente → A
  (function(){
    const radii = [8, 13, 18, 24];
    const circs = radii.map((r, i) => `<circle cx="${40 + i*80}" cy="40" r="${r}"/>`).join("");
    const main = serMain(circs) + placeholderQ(336, 8, 56, 64);

    abstracta.push({
      id: "cm_a11", dimension: "abstracta", tipo: "serie",
      text: "¿Cuál figura continúa la serie?",
      svg: svgSer(main),
      options: ["A","B","C","D"],
      options_svg: [
        outlineSm(`<circle cx="30" cy="30" r="27"/>`),  // A: xxl ✓
        outlineSm(`<circle cx="30" cy="30" r="22"/>`),  // B: igual al anterior
        outlineSm(`<circle cx="30" cy="30" r="8"/>`),   // C: vuelve al inicio
        outlineSm(`<rect x="3" y="3" width="54" height="54"/>`), // D: cuadrado xxl (forma incorrecta)
      ],
      correct: 0
    });
  })();

  // A12 · transformación gradual cuadrado → círculo → C
  (function(){
    const rxList = [0, 6, 14, 22]; // de cuadrado a casi círculo
    const series = rxList.map((rx, i) => `<rect x="${40-26 + i*80}" y="14" width="52" height="52" rx="${rx}" ry="${rx}"/>`).join("");
    const main = serMain(series) + placeholderQ(336, 8, 56, 64);

    abstracta.push({
      id: "cm_a12", dimension: "abstracta", tipo: "serie",
      text: "¿Cuál figura continúa la serie?",
      svg: svgSer(main),
      options: ["A","B","C","D"],
      options_svg: [
        outlineSm(`<rect x="6" y="6" width="48" height="48"/>`),   // A: cuadrado puro (vuelve)
        outlineSm(`<rect x="6" y="6" width="48" height="48" rx="6" ry="6"/>`), // B: poco redondeado (retrocede)
        outlineSm(`<circle cx="30" cy="30" r="24"/>`),             // C: círculo perfecto ✓
        outlineSm(`<ellipse cx="30" cy="30" rx="26" ry="16"/>`),   // D: óvalo
      ],
      correct: 2
    });
  })();

  /* ============= ANALOGÍAS (A13–A16) — formato A : B :: C : ? ============= */

  // Render principal: 4 celdas + separadores ":" / "::"
  function analogyMain(aSvg, bSvg, cSvg) {
    return svgAna(`
      <g fill="none" stroke="${FILL}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round">
        ${aSvg}${bSvg}${cSvg}
      </g>
      <g fill="${FAINT}" font-family="ui-sans-serif, system-ui, Helvetica, Arial, sans-serif" font-size="34" font-weight="600">
        <text x="85" y="52" text-anchor="middle">:</text>
        <text x="185" y="52" text-anchor="middle">::</text>
        <text x="285" y="52" text-anchor="middle">:</text>
      </g>
      ${placeholderQ(300, 10, 60, 60)}
    `);
  }

  // Posiciones celdas: A→cx=40, B→cx=130, C→cx=240
  // A13 · entero : mitad relleno :: entero : mitad relleno → B
  (function(){
    const aSvg = `<circle cx="40" cy="40" r="22"/>`;
    // mitad relleno (mitad derecha) — círculo + path semicírculo derecho relleno
    const bSvg = `<circle cx="130" cy="40" r="22"/><path d="M130 18 A 22 22 0 0 1 130 62 Z" fill="${FILL}"/>`;
    const cSvg = `<rect x="218" y="18" width="44" height="44"/>`;

    abstracta.push({
      id: "cm_a13", dimension: "abstracta", tipo: "analogia",
      text: "Completa la analogía: ¿qué figura corresponde al lugar del signo de interrogación?",
      svg: analogyMain(aSvg, bSvg, cSvg),
      options: ["A","B","C","D"],
      options_svg: [
        outlineSm(`<rect x="10" y="10" width="40" height="40"/>`),  // A: cuadrado vacío (sin cambio)
        outlineSm(`<rect x="10" y="10" width="40" height="40"/><rect x="30" y="10" width="20" height="40" fill="${FILL}"/>`), // B: cuadrado mitad relleno ✓
        outlineSm(`<rect x="10" y="10" width="40" height="40" fill="${FILL}"/>`), // C: cuadrado lleno
        outlineSm(`<rect x="6" y="18" width="48" height="24"/><rect x="30" y="18" width="24" height="24" fill="${FILL}"/>`), // D: rectángulo mitad relleno
      ],
      correct: 1
    });
  })();

  // A14 · chico : grande :: chico : grande → C (de cuadrados)
  (function(){
    const aSvg = `<rect x="32" y="32" width="16" height="16"/>`;        // A: cuadrado chico
    const bSvg = `<rect x="108" y="18" width="44" height="44"/>`;       // B: cuadrado grande
    const cSvg = `<circle cx="240" cy="40" r="8"/>`;                    // C: círculo chico

    abstracta.push({
      id: "cm_a14", dimension: "abstracta", tipo: "analogia",
      text: "Completa la analogía: ¿qué figura corresponde al lugar del signo de interrogación?",
      svg: analogyMain(aSvg, bSvg, cSvg),
      options: ["A","B","C","D"],
      options_svg: [
        outlineSm(`<circle cx="30" cy="30" r="8"/>`),   // A: círculo chico (sin cambio)
        outlineSm(`<circle cx="30" cy="30" r="14"/>`),  // B: círculo mediano
        outlineSm(`<circle cx="30" cy="30" r="24"/>`),  // C: círculo grande ✓
        outlineSm(`<rect x="6" y="6" width="48" height="48"/>`),  // D: cuadrado grande (forma cambiada)
      ],
      correct: 2
    });
  })();

  // A15 · rotación → A
  // ↑ : ↓ :: → : ? = ←
  // representación: triángulo apuntando hacia ↑ / ↓ / →
  (function(){
    const triUp = (cx,cy,s=22) => `<polygon points="${cx},${cy-s} ${cx+s*0.9},${cy+s*0.7} ${cx-s*0.9},${cy+s*0.7}"/>`;
    const aSvg = triUp(40, 40);
    const bSvg = `<g transform="rotate(180 130 40)">${triUp(130, 40)}</g>`;
    const cSvg = `<g transform="rotate(90 240 40)">${triUp(240, 40)}</g>`;

    const tri = (a)=>`<g transform="rotate(${a} 30 30)"><polygon points="30,8 50,46 10,46"/></g>`;
    abstracta.push({
      id: "cm_a15", dimension: "abstracta", tipo: "analogia",
      text: "Completa la analogía: ¿qué figura corresponde al lugar del signo de interrogación?",
      svg: analogyMain(aSvg, bSvg, cSvg),
      options: ["A","B","C","D"],
      options_svg: [
        outlineSm(tri(270)),  // A: ← ✓
        outlineSm(tri(0)),    // B: ↑ (no es el opuesto de →)
        outlineSm(tri(90)),   // C: → (sin cambio)
        outlineSm(tri(180)),  // D: ↓ (rotación del primer par)
      ],
      correct: 0
    });
  })();

  // A16 · inscripción → D
  // ○ : ○ con punto :: □ : ? = □ con punto
  (function(){
    const aSvg = `<circle cx="40" cy="40" r="22"/>`;
    const bSvg = `<circle cx="130" cy="40" r="22"/><circle cx="130" cy="40" r="4" fill="${FILL}"/>`;
    const cSvg = `<rect x="218" y="18" width="44" height="44"/>`;

    abstracta.push({
      id: "cm_a16", dimension: "abstracta", tipo: "analogia",
      text: "Completa la analogía: ¿qué figura corresponde al lugar del signo de interrogación?",
      svg: analogyMain(aSvg, bSvg, cSvg),
      options: ["A","B","C","D"],
      options_svg: [
        outlineSm(`<rect x="10" y="10" width="40" height="40"/><circle cx="30" cy="30" r="14"/>`), // A: cuadrado con círculo grande
        outlineSm(`<rect x="10" y="10" width="40" height="40"/>`),  // B: cuadrado solo (sin cambio)
        outlineSm(`<rect x="10" y="10" width="40" height="40"/><line x1="30" y1="14" x2="30" y2="46"/><line x1="14" y1="30" x2="46" y2="30"/>`),  // C: cuadrado con cruz
        outlineSm(`<rect x="10" y="10" width="40" height="40"/><circle cx="30" cy="30" r="4" fill="${FILL}"/>`),  // D: cuadrado con punto ✓
      ],
      correct: 3
    });
  })();

  /* ============= FIGURA DIFERENTE (A17–A20) — sin figura principal ============= */

  // SVG placeholder con un texto sutil tipo "Compará las opciones"
  const compareSvg = svgPlh(`
    <g font-family="ui-sans-serif, system-ui, Helvetica, Arial, sans-serif">
      <text x="160" y="44" text-anchor="middle" font-size="18" fill="${FAINT}" font-weight="500">
        Compará las opciones
      </text>
      <text x="160" y="64" text-anchor="middle" font-size="13" fill="${FAINT}">
        tres siguen un patrón, una no
      </text>
    </g>
  `);

  // A17 · 3 rotaciones de F + 1 reflejo → C
  // La F asimétrica no se confunde con su reflejo: 3 rotaciones de F + 1 mirror
  (function(){
    const fInner = `<g fill="${FILL}">${SH.F}</g>`;
    abstracta.push({
      id: "cm_a17", dimension: "abstracta", tipo: "figura_diferente",
      text: "¿Cuál de estas figuras es diferente a las otras tres?",
      svg: compareSvg,
      options: ["A","B","C","D"],
      options_svg: [
        svgSm(fInner),                      // A: F 0°
        svgSm(rot(90, fInner)),             // B: F 90°
        svgSm(flipH(fInner)),               // C: F reflejada horizontal ✓ (diferente)
        svgSm(rot(180, fInner)),            // D: F 180°
      ],
      correct: 2
    });
  })();

  // A18 · 3 simétricas + 1 asimétrica → A
  (function(){
    abstracta.push({
      id: "cm_a18", dimension: "abstracta", tipo: "figura_diferente",
      text: "¿Cuál de estas figuras es diferente a las otras tres?",
      svg: compareSvg,
      options: ["A","B","C","D"],
      options_svg: [
        outlineSm(`<path d="M15 12 L23 12 L23 38 L42 38 L42 46 L15 46 Z"/>`), // A: L asimétrica ✓
        outlineSm(`<polygon points="30,12 50,46 10,46"/>`),   // B: triángulo equilátero
        outlineSm(`<rect x="14" y="14" width="32" height="32"/>`), // C: cuadrado
        outlineSm(`<circle cx="30" cy="30" r="18"/>`),        // D: círculo
      ],
      correct: 0
    });
  })();

  // A19 · 3 pentágonos + 1 hexágono → B
  (function(){
    const pent = (a) => `<g transform="rotate(${a} 30 30)"><polygon points="30,10 49,24 42,46 18,46 11,24"/></g>`;
    abstracta.push({
      id: "cm_a19", dimension: "abstracta", tipo: "figura_diferente",
      text: "¿Cuál de estas figuras es diferente a las otras tres?",
      svg: compareSvg,
      options: ["A","B","C","D"],
      options_svg: [
        outlineSm(pent(0)),                                                    // A: pentágono
        outlineSm(`<polygon points="30,10 47,20 47,40 30,50 13,40 13,20"/>`),  // B: hexágono ✓
        outlineSm(pent(72)),                                                   // C: pentágono rotado
        outlineSm(pent(144)),                                                  // D: pentágono rotado
      ],
      correct: 1
    });
  })();

  // A20 · 3 cerradas + 1 abierta → D
  (function(){
    abstracta.push({
      id: "cm_a20", dimension: "abstracta", tipo: "figura_diferente",
      text: "¿Cuál de estas figuras es diferente a las otras tres?",
      svg: compareSvg,
      options: ["A","B","C","D"],
      options_svg: [
        outlineSm(`<rect x="14" y="14" width="32" height="32"/>`),             // A: cuadrado cerrado
        outlineSm(`<polygon points="30,12 50,46 10,46"/>`),                    // B: triángulo cerrado
        outlineSm(`<polygon points="30,10 47,20 47,40 30,50 13,40 13,20"/>`),  // C: hexágono cerrado
        outlineSm(`<path d="M44 14 L18 14 L18 46 L44 46"/>`),                  // D: figura abierta (C abierta) ✓
      ],
      correct: 3
    });
  })();

  // === EXPORT ===
  window.VELNA_DATA = { espacial, abstracta };
})();
