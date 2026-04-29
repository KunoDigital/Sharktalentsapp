import type { IncomingMessage } from 'http';
import catalystSDK from 'zcatalyst-sdk-node';

type CatalystApp = ReturnType<typeof catalystSDK.initialize>;

const cache = new WeakMap<IncomingMessage, CatalystApp>();

export function catalyst(req: IncomingMessage): CatalystApp {
  const existing = cache.get(req);
  if (existing) return existing;
  const app = catalystSDK.initialize(req as unknown as { [k: string]: unknown });
  cache.set(req, app);
  return app;
}

export function datastore(req: IncomingMessage) {
  return catalyst(req).datastore();
}

export function zcql(req: IncomingMessage) {
  return catalyst(req).zcql();
}

export function now(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
