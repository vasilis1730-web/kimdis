/* Έλεγχοι του Cloudflare Worker — node test/worker.test.mjs */
import worker from '../worker/worker.js';

// Προσομοίωση του cache API των Workers
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.error('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};
const ctx = { waitUntil() {} };
const call = (url, init) => worker.fetch(new Request(url, init), {}, ctx);

console.log('\n▸ Βασική συμπεριφορά');
let r = await call('https://p.dev/', { method: 'OPTIONS', headers: { Origin: 'https://x.github.io' } });
check('OPTIONS → 204', r.status === 204, 'πήρα ' + r.status);
check('OPTIONS → CORS header', r.headers.get('Access-Control-Allow-Origin') === '*');

r = await call('https://p.dev/health');
let body = await r.json();
check('/health → 200 ok', r.status === 200 && body.ok === true);
check('/health → δηλώνει τους επιτρεπτούς hosts', body.allowedHosts.includes('cerpp.eprocurement.gov.gr'));

r = await call('https://p.dev/');
body = await r.json();
check('χωρίς ?url → 400 MISSING_URL', r.status === 400 && body.error === 'MISSING_URL');

console.log('\n▸ Ασφάλεια');
r = await call('https://p.dev/?url=' + encodeURIComponent('https://evil.example.com/steal'));
body = await r.json();
check('άγνωστος host → 403', r.status === 403 && body.error === 'HOST_NOT_ALLOWED', body.error);

r = await call('https://p.dev/?url=' + encodeURIComponent('http://cerpp.eprocurement.gov.gr/x'));
body = await r.json();
check('http (όχι https) → 400', r.status === 400 && body.error === 'NOT_HTTPS', body.error);

r = await call('https://p.dev/?url=' + encodeURIComponent('https://cerpp.eprocurement.gov.gr/x'), { method: 'DELETE' });
body = await r.json();
check('DELETE → 405', r.status === 405 && body.error === 'METHOD_NOT_ALLOWED', body.error);

r = await call('https://p.dev/?url=' + encodeURIComponent('ΟΧΙ-URL'));
body = await r.json();
check('κακοσχηματισμένο URL → 400', r.status === 400 && body.error === 'BAD_URL', body.error);

console.log('\n▸ Προώθηση');
let seen = null;
globalThis.fetch = async (u, init) => {
  seen = { url: String(u), method: init.method, headers: init.headers, body: init.body };
  return new Response('{"content":[{"referenceNumber":"26SYMV019210768"}]}', {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'secret=1' }
  });
};
r = await call('https://p.dev/?url=' + encodeURIComponent('https://cerpp.eprocurement.gov.gr/khmdhs-opendata/contract?page=0'),
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"referenceNumber":"26SYMV019210768"}' });
check('POST προωθείται → 200', r.status === 200, 'πήρα ' + r.status);
check('διατηρεί μέθοδο POST', seen && seen.method === 'POST');
check('προωθεί το σώμα αυτούσιο', seen && seen.body === '{"referenceNumber":"26SYMV019210768"}');
check('σωστό upstream URL', seen && seen.url.includes('khmdhs-opendata/contract?page=0'));
check('ΔΕΝ προωθεί cookies προς τα πίσω', r.headers.get('Set-Cookie') === null);
check('προσθέτει CORS στην απάντηση', r.headers.get('Access-Control-Allow-Origin') === '*');
check('το σώμα φτάνει ακέραιο', (await r.json()).content[0].referenceNumber === '26SYMV019210768');

globalThis.fetch = async () => new Response(new Uint8Array([37, 80, 68, 70]), {
  status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="a.pdf"' }
});
r = await call('https://p.dev/?url=' + encodeURIComponent('https://cerpp.eprocurement.gov.gr/khmdhs-opendata/contract/attachment/26SYMV019210768'));
check('PDF: σωστό Content-Type', r.headers.get('Content-Type') === 'application/pdf');
check('PDF: κρατά το όνομα αρχείου', (r.headers.get('Content-Disposition') || '').includes('a.pdf'));
const bytes = new Uint8Array(await r.arrayBuffer());
check('PDF: δυαδικά δεδομένα ακέραια', bytes[0] === 0x25 && bytes[1] === 0x50);

globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
r = await call('https://p.dev/?url=' + encodeURIComponent('https://cerpp.eprocurement.gov.gr/x'));
body = await r.json();
check('upstream πεσμένο → 502 με εξήγηση', r.status === 502 && body.error === 'UPSTREAM_UNREACHABLE', body.error);

console.log('\n▸ Περιορισμός origin (ALLOWED_ORIGINS)');
r = await worker.fetch(new Request('https://p.dev/health', { headers: { Origin: 'https://ok.example' } }),
  { ALLOWED_ORIGINS: 'https://ok.example,https://other.example' }, ctx);
