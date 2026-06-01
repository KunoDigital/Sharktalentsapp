type Config = {
  apiBase: string;
  appVersion: string;
  appBaseUrl: string;
  clientHostingPath: string;
  clerkPublishableKey: string;
  /**
   * Si true, los componentes que ya migraron usan el cliente API real (backend Catalyst).
   * Si false, se quedan en mock data (estado actual mientras no hay tablas / deploy).
   * Toggle desde .env: VITE_USE_API=true
   */
  useApi: boolean;
};

function required(key: string): string {
  const v = (import.meta.env as Record<string, string | undefined>)[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function optionalBool(key: string, fallback = false): boolean {
  const v = (import.meta.env as Record<string, string | undefined>)[key];
  if (!v) return fallback;
  return v === 'true' || v === '1';
}

export const config: Config = {
  apiBase: required('VITE_API_BASE'),
  appVersion: required('VITE_APP_VERSION'),
  appBaseUrl: required('VITE_APP_BASE_URL'),
  clientHostingPath: required('VITE_CLIENT_HOSTING_PATH'),
  clerkPublishableKey: required('VITE_CLERK_PUBLISHABLE_KEY'),
  useApi: optionalBool('VITE_USE_API', false),
};
