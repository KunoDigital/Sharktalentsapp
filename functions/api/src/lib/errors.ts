export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'validation_error', message, details);
    this.name = 'ValidationError';
  }
}

/**
 * Errores de "preconditions not met" — algo que debe estar listo ANTES de que el endpoint
 * pueda ejecutar. Diseñado para que un agente IA pueda leer `missing_fields` y
 * `next_action` y autocorregir sin intervención humana.
 *
 * Ejemplo de payload devuelto al cliente:
 * {
 *   error: {
 *     code: 'preconditions_not_met',
 *     message: 'Antes de enviar al cliente faltan campos obligatorios',
 *     details: {
 *       missing_fields: ['fee_usd', 'salary_range_usd.max'],
 *       next_action: 'patch_draft_with_missing_fields_then_retry',
 *       hint: 'Editá el draft y completá los campos faltantes antes de enviar.'
 *     }
 *   }
 * }
 */
export class PreconditionsNotMetError extends AppError {
  constructor(
    message: string,
    info: { missing_fields: string[]; next_action: string; hint?: string },
  ) {
    super(400, 'preconditions_not_met', message, info);
    this.name = 'PreconditionsNotMetError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'unauthorized', message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'forbidden', message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, 'not_found', message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, 'conflict', message, details);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSec: number) {
    super(429, 'rate_limited', `Too many requests`, { retry_after_sec: retryAfterSec });
    this.name = 'RateLimitError';
  }
}

export class UpstreamError extends AppError {
  constructor(provider: string, message: string, details?: unknown) {
    super(502, 'upstream_error', `${provider}: ${message}`, details);
    this.name = 'UpstreamError';
  }
}
