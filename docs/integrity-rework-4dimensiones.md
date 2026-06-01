# Rework de 4 dimensiones de integridad

> Propuesta para revisar. Reemplazo de las preguntas actuales en alcohol, drogas, apuestas y hurto, tomando ideas de tests validados (AUDIT, DAST, Lie/Bet, SOGS, Reid Report) y adaptándolas a escenarios laborales.
>
> **Cómo leer los risk_weights:** la opción con `0` es la "ideal", `3` es la "más riesgosa". El cálculo de integridad suma los pesos elegidos.

---

## 🍷 ALCOHOL (6 preguntas)

### al1 — Frecuencia objetiva (AUDIT-C inspirado)
**Pensando en los últimos 12 meses, ¿con qué frecuencia tomaste 4 o más bebidas alcohólicas en una sola ocasión?**

| Opción | Risk |
|---|---|
| Nunca o casi nunca | 0 |
| Algunas veces al año (eventos sociales) | 1 |
| Una o dos veces al mes | 2 |
| Una vez por semana o más | 3 |

### al2 — Self-perception (CAGE inspirado)
**¿Alguien en tu familia, pareja, amigos o trabajo te ha pedido alguna vez que reduzcas tu consumo de alcohol?**

| Opción | Risk |
|---|---|
| Nunca | 0 |
| Una vez en tono de broma | 1 |
| Sí, una vez en tono serio | 2 |
| Sí, en más de una ocasión | 3 |

### al3 — Situacional: priorización con consecuencias
**Tu equipo te invita a un after-work donde se bebe bastante. Mañana tenés una presentación importante para un cliente. ¿Qué hacés?**

| Opción | Risk |
|---|---|
| No voy, prefiero llegar fresca/o a la presentación | 0 |
| Voy, tomo poco y me retiro temprano | 0 |
| Voy y me adapto a lo que tome el resto | 2 |
| Voy igual, una noche no afecta mi rendimiento al día siguiente | 3 |

### al4 — Situacional: presión social del cliente
**Estás en almuerzo de trabajo con un cliente importante. Él está tomando bastante e insiste en que lo acompañes. Vos casi no tomaste. ¿Qué hacés?**

| Opción | Risk |
|---|---|
| Sigo tomando agua o algo sin alcohol con naturalidad | 0 |
| Tomo solo lo justo para acompañar, sin pasar mi límite | 0 |
| Tomo a su ritmo, no quiero ofenderlo | 2 |
| Aprovecho que es trabajo y tomo lo que él tome | 3 |

### al5 — Situacional: compañero con problema
**Un compañero llega los lunes notoriamente con resaca y su trabajo se ve afectado. ¿Qué hacés?**

| Opción | Risk |
|---|---|
| Le hablo en privado, le pregunto si está todo bien | 0 |
| Espero unas semanas y si sigue, hablo con el jefe | 1 |
| No es mi problema, cada uno con su vida | 2 |
| Lo cubro algunas veces, no quiero meterme | 3 |

### al6 — Auto-evaluación reflexiva (forma indirecta)
**¿Cuál de estas frases describe mejor tu relación con el alcohol hoy?**

| Opción | Risk |
|---|---|
| No tomo o tomo muy ocasionalmente | 0 |
| Tomo socialmente, sin que afecte mi vida diaria | 0 |
| Disfruto tomar, a veces me excedo pero no afecta mi trabajo | 2 |
| El alcohol es parte importante de cómo me relajo, lo manejo bien | 3 |

---

## 💊 DROGAS (6 preguntas)

### dr1 — Overt admission (DAST-10 inspirado, suavizado para contexto laboral)
**En los últimos 12 meses, ¿usaste alguna sustancia recreativa (marihuana u otra) que no fuera recetada por un médico?**

| Opción | Risk |
|---|---|
| Nunca | 0 |
| Una o dos ocasiones aisladas en contexto social | 1 |
| De forma esporádica (menos de 1 vez al mes) | 2 |
| Regularmente como parte de mi rutina social | 3 |

### dr2 — Situacional: oferta directa en trabajo
**Un compañero te ofrece una pastilla "para concentrarte mejor" en una semana de alta carga laboral. ¿Qué hacés?**

| Opción | Risk |
|---|---|
| Rechazo, prefiero descansar más o pedir reorganizar prioridades | 0 |
| Le pregunto qué es exactamente y decido informada/o | 1 |
| Acepto, si a él le funciona puede funcionarme a mí | 3 |
| Acepto solo si veo que muchos del equipo lo hacen | 2 |

### dr3 — Situacional: gestión de compañero con problema
**Estás manejando un proyecto crítico. Un colaborador clave llega los lunes con signos claros de haber consumido fin de semana (cansado, distraído, pupilas raras). ¿Qué hacés?**

