/*!
 * kimdis-proxy — αυτόνομος Cloudflare Worker
 * ---------------------------------------------------------------------------
 * Χρειάζεται ΜΟΝΟ αν θες το proxy ξεχωριστά από το site.
 * Αν το site σου τρέχει σε Cloudflare Pages, το proxy φεύγει ήδη μαζί του
 * μέσω του φακέλου functions/ — δες worker/README.md.
 *
 *   GET  /health
 *   GET  /?url=<urlencoded upstream>
 *   POST /?url=<urlencoded upstream>
 */
import { handleProxy, handleHealth, preflight } from './proxy-core.js';

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (request.method === 'OPTIONS') return preflight(request, env);
    if (pathname === '/health' || pathname === '/health/') return handleHealth(request, env);
    return handleProxy(request, env, ctx);
  }
};
