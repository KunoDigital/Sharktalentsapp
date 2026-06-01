import { describe, expect, it } from 'vitest';
import { getTemplate, renderTemplate, TEMPLATES } from '../src/lib/emailTemplates';

describe('email templates', () => {
  it('todos los templates tienen ES y EN', () => {
    for (const key of Object.keys(TEMPLATES) as Array<keyof typeof TEMPLATES>) {
      expect(TEMPLATES[key].es).toBeDefined();
      expect(TEMPLATES[key].en).toBeDefined();
      expect(TEMPLATES[key].es.subject).toBeTruthy();
      expect(TEMPLATES[key].es.body_text).toBeTruthy();
      expect(TEMPLATES[key].es.body_html).toBeTruthy();
    }
  });

  it('renderiza variables correctamente', () => {
    const tpl = getTemplate('client_report_ready', 'es');
    const rendered = renderTemplate(tpl, {
      client_name: 'María',
      job_title: 'Desarrolladora Senior',
      finalist_count: '4',
      report_url: 'https://test.example.com/abc',
    });
    expect(rendered.subject).toContain('María');
    expect(rendered.subject).toContain('Desarrolladora Senior');
    expect(rendered.body_text).toContain('María');
    expect(rendered.body_html).toContain('https://test.example.com/abc');
  });

  it('placeholders sin reemplazo quedan literales', () => {
    const tpl = getTemplate('client_report_ready', 'en');
    const rendered = renderTemplate(tpl, { client_name: 'Bob' });
    expect(rendered.subject).toContain('{{job_title}}');
  });

  it('todos los templates ES tienen contenido en español', () => {
    for (const key of Object.keys(TEMPLATES) as Array<keyof typeof TEMPLATES>) {
      const text = TEMPLATES[key].es.body_text;
      const hasSpanish =
        text.includes('Hola') || text.includes('Saludos') || text.includes('Tu') || text.includes('te');
      expect(hasSpanish).toBe(true);
    }
  });
});
