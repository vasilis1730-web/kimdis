/*!
 * ΚΗΜΔΗΣ Υπερ-Εργαλείο — service worker της επέκτασης
 * ---------------------------------------------------------------------------
 * Δύο τρόποι χρήσης:
 *   1. Σελίδα της επέκτασης (app.html) — ο κύριος, σταθερός τρόπος.
 *      Τρέχει στο δικό της origin με host_permissions, άρα καλεί το ΚΗΜΔΗΣ
 *      απευθείας χωρίς CORS και χωρίς να εξαρτάται από τη σελίδα του ΚΗΜΔΗΣ.
 *   2. Επικάλυψη πάνω στη σελίδα του ΚΗΜΔΗΣ — για όταν βλέπεις ήδη μια εγγραφή.
 */

const APP_PAGE = 'app.html';
const KHMDHS_HOME = 'https://cerpp.eprocurement.gov.gr/upgkimdis/unprotected/home.xhtml';
const ADAM_RE = /\d{2}(?:REQ|PROC|AWRD|SYMV|PAY)\d{6,12}/;

/** Ανοίγει τη σελίδα του εργαλείου, προαιρετικά με προσυμπληρωμένο ΑΔΑΜ. */
function openApp(adam) {
  const url = chrome.runtime.getURL(APP_PAGE) + (adam ? '?adam=' + encodeURIComponent(adam) : '');
  return chrome.tabs.create({ url });
}

/* ---------------------------------------------------------------------- */

chrome.runtime.onInstalled.addListener(details => {
  // Μενού δεξιού κλικ πάνω σε επιλεγμένο κείμενο, σε οποιαδήποτε σελίδα
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'khmdis-search-selection',
      title: 'Αναζήτηση «%s» στο ΚΗΜΔΗΣ',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'khmdis-open',
      title: 'Άνοιγμα ΚΗΜΔΗΣ Υπερ-Εργαλείου',
      contexts: ['action']
    });
  });

  if (details.reason === 'install') openApp();
});

chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === 'khmdis-open') { openApp(); return; }
  if (info.menuItemId !== 'khmdis-search-selection') return;

  const raw = (info.selectionText || '').replace(/\s+/g, '').toUpperCase();
  const match = ADAM_RE.exec(raw);
  openApp(match ? match[0] : raw);
});

/* ---------------------------------------------------------------------- */

/**
 * Εισάγει το εργαλείο ως επικάλυψη στην τρέχουσα καρτέλα.
 * Καλείται από το popup. Επιστρέφει {ok} ή {ok:false, error}.
 */
async function injectOverlay(tabId, adam) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ['assets/khmdis-ui.css']
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['assets/vendor/jszip.min.js', 'assets/khmdis-core.js', 'assets/khmdis-ui.js']
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: presetAdam => {
      const app = window.KHMDIS_UI.mount({ overlay: true });
      if (presetAdam) app.search(presetAdam);
    },
    args: [adam || null]
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message && message.type === 'OPEN_APP') {
        await openApp(message.adam);
        sendResponse({ ok: true });
        return;
      }

      if (message && message.type === 'OVERLAY') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          sendResponse({ ok: false, error: 'Δεν βρέθηκε ενεργή καρτέλα.' });
          return;
        }
        if (!tab.url || !tab.url.startsWith('https://cerpp.eprocurement.gov.gr/')) {
          // Δεν είμαστε στο ΚΗΜΔΗΣ: ανοίγουμε τη σελίδα και μπαίνουμε όταν φορτώσει.
          const created = await chrome.tabs.create({ url: KHMDHS_HOME });
          const listener = (tabId, info) => {
            if (tabId !== created.id || info.status !== 'complete') return;
            chrome.tabs.onUpdated.removeListener(listener);
            injectOverlay(created.id, message.adam).catch(e =>
              console.error('[ΚΗΜΔΗΣ] Αποτυχία επικάλυψης:', e));
          };
          chrome.tabs.onUpdated.addListener(listener);
          sendResponse({ ok: true, opened: true });
          return;
        }

        await injectOverlay(tab.id, message.adam);
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: 'Άγνωστο μήνυμα.' });
    } catch (e) {
      sendResponse({ ok: false, error: (e && e.message) || String(e) });
    }
  })();

  return true;   // κρατάμε το κανάλι ανοιχτό για την ασύγχρονη απάντηση
});
