# Logica de Calculo de Competencias - SharkTalents

## Resumen
El sistema calcula 54 competencias para cada candidato basandose en 3 fuentes de datos:
DISC, Cognitivo (VELNA) y Perfil Emocional.

## Formula General
```
score_competencia = promedio simple de todos los factores que indica el manual
```
- Si tiene 3 factores: score = (factor1 + factor2 + factor3) / 3
- Si tiene 4 factores: score = (factor1 + factor2 + factor3 + factor4) / 4
- Todos los factores pesan igual

## Factores DISC (D, I, S, C)

Los valores raw vienen del conteo de respuestas (40 preguntas, suma = 40).
Se normalizan a escala 0-100 multiplicando por 5 con tope en 100.

```
valor_normalizado = min(100, raw * 5)
```

Ejemplo: D=11, I=7, S=3, C=19 -> D=55, I=35, S=15, C=95

Caso especial - "Baja Solidez":
Algunas competencias requieren baja solidez (ej: Creatividad).
Se calcula como: 100 - S_normalizado

## Factores Cognitivos (VELNA)

5 dimensiones: Verbal, Espacial, Logico, Numerico, Abstracto.
Cada una se normaliza a 0-100:

```
valor = min(100, round((aciertos / max_por_dimension) * 100))
```

Donde max_por_dimension = total_preguntas / 5 (basico=20, medio=20, senior=25)

Indice Cognitivo = promedio de las 5 dimensiones:
```
IC = (verbal + espacial + logico + numerico + abstracto) / 5
```

## Perfil Emocional

El score emocional va de 0 a 100:
- 0-30: Espontaneo
- 31-70: Mesura
- 71-100: Reflexivo

NO es un valor lineal. Segun lo que requiere cada competencia, se convierte asi:

### Si la competencia requiere MESURA:
- Candidato en Mesura (31-70): contribucion = 100
- Candidato en Espontaneo (0-30): contribucion = (score / 30) * 50
- Candidato en Reflexivo (71-100): contribucion = ((100 - score) / 30) * 50

### Si la competencia requiere REFLEXIVIDAD:
- Candidato en Reflexivo (71-100): contribucion = 100
- Candidato en Mesura (31-70): contribucion = ((score - 31) / 39) * 70
- Candidato en Espontaneo (0-30): contribucion = (score / 30) * 30

### Si la competencia requiere ESPONTANEIDAD:
- Candidato en Espontaneo (0-30): contribucion = 100
- Candidato en Mesura (31-70): contribucion = ((70 - score) / 39) * 70
- Candidato en Reflexivo (71-100): contribucion = ((100 - score) / 30) * 30

## Ejemplo Completo

Candidato con:
- DISC raw: D=11, I=7, S=3, C=19
- DISC normalizado: D=55, I=35, S=15, C=95
- Cognitivo: Verbal=80, Espacial=5, Logico=50, Numerico=80, Abstracto=70
- Indice Cognitivo: (80+5+50+80+70)/5 = 57
- Emocion: 73 (Reflexivo)

Calculo de "Persuasion y negociacion" (factores: disc_I, cog_verbal, cog_logico, emocion_mesura):
- disc_I = 35
- cog_verbal = 80
- cog_logico = 50
- emocion_mesura: score=73 esta en Reflexivo -> ((100-73)/30)*50 = 45
- Score = (35 + 80 + 50 + 45) / 4 = 52.5 -> 53

## Lista de 54 Competencias y sus Factores

