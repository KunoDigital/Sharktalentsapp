import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface IntegrityDimension {
  nivel: string;
  pct: number;
}

export interface ReportData {
  candidate: { name: string; email: string };
  job: { title: string; company: string };
  disc: { score: Record<string, number>; perfil_dominante: string; match_percentage: number } | null;
  cognitive: { score: Record<string, number>; match_percentage: number } | null;
  technical: { score: number | null; passed: boolean } | null;
  integrity: { overall: string; recomendacion: string; overall_pct: number; dimensiones: Record<string, IntegrityDimension> } | null;
  ideal_profile: {
    disc: Record<string, number>;
    cognitive: Record<string, number>;
    min_technical_score: number;
  };
}

const DIM_LABELS: Record<string, string> = {
  honestidad: 'Honestidad', hurto: 'Hurto', soborno: 'Soborno',
  alcohol: 'Alcohol', drogas: 'Drogas', confiabilidad: 'Confiabilidad',
  etica_profesional: 'Ética profesional', personalidad: 'Personalidad', apuestas: 'Apuestas',
};

export async function generateCandidateReport(data: ReportData): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }> {
  const discSection = data.disc
    ? `DISC: Perfil ${data.disc.perfil_dominante} - D:${data.disc.score.D} I:${data.disc.score.I} S:${data.disc.score.S} C:${data.disc.score.C} - Compatibilidad con perfil ideal: ${data.disc.match_percentage}%`
    : 'DISC: No completada';

  const cogSection = data.cognitive
    ? `Cognitiva: Compatibilidad ${data.cognitive.match_percentage}% - Verbal:${data.cognitive.score.verbal} Espacial:${data.cognitive.score.espacial} Lógica:${data.cognitive.score.logica} Numérica:${data.cognitive.score.numerica} Abstracta:${data.cognitive.score.abstracta} (Total: ${data.cognitive.score.total}/${data.cognitive.score.max})`
    : 'Cognitiva: No completada';

  const techSection = data.technical?.score != null
    ? `Técnica: ${data.technical.score}% - ${data.technical.passed ? 'Aprobado' : 'No aprobado'} (mínimo requerido: ${data.ideal_profile.min_technical_score}%)`
    : 'Técnica: No completada';

  let intSection = 'Integridad: No completada';
  if (data.integrity) {
    const dimLines = Object.entries(data.integrity.dimensiones)
      .map(([dim, d]) => `  ${DIM_LABELS[dim] || dim}: ${d.nivel.toUpperCase()} (${d.pct}% de riesgo)`)
      .join('\n');
    const alertDims = Object.entries(data.integrity.dimensiones)
      .filter(([, d]) => d.nivel === 'alto' || d.nivel === 'medio')
      .map(([dim, d]) => `${DIM_LABELS[dim] || dim} (${d.nivel})`)
      .join(', ');
    intSection = `Integridad: Nivel general ${data.integrity.overall.toUpperCase()} (${data.integrity.overall_pct}% de riesgo) — ${data.integrity.recomendacion}
Detalle por dimensión:
${dimLines}${alertDims ? `\nDimensiones que requieren atención: ${alertDims}` : ''}`;
  }

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: 'Eres un experto en psicología organizacional y selección de talento. Redactas informes ejecutivos profesionales en español para clientes empresariales. Responde SOLO con el texto del informe, sin markdown, sin títulos con #.',
    messages: [
      {
        role: 'user',
        content: `Genera un informe ejecutivo del candidato ${data.candidate.name} para el puesto ${data.job.title} en ${data.job.company}.

RESULTADOS:
${discSection}
${cogSection}
${techSection}
${intSection}

Perfil ideal del puesto:
DISC ideal: D:${data.ideal_profile.disc.D} I:${data.ideal_profile.disc.I} S:${data.ideal_profile.disc.S} C:${data.ideal_profile.disc.C}
Cognitiva ideal: Verbal:${data.ideal_profile.cognitive.verbal} Espacial:${data.ideal_profile.cognitive.espacial} Lógica:${data.ideal_profile.cognitive.logica} Numérica:${data.ideal_profile.cognitive.numerica} Abstracta:${data.ideal_profile.cognitive.abstracta}

El informe debe incluir:
1. Resumen ejecutivo del candidato (2-3 párrafos)
2. Análisis de perfil conductual DISC: cómo es esta persona, cómo trabaja, fortalezas y áreas de desarrollo
3. Capacidades cognitivas: en qué áreas destaca y cuáles son más débiles
4. Evaluación técnica: si está preparado para el puesto
5. Análisis de integridad: menciona el nivel general de riesgo (${data.integrity?.overall || 'N/A'}) y detalla las 9 dimensiones (honestidad, hurto, soborno, ética profesional, confiabilidad, alcohol, drogas, personalidad, apuestas) especialmente las que están en nivel MEDIO o ALTO. Usa lenguaje profesional y discreto. Si hay dimensiones de riesgo alto, señálalas como áreas de observación. Si todo está en BAJO, indícalo como fortaleza.
6. Compatibilidad general con el puesto y recomendación final

Tono: profesional, objetivo, en tercera persona. Lenguaje que un CEO o gerente pueda leer.`,
      },
    ],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Anthropic');
  }

  return {
    text: textBlock.text,
    usage: {
      input_tokens: response.usage?.input_tokens || 0,
      output_tokens: response.usage?.output_tokens || 0,
    },
  };
}
