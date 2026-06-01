import { describe, expect, it } from 'vitest';
import { TOOLS, dispatchTool } from '../src/tools.js';
import type { SharkTalentsClient } from '../src/apiClient.js';

// Stub minimal del cliente
function makeStubClient(): SharkTalentsClient {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const stub = {
    listJobs: (...a: unknown[]) => { calls.push({ method: 'listJobs', args: a }); return Promise.resolve({ jobs: [] }); },
    getJob: (...a: unknown[]) => { calls.push({ method: 'getJob', args: a }); return Promise.resolve({ job: { ROWID: a[0] } }); },
    createJob: (...a: unknown[]) => { calls.push({ method: 'createJob', args: a }); return Promise.resolve({ job: { ROWID: 'new' } }); },
    archiveJob: (...a: unknown[]) => { calls.push({ method: 'archiveJob', args: a }); return Promise.resolve({ job: { ROWID: a[0] } }); },
    listCandidates: (...a: unknown[]) => { calls.push({ method: 'listCandidates', args: a }); return Promise.resolve({ candidates: [] }); },
    getCandidate: (...a: unknown[]) => { calls.push({ method: 'getCandidate', args: a }); return Promise.resolve({ candidate: { ROWID: a[0] } }); },
    listApplications: (...a: unknown[]) => { calls.push({ method: 'listApplications', args: a }); return Promise.resolve({ applications: [] }); },
    getApplication: (...a: unknown[]) => { calls.push({ method: 'getApplication', args: a }); return Promise.resolve({ application: { ROWID: a[0] }, transitions: [] }); },
    transitionApplication: (...a: unknown[]) => { calls.push({ method: 'transitionApplication', args: a }); return Promise.resolve({ application: {}, transition: {} }); },
    readApplicationScores: (...a: unknown[]) => { calls.push({ method: 'readApplicationScores', args: a }); return Promise.resolve({ scores: null, integrity_dimensions: [] }); },
    listReviewQueue: () => { calls.push({ method: 'listReviewQueue', args: [] }); return Promise.resolve({ items: [], count: 0 }); },
    decideReviewQueueItem: (...a: unknown[]) => { calls.push({ method: 'decideReviewQueueItem', args: a }); return Promise.resolve({ resolved: true, final_stage: 'finalist' }); },
    _calls: calls,
  };
  return stub as unknown as SharkTalentsClient & { _calls: typeof calls };
}

describe('TOOLS catalog', () => {
  it('cada tool tiene name único', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('cada tool tiene descripción no vacía', () => {
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(10);
    }
  });

  it('cada tool tiene inputSchema válido', () => {
    for (const t of TOOLS) {
      expect(t.inputSchema.type).toBe('object');
    }
  });

  it('incluye tools clave', () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain('jobs_list');
    expect(names).toContain('jobs_create');
    expect(names).toContain('applications_get_with_scores');
    expect(names).toContain('applications_transition');
    expect(names).toContain('bot_review_queue_decide');
  });
});

describe('dispatchTool', () => {
  it('ruta jobs_list al método correcto', async () => {
    const client = makeStubClient() as unknown as SharkTalentsClient & { _calls: Array<{ method: string }> };
    await dispatchTool(client, 'jobs_list', {});
    expect(client._calls[0].method).toBe('listJobs');
  });

  it('ruta jobs_get con id', async () => {
    const client = makeStubClient() as unknown as SharkTalentsClient & { _calls: Array<{ method: string; args: unknown[] }> };
    await dispatchTool(client, 'jobs_get', { id: 'abc' });
    expect(client._calls[0].method).toBe('getJob');
    expect(client._calls[0].args[0]).toBe('abc');
  });

  it('ruta applications_get_with_scores combina 2 calls', async () => {
    const client = makeStubClient() as unknown as SharkTalentsClient & { _calls: Array<{ method: string }> };
    await dispatchTool(client, 'applications_get_with_scores', { id: 'app_1' });
    const methods = client._calls.map((c) => c.method);
    expect(methods).toContain('getApplication');
    expect(methods).toContain('readApplicationScores');
  });

  it('lanza error si tool no existe', async () => {
    const client = makeStubClient();
    await expect(dispatchTool(client, 'unknown_tool', {})).rejects.toThrow(/no encontrada/);
  });

  it('jobs_create pasa los argumentos válidos al API', async () => {
    const client = makeStubClient() as unknown as SharkTalentsClient & { _calls: Array<{ method: string; args: unknown[] }> };
    await dispatchTool(client, 'jobs_create', {
      title: 'Backend Engineer',
      company: 'AcmeTech',
      cognitive_level: 'mid',
    });
    const call = client._calls.find((c) => c.method === 'createJob');
    expect(call).toBeDefined();
    expect((call!.args[0] as { title: string }).title).toBe('Backend Engineer');
  });

  it('cognitive_level default a mid', async () => {
    const client = makeStubClient() as unknown as SharkTalentsClient & { _calls: Array<{ method: string; args: unknown[] }> };
    await dispatchTool(client, 'jobs_create', { title: 't', company: 'c' });
    const call = client._calls.find((c) => c.method === 'createJob');
    expect((call!.args[0] as { cognitive_level: string }).cognitive_level).toBe('mid');
  });
});
