/**
 * Scoring functions — extracted from the original Express backend.
 * Calculates scores for each assessment type.
 */

export function calculateScore(type: string, rawQuestions: any, answers: Record<string, number>): any {
  switch (type) {
    case 'kudert': {
      const sections = rawQuestions as { name: string; questions: any[]; timer: number | null }[];
      const discSection = sections.find(s => s.name === 'DISC');
      const emotionSection = sections.find(s => s.name === 'Emoción');
      const cogSections = sections.filter(s => !['DISC', 'Emoción'].includes(s.name));
      const allCogQuestions = cogSections.flatMap(s => s.questions);

      const discResult = scoreDisc(discSection?.questions || [], answers);
      const cogResult = scoreCognitive(allCogQuestions, answers);
      const emotionalResult = scoreEmotional(emotionSection?.questions || [], answers);

      let competencias = null;
      try {
        const { calculateCompetencias } = require('../data/competencias');
        competencias = calculateCompetencias(discResult, cogResult, emotionalResult);
      } catch { /* competencias module not available */ }

      return { disc: discResult, cognitive: cogResult, emotional: emotionalResult, competencias };
    }
    case 'integrity':
      return scoreIntegrity(rawQuestions, answers);
    case 'technical':
      return scoreTechnical(rawQuestions, answers);
    default:
      return null;
  }
}

function scoreDisc(questions: any[], answers: Record<string, number>): any {
  const profile: Record<string, number> = { D: 0, I: 0, S: 0, C: 0 };
  for (const q of questions) {
    const sel = answers[q.id];
    if (sel == null || !Array.isArray(q.dimension)) continue;
    const dim = q.dimension[sel];
    if (dim && profile[dim] !== undefined) profile[dim]++;
  }
  const maxKey = Object.entries(profile).reduce((a, b) => a[1] >= b[1] ? a : b)[0];
  return { ...profile, perfil_dominante: maxKey };
}

function scoreCognitive(questions: any[], answers: Record<string, number>): any {
  const dims: Record<string, number> = { verbal: 0, espacial: 0, logica: 0, numerica: 0, abstracta: 0 };
  const dimMap: Record<string, string> = { verbal: 'verbal', espacial: 'espacial', logico: 'logica', numerico: 'numerica', abstracto: 'abstracta' };
  let total = 0;
  for (const q of questions) {
    const sel = answers[q.id];
    if (sel == null) continue;
    if (sel === q.correct) {
      total++;
      const scoreKey = dimMap[q.dimension] || q.dimension;
      if (dims[scoreKey] !== undefined) dims[scoreKey]++;
    }
  }
  return { total, max: questions.length, ...dims };
}

function scoreTechnical(questions: any[], answers: Record<string, number>): any {
  if (!questions.length) return null;
  let total = 0;
  for (const q of questions) {
    const sel = answers[q.id];
    if (sel == null) continue;
    if (sel === q.correct) total++;
  }
  return { total, max: questions.length };
}

function scoreIntegrity(questions: any[], answers: Record<string, number>): any {
  const dimData: Record<string, { risk_score: number; max_risk: number; total: number }> = {};
  for (const q of questions) {
    const sel = answers[q.id];
    const dim = q.dimension || 'general';
    const weights: number[] = q.risk_weights || [0, 1, 2, 3];
    if (!dimData[dim]) dimData[dim] = { risk_score: 0, max_risk: 0, total: 0 };
    dimData[dim].max_risk += 3;
    dimData[dim].total++;
    if (sel == null) continue;
    dimData[dim].risk_score += weights[sel] ?? 0;
  }

  // Umbrales diferenciados por dimensión
  const thresholds: Record<string, { medioMin: number; altoMin: number }> = {
    hurto:               { medioMin: 21, altoMin: 41 },
    soborno:             { medioMin: 21, altoMin: 41 },
    drogas:              { medioMin: 26, altoMin: 51 },
    honestidad:          { medioMin: 31, altoMin: 56 },
    confiabilidad:       { medioMin: 31, altoMin: 56 },
    alcohol:             { medioMin: 36, altoMin: 61 },
    apuestas:            { medioMin: 26, altoMin: 51 },
    personalidad:        { medioMin: 36, altoMin: 61 },
    autenticidad:        { medioMin: 31, altoMin: 56 },
    inteligencia_social: { medioMin: 36, altoMin: 61 },
    imparcialidad:       { medioMin: 26, altoMin: 51 },
    sencillez:           { medioMin: 36, altoMin: 61 },
    dominio_personal:    { medioMin: 31, altoMin: 56 },
    buena_impresion:     { medioMin: 41, altoMin: 66 },
    etica_profesional:   { medioMin: 31, altoMin: 56 },
  };
  const defaultThreshold = { medioMin: 31, altoMin: 56 };

  const dimensiones: Record<string, { nivel: string; pct: number }> = {};
  let totalRisk = 0, totalMax = 0, anyAlto = false;
  let biPct = 0;
  for (const [dim, data] of Object.entries(dimData)) {
    const pct = data.max_risk > 0 ? Math.round((data.risk_score / data.max_risk) * 100) : 0;
    const t = thresholds[dim] || defaultThreshold;
    const nivel = pct < t.medioMin ? 'bajo' : pct < t.altoMin ? 'medio' : 'alto';
    dimensiones[dim] = { nivel, pct };
    if (dim === 'buena_impresion') {
      biPct = pct;
      continue;
    }
    totalRisk += data.risk_score;
    totalMax += data.max_risk;
    if (nivel === 'alto') anyAlto = true;
  }

  const overallPct = totalMax > 0 ? Math.round((totalRisk / totalMax) * 100) : 0;
  let overall: string;
  if (overallPct <= 30 && !anyAlto) overall = 'bajo';
  else if (overallPct > 60) overall = 'alto';
  else overall = 'medio';

  const recomendacion = overall === 'bajo' ? 'Se puede recomendar' : overall === 'medio' ? 'Revisar con cautela' : 'No se recomienda';
  const buena_impresion = biPct > 60 ? 'alto' : biPct > 30 ? 'medio' : 'bajo';
  return { overall, recomendacion, overall_pct: overallPct, dimensiones, buena_impresion, buena_impresion_pct: biPct };
}

function scoreEmotional(questions: any[], answers: Record<string, number>): any {
  if (!questions.length) return null;
  let sum = 0, count = 0;
  for (const q of questions) {
    const sel = answers[q.id];
    if (sel == null || !Array.isArray(q.scores)) continue;
    sum += q.scores[sel] ?? 50;
    count++;
  }
  if (count === 0) return null;
  const score = Math.round(sum / count);
  const perfil = score <= 33 ? 'espontaneo' : score <= 66 ? 'mesura' : 'reflexivo';
  return { score, perfil };
}
