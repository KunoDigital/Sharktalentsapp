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

/**
 * Acceso al File Store de Catalyst. Requiere que la function tenga permisos de FileStore.
 * Cada folder se crea desde Catalyst Console → File Store → Create Folder, y su ID se
 * usa para hacer uploads.
 */
export function filestore(req: IncomingMessage) {
  // El SDK expone .filestore() como handle al servicio. Wrapeamos para tipo + cache.
  return (catalyst(req) as unknown as { filestore: () => unknown }).filestore();
}

export function now(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
