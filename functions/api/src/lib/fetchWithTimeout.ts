/**
 * fetch con timeout via AbortController.
 *
 * Usar siempre que se llame a un servicio externo (Zoho, HeyReach, Anthropic, etc.)
 * para evitar que la function se quede colgada hasta el límite de Catalyst (30s).
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs: number },
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