| Opción | Risk |
|---|---|
| Le hablo directamente sin acusarlo, ofrezco apoyo si necesita | 0 |
| Documento la situación y la reporto a RRHH formalmente | 1 |
| Lo asigno a tareas menos críticas temporalmente sin hablar del tema | 2 |
| No hago nada si su trabajo sigue saliendo | 3 |

### dr4 — Opinión política (revela actitud, difícil de fakear)
**¿Qué tan de acuerdo estás con esta frase: "lo que un empleado consume en su tiempo libre no es asunto del empleador"?**

| Opción | Risk |
|---|---|
| No estoy de acuerdo, afecta el rendimiento general y la confianza | 0 |
| Depende del tipo de trabajo y la sustancia | 1 |
| Es zona gris, cada empresa decide su política | 2 |
| Totalmente de acuerdo, es decisión personal del empleado | 3 |

### dr5 — Situacional: tráfico interno
**Si te enterás de que un compañero está vendiendo sustancias dentro del trabajo, ¿qué hacés?**

| Opción | Risk |
|---|---|
| Reporto inmediatamente a RRHH o seguridad | 0 |
| Hablo primero con esa persona para confirmar lo que vi | 1 |
| Lo comento informalmente con otros compañeros, sin reportarlo | 2 |
| No hago nada, no es mi problema | 3 |

### dr6 — Self-perception (paralela a CAGE pero adaptada)
**¿Alguien (familia, pareja, amigos, médico) te ha sugerido alguna vez que reduzcas o dejes el consumo de alguna sustancia?**

| Opción | Risk |
|---|---|
| Nunca, no consumo sustancias | 0 |
| Sí, en tono de broma | 1 |
| Sí, una vez en tono preocupado | 2 |
| Sí, en más de una ocasión | 3 |

---

## 🎲 APUESTAS (6 preguntas)

### ap1 — Lie/Bet adaptado (el test más validado en 2 preguntas)
**¿Alguna vez sentiste la necesidad de apostar montos cada vez más grandes para sentir la misma emoción?**

| Opción | Risk |
|---|---|
| Nunca apuesto | 0 |
| No, controlo mis montos y no busco más adrenalina | 0 |
| Alguna vez sí, pero me detuve | 1 |
| Sí, ha pasado | 3 |

### ap2 — Lie/Bet pregunta 2
**¿Le mentiste alguna vez a alguien cercano (familia, pareja, amigos) sobre cuánto apostaste?**

| Opción | Risk |
|---|---|
| Nunca apuesto | 0 |
| No, soy transparente con mis gastos | 0 |
| Una vez minimicé el monto | 2 |
| Sí, en varias ocasiones | 3 |

### ap3 — Situacional CRÍTICO: acceso a dinero ajeno + dificultades
**Tenés acceso al manejo de efectivo o cuentas en tu trabajo. Estás pasando por una racha de pérdidas en apuestas y necesitás cubrir gastos. ¿Qué hacés?**

| Opción | Risk |
|---|---|
| Jamás tocaría dinero de la empresa, busco solución personal | 0 |
| Pido un adelanto formal a RRHH | 0 |
| Considero tomar prestado prometiéndome devolverlo rápido | 3 |
| Espero que se recupere mi suerte sin tocar nada | 1 |

### ap4 — Situacional: contexto laboral con apuestas
**Tu jefe te invita a un casino con un cliente importante. Te ofrecen fichas de cortesía por USD 100. ¿Qué hacés?**

| Opción | Risk |
|---|---|
| Las rechazo educadamente, prefiero no apostar en contexto laboral | 0 |
| Las acepto y juego muy conservadora/o, sin gastar de más | 1 |
| Acepto y aprovecho para jugar normalmente, total son fichas regaladas | 2 |
| Acepto y las cambio por dinero al final | 3 |

### ap5 — Actitud frente a comportamiento de otros
**Un compañero te cuenta orgulloso que ganó USD 5,000 apostando deportes este mes. ¿Qué te genera?**

| Opción | Risk |
|---|---|
| Preocupación, las apuestas suelen terminar mal a largo plazo | 0 |
| Me parece bien si lo controla, no es asunto mío | 1 |
| Curiosidad sobre cómo lo hizo | 2 |
| Quiero que me cuente cómo para intentarlo yo también | 3 |

### ap6 — Auto-cuantificación (PGSI inspirado)
**¿Qué porcentaje aproximado de tu ingreso mensual destinás a apuestas, loterías o juegos de azar?**

| Opción | Risk |
|---|---|
| 0% — no apuesto | 0 |
| Menos del 1% (lotería esporádica) | 0 |
| Entre 1% y 5% | 2 |
| Más del 5% | 3 |

---

## 🚫 HURTO (7 preguntas)

### hu1 — Overt admission (estilo Reid Report)
**¿Alguna vez te llevaste algo del trabajo (papelería, herramientas, equipamiento, productos) sin pedir permiso?**

