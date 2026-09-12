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

console.log('\n' + '='.repeat(52));
console.log(fail === 0 ? `✅ ΟΛΑ ΠΕΡΑΣΑΝ — ${pass} έλεγχοι` : `❌ ${fail} ΑΠΕΤΥΧΑΝ (${pass} πέρασαν)`);
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
