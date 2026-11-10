import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { hashPassword, maskEmail, verifyPassword } from '../src/security.js';
import { startTestApp } from './helpers.js';

let t;
before(async () => { t = await startTestApp(); });
after(async () => t.stop());

test('contraseñas con scrypt', async () => {
  const h = await hashPassword('una clave larga');
  assert.match(h, /^scrypt\$/);
  assert.equal(await verifyPassword('una clave larga', h), true);
  assert.equal(await verifyPassword('otra', h), false);
  assert.equal(maskEmail('juan@dominio.com'), 'ju**@dominio.com');
});

test('páginas públicas con SEO completo', async () => {
  const sitemap = await (await fetch(`${t.base}/sitemap.xml`)).text();
  const paths = [...sitemap.matchAll(/<loc>https:\/\/docsure\.app([^<]*)<\/loc>/g)].map((m) => m[1]);
  assert.ok(paths.length > 40, `sitemap con ${paths.length} páginas`);
  for (const path of [...paths, '/acceder']) {
    const res = await fetch(t.base + path);
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.match(html, /<html lang="es">/, path);
    assert.match(html, /<title>[^<]{10,70}<\/title>/, `${path}: title de 10 a 70 caracteres`);
    const desc = html.match(/<meta name="description" content="([^"]+)">/);
    assert.ok(desc && desc[1].length >= 50 && desc[1].length <= 170, `${path}: description de 50 a 170 caracteres (${desc?.[1].length})`);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://docsure.app${path === '/' ? '/' : path}">`), path);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${path}: un solo h1`);
    assert.match(html, /<meta property="og:image" content="https?:\/\/[^"]+\/static\/og\.png">/, `${path}: og:image`);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/, path);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  }
  const home = await (await fetch(t.base)).text();
  assert.match(home, /"@type":"Organization"/);
  const pricing = await (await fetch(`${t.base}/precios`)).text();
  assert.match(pricing, /"@type":"FAQPage"/);
});

test('robots, sitemap, favicon y 404', async () => {
  const robots = await (await fetch(`${t.base}/robots.txt`)).text();
  assert.match(robots, /Disallow: \/app/);
  assert.match(robots, /Sitemap: https:\/\/docsure.app\/sitemap.xml/);
  const sitemap = await (await fetch(`${t.base}/sitemap.xml`)).text();
  assert.match(sitemap, /<loc>https:\/\/docsure.app\/precios<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/docsure.app\/soluciones\/inmobiliarias<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/docsure.app\/blog\/verificacion-en-dos-pasos<\/loc>/);
  assert.equal((await fetch(`${t.base}/soluciones/no-existe`)).status, 404);
  const ind = await (await fetch(`${t.base}/soluciones/salud`)).text();
  assert.match(ind, /"@type":"FAQPage"/);
  assert.match(ind, /"@type":"BreadcrumbList"/);
  const pricing = await (await fetch(`${t.base}/precios`)).text();
  assert.doesNotMatch(pricing, /Equipos con plantillas compartidas <span class="badge-soon">/, 'lo que ya existe no figura como Pronto');
  const fav = await fetch(`${t.base}/static/favicon.svg`);
  assert.equal(fav.status, 200);
  const og = await fetch(`${t.base}/static/og.png`);
  assert.equal(og.status, 200);
  assert.equal(og.headers.get('content-type'), 'image/png');
  const ogBytes = Buffer.from(await og.arrayBuffer());
  assert.equal(ogBytes.readUInt32BE(16), 1200);
  assert.equal(ogBytes.readUInt32BE(20), 630);
  const nf = await fetch(`${t.base}/no-existe`);
  assert.equal(nf.status, 404);
  assert.match(await nf.text(), /noindex/);
  const app = await fetch(`${t.base}/app`, { redirect: 'manual' });
  assert.equal(app.status, 302);
  assert.match(app.headers.get('location'), /^\/ingresar/);
  const pdfjs = await fetch(`${t.base}/vendor/pdfjs-dist/build/pdf.min.mjs`);
  assert.equal(pdfjs.status, 200);
  assert.match(pdfjs.headers.get('content-type'), /javascript/);
});

test('host no canónico no se indexa', async () => {
  const res = await fetch(`${t.base}/`);
  assert.match(res.headers.get('x-robots-tag'), /noindex/);
});