| Opción | Risk |
|---|---|
| Nunca | 0 |
| Sí, cosas insignificantes que se asumen como bienes comunes (un bolígrafo, etc.) | 1 |
| Sí, ocasionalmente cuando lo necesité en casa | 2 |
| Sí, en varias ocasiones y de cierto valor | 3 |

### hu2 — Situacional: faltante de caja
**Sos responsable de cerrar caja al final del día. Falta dinero (USD 50) y vos sos quien último la manejó. ¿Qué hacés?**

| Opción | Risk |
|---|---|
| Reporto el faltante inmediatamente a mi supervisor | 0 |
| Reviso todo el día primero, si no aparece, lo reporto | 0 |
| Pongo dinero de mi bolsillo para no levantar problemas y reviso después en privado | 2 |
| Asumo que alguien más lo tomó y lo comento informalmente | 3 |

### hu3 — Situacional: dinero encontrado
**Encontrás un sobre con USD 500 en efectivo abandonado en una sala de reuniones. No sabés de quién es. ¿Qué hacés?**

| Opción | Risk |
|---|---|
| Lo entrego inmediatamente a recepción o RRHH | 0 |
| Pregunto al equipo de quién es | 0 |
| Lo guardo unos días, si nadie lo reclama, lo entrego | 1 |
| Lo guardo, si nadie lo busca, me lo quedo | 3 |

### hu4 — Situacional: complicidad con jefe (NUEVA — clave)
**Tu jefe te pide que infles los gastos de tu próximo viaje de trabajo en USD 100 para que él pueda cobrar la diferencia. Te dice que es práctica común en la empresa. ¿Qué hacés?**

| Opción | Risk |
|---|---|
| Me niego y le explico por qué no estoy dispuesta/o | 0 |
| Le pido la instrucción por escrito antes de hacerlo | 1 |
| Lo hago una vez para no generar conflicto y registro evidencia | 2 |
| Lo hago, si es práctica de la empresa no es problema mío | 3 |

### hu5 — Acceso a info sensible
**Tenés acceso a información confidencial de clientes (datos personales, financieros). Un amigo te pide info específica de un cliente por motivos personales. ¿Qué hacés?**

| Opción | Risk |
|---|---|
| Me niego rotundamente, sin importar la relación | 0 |
| Le explico que está prohibido legalmente y por política | 0 |
| Le ayudo solo si es algo menor (un teléfono, una dirección) | 3 |
| Le doy la info, es para mi amigo, no veo problema | 3 |

### hu6 — Uso de recursos
**Ves que un compañero usa el equipo de la empresa (laptop, software, conexión) para freelance personal en horario laboral. ¿Qué hacés?**

| Opción | Risk |
|---|---|
| Le hablo en privado para que entienda el riesgo | 0 |
| Reporto la situación a su jefe directo | 1 |
| No hago nada, no es mi problema | 2 |
| Hago lo mismo si veo que está aceptado | 3 |

### hu7 — Actitud (paralela a la actual pero más nueva)
**¿Qué tan de acuerdo estás con esta frase: "Si la empresa tiene exceso de inventario que nadie revisa, no es robar tomar algo para uso personal"?**

| Opción | Risk |
|---|---|
| No estoy de acuerdo, sigue siendo propiedad de la empresa | 0 |
| Depende del valor y de si es algo descartable | 1 |
| Estoy parcialmente de acuerdo si nadie lo va a usar | 2 |
| De acuerdo, si no lo controlan no es problema | 3 |

---

## Resumen comparativo

| Dimensión | Antes | Después | Cambio principal |
|---|---|---|---|
| Alcohol | 6 preguntas (3 self-report débil) | 6 preguntas (2 self-report mejor calibradas + 4 situacionales) | AUDIT-C + escenarios laborales |
| Drogas | 6 preguntas (mayormente self-report) | 6 preguntas (1 overt admission + 4 situacionales + 1 actitudinal) | DAST adaptado + situaciones reales |
| Apuestas | 6 preguntas (3 frecuencia obvia) | 6 preguntas (2 Lie/Bet + 4 situacionales) | Lie/Bet adaptado + acceso a dinero |
| Hurto | 7 preguntas | 7 preguntas (1 overt + 6 situacionales) | Más escenarios donde la línea es ambigua |

**Total:** 25 preguntas reemplazadas.

---

## Decisión que necesitamos tomar

1. **¿Reemplazo todas o vas a iterar opción por opción?**
2. **¿Mantengo los risk_weights propuestos o querés ajustar alguno?** (la mayoría siguen el patrón clásico: ideal=0, leve=1, moderado=2, riesgoso=3)
3. **¿Querés que estas 25 preguntas se carguen YA al backend** para que el próximo candidato del demo las vea, o las dejamos en doc y las cargamos cuando el equipo las revise?

Decime y arranco con la migración al JSON real.
