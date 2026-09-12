/*!
 * ΚΗΜΔΗΣ Υπερ-Εργαλείο — Service Worker
 * ---------------------------------------------------------------------------
 * Κάνει το κέλυφος της εφαρμογής διαθέσιμο εκτός σύνδεσης (εγκατάσταση ως PWA).
 *
 * ΣΗΜΕΙΩΣΗ: δεν αποθηκεύει ΠΟΤΕ απαντήσεις του ΚΗΜΔΗΣ ή του proxy — τα δημόσια
 * δεδομένα πρέπει να είναι πάντα φρέσκα. Μόνο τα στατικά αρχεία της εφαρμογής.
 */

const VERSION = 'khmdis-v8.0.0';
const SHELL_CACHE = VERSION + '-shell';

/** Τα αρχεία που κάνουν την εφαρμογή να ανοίγει χωρίς δίκτυο. */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/khmdis-ui.css',
  './assets/khmdis-core.js',
  './assets/khmdis-ui.js',
  './assets/vendor/jszip.min.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

/* ---------------------------------------------------------------------- */

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll αποτυγχάνει ολόκληρο αν λείψει ένα αρχείο — τα βάζουμε ένα-ένα.
    await Promise.all(SHELL.map(async url => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { console.warn('[SW] δεν αποθηκεύτηκε:', url, e && e.message); }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== SHELL_CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Ό,τι φεύγει έξω από τη σελίδα (ΚΗΜΔΗΣ, Διαύγεια, Worker) περνά αδιάβαστο.
  if (url.origin !== self.location.origin) return;

  // Πλοήγηση: δίκτυο πρώτα, ώστε να παίρνεις πάντα την τελευταία έκδοση·
  // αν δεν υπάρχει δίκτυο, σερβίρουμε το αποθηκευμένο index.html.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match('./index.html', { ignoreSearch: true });
        return cached || new Response(
          '<!doctype html><meta charset="utf-8"><title>Εκτός σύνδεσης</title>' +
          '<div style="font-family:system-ui;padding:40px;text-align:center">' +
          '<h1>Εκτός σύνδεσης</h1><p>Η εφαρμογή δεν έχει αποθηκευτεί ακόμη. Σύνδεσου και δοκίμασε ξανά.</p></div>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // Στατικά αρχεία: σερβίρουμε από την cache αμέσως και ανανεώνουμε στο παρασκήνιο.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request).then(async res => {
      if (res && res.ok) {
        const cache = await caches.open(SHELL_CACHE);
        cache.put(request, res.clone());
      }
      return res;
    }).catch(() => null);

    return cached || (await network) || new Response('', { status: 504 });
  })());
});
