/*!
 * Cloudflare Pages Function — διαδρομή /proxy/health
 * Η εφαρμογή τη χτυπά στο ξεκίνημα για να καταλάβει μόνη της ότι υπάρχει proxy.
 */
import { handleHealth } from '../../worker/proxy-core.js';

export const onRequest = context => handleHealth(context.request, context.env);
