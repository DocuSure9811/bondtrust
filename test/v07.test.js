import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { INDUSTRIES } from '../src/web/industries.js';
import { HELP_PATHS } from '../src/web/resources.js';
import { startTestApp } from './helpers.js';

let t;
before(async () => {
  t = await startTestApp();
});
after(async () => t.stop());

test('generador de firma, centro de ayuda y soluciones nuevas: publicados, enlazados y en el sitemap', async () => {
  const gen = await fetch(`${t.base}/generador-de-firma`);
  assert.equal(gen.status, 200);
  const html = await gen.text();
  assert.match(html, /signature-generator\.js/);
  assert.match(html, /"@type":"WebApplication"/);

  for (const p of HELP_PATHS) assert.equal((await fetch(`${t.base}${p}`)).status, 200, p);
  assert.equal((await fetch(`${t.base}/ayuda/no-existe`)).status, 404);

  for (const slug of ['seguros', 'ciencias-de-la-vida', 'experiencia-del-cliente', 'pymes', 'grandes-empresas']) {
    assert.ok(INDUSTRIES[slug], slug);
    assert.equal((await fetch(`${t.base}/soluciones/${slug}`)).status, 200, slug);
  }
  const solutions = await (await fetch(`${t.base}/soluciones`)).text();
  for (const slug of Object.keys(INDUSTRIES)) assert.match(solutions, new RegExp(`/soluciones/${slug}"`));

  const home = await (await fetch(`${t.base}/`)).text();
  for (const href of ['/ayuda', '/generador-de-firma', '/soluciones/seguros', '/soluciones/pymes']) assert.ok(home.includes(`href="${href}"`), href);

  const sitemap = await (await fetch(`${t.base}/sitemap.xml`)).text();
  for (const p of ['/generador-de-firma', '/ayuda', '/ayuda/como-firmar', '/soluciones/grandes-empresas']) assert.ok(sitemap.includes(`${p}</loc>`), p);
});
