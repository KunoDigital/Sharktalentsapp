import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitMindsetTest, submitEnglishTest } from '../src/lib/testApi';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('testApi.submitMindsetTest', () => {
  it('llama al endpoint correcto con el body esperado', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        result_id: 'app_123',
        adaptability_score_pct: 80,
        adaptability_pattern: 'adaptable',
        perfil: { crecimiento: 30, fija: 5 },
      }),
    });

    const result = await submitMindsetTest('test-token-abc', [
      { question_id: 'm1', chosen_mentalidad: 'crecimiento' },
      { question_id: 'm2', chosen_mentalidad: 'agente' },
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/test/test-token-abc/mindset/submit');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body).answers).toHaveLength(2);
    expect(result.adaptability_pattern).toBe('adaptable');
  });

  it('throws si el server responde con error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    await expect(submitMindsetTest('bad-token', [])).rejects.toThrow(/HTTP 401/);
  });

  it('encodea el token correctamente en la URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ result_id: 'x', adaptability_score_pct: 50, adaptability_pattern: 'mixto', perfil: {} }),
    });
    await submitMindsetTest('tok with/special&chars', []);
    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain('tok%20with%2Fspecial%26chars');
  });
});

describe('testApi.submitEnglishTest', () => {
  it('llama al endpoint correcto con el body esperado', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        result_id: 'app_456',
        level: 'B2',
        total_score_pct: 75,
        threshold_pct: 70,
        passed: true,
      }),
    });

    const result = await submitEnglishTest('token-xyz', {
      level: 'B2',
      mc_correct: 14,
      mc_total: 20,
      listening_correct: 2,
      listening_total: 2,
      writing_text: 'Some sample writing about remote work...',
      writing_word_count: 152,
      writing_time_seconds: 540,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/test/token-xyz/english/submit');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.level).toBe('B2');
    expect(body.mc_correct).toBe(14);
    expect(body.writing_text).toContain('remote work');
    expect(result.passed).toBe(true);
  });

  it('throws si el server responde con error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });
    await expect(
      submitEnglishTest('tok', {
        level: 'A2',
        mc_correct: 0,
        mc_total: 0,
        listening_correct: 0,
        listening_total: 0,
        writing_text: 'x',
        writing_word_count: 1,
        writing_time_seconds: 1,
      }),
    ).rejects.toThrow(/HTTP 503/);
  });

  it('incluye fields opcionales si se pasan', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ result_id: 'x', level: 'B1', total_score_pct: 70, threshold_pct: 65, passed: true }),
    });
    await submitEnglishTest('tok', {
      level: 'B1',
      mc_correct: 14,
      mc_total: 20,
      listening_correct: 1,
      listening_total: 2,
      writing_text: 'Sample',
      writing_word_count: 10,
      writing_time_seconds: 120,
      writing_paste_attempts: 2,
      writing_focus_lost_count: 1,
      audio_listening_id: 'audio_b1',
    });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.writing_paste_attempts).toBe(2);
    expect(body.writing_focus_lost_count).toBe(1);
    expect(body.audio_listening_id).toBe('audio_b1');
  });
});
