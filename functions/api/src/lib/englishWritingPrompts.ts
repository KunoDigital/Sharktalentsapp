/**
 * Prompts para que Claude analice el writing del candidato en el test de inglés.
 *
 * Hay un prompt por nivel CEFR (A2/B1/B2/C1). Cada uno calibra la rubric al nivel
 * solicitado por el cliente — un texto B1 evaluado contra rubric B2 sale más bajo,
 * que es lo que queremos.
 *
 * Output esperado (JSON estructurado): ver type WritingAnalysisResult abajo.
 *
 * Uso:
 *   const prompt = WRITING_PROMPTS[levelRequired]; // ej "B2"
 *   const fullPrompt = prompt.replace('{{TEXT}}', candidateText);
 *   const claudeResponse = await anthropic.messages.create({...});
 *   const result: WritingAnalysisResult = JSON.parse(claudeResponse);
 *
 * Costo aproximado por análisis: ~$0.03-0.05 USD (prompt ~500 tokens + output ~400).
 */

export type WritingAnalysisResult = {
  /** Score 0-100 — % al nivel solicitado. ≥ threshold = pass. */
  score_pct: number;

  /** Nivel CEFR estimado del texto (puede ser distinto al solicitado). */
  level_achieved: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

  /** Scores parciales por dimensión (0-100). */
  dimensions: {
    grammar: number;
    vocabulary: number;
    coherence: number;
    task_completion: number;
  };

  /** Fortalezas observadas (3-5 bullets cortos). */
  strengths: string[];

  /** Áreas de mejora (3-5 bullets cortos). */
  areas_for_improvement: string[];

  /** Citas textuales del candidato que respaldan el análisis. */
  evidence_quotes: string[];

  /** Detección de anomalías (anti-cheat). */
  suspicious_patterns: {
    /** El estilo del texto es notablemente más alto que el nivel declarado. */
    quality_too_high_for_declared_level: boolean;
    /** El texto suena generado por IA (consistencia perfecta, falta de variación humana). */
    sounds_ai_generated: boolean;
    /** Notas adicionales del análisis (vacío si todo OK). */
    notes: string;
  };
};

const SHARED_INSTRUCTIONS = `
You are an expert English language examiner certified to evaluate writing samples against the CEFR (Common European Framework of Reference) standards.

Your task is to analyze a writing sample submitted by a candidate as part of a job assessment. The candidate was asked to write about a specific topic and the test is calibrated to a specific CEFR level (A2, B1, B2, or C1).

You must return a JSON object EXACTLY matching this schema:

{
  "score_pct": <integer 0-100, the candidate's score AT THE REQUESTED LEVEL>,
  "level_achieved": "<A1|A2|B1|B2|C1|C2>",
  "dimensions": {
    "grammar": <0-100>,
    "vocabulary": <0-100>,
    "coherence": <0-100>,
    "task_completion": <0-100>
  },
  "strengths": ["<3-5 short bullets>"],
  "areas_for_improvement": ["<3-5 short bullets>"],
  "evidence_quotes": ["<2-4 direct quotes from the candidate's text>"],
  "suspicious_patterns": {
    "quality_too_high_for_declared_level": <boolean>,
    "sounds_ai_generated": <boolean>,
    "notes": "<string, empty if no concerns>"
  }
}

CRITICAL: Return ONLY the JSON object. No prose, no markdown, no code fences.

Scoring guidance:
- score_pct of 100 means the writing fully meets the requested level requirements
- score_pct around the threshold (60-75% depending on level) means borderline pass
- score_pct below threshold means the candidate does NOT meet the level
- If quality_too_high_for_declared_level is true (e.g., a candidate marked as A2 writes like C1), flag it — likely cheating
- If sounds_ai_generated is true (suspiciously perfect grammar, no natural errors, formulaic structure), flag it
`.trim();

