import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { publishRecruitSync } from '../src/lib/recruitSyncPublisher';

vi.mock('../src/features/outbox', () => ({
  publishOutboxEvent: vi.fn(),
}));

import { publishOutboxEvent } from '../src/features/outbox';
const mockedPublish = vi.mocked(publishOutboxEvent);

describe('recruitSyncPublisher.publishRecruitSync', () => {
  const fakeReq = {} as Parameters<typeof publishRecruitSync>[0];
  const baseEvent = {
    application_id: 'app_1',
    job_id: 'job_1',
    tenant_id: 'tenant_1',
    from_stage: 'tests_started' as const,
    to_stage: 'finalist',
    actor: 'admin:user_1',
    transitioned_at: new Date().toISOString(),
  };

  beforeEach(() => {
    mockedPublish.mockReset();
    delete process.env.ZOHO_OAUTH_REFRESH_TOKEN;
    delete process.env.ZOHO_OAUTH_CLIENT_ID;
  });

  afterEach(() => {
    delete process.env.ZOHO_OAUTH_REFRESH_TOKEN;
    delete process.env.ZOHO_OAUTH_CLIENT_ID;
  });

  it('skipea publicación si Zoho Recruit no está configurado', async () => {
    const ok = await publishRecruitSync(fakeReq, baseEvent);
    expect(ok).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it('publica si Zoho Recruit está configurado', async () => {
    process.env.ZOHO_OAUTH_REFRESH_TOKEN = 'refresh123';
    process.env.ZOHO_OAUTH_CLIENT_ID = 'client123';
    mockedPublish.mockResolvedValue({ id: 'event_1' });

    const ok = await publishRecruitSync(fakeReq, baseEvent);
    expect(ok).toBe(true);
    expect(mockedPublish).toHaveBeenCalledTimes(1);

    const [, eventType, payload] = mockedPublish.mock.calls[0];
    expect(eventType).toBe('sync.recruit');
    expect(payload).toMatchObject({
      action: 'transition',
      application_id: 'app_1',
      tenant_id: 'tenant_1',
      to_stage: 'finalist',
    });
  });

  it('marca action=create si no hay from_stage', async () => {
    process.env.ZOHO_OAUTH_REFRESH_TOKEN = 'refresh123';
    process.env.ZOHO_OAUTH_CLIENT_ID = 'client123';
    mockedPublish.mockResolvedValue({ id: 'event_1' });

    await publishRecruitSync(fakeReq, { ...baseEvent, from_stage: null });
    const payload = mockedPublish.mock.calls[0][2];
    expect((payload as { action: string }).action).toBe('create');
  });

  it('returns false si publish falla — no throw', async () => {
    process.env.ZOHO_OAUTH_REFRESH_TOKEN = 'refresh123';
    process.env.ZOHO_OAUTH_CLIENT_ID = 'client123';
    mockedPublish.mockRejectedValue(new Error('outbox down'));

    const ok = await publishRecruitSync(fakeReq, baseEvent);
    expect(ok).toBe(false);
  });
});
