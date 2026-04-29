type Config = {
  apiBase: string;
  appVersion: string;
  appBaseUrl: string;
  clientHostingPath: string;
  clerkPublishableKey: string;
};

function required(key: string): string {
  const v = (import.meta.env as Record<string, string | undefined>)[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export const config: Config = {
  apiBase: required('VITE_API_BASE'),
  appVersion: required('VITE_APP_VERSION'),
  appBaseUrl: required('VITE_APP_BASE_URL'),
  clientHostingPath: required('VITE_CLIENT_HOSTING_PATH'),
  clerkPublishableKey: required('VITE_CLERK_PUBLISHABLE_KEY'),
};