const A2_RUBRIC = `
LEVEL: A2 — Elementary
The candidate must demonstrate:
- Grammar: present simple, past simple (regular + common irregulars), basic prepositions, articles, possessives. Errors expected but should not impede understanding.
- Vocabulary: high-frequency words (family, food, daily routines, places, simple feelings, basic professions). 200-500 word active vocabulary.
- Coherence: simple sentences linked with "and", "but", "because". No need for complex paragraph structure.
- Task completion: covers the basic prompt elements. Length expected: 50+ words.

Evaluate against A2 expectations. A native speaker writing simply still meets A2. A B1+ writer who sticks to A2 patterns also meets it.
`.trim();

const B1_RUBRIC = `
LEVEL: B1 — Intermediate
The candidate must demonstrate:
- Grammar: present perfect, past continuous, first conditional, comparatives/superlatives, basic future forms (will, going to). Some errors acceptable.
- Vocabulary: 1000-2000 active words, basic professional vocabulary, opinion expressions (I think, In my opinion).
- Coherence: 2-3 short paragraphs with basic connectors (because, however, also, then). Clear introduction and conclusion.
- Task completion: addresses all prompt elements with reasonable detail. Length expected: 100+ words.

A B1 writer can express opinions and describe experiences but with limited nuance.
`.trim();

const B2_RUBRIC = `
LEVEL: B2 — Upper-Intermediate
The candidate must demonstrate:
- Grammar: all conditionals, passive voice, modal verbs for speculation (might, could, must have), reported speech, relative clauses.
- Vocabulary: 3000-4000 active words, professional vocabulary, idiomatic expressions, register variation (formal vs informal).
- Coherence: multi-paragraph structure with sophisticated connectors (however, nevertheless, on the other hand, moreover, in contrast). Clear argumentation.
- Task completion: addresses all prompt elements with depth, includes pros/cons or comparisons where requested. Length expected: 150+ words.

A B2 writer can argue a position effectively and handle abstract concepts in writing.
`.trim();

const C1_RUBRIC = `
LEVEL: C1 — Advanced
The candidate must demonstrate:
- Grammar: subjunctive, complex verb tenses, inversion for emphasis, hypothetical structures (had I known...), reduced clauses.
- Vocabulary: 5000+ active words including academic and professional jargon, idioms, collocations, register flexibility (formal, informal, technical).
- Coherence: well-structured essay with smooth transitions, clear thesis, supporting arguments, nuanced conclusion. Use of cohesive devices for emphasis and contrast.
- Task completion: fully addresses all prompt elements with reflection, analysis, and self-awareness. Length expected: 200+ words.

A C1 writer can produce clear, well-structured, detailed text on complex subjects with controlled use of organizational patterns and cohesive devices.
`.trim();

export const WRITING_PROMPTS: Record<'A2' | 'B1' | 'B2' | 'C1', string> = {
  A2: `${SHARED_INSTRUCTIONS}

${A2_RUBRIC}

The candidate's text is below. Evaluate it against A2 standards and return the JSON.

CANDIDATE TEXT:
"""
{{TEXT}}
"""`,

  B1: `${SHARED_INSTRUCTIONS}

${B1_RUBRIC}

The candidate's text is below. Evaluate it against B1 standards and return the JSON.

CANDIDATE TEXT:
"""
{{TEXT}}
"""`,

  B2: `${SHARED_INSTRUCTIONS}

${B2_RUBRIC}

The candidate's text is below. Evaluate it against B2 standards and return the JSON.

CANDIDATE TEXT:
"""
{{TEXT}}
"""`,

  C1: `${SHARED_INSTRUCTIONS}

${C1_RUBRIC}

The candidate's text is below. Evaluate it against C1 standards and return the JSON.

CANDIDATE TEXT:
"""
{{TEXT}}
"""`,
};

/** Threshold por nivel — % mínimo en `score_pct` para considerar "passed" en ese nivel. */
export const PASS_THRESHOLD: Record<'A2' | 'B1' | 'B2' | 'C1', number> = {
  A2: 60,
  B1: 65,
  B2: 70,
  C1: 75,
};
