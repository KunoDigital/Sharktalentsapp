/**
 * Calculate candidate's overall score and recommendation
 * All dimensions weighted equally (20% each)
 */

export interface CandidateAnalysis {
  overall_score: number;
  recommendation: 'recomendado' | 'con_observaciones' | 'no_recomendado';
  disc_match: number;
  cognitive_match: number;
  technical_score: number;
  integrity_score: number;
  emotion_score: number;
  strengths: string[];
  weaknesses: string[];
}

export function analyzeCandidateVsIdeal(
  scores: any,
  idealProfile: any
): CandidateAnalysis {
  const ip = idealProfile || {};

  // 1. DISC match (ratio min/max per dimension)
  let discMatch = 50;
  if (scores.disc && ip.disc) {
    const dims = ['D', 'I', 'S', 'C'];
    const discRaw = scores.disc;
    // Normalize candidate DISC (raw × 5, cap 100)
    const norm: Record<string, number> = {};
    const sum = dims.reduce((s, d) => s + (discRaw[d] || 0), 0);
    if (sum <= 100) {
      for (const d of dims) norm[d] = Math.min(100, (discRaw[d] || 0) * 5);
    } else {
      for (const d of dims) norm[d] = discRaw[d] || 0;
    }
    let totalRatio = 0;
    for (const d of dims) {
      const i = ip.disc[d] || 0;
      const c = norm[d] || 0;
      if (i === 0 && c === 0) { totalRatio += 100; continue; }
      totalRatio += Math.round((Math.min(i, c) / Math.max(i, c, 1)) * 100);
    }
    discMatch = Math.round(totalRatio / 4);
  }

  // 2. Cognitive match (ratio min/max per dimension)
  let cogMatch = 50;
  if (scores.cognitive && ip.cognitive) {
    const cog = scores.cognitive;
    const maxPerDim = cog.max ? Math.max(1, Math.round(cog.max / 5)) : 20;
    const dims = ['verbal', 'espacial', 'logica', 'numerica', 'abstracta'];
    const dimMap: Record<string, string> = { logica: 'logica', numerica: 'numerica' };
    let totalRatio = 0;
    for (const dim of dims) {
      const raw = cog[dim] || 0;
      const pct = Math.min(100, Math.round((raw / maxPerDim) * 100));
      const idealVal = ip.cognitive[dim] || 50;
      if (idealVal === 0 && pct === 0) { totalRatio += 100; continue; }
      totalRatio += Math.round((Math.min(pct, idealVal) / Math.max(pct, idealVal, 1)) * 100);
    }
    cogMatch = Math.round(totalRatio / 5);
  }

  // 3. Technical score (direct %)
  let techScore = 50;
  if (scores.technical?.score != null) {
    techScore = scores.technical.score;
  }

  // 4. Integrity (inverted: bajo=100, medio=50, alto=10)
  let intScore = 50;
  if (scores.integrity) {
    const pct = scores.integrity.overall_pct || 0;
    intScore = 100 - pct; // low risk % = high integrity score
  }

  // 5. Emotion — how close to mesura (center)
  let emoScore = 50;
  if (scores.emotional) {
    const s = scores.emotional.score;
    // mesura (31-70) = best, further from center = lower score
    const distFromCenter = Math.abs(s - 50);
    emoScore = Math.max(0, 100 - distFromCenter * 2);
  }

  // Overall score (equal weights)
  const overall = Math.round((discMatch + cogMatch + techScore + intScore + emoScore) / 5);

  // Recommendation
  let recommendation: 'recomendado' | 'con_observaciones' | 'no_recomendado';
  if (overall >= 70) recommendation = 'recomendado';
  else if (overall >= 50) recommendation = 'con_observaciones';
  else recommendation = 'no_recomendado';

  // Strengths & weaknesses
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (discMatch >= 70) strengths.push(`Perfil conductual compatible con el puesto (${discMatch}% match)`);
  else if (discMatch < 50) weaknesses.push(`Perfil conductual difiere del ideal (${discMatch}% match)`);

  if (cogMatch >= 70) strengths.push(`Capacidad cognitiva alineada con las exigencias del puesto (${cogMatch}% match)`);
  else if (cogMatch < 50) weaknesses.push(`Capacidad cognitiva por debajo de lo esperado (${cogMatch}% match)`);

  if (techScore >= 70) strengths.push(`Buen desempeno en la evaluacion tecnica (${techScore}%)`);
  else if (techScore < 50) weaknesses.push(`Resultado tecnico por debajo del minimo (${techScore}%)`);

  if (intScore >= 80) strengths.push('Perfil de integridad solido, bajo riesgo');
  else if (intScore < 50) weaknesses.push('Alertas en el perfil de integridad que requieren atencion');

  if (emoScore >= 70) strengths.push('Equilibrio emocional adecuado para el puesto');
  else if (emoScore < 40) weaknesses.push('Perfil emocional en los extremos, podria afectar la adaptacion');

  // Add specific cognitive strengths/weaknesses
  if (scores.cognitive) {
    const cog = scores.cognitive;
    const maxPerDim = cog.max ? Math.max(1, Math.round(cog.max / 5)) : 20;
    const cogDims = [
      { key: 'verbal', label: 'habilidad verbal' },
      { key: 'espacial', label: 'razonamiento espacial' },
      { key: 'logica', label: 'razonamiento logico' },
      { key: 'numerica', label: 'habilidad numerica' },
      { key: 'abstracta', label: 'razonamiento abstracto' },
    ];
    for (const d of cogDims) {
      const pct = Math.min(100, Math.round(((cog[d.key] || 0) / maxPerDim) * 100));
      if (pct >= 75) strengths.push(`Destaca en ${d.label}`);
      else if (pct < 30) weaknesses.push(`Area a desarrollar: ${d.label}`);
    }
  }

  return {
    overall_score: overall,
    recommendation,
    disc_match: discMatch,
    cognitive_match: cogMatch,
    technical_score: techScore,
    integrity_score: intScore,
    emotion_score: emoScore,
    strengths: strengths.slice(0, 5),
    weaknesses: weaknesses.slice(0, 5),
  };
}