check('επιτρεπτό origin επιστρέφεται', r.headers.get('Access-Control-Allow-Origin') === 'https://ok.example');
r = await worker.fetch(new Request('https://p.dev/health', { headers: { Origin: 'https://bad.example' } }),
  { ALLOWED_ORIGINS: 'https://ok.example' }, ctx);
check('μη επιτρεπτό origin δεν παίρνει άδεια', r.headers.get('Access-Control-Allow-Origin') !== 'https://bad.example');

/* =============== Pages Functions =============== */
console.log('\n▸ Cloudflare Pages Functions (ίδιο origin με το site)');
const { onRequest: proxyFn } = await import('../functions/proxy/index.js');
const { onRequest: healthFn } = await import('../functions/proxy/health.js');

globalThis.fetch = async () => new Response('{"content":[]}', {
  status: 200, headers: { 'Content-Type': 'application/json' }
});

r = await healthFn({ request: new Request('https://site.pages.dev/proxy/health'), env: {}, waitUntil() {} });
body = await r.json();
check('/proxy/health απαντά', r.status === 200 && body.ok === true);
check('/proxy/health έχει την υπογραφή που ψάχνει η εφαρμογή',
  body.service === 'kimdis-proxy', body.service);

r = await proxyFn({
  request: new Request('https://site.pages.dev/proxy?url=' +
    encodeURIComponent('https://cerpp.eprocurement.gov.gr/khmdhs-opendata/contract?page=0'),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"referenceNumber":"26SYMV019210768"}' }),
  env: {}, waitUntil() {}
});
check('/proxy προωθεί κανονικά', r.status === 200, r.status);

r = await proxyFn({
  request: new Request('https://site.pages.dev/proxy?url=' + encodeURIComponent('https://evil.example.com/x')),
  env: {}, waitUntil() {}
});
check('/proxy κρατά τον ίδιο έλεγχο ασφαλείας', r.status === 403, r.status);

r = await proxyFn({ request: new Request('https://site.pages.dev/proxy'), env: {}, waitUntil() {} });
body = await r.json();
check('/proxy χωρίς url δίνει βοηθητικό μήνυμα', r.status === 400 && body.example.includes('/proxy?url='), body.example);

/* =============== Workers: static assets + proxy μαζί =============== */
console.log('\n▸ Cloudflare Workers — site και proxy στην ίδια διεύθυνση');
const site = (await import('../worker-site.js')).default;

const ASSETS = {
  async fetch(req) {
    const p = new URL(req.url).pathname;
    return new Response('ΑΡΧΕΙΟ:' + p, { status: 200, headers: { 'Content-Type': 'text/html' } });
  }
};
const siteEnv = { ASSETS };

globalThis.fetch = async () => new Response('{"content":[]}', {
  status: 200, headers: { 'Content-Type': 'application/json' }
});

r = await site.fetch(new Request('https://kimdis.workers.dev/'), siteEnv, ctx);
check('η ρίζα σερβίρεται από τα στατικά αρχεία', (await r.text()) === 'ΑΡΧΕΙΟ:/');

r = await site.fetch(new Request('https://kimdis.workers.dev/assets/khmdis-core.js'), siteEnv, ctx);
check('τα assets σερβίρονται', (await r.text()) === 'ΑΡΧΕΙΟ:/assets/khmdis-core.js');

r = await site.fetch(new Request('https://kimdis.workers.dev/proxy/health'), siteEnv, ctx);
body = await r.json();
check('/proxy/health δεν πάει στα αρχεία αλλά στο proxy', r.status === 200 && body.ok === true);
check('/proxy/health έχει την υπογραφή που ψάχνει η εφαρμογή', body.service === 'kimdis-proxy', body.service);

r = await site.fetch(new Request('https://kimdis.workers.dev/proxy?url=' +
  encodeURIComponent('https://cerpp.eprocurement.gov.gr/khmdhs-opendata/contract?page=0'),
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"referenceNumber":"26SYMV019210768"}' }),
  siteEnv, ctx);
check('/proxy προωθεί κανονικά', r.status === 200 && (await r.json()).content !== undefined);

r = await site.fetch(new Request('https://kimdis.workers.dev/proxy?url=' +
  encodeURIComponent('https://evil.example.com/x')), siteEnv, ctx);
check('/proxy κρατά τον έλεγχο ασφαλείας', r.status === 403, r.status);

r = await site.fetch(new Request('https://kimdis.workers.dev/proxy', { method: 'OPTIONS' }), siteEnv, ctx);
check('preflight στο /proxy απαντά 204', r.status === 204, r.status);

r = await site.fetch(new Request('https://kimdis.workers.dev/index.html'), {}, ctx);
check('χωρίς binding ASSETS δίνει 404 αντί να σκάσει', r.status === 404, r.status);

console.log('\n' + '='.repeat(52));
console.log(fail === 0 ? `✅ ΟΛΑ ΠΕΡΑΣΑΝ — ${pass} έλεγχοι` : `❌ ${fail} ΑΠΕΤΥΧΑΝ (${pass} πέρασαν)`);
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
