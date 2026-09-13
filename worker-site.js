/*!
 * kimdis — σημείο εισόδου για Cloudflare Workers (static assets + proxy)
 * ---------------------------------------------------------------------------
 * Χρησιμοποιείται από τη ΝΕΑ ροή «Import a repository» των Cloudflare Workers.
 * Σερβίρει τη στατική εφαρμογή ΚΑΙ το proxy, από την ίδια διεύθυνση.
 *
 *   /proxy?url=…     → προώθηση προς ΚΗΜΔΗΣ / Διαύγεια
 *   /proxy/health    → η εφαρμογή το χτυπά και ρυθμίζεται μόνη της
 *   οτιδήποτε άλλο   → τα αρχεία του site (index.html, assets/…)
 *
 * Ρύθμιση: wrangler.jsonc στη ρίζα.
 * (Ο φάκελος functions/ κάνει το ίδιο για τη ροή Cloudflare Pages.)
 */
import { handleProxy, handleHealth, preflight } from './worker/proxy-core.js';

const PROXY_PATHS = new Set(['/proxy', '/proxy/']);
const HEALTH_PATHS = new Set(['/proxy/health', '/proxy/health/']);

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (HEALTH_PATHS.has(pathname)) return handleHealth(request, env);
    if (PROXY_PATHS.has(pathname)) return handleProxy(request, env, ctx);
    if (pathname.startsWith('/proxy') && request.method === 'OPTIONS') return preflight(request, env);

    // Όλα τα υπόλοιπα είναι το ίδιο το site.
    if (env && env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  }
};
