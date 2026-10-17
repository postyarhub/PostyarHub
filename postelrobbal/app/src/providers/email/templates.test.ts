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


  it('uses the official hosted brand mark and Vazirmatn font stack', () => {
    const rendered = renderEmailTemplate({
      templateKey: 'registration',
      subject: 'موضوع',
      preheader: 'پیش‌نمایش',
      title: 'عنوان',
      paragraphs: ['متن پیام'],
    }, 'https://postyarhub.ir');
    expect(rendered.html).toContain('https://postyarhub.ir/icons/icon-512x512.png');
    expect(rendered.html).toContain('Vazirmatn-Regular.woff2');
    expect(rendered.html).toContain('font-family:Vazirmatn');
    expect(rendered.subject).toBe('موضوع');
  });

  it('applies safe editable overrides and preserves dynamic placeholders', () => {
    const rendered = renderEmailTemplate({
      templateKey: 'password_reset',
      subject: 'بازیابی رمز',
      preheader: 'پیام',
      title: 'عنوان پیش‌فرض',
      paragraphs: ['مبلغ تراکنش'],
      details: [{ label: 'مبلغ', value: '۱۲۳ ریال' }],
    }, 'https://postyarhub.ir', {
      password_reset: {
        subject: 'امنیت حساب: {{subject}}',
        title: '<b>{{title}}</b>',
        paragraphs: 'جزئیات: {{detail:مبلغ}}',
      },
    });
    expect(rendered.subject).toBe('امنیت حساب: بازیابی رمز');
    expect(rendered.html).toContain('&lt;b&gt;عنوان پیش‌فرض&lt;/b&gt;');
    expect(rendered.html).toContain('جزئیات: ۱۲۳ ریال');
    expect(rendered.html).not.toContain('<b>عنوان پیش‌فرض</b>');
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
