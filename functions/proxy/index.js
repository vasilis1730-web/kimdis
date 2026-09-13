/*!
 * Cloudflare Pages Function — διαδρομή /proxy
 * ---------------------------------------------------------------------------
 * Φεύγει αυτόματα μαζί με το site όταν συνδέσεις το repo στο Cloudflare Pages.
 * Καμία ξεχωριστή εγκατάσταση, κανένα URL να ρυθμίσεις: η εφαρμογή το βρίσκει
 * μόνη της, επειδή βρίσκεται στο ίδιο origin.
 */
import { handleProxy } from '../../worker/proxy-core.js';

export const onRequest = context => handleProxy(context.request, context.env, context);
