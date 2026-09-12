/*!
 * kimdis-proxy — Cloudflare Worker
 * ---------------------------------------------------------------------------
 * Γεφυρώνει το CORS ανάμεσα στην online εφαρμογή και στο ΚΗΜΔΗΣ / Διαύγεια.
 *
 * Ο browser δεν επιτρέπει στη σελίδα σου να καλέσει απευθείας το
 * cerpp.eprocurement.gov.gr, επειδή εκείνος ο server δεν στέλνει κεφαλίδες CORS.
 * Ο Worker κάνει την κλήση από τη μεριά του server (όπου δεν ισχύει CORS) και
 * επιστρέφει την απάντηση με τις σωστές κεφαλίδες.
 *
 * Χρήση:
 *   GET  /health
 *   GET  /?url=<urlencoded upstream>
 *   POST /?url=<urlencoded upstream>     (το σώμα προωθείται αυτούσιο)
 *
 * Ασφάλεια: προωθούνται ΜΟΝΟ οι hosts της λίστας ALLOWED_HOSTS, μόνο https,
 * χωρίς cookies και χωρίς προώθηση κεφαλίδων ταυτοποίησης.
 */

const VERSION = '8.0.0';

/** Μόνο αυτοί οι hosts επιτρέπονται — τίποτα άλλο δεν προωθείται. */
const ALLOWED_HOSTS = new Set([
  'cerpp.eprocurement.gov.gr',
  'diavgeia.gov.gr',
  'www.diavgeia.gov.gr'
]);

/** Μέγιστο σώμα αιτήματος που δεχόμαστε (προστασία από κατάχρηση). */
const MAX_BODY_BYTES = 256 * 1024;
/** Πόσο κρατάμε στην cache τις GET απαντήσεις. */
const CACHE_SECONDS = 300;

/**
 * Ποια origins επιτρέπονται. Ορίζεται με τη μεταβλητή περιβάλλοντος
 * ALLOWED_ORIGINS (λίστα χωρισμένη με κόμμα). Κενό = όλα (*).
 */
function corsOrigin(request, env) {
  const allowed = (env && env.ALLOWED_ORIGINS || '').trim();
  const origin = request.headers.get('Origin') || '';
  if (!allowed) return '*';
  const list = allowed.split(',').map(s => s.trim()).filter(Boolean);
  if (list.includes('*')) return '*';
  return list.includes(origin) ? origin : list[0];
}

function corsHeaders(request, env, extra) {
  return Object.assign({
    'Access-Control-Allow-Origin': corsOrigin(request, env),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  }, extra || {});
}

function json(body, status, request, env) {
  return new Response(JSON.stringify(body, null, 2), {
    status: status || 200,
    headers: corsHeaders(request, env, { 'Content-Type': 'application/json; charset=utf-8' })
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    /* --- Preflight ---------------------------------------------------- */
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    /* --- Υγεία -------------------------------------------------------- */
    if (url.pathname === '/health' || url.pathname === '/health/') {
      return json({
        ok: true,
        service: 'kimdis-proxy',
        version: VERSION,
        allowedHosts: Array.from(ALLOWED_HOSTS),
        time: new Date().toISOString()
      }, 200, request, env);
    }

    /* --- Σύντομες οδηγίες στη ρίζα ------------------------------------ */
    const target = url.searchParams.get('url');
    if (!target) {
      return json({
        ok: false,
        error: 'MISSING_URL',
        message: 'Λείπει η παράμετρος ?url=. Παράδειγμα: /?url=' +
                 encodeURIComponent('https://cerpp.eprocurement.gov.gr/khmdhs-opendata/contract?page=0'),
        health: url.origin + '/health'
      }, 400, request, env);
    }

    /* --- Έλεγχος στόχου ----------------------------------------------- */
    let upstream;
    try {
      upstream = new URL(target);
    } catch (e) {
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

    /* --- Cache για GET ------------------------------------------------ */
    const cache = caches.default;
    const cacheKey = new Request(upstream.toString(), { method: 'GET' });
    if (request.method === 'GET') {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const h = new Headers(hit.headers);
        Object.entries(corsHeaders(request, env, { 'X-Proxy-Cache': 'HIT' }))
          .forEach(([k, v]) => h.set(k, v));
        return new Response(hit.body, { status: hit.status, headers: h });
      }
    }

    /* --- Σώμα αιτήματος ----------------------------------------------- */
    let body;
    if (request.method === 'POST') {
      body = await request.text();
      if (body.length > MAX_BODY_BYTES) {
        return json({ ok: false, error: 'BODY_TOO_LARGE', message: 'Το σώμα του αιτήματος είναι πολύ μεγάλο.' }, 413, request, env);
      }
    }

    /* --- Προώθηση ------------------------------------------------------ */
    let res;
    try {
      res = await fetch(upstream.toString(), {
        method: request.method,
        headers: {
          // Στέλνουμε μόνο ό,τι χρειάζεται. Καμία cookie, κανένα Authorization.
          'Accept': request.headers.get('Accept') || 'application/json, */*',
          'Accept-Language': 'el-GR,el;q=0.9,en;q=0.8',
          'User-Agent': 'kimdis-proxy/' + VERSION + ' (+https://github.com/vasilis1730-web/kimdis)',
          ...(request.method === 'POST'
            ? { 'Content-Type': request.headers.get('Content-Type') || 'application/json' }
            : {})
        },
        body,
        redirect: 'follow'
      });
    } catch (e) {
      return json({
        ok: false,
        error: 'UPSTREAM_UNREACHABLE',
        message: 'Δεν ήταν δυνατή η σύνδεση με ' + upstream.hostname + '.',
        detail: String(e && e.message || e)
      }, 502, request, env);
    }

    /* --- Απάντηση ------------------------------------------------------ */
    const headers = new Headers();
    const contentType = res.headers.get('Content-Type');
    if (contentType) headers.set('Content-Type', contentType);
    const disposition = res.headers.get('Content-Disposition');
    if (disposition) headers.set('Content-Disposition', disposition);   // κρατά το όνομα του PDF
    const length = res.headers.get('Content-Length');
    if (length) headers.set('Content-Length', length);
    headers.set('Cache-Control', 'public, max-age=' + CACHE_SECONDS);
    headers.set('X-Proxy-Cache', 'MISS');
    headers.set('X-Proxy-Upstream-Status', String(res.status));
    Object.entries(corsHeaders(request, env)).forEach(([k, v]) => headers.set(k, v));

    const out = new Response(res.body, { status: res.status, headers });

    if (request.method === 'GET' && res.ok && ctx && ctx.waitUntil) {
      ctx.waitUntil(cache.put(cacheKey, out.clone()));
    }
    return out;
  }
};
