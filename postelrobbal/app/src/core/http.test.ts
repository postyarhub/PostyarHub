import { describe, expect, it } from 'vitest';
import { assertSafeUrl, encodeMultipartBody, HttpJsonParseError } from './http.js';

describe('hardened outbound HTTP boundaries', () => {
  it('encodes multiple multipart files with distinct attachment names and caps the count', () => {
    const encoded = encodeMultipartBody({ chat_id: '-100', media: '[{"media":"attach://file0"},{"media":"attach://file1"}]' }, [
      { fieldName: 'file0', filename: 'one.jpg', contentType: 'image/jpeg', data: Buffer.from('photo-one') },
      { fieldName: 'file1', filename: 'two.jpg', contentType: 'image/jpeg', data: Buffer.from('photo-two') },
    ]);
    const body = encoded.body.toString('utf8');
    expect(encoded.contentType).toMatch(/^multipart\/form-data; boundary=----PostYarBoundary/);
    expect(body).toContain('name="chat_id"');
    expect(body).toContain('attach://file0');
    expect(body).toContain('name="file0"; filename="one.jpg"');
    expect(body).toContain('name="file1"; filename="two.jpg"');
    expect(body).toContain('photo-one');
    expect(body).toContain('photo-two');
    expect(body.endsWith('--' + encoded.contentType.split('boundary=')[1] + '--\r\n')).toBe(true);
    expect(() => encodeMultipartBody({}, Array.from({ length: 11 }, (_, index) => ({
      fieldName: `file${index}`, filename: `${index}.jpg`, contentType: 'image/jpeg', data: Buffer.from('x'),
    })))).toThrow('MULTIPART_FILE_COUNT_INVALID');
  });

  it('rejects loopback and private IP addresses before network access', async () => {
    await expect(assertSafeUrl('http://127.0.0.1/resource')).rejects.toThrow();
    await expect(assertSafeUrl('http://192.168.1.20/resource')).rejects.toThrow();
    await expect(assertSafeUrl('http://[::1]/resource')).rejects.toThrow();
  });

  it('rejects IPv4-mapped IPv6 and other non-global IPv6 destinations', async () => {
    // Node normalizes the dotted mapped form ::ffff:127.0.0.1 to ::ffff:7f00:1.
    // These are rejected before any socket/network request can occur.
    const blocked = [
      'http://[::ffff:7f00:1]/resource',
      'http://[::ffff:a9fe:a9fe]/latest/meta-data/',
      'http://[fe90::1]/resource',
      'http://[febf::1]/resource',
      'http://[64:ff9b::a9fe:a9fe]/resource',
      'http://[2001:1::1]/resource',
      'http://[2002:a9fe:a9fe::1]/resource',
      'http://[3fff::1]/resource',
    ];
    for (const target of blocked) {
      await expect(assertSafeUrl(target)).rejects.toThrow();
    }
  });

  it('rejects IANA special-purpose, documentation, benchmarking and reserved IPv4 destinations before network access', async () => {
    const blocked = [
      '0.0.0.1',
      '100.64.0.0',
      '100.127.255.255',
      '192.0.0.1',
      '192.0.0.170',
      '192.0.2.0',
      '192.0.2.255',
      '192.88.99.1',
      '198.18.0.0',
      '198.19.255.255',
      '198.51.100.0',
      '198.51.100.255',
      '203.0.113.0',
      '203.0.113.255',
      '224.0.0.1',
      '239.255.255.255',
      '240.0.0.1',
      '255.255.255.255',
    ];
    for (const address of blocked) {
      await expect(assertSafeUrl(`http://${address}/resource`)).rejects.toThrow();
    }
  });

  it('continues to allow representative public IPv4 literals outside blocked ranges', async () => {
    for (const address of ['1.1.1.1', '8.8.8.8', '198.20.0.1', '198.51.101.1', '203.0.114.1']) {
      await expect(assertSafeUrl(`https://${address}/resource`)).resolves.toBeInstanceOf(URL);
    }
  });

  it('continues to allow a public global-unicast IPv6 literal', async () => {
    await expect(assertSafeUrl('https://[2606:4700:4700::1111]/resource')).resolves.toBeInstanceOf(URL);
  });

  it('rejects URL credentials and nonstandard ports before network access', async () => {
    await expect(assertSafeUrl('https://user:pass@8.8.8.8/resource')).rejects.toThrow();
    await expect(assertSafeUrl('https://8.8.8.8:8443/resource')).rejects.toThrow();
    await expect(assertSafeUrl('http://8.8.8.8:443/resource')).rejects.toThrow();
  });

  it('rejects unsupported schemes', async () => {
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toThrow();
    await expect(assertSafeUrl('ftp://example.com/file')).rejects.toThrow();
  });

  it('keeps non-JSON provider evidence bounded and typed', () => {
    const err = new HttpJsonParseError(502, 'text/html', '<html>gateway</html>');
    expect(err.code).toBe('HTTP_NON_JSON');
    expect(err.status).toBe(502);
    expect(err.contentType).toBe('text/html');
    expect(err.bodyPreview.length).toBeLessThanOrEqual(240);
  });
});
