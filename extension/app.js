/*! Εκκίνηση της σελίδας της επέκτασης. */
(function () {
  'use strict';
  // Μέσα στην επέκταση οι κλήσεις πάνε κατευθείαν στο ΚΗΜΔΗΣ —
  // το host_permissions του manifest δίνει την άδεια, δεν χρειάζεται proxy.
  window.KHMDIS.configure({ mode: 'direct' });
  window.KHMDIS_UI.mount({ container: document.getElementById('app'), overlay: false });
})();
