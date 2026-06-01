/**
 * Helper para parsear/serializar `Tenants.branding_config` (Text JSON column).
 *
 * Permite custom branding sin agregar columnas nuevas a Tenants — todo vive en un
 * único campo JSON. Esto es bueno porque:
 *   - branding evoluciona (font, dark mode, etc.) sin migrations
 *   - cero impacto en queries existentes
 *   - se valida en código, defaults en código
 *
 * Uso:
 *   const branding = parseBranding(tenant.branding_config);
 *   // → { logo_url: '...', primary_color: '#...', ... }
 *
 *   const updated = serializeBranding({ logo_url: 'https://...' });
 *   await datastore(req).table('Tenants').updateRow({ ROWID: tenantId, branding_config: updated });
 */

import { stringifyAndTruncate, FIELD_LIMITS } from './dbLimits';

export type BrandingConfig = {
  /** URL al logo del tenant (PNG/SVG, max ~500KB recomendado). */
  logo_url?: string;
  /** Color primario (hex). Default: #2563eb */
  primary_color?: string;
  /** Color secundario (hex). Opcional. */
  secondary_color?: string;
  /** Color de texto sobre primary_color. Default: #ffffff */
  on_primary_color?: string;
  /** Nombre legal del tenant para mostrar en reportes/footers. */
  legal_name?: string;
  /** URL canónica del sitio del tenant (footer link). */
  website_url?: string;
  /** Email de contacto público (footer/help). */
  contact_email?: string;
};

const DEFAULT_BRANDING: Required<Pick<BrandingConfig, 'primary_color' | 'on_primary_color'>> = {
  primary_color: '#2563eb',
  on_primary_color: '#ffffff',
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const URL_RE = /^https:\/\/[^\s<>"]+$/;

/** Parsea el JSON de Tenants.branding_config y aplica defaults. Tolera null/inválido. */
export function parseBranding(raw: string | null | undefined): BrandingConfig {
  if (!raw) return { ...DEFAULT_BRANDING };
  try {
    const parsed = JSON.parse(raw) as BrandingConfig;
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_BRANDING };
    return { ...DEFAULT_BRANDING, ...parsed };
  } catch {
    return { ...DEFAULT_BRANDING };
  }
}

/**
 * Valida + serializa BrandingConfig a JSON string para guardar.
 * Throws si algún field tiene formato inválido (ej: color no hex, URL no https).
 */
export function serializeBranding(input: BrandingConfig): string {
  const cleaned: BrandingConfig = {};

  if (input.logo_url !== undefined) {
    if (!URL_RE.test(input.logo_url)) {
      throw new Error('logo_url must be HTTPS URL');
    }
    cleaned.logo_url = input.logo_url.slice(0, 500);
  }
  if (input.primary_color !== undefined) {
    if (!HEX_COLOR_RE.test(input.primary_color)) {
      throw new Error('primary_color must be hex format like #2563eb');
    }
    cleaned.primary_color = input.primary_color;
  }
  if (input.secondary_color !== undefined) {
    if (!HEX_COLOR_RE.test(input.secondary_color)) {
      throw new Error('secondary_color must be hex format like #2563eb');
    }
    cleaned.secondary_color = input.secondary_color;
  }
  if (input.on_primary_color !== undefined) {
    if (!HEX_COLOR_RE.test(input.on_primary_color)) {
      throw new Error('on_primary_color must be hex format');
    }
    cleaned.on_primary_color = input.on_primary_color;
  }
  if (input.legal_name !== undefined) {
    cleaned.legal_name = input.legal_name.slice(0, 200);
  }
  if (input.website_url !== undefined) {
    if (!URL_RE.test(input.website_url)) {
      throw new Error('website_url must be HTTPS URL');
    }
    cleaned.website_url = input.website_url.slice(0, 500);
  }
  if (input.contact_email !== undefined) {
    cleaned.contact_email = input.contact_email.slice(0, 255);
  }

  return stringifyAndTruncate(cleaned, FIELD_LIMITS.BRANDING_CONFIG, 'Tenants.branding_config');
}