| # | Competencia | Factores |
|---|-------------|----------|
| 1 | Comunicacion digital | cog_verbal, disc_I, disc_S, emocion_mesura |
| 2 | Colaboracion | disc_I, disc_S, disc_C, emocion_mesura |
| 3 | Adaptabilidad | disc_D, disc_I, cog_indice, emocion_mesura |
| 4 | Iniciativa | disc_D, disc_I, emocion_reflexividad, cog_logico, cog_abstracto |
| 5 | Planificacion | disc_C, cog_espacial, emocion_reflexividad |
| 6 | Manejo de la ambiguedad | disc_D, disc_C, cog_indice, emocion_mesura |
| 7 | Trabajo en equipo y colaboracion | disc_D, disc_S, cog_indice, emocion_mesura |
| 8 | Retroalimentacion y monitoreo | disc_D, disc_C, cog_logico, cog_verbal, emocion_mesura |
| 9 | Orientacion al cliente | disc_D, disc_C, cog_indice, emocion_mesura |
| 10 | Aprendizaje al vuelo | disc_D, disc_I, cog_logico |
| 11 | Resolucion de problemas complejos | cog_indice, emocion_mesura |
| 12 | Inteligencia emocional | emocion_mesura, cog_indice |
| 13 | Creatividad e innovacion | disc_D, disc_I, disc_S_inv (baja solidez), disc_C, emocion_espontaneidad |
| 14 | Liderazgo | disc_D, disc_I, disc_S, cog_indice, emocion_mesura |
| 15 | Orientacion al logro | disc_D, cog_espacial, cog_logico, cog_numerico, emocion_mesura |
| 16 | Persuasion y negociacion | disc_I, cog_verbal, cog_logico, emocion_mesura |
| 17 | Mentalidad digital | disc_I, disc_D, disc_C, cog_espacial, cog_logico, cog_abstracto |
| 18 | Foco en data | disc_C, disc_D, cog_espacial, cog_logico, cog_numerico, emocion_reflexividad |
| 19 | Impacto e influencia | disc_I |
| 20 | Autoconfianza | disc_D, disc_I |
| 21 | Comprension interpersonal | disc_S, disc_I, emocion_mesura |
| 22 | Comprension de la organizacion | disc_I |
| 23 | Desarrollo de interrelaciones | disc_I, disc_S |
| 24 | Desarrollo de personas | disc_D |
| 25 | Orden y calidad | disc_C |
| 26 | Direccion de personas | disc_D |
| 27 | Asertividad | disc_D, emocion_mesura |
| 28 | Dinamismo y energia | disc_I, disc_D, emocion_mesura |
| 29 | Habilidad analitica | cog_logico, cog_espacial, disc_C |
| 30 | Perseverancia | disc_D, disc_S, emocion_reflexividad |
| 31 | Orientacion a la accion | disc_D, disc_I, emocion_espontaneidad |
| 32 | Habilidades de mando | disc_D, disc_I, emocion_espontaneidad |
| 33 | Compromiso organizacional | disc_S, disc_C |
| 34 | Actitud de servicio | disc_S, disc_I |
| 35 | Manejo de conflictos | disc_D, disc_I, emocion_mesura |
| 36 | Toma de decisiones oportuna | disc_D, cog_indice, emocion_espontaneidad |
| 37 | Calidad de las decisiones | cog_indice, emocion_reflexividad, disc_S, disc_C |
| 38 | Delegacion | disc_I, disc_S, emocion_mesura |
| 39 | Habilidad de informar | disc_I, disc_S |
| 40 | Capacidad intelectual | cog_indice |
| 41 | Capacidad para escuchar | disc_S, emocion_reflexividad |
| 42 | Valentia gerencial | disc_D, disc_I, emocion_espontaneidad |
| 43 | Administracion y supervision del trabajo | disc_D, disc_C, cog_espacial, cog_logico |
| 44 | Habilidad de motivar a personas | disc_I, disc_S, disc_C, emocion_mesura |
| 45 | Paciencia | disc_S, emocion_reflexividad |
| 46 | Administracion de procesos | cog_logico, cog_espacial, disc_C |
| 47 | Manejo de vision y proposito | disc_I, disc_S, disc_C, emocion_mesura |
| 48 | Comunicacion escrita | cog_verbal |
| 49 | Gestion del riesgo | disc_S, disc_C, cog_verbal, cog_espacial, cog_logico, emocion_mesura |
| 50 | Pensamiento analitico e innovacion | cog_logico, cog_espacial, cog_abstracto, disc_C, emocion_espontaneidad |
| 51 | Aprendizaje activo y estrategias de aprendizaje | disc_D, disc_I, cog_logico |
| 52 | Pensamiento critico y analisis | cog_logico, cog_espacial, disc_C |
| 53 | Creatividad, originalidad e iniciativa | disc_D, disc_I, cog_indice, emocion_mesura |
| 54 | Liderazgo e influencia social | disc_I, disc_S, disc_D, cog_indice, emocion_mesura |
| 55 | Resiliencia, tolerancia al estres y flexibilidad | disc_D, disc_I, cog_indice, emocion_mesura |

Nota: Se omitio "Razonamiento, solucion de problemas e ideacion" porque incluia
"Cumplimiento situacional" que no tiene logica de calculo definida.

## Archivo de implementacion
El codigo fuente esta en: functions/sharktalents/src/data/competencias.ts

## Recalculo
Si se modifica la logica, se puede recalcular todos los candidatos existentes
llamando al endpoint POST /api/admin/recalculate-competencias
