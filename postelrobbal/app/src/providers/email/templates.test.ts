import { describe, expect, it } from 'vitest';
import { renderEmailTemplate } from './templates.js';

describe('Postyar email template', () => {
  it('escapes dynamic content instead of interpreting user-controlled HTML', () => {
    const rendered = renderEmailTemplate({
      subject: 'پیام پُست‌یار',
      preheader: 'آزمایش',
      title: '<script>alert(1)</script>',
      greeting: 'سلام <b>',
      paragraphs: ['متن & <img src=x onerror=alert(1)>'],
      details: [{ label: 'عنوان', value: 'الف "ب"' }],
    }, 'https://postyarhub.ir');
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(rendered.html).toContain('الف &quot;ب&quot;');
    expect(rendered.html).not.toContain('<script>');
  });

  it('allows only same-origin root-relative call-to-action links', () => {
    const base = {
      subject: 'مشاهده',
      preheader: 'مشاهده',
      title: 'مشاهده در پنل',
      paragraphs: ['پیام'],
      buttonLabel: 'ورود به پنل',
    };
    expect(() => renderEmailTemplate({ ...base, buttonPath: '//example.com/fake' }, 'https://postyarhub.ir')).toThrow();
    expect(() => renderEmailTemplate({ ...base, buttonPath: 'https://example.com/fake' }, 'https://postyarhub.ir')).toThrow();
    expect(() => renderEmailTemplate({ ...base, buttonPath: '/\\example.com/fake' }, 'https://postyarhub.ir')).toThrow();
    expect(renderEmailTemplate({ ...base, buttonPath: '/dashboard/help' }, 'https://postyarhub.ir').html)
      .toContain('https://postyarhub.ir/dashboard/help');
  });
});
