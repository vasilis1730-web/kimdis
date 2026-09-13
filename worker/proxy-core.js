/*!
 * kimdis-proxy — κοινή λογική
 * ---------------------------------------------------------------------------
 * Την ίδια υλοποίηση χρησιμοποιούν:
 *   • functions/proxy/…  → Cloudflare Pages Function, φεύγει ΜΑΖΙ με το site
 *   • worker/worker.js   → αυτόνομος Worker, αν τον θες ξεχωριστά
 *
 * Γεφυρώνει το CORS: ο browser δεν επιτρέπει στη σελίδα να διαβάσει απάντηση
 * από το cerpp.eprocurement.gov.gr, γιατί εκείνος ο server δεν στέλνει
 * κεφαλίδες CORS. Η κλήση γίνεται εδώ, από τη μεριά του server, όπου δεν ισχύει.
 */

export const VERSION = '8.1.0';

/** Μόνο αυτοί οι hosts προωθούνται — τίποτα άλλο. */
export const ALLOWED_HOSTS = new Set([
  'cerpp.eprocurement.gov.gr',
  'diavgeia.gov.gr',
  'www.diavgeia.gov.gr'
]);

const MAX_BODY_BYTES = 256 * 1024;
const CACHE_SECONDS = 300;

/**
 * Ποια origins επιτρέπονται. Ορίζεται με τη μεταβλητή ALLOWED_ORIGINS
 * (λίστα με κόμματα). Κενό = όλα (*).
 */
function corsOrigin(request, env) {
  const allowed = ((env && env.ALLOWED_ORIGINS) || '').trim();
  const origin = request.headers.get('Origin') || '';
  if (!allowed) return '*';
  const list = allowed.split(',').map(s => s.trim()).filter(Boolean);
  if (list.includes('*')) return '*';
  return list.includes(origin) ? origin : list[0];
}

export function corsHeaders(request, env, extra) {
  return Object.assign({
    'Access-Control-Allow-Origin': corsOrigin(request, env),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  }, extra || {});
}

export function json(body, status, request, env) {
  return new Response(JSON.stringify(body, null, 2), {
    status: status || 200,
    headers: corsHeaders(request, env, { 'Content-Type': 'application/json; charset=utf-8' })
  });
}

export function preflight(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

/** GET /health — η εφαρμογή το χρησιμοποιεί και για αυτόματο εντοπισμό. */
export function handleHealth(request, env) {
  if (request.method === 'OPTIONS') return preflight(request, env);
  return json({
    ok: true,
    service: 'kimdis-proxy',
    version: VERSION,
    allowedHosts: Array.from(ALLOWED_HOSTS),
    time: new Date().toISOString()
  }, 200, request, env);
}

/** GET|POST ?url=<upstream> — η καθαυτό προώθηση. */
export async function handleProxy(request, env, ctx) {
  if (request.method === 'OPTIONS') return preflight(request, env);

  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  if (!target) {
    return json({
      ok: false,
      error: 'MISSING_URL',
      message: 'Λείπει η παράμετρος ?url=.',
      example: url.origin + url.pathname + '?url=' +
        encodeURIComponent('https://cerpp.eprocurement.gov.gr/khmdhs-opendata/contract?page=0'),
      health: url.origin + url.pathname.replace(/\/+$/, '') + '/health'
    }, 400, request, env);
  }

  let upstream;
  try { upstream = new URL(target); }
  catch (e) {
    return json({ ok: false, error: 'BAD_URL', message: 'Μη έγκυρο URL στην παράμετρο ?url=' }, 400, request, env);
  }
  if (upstream.protocol !== 'https:') {
    return json({ ok: false, error: 'NOT_HTTPS', message: 'Επιτρέπεται μόνο https.' }, 400, request, env);
  }
  if (!ALLOWED_HOSTS.has(upstream.hostname)) {
    return json({
      ok: false,
      error: 'HOST_NOT_ALLOWED',
      message: 'Ο host «' + upstream.hostname + '» δεν επιτρέπεται.',
      allowedHosts: Array.from(ALLOWED_HOSTS)
    }, 403, request, env);
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED', message: 'Μόνο GET και POST.' }, 405, request, env);
  }

  /* --- Cache για GET --- */
  const cache = (typeof caches !== 'undefined' && caches.default) ? caches.default : null;
  const cacheKey = new Request(upstream.toString(), { method: 'GET' });
  if (request.method === 'GET' && cache) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const h = new Headers(hit.headers);
      Object.entries(corsHeaders(request, env, { 'X-Proxy-Cache': 'HIT' })).forEach(([k, v]) => h.set(k, v));
      return new Response(hit.body, { status: hit.status, headers: h });
    }
  }

  let body;
  if (request.method === 'POST') {
    body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return json({ ok: false, error: 'BODY_TOO_LARGE', message: 'Το σώμα του αιτήματος είναι πολύ μεγάλο.' }, 413, request, env);
    }
  }

  let res;
  try {
    res = await fetch(upstream.toString(), {
      method: request.method,
      headers: Object.assign({
        // Καμία cookie, κανένα Authorization — στέλνουμε μόνο τα απαραίτητα.
        'Accept': request.headers.get('Accept') || 'application/json, */*',
        'Accept-Language': 'el-GR,el;q=0.9,en;q=0.8',
        'User-Agent': 'kimdis-proxy/' + VERSION + ' (+https://github.com/vasilis1730-web/kimdis)'
      }, request.method === 'POST'
        ? { 'Content-Type': request.headers.get('Content-Type') || 'application/json' }
        : {}),
      body,
      redirect: 'follow'
    });
  } catch (e) {
    return json({
      ok: false,
      error: 'UPSTREAM_UNREACHABLE',
      message: 'Δεν ήταν δυνατή η σύνδεση με ' + upstream.hostname + '.',
      detail: String((e && e.message) || e)
    }, 502, request, env);
  }

  const headers = new Headers();
  const ct = res.headers.get('Content-Type');
  if (ct) headers.set('Content-Type', ct);
  const cd = res.headers.get('Content-Disposition');
  if (cd) headers.set('Content-Disposition', cd);         // κρατά το όνομα του PDF
  const cl = res.headers.get('Content-Length');
  if (cl) headers.set('Content-Length', cl);
  headers.set('Cache-Control', 'public, max-age=' + CACHE_SECONDS);
  headers.set('X-Proxy-Cache', 'MISS');
  headers.set('X-Proxy-Upstream-Status', String(res.status));
  Object.entries(corsHeaders(request, env)).forEach(([k, v]) => headers.set(k, v));

  const out = new Response(res.body, { status: res.status, headers });
  if (request.method === 'GET' && res.ok && cache && ctx && ctx.waitUntil) {
    ctx.waitUntil(cache.put(cacheKey, out.clone()));
  }
  return out;
}
