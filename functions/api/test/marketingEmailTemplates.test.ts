/**
 * Tests de los templates de email del funnel de marketing.
 *
 * Garantiza que:
 * - Existen los templates esperados (no se borran por accidente)
 * - Las variables placeholder no quedan literales en el render
 * - El URL de baja se interpola correctamente
 */
import { describe, expect, it } from 'vitest';
import { getTemplate, renderTemplate, TEMPLATES } from '../src/lib/emailTemplates';

describe('Marketing email templates', () => {
  it('marketing_deletion_request existe con ES + EN', () => {
    expect(TEMPLATES.marketing_deletion_request).toBeDefined();
    expect(TEMPLATES.marketing_deletion_request.es).toBeDefined();
    expect(TEMPLATES.marketing_deletion_request.en).toBeDefined();
  });

  it('marketing_demo_test_link existe con ES + EN', () => {
    expect(TEMPLATES.marketing_demo_test_link).toBeDefined();
    expect(TEMPLATES.marketing_demo_test_link.es).toBeDefined();
    expect(TEMPLATES.marketing_demo_test_link.en).toBeDefined();
  });

  it('marketing_deletion_request renderiza deletion_url correctamente', () => {
    const tpl = getTemplate('marketing_deletion_request', 'es');
    const rendered = renderTemplate(tpl, {
      deletion_url: 'https://www.sharktalents.ai/unsubscribe?email=x@y.com&token=abc',
      expires_in_hours: '24',
    });
    expect(rendered.body_html).toContain('https://www.sharktalents.ai/unsubscribe?email=x@y.com&token=abc');
    expect(rendered.body_text).toContain('https://www.sharktalents.ai/unsubscribe?email=x@y.com&token=abc');
    // No queda ningún {{placeholder}} sin reemplazar
    expect(rendered.subject).not.toMatch(/\{\{[a-z_]+\}\}/);
  });

  it('marketing_demo_test_link incluye member_name + lead_name + test_url', () => {
    const tpl = getTemplate('marketing_demo_test_link', 'es');
    const rendered = renderTemplate(tpl, {
      member_name: 'María',
      lead_name: 'Cris',
      lead_company: 'Kuno Digital',
      test_url: 'https://app.sharktalents.ai/#/test/xyz',
      expires_at: '2026-05-18',
      estimated_minutes: '20',
    });
    expect(rendered.subject).toContain('Cris');
    expect(rendered.body_html).toContain('María');
    expect(rendered.body_html).toContain('Kuno Digital');
    expect(rendered.body_html).toContain('https://app.sharktalents.ai/#/test/xyz');
  });

  it('locale en (inglés) también funciona para deletion_request', () => {
    const tpl = getTemplate('marketing_deletion_request', 'en');
    const rendered = renderTemplate(tpl, {
      deletion_url: 'https://x.com/del?t=1',
      expires_in_hours: '24',
    });
    expect(rendered.subject).toMatch(/[Cc]onfirm/);
    expect(rendered.body_html).toContain('https://x.com/del?t=1');
  });
});
