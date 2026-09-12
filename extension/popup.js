/*! Popup της επέκτασης — μικρό, μόνο δρομολόγηση. */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const msg = $('msg');

  const clean = v => String(v || '').replace(/\s+/g, '').replace(/\*+$/, '').toUpperCase();

  function say(text, isError) {
    msg.textContent = text || '';
    msg.className = 'msg' + (isError ? ' err' : '');
  }

  function send(payload, onDone) {
    chrome.runtime.sendMessage(payload, response => {
      if (chrome.runtime.lastError) {
        say('Σφάλμα: ' + chrome.runtime.lastError.message, true);
        return;
      }
      if (response && response.ok) { onDone && onDone(response); }
      else { say((response && response.error) || 'Κάτι πήγε στραβά.', true); }
    });
  }

  $('open').addEventListener('click', () => {
    say('Άνοιγμα…');
    send({ type: 'OPEN_APP', adam: clean($('adam').value) || null }, () => window.close());
  });

  $('overlay').addEventListener('click', () => {
    say('Φόρτωση στη σελίδα…');
    send({ type: 'OVERLAY', adam: clean($('adam').value) || null }, res => {
      if (res.opened) say('Ανοίγει το ΚΗΜΔΗΣ· το εργαλείο θα εμφανιστεί μόλις φορτώσει.');
      else window.close();
    });
  });

  $('site').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://cerpp.eprocurement.gov.gr/upgkimdis/unprotected/home.xhtml' });
    window.close();
  });

  $('adam').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); $('open').click(); }
  });

  // Αν η σελίδα που βλέπεις έχει ΑΔΑΜ στη διεύθυνσή της, τον προσυμπληρώνουμε.
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const url = tabs && tabs[0] && tabs[0].url;
    if (!url) return;
    const found = /\d{2}(?:REQ|PROC|AWRD|SYMV|PAY)\d{6,12}/.exec(decodeURIComponent(url).toUpperCase());
    if (found) { $('adam').value = found[0]; say('Βρέθηκε ΑΔΑΜ στη σελίδα.'); }
  });
})();
