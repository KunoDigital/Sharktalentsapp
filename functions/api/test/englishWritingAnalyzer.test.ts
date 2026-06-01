import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeWriting } from '../src/lib/englishWritingAnalyzer';
import type { WritingAnalysisResult } from '../src/lib/englishWritingPrompts';

vi.mock('../src/lib/anthropic', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/anthropic')>('../src/lib/anthropic');
  return {
    ...actual,
    anthropicMessage: vi.fn(),
  };
});

import { anthropicMessage } from '../src/lib/anthropic';

const mockedAnthropic = vi.mocked(anthropicMessage);

const validResponse: WritingAnalysisResult = {
  score_pct: 75,
  level_achieved: 'B2',
  dimensions: {
    grammar: 75,
    vocabulary: 80,
    coherence: 70,
    task_completion: 75,
  },
  strengths: ['Clear opinion', 'Good vocabulary range'],
  areas_for_improvement: ['Some article errors', 'Could use more connectors'],
  evidence_quotes: ["'I prefer to work in teams because...'", "'In my opinion...'"],
  suspicious_patterns: {
    quality_too_high_for_declared_level: false,
    sounds_ai_generated: false,
    notes: '',
  },
};

function makeAnthropicResponse(json: unknown) {
  return {
    id: 'msg_test',
    type: 'message' as const,
    role: 'assistant' as const,
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'text' as const, text: JSON.stringify(json) }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

describe('englishWritingAnalyzer.analyzeWriting', () => {
  beforeEach(() => {
    mockedAnthropic.mockReset();
  });

  it('parsea respuesta válida de Claude', async () => {
    mockedAnthropic.mockResolvedValue(makeAnthropicResponse(validResponse));
    const result = await analyzeWriting({
      text: 'Some candidate writing about remote work and its benefits...',
      level: 'B2',
    });
    expect(result.score_pct).toBe(75);
    expect(result.level_achieved).toBe('B2');
    expect(result.dimensions.grammar).toBe(75);
    expect(result.suspicious_patterns.sounds_ai_generated).toBe(false);
  });

  it('throws si text está vacío', async () => {
    await expect(analyzeWriting({ text: '', level: 'B2' })).rejects.toThrow(/text is empty/);
    await expect(analyzeWriting({ text: '   ', level: 'B2' })).rejects.toThrow(/text is empty/);
  });

  it('throws si level es inválido', async () => {
    await expect(
      analyzeWriting({ text: 'something', level: 'X1' as 'A2' }),
    ).rejects.toThrow(/unsupported level/);
  });

  it('throws si Claude devuelve JSON inválido', async () => {
    mockedAnthropic.mockResolvedValue({
      ...makeAnthropicResponse({}),
      content: [{ type: 'text' as const, text: 'this is not json' }],
    });
    await expect(analyzeWriting({ text: 'sample', level: 'B2' })).rejects.toThrow(/invalid JSON/);
  });

  it('throws si score_pct está fuera de rango', async () => {
    mockedAnthropic.mockResolvedValue(makeAnthropicResponse({ ...validResponse, score_pct: 150 }));
    await expect(analyzeWriting({ text: 'sample', level: 'B2' })).rejects.toThrow(/invalid score_pct/);
  });

  it('throws si score_pct es negativo', async () => {
    mockedAnthropic.mockResolvedValue(makeAnthropicResponse({ ...validResponse, score_pct: -5 }));
    await expect(analyzeWriting({ text: 'sample', level: 'B2' })).rejects.toThrow(/invalid score_pct/);
  });

  it('flag de suspicious_patterns se pasa al output', async () => {
    mockedAnthropic.mockResolvedValue(
      makeAnthropicResponse({
        ...validResponse,
        suspicious_patterns: {
          quality_too_high_for_declared_level: true,
          sounds_ai_generated: true,
          notes: 'A2 candidate writing like C1',
        },
      }),
    );
    const result = await analyzeWriting({ text: 'sample', level: 'A2' });
    expect(result.suspicious_patterns.quality_too_high_for_declared_level).toBe(true);
    expect(result.suspicious_patterns.sounds_ai_generated).toBe(true);
    expect(result.suspicious_patterns.notes).toContain('A2');
  });

  it('llama a Claude con el prompt correcto del nivel', async () => {
    mockedAnthropic.mockResolvedValue(makeAnthropicResponse(validResponse));
    await analyzeWriting({ text: 'My weekend was great', level: 'A2' });

    expect(mockedAnthropic).toHaveBeenCalledTimes(1);
    const callArg = mockedAnthropic.mock.calls[0][0];
    const userMessage = callArg.messages[0].content;
    expect(typeof userMessage).toBe('string');
    expect(userMessage as string).toContain('My weekend was great');
    expect(userMessage as string).toContain('A2');
  });
});
