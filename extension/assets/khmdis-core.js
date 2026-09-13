/*!
 * ΚΗΜΔΗΣ Υπερ-Εργαλείο — Κοινός Πυρήνας (khmdis-core.js)
 * ---------------------------------------------------------------------------
 * Μοιράζεται αυτούσιος από:
 *   • την επέκταση Chrome  (extension/)  -> απευθείας κλήσεις, host_permissions
 *   • την online εφαρμογή  (index.html)  -> μέσω Cloudflare Worker proxy
 *
 * Καμία εξάρτηση εκτός από το JSZip (προαιρετικό, μόνο για ZIP/XLSX εξαγωγή).
 *
 * Ανάπτυξη: developer V. Diakolios — Δήμος Ρόδου, Δ/νση Τεχνικών Έργων & Υποδομών
 */
(function (global) {
  'use strict';

  const VERSION = '8.0.0';

  /* ======================================================================
   * 1. ΣΤΑΘΕΡΕΣ / ΣΤΑΔΙΑ
   * ==================================================================== */

  const KHMDHS_ORIGIN = 'https://cerpp.eprocurement.gov.gr';
  const OPENDATA_BASE = KHMDHS_ORIGIN + '/khmdhs-opendata';
  const PUBLIC_PAGE   = KHMDHS_ORIGIN + '/upgkimdis/unprotected/home.xhtml';
  const SEARCH_PAGE   = KHMDHS_ORIGIN + '/upgkimdis/unprotected/search-contracts.xhtml';
  const DIAVGEIA      = 'https://diavgeia.gov.gr';

  /**
   * Τα 5 στάδια της αλυσίδας μιας δημόσιας σύμβασης.
   * `key` = το path segment του opendata API, `code` = το τμήμα του ΑΔΑΜ.
   */
  const STAGES = {
    request:  { key: 'request',  code: 'REQ',  order: 10, icon: '📝', color: '#6d28d9',
                label: 'Πρωτογενές / Εγκεκριμένο Αίτημα', short: 'Αίτημα' },
    notice:   { key: 'notice',   code: 'PROC', order: 20, icon: '📢', color: '#0284c7',
                label: 'Πρόσκληση / Διακήρυξη',           short: 'Διακήρυξη' },
    auction:  { key: 'auction',  code: 'AWRD', order: 30, icon: '⚖️', color: '#d97706',
                label: 'Ανάθεση / Κατακύρωση',            short: 'Ανάθεση' },
    contract: { key: 'contract', code: 'SYMV', order: 40, icon: '📜', color: '#146c43',
                label: 'Σύμβαση',                          short: 'Σύμβαση' },
    payment:  { key: 'payment',  code: 'PAY',  order: 50, icon: '💶', color: '#b42318',
                label: 'Εντολή Πληρωμής',                  short: 'Πληρωμή' }
  };

  const STAGE_LIST    = Object.values(STAGES).sort((a, b) => a.order - b.order);
  const STAGE_BY_CODE = STAGE_LIST.reduce((m, s) => (m[s.code] = s, m), {});

  /** Άγνωστο στάδιο: κρατάμε την εγγραφή αντί να τη ρίχνουμε. */
  const UNKNOWN_STAGE = {
    key: 'unknown', code: '???', order: 90, icon: '❓', color: '#64748b',
    label: 'Άγνωστο στάδιο', short: 'Άγνωστο'
  };

  /* ======================================================================
   * 2. ΣΦΑΛΜΑΤΑ
   * ==================================================================== */

  class KhmdisError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = 'KhmdisError';
      this.code = code;
      this.details = details || null;
    }
  }

  /* ======================================================================
   * 3. ΡΥΘΜΙΣΕΙΣ
   * ==================================================================== */

  const config = {
    /** 'auto' | 'direct' | 'worker' */
    mode: 'auto',
    /** URL του Cloudflare Worker, π.χ. https://kimdis-proxy.xxx.workers.dev */
    workerUrl: '',
    /** Ταυτόχρονα requests προς το ΚΗΜΔΗΣ (ευγενικό προς τον server) */
    concurrency: 4,
    /** Όρια σάρωσης δέντρου, ώστε να μην τρέχει επ' άπειρον */
    maxNodes: 80,
    maxDepth: 6,
    /** ms */
    timeout: 30000,
    retries: 2,
    cacheTtl: 10 * 60 * 1000,
    /** Αν false, δεν χτυπάμε καθόλου τη Διαύγεια */
    useDiavgeia: true,
    /** Επιπλέον σάρωση της δημόσιας σελίδας ΚΗΜΔΗΣ (ένα αίτημα ανά κόμβο) */
    scanPublicPage: false
  };

  function configure(patch) {
    Object.assign(config, patch || {});
    return config;
  }

  function isExtensionContext() {
    return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;
  }

  /** Σε ποιον δρόμο θα φύγουν τα requests. */
  function resolveMode() {
    if (config.mode === 'direct' || config.mode === 'worker') return config.mode;
    if (isExtensionContext()) return 'direct';
    return config.workerUrl ? 'worker' : 'direct';
  }

  /**
   * Τυλίγει ένα upstream URL στον Worker, όταν χρειάζεται.
   * Στην επέκταση επιστρέφει το URL ως έχει (έχουμε host_permissions).
   */
  function proxied(url) {
    if (resolveMode() !== 'worker') return url;
    if (!config.workerUrl) {
      throw new KhmdisError(
        'NO_PROXY',
        'Δεν έχει ρυθμιστεί Cloudflare Worker. Άνοιξε τις Ρυθμίσεις (⚙️) και ' +
        'καταχώρισε το URL του Worker σου, αλλιώς ο browser μπλοκάρει τις κλήσεις (CORS).'
      );
    }
    return config.workerUrl.replace(/\/+$/, '') + '?url=' + encodeURIComponent(url);
  }

  /**
   * Ψάχνει proxy στο ΙΔΙΟ origin με τη σελίδα (Cloudflare Pages Function στο
   * /proxy). Αν το βρει, η εφαρμογή ρυθμίζεται μόνη της — ο χρήστης δεν
   * χρειάζεται να κάνει τίποτα. Επιστρέφει το URL ή null.
   */
  async function autodetectProxy(baseHref) {
    if (isExtensionContext()) return null;
    let base;
    try { base = baseHref || (global.location && global.location.href); }
    catch (e) { return null; }
    if (!base) return null;

    let healthUrl, proxyUrl;
    try {
      healthUrl = new URL('proxy/health', base).toString();
      proxyUrl = new URL('proxy', base).toString();
    } catch (e) { return null; }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(healthUrl, { method: 'GET', signal: controller.signal, credentials: 'omit' });
      clearTimeout(timer);
      if (!res.ok) return null;
      const json = await res.json();
      // Ελέγχουμε την υπογραφή, ώστε να μην μπερδευτούμε με άσχετη σελίδα 200.
      return (json && json.ok === true && json.service === 'kimdis-proxy') ? proxyUrl : null;
    } catch (e) {
      return null;
    }
  }

  /* ======================================================================
   * 4. ΒΟΗΘΗΤΙΚΑ — ΑΔΑΜ / ΑΔΑ / ΕΣΗΔΗΣ
   * ==================================================================== */

  const ADAM_CODES = STAGE_LIST.map(s => s.code).join('|');
  /** π.χ. 26SYMV019210768 — 2 ψηφία έτους + κωδικός σταδίου + 6..12 ψηφία */
  const ADAM_RE       = new RegExp('(\\d{2})(' + ADAM_CODES + ')(\\d{6,12})');
  const ADAM_RE_FULL  = new RegExp('^' + ADAM_RE.source + '$');
  const ADAM_RE_SCAN  = new RegExp('\\d{2}(?:' + ADAM_CODES + ')\\d{6,12}', 'g');
  /** ΑΔΑ Διαύγειας: 10 χαρακτήρες + παύλα + 3, με ελληνικά ή λατινικά κεφαλαία */
  const ADA_RE        = /^[0-9A-ZΑ-Ω]{10}-[0-9A-ZΑ-Ω]{3}$/;
  /** Α/Α Συστήματος ΕΣΗΔΗΣ: σκέτος αριθμός */
  const ESIDIS_RE     = /^\d{3,9}$/;

  const clean = v => String(v == null ? '' : v)
    .replace(/\s+/g, '')
    .replace(/\*+$/, '')          // κάποιοι ΑΔΑΜ αντιγράφονται με αστερίσκο
    .trim()
    .toUpperCase();

  const isAdam   = v => ADAM_RE_FULL.test(clean(v));
  const isAda    = v => ADA_RE.test(clean(v));
  const isEsidis = v => ESIDIS_RE.test(clean(v));

  /** Τι μας έδωσε ο χρήστης; */
  function detectInputType(value) {
    const v = clean(value);
    if (!v) return 'empty';
    if (isAdam(v)) return 'adam';
    if (isAda(v)) return 'ada';
    if (isEsidis(v)) return 'esidis';
    return 'text';
  }

  /** Το στάδιο στο οποίο ανήκει ένας ΑΔΑΜ (ή UNKNOWN_STAGE). */
  function stageOfAdam(adam) {
    const m = ADAM_RE_FULL.exec(clean(adam));
    return (m && STAGE_BY_CODE[m[2]]) || UNKNOWN_STAGE;
  }

  /** Το έτος καταχώρισης, από τα 2 πρώτα ψηφία. */
  function yearOfAdam(adam) {
    const m = ADAM_RE_FULL.exec(clean(adam));
    if (!m) return null;
    const yy = parseInt(m[1], 10);
    return yy >= 80 ? 1900 + yy : 2000 + yy;
  }

  /** Βρίσκει όλους τους ΑΔΑΜ μέσα σε οποιοδήποτε κείμενο/JSON. */
  function scanAdams(text) {
    if (text == null) return [];
    const hay = typeof text === 'string' ? text : JSON.stringify(text);
    const out = hay.match(ADAM_RE_SCAN) || [];
    return Array.from(new Set(out.map(clean)));
  }

  /* ----------------------------------------------------------------------
   * ΑΦΜ: έλεγχος με τον επίσημο αλγόριθμο ελέγχου (check digit)
   * -------------------------------------------------------------------- */

  /**
   * Ελληνικό ΑΦΜ = 9 ψηφία. Το 9ο είναι ψηφίο ελέγχου:
   *   άθροισμα = Σ d[i] * 2^(8-i) για i=0..7,  έλεγχος = (άθροισμα % 11) % 10
   * Κόβει ~90% των τυχαίων 9ψήφιων αριθμών (ημερομηνίες, ποσά, IDs).
   */
  function isValidVat(value) {
    const v = String(value == null ? '' : value).replace(/\D/g, '');
    if (v.length !== 9) return false;
    if (/^0+$/.test(v)) return false;
    let sum = 0;
    for (let i = 0; i < 8; i++) sum += Number(v[i]) * Math.pow(2, 8 - i);
    return (sum % 11) % 10 === Number(v[8]);
  }

  /** Κλειδιά που «μυρίζουν» ΑΦΜ — χρησιμοποιούνται για στοχευμένη συλλογή. */
  const VAT_KEY_RE = /(vat|afm|αφμ|taxid|tax_id|taxregist|tin)/i;
  /** Κλειδιά που «μυρίζουν» επωνυμία φορέα/αναδόχου. */
  const NAME_KEY_RE = /(name|επωνυμ|onoma|contractor|supplier|organization|company|member)/i;

  /* ----------------------------------------------------------------------
   * CPV: περιγραφές ανά τμήμα (2 πρώτα ψηφία)
   * -------------------------------------------------------------------- */

  const CPV_DIVISIONS = {
    '03': 'Γεωργικά, κτηνοτροφικά, αλιευτικά και δασοκομικά προϊόντα',
    '09': 'Πετρελαιοειδή, καύσιμα, ηλεκτρισμός και άλλες πηγές ενέργειας',
    '14': 'Προϊόντα εξόρυξης, βασικά μέταλλα και συναφή προϊόντα',
    '15': 'Τρόφιμα, ποτά, καπνός και συναφή προϊόντα',
    '16': 'Γεωργικά μηχανήματα',
    '18': 'Ιματισμός, υπόδηση, είδη ταξιδίου και εξαρτήματα',
    '19': 'Δέρμα, κλωστοϋφαντουργικά υλικά, πλαστικά και καουτσούκ',
    '22': 'Έντυπο υλικό και συναφή προϊόντα',
    '24': 'Χημικά προϊόντα',
    '30': 'Μηχανήματα γραφείου και υπολογιστές, εξοπλισμός και αναλώσιμα',
    '31': 'Ηλεκτρολογικά μηχανήματα, συσκευές και αναλώσιμα· φωτισμός',
    '32': 'Ραδιοτηλεοπτικός εξοπλισμός, τηλεπικοινωνίες',
    '33': 'Ιατρικές συσκευές, φαρμακευτικά προϊόντα και είδη ατομικής φροντίδας',
    '34': 'Εξοπλισμός μεταφορών και βοηθητικά μέσα',
    '35': 'Εξοπλισμός ασφαλείας, πυρόσβεσης, αστυνομίας και άμυνας',
    '37': 'Μουσικά όργανα, είδη αθλητισμού, παιχνίδια, χειροτεχνήματα',
    '38': 'Εξοπλισμός εργαστηρίων, οπτικός και ακριβείας',
    '39': 'Έπιπλα, διακόσμηση, οικιακές συσκευές, καθαριστικά',
    '41': 'Συλλεγόμενο και καθαριζόμενο νερό',
    '42': 'Βιομηχανικά μηχανήματα',
    '43': 'Μηχανήματα ορυχείων και λατομείων, εξοπλισμός δομικών έργων',
    '44': 'Δομικές κατασκευές και υλικά· βοηθητικά είδη',
    '45': 'Κατασκευαστικές εργασίες',
    '48': 'Πακέτα λογισμικού και συστήματα πληροφορικής',
    '50': 'Υπηρεσίες επισκευής και συντήρησης',
    '51': 'Υπηρεσίες εγκατάστασης (εκτός λογισμικού)',
    '55': 'Υπηρεσίες ξενοδοχείων, εστιατορίων και λιανικού εμπορίου',
    '60': 'Υπηρεσίες μεταφορών (εκτός μεταφοράς αποβλήτων)',
    '63': 'Υποστηρικτικές και βοηθητικές μεταφορικές υπηρεσίες',
    '64': 'Ταχυδρομικές και τηλεπικοινωνιακές υπηρεσίες',
    '65': 'Κοινής ωφέλειας',
    '66': 'Υπηρεσίες χρηματοπιστωτικές και ασφαλιστικές',
    '70': 'Υπηρεσίες ακίνητης περιουσίας',
    '71': 'Αρχιτεκτονικές, κατασκευαστικές, μηχανικές και επιθεωρήσεις',
    '72': 'Υπηρεσίες τεχνολογίας των πληροφοριών',
    '73': 'Υπηρεσίες έρευνας και ανάπτυξης',
    '75': 'Υπηρεσίες δημόσιας διοίκησης, άμυνας και κοινωνικής ασφάλισης',
    '76': 'Υπηρεσίες σχετιζόμενες με τη βιομηχανία πετρελαίου και αερίου',
    '77': 'Γεωργικές, δασοκομικές και κηπουρικές υπηρεσίες',
    '79': 'Επιχειρηματικές υπηρεσίες: νομικές, μάρκετινγκ, παροχή συμβουλών',
    '80': 'Υπηρεσίες εκπαίδευσης και επιμόρφωσης',
    '85': 'Υπηρεσίες υγείας και κοινωνικής μέριμνας',
    '90': 'Υπηρεσίες λυμάτων, απορριμμάτων, καθαρισμού και περιβάλλοντος',
    '92': 'Υπηρεσίες ψυχαγωγίας, πολιτισμού και αθλητισμού',
    '98': 'Άλλες υπηρεσίες κοινωνικού χαρακτήρα'
  };

  /** Κανονικοποιεί έναν CPV κωδικό και δίνει την περιγραφή τμήματος. */
  function describeCpv(code) {
    const raw = String(code == null ? '' : code).trim();
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 2) return { code: raw, division: null, divisionLabel: null };
    const div = digits.slice(0, 2);
    return {
      code: digits.length >= 8 ? digits.slice(0, 8) + (digits.length > 8 ? '-' + digits.slice(8) : '') : raw,
      division: div,
      divisionLabel: CPV_DIVISIONS[div] || null
    };
  }

  /* ======================================================================
   * 5. ΜΟΡΦΟΠΟΙΗΣΗ
   * ==================================================================== */

  const nfEur = new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' });
  const nfNum = new Intl.NumberFormat('el-GR', { maximumFractionDigits: 2 });

  /** Μετατρέπει σε αριθμό δεχόμενο και «1.234,56» και «1234.56». */
  function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value == null) return null;
    let s = String(value).trim();
    if (!s) return null;
    s = s.replace(/[€\s]/g, '');
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  const money = v => { const n = toNumber(v); return n == null ? '—' : nfEur.format(n); };
  const num   = v => { const n = toNumber(v); return n == null ? '—' : nfNum.format(n); };

  /** Ημερομηνίες: δέχεται ISO, timestamp ή dd/mm/yyyy. */
  function toDate(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return new Date(value);
    const s = String(value).trim();
    let m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/.exec(s);
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtDate(value) {
    const d = toDate(value);
    if (!d) return value == null || value === '' ? '—' : String(value);
    return d.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  /** Γενική μορφοποίηση τιμής για εμφάνιση. */
  function fmtVal(v) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Ναι' : 'Όχι';
    if (Array.isArray(v)) return v.map(fmtVal).join(', ');
    if (typeof v === 'object') {
      // Το API επιστρέφει συχνά {key, value} ζεύγη για λίστες τιμών
      if (v.value !== undefined || v.key !== undefined) {
        const label = v.value != null && v.value !== '' ? v.value : v.key;
        return v.key != null && v.key !== label ? label + ' (' + v.key + ')' : String(label);
      }
      if (v.description) return String(v.description);
      if (v.name) return String(v.name);
      return JSON.stringify(v);
    }
    return String(v);
  }

  /** Ισοπεδώνει αντικείμενο σε [path, value] ζεύγη. */
  function flatten(obj, prefix, out) {
    out = out || [];
    prefix = prefix || '';
    if (obj === null || obj === undefined) { out.push([prefix, '—']); return out; }
    if (Array.isArray(obj)) {
      if (!obj.length) { out.push([prefix, '[]']); return out; }
      obj.forEach((v, i) => flatten(v, prefix + '[' + i + ']', out));
      return out;
    }
    if (typeof obj === 'object' && !(obj.key !== undefined && obj.value !== undefined)) {
      const keys = Object.keys(obj);
      if (!keys.length) { out.push([prefix, '{}']); return out; }
      keys.forEach(k => flatten(obj[k], prefix ? prefix + '.' + k : k, out));
      return out;
    }
    out.push([prefix, fmtVal(obj)]);
    return out;
  }

  /** Πρώτη μη-κενή τιμή από λίστα διαδρομών (π.χ. 'a.b.c'). */
  function getBy(object, paths) {
    for (const path of paths) {
      let value = object;
      for (const part of String(path).split('.')) {
        if (value === null || value === undefined) { value = undefined; break; }
        value = value[part];
      }
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
  }

  const escapeHtml = v => String(v == null ? '' : v)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ======================================================================
   * 6. ΔΙΚΤΥΟ — timeout, retry, cache, παραλληλία
   * ==================================================================== */

  const _cache = new Map();

  function cacheGet(key) {
    const hit = _cache.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.t > config.cacheTtl) { _cache.delete(key); return undefined; }
    return hit.v;
  }
  function cacheSet(key, value) { _cache.set(key, { t: Date.now(), v: value }); return value; }
  function clearCache() { _cache.clear(); }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /**
   * fetch με χρονικό όριο, αυτόματες επαναλήψεις σε δικτυακά/5xx σφάλματα,
   * και διαφανή δρομολόγηση μέσω Worker όταν τρέχουμε online.
   */
  async function httpRequest(url, options) {
    const opts = options || {};
    const method = opts.method || 'GET';
    const responseType = opts.responseType || 'json';
    const retries = opts.retries != null ? opts.retries : config.retries;
    const cacheKey = opts.cache === false ? null : method + ' ' + url + ' ' + (opts.body || '');

    if (cacheKey) {
      const hit = cacheGet(cacheKey);
      if (hit !== undefined) return hit;
    }

    const target = proxied(url);
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(Math.min(500 * Math.pow(2, attempt - 1), 4000));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeout);
      // Αν ο καλών έδωσε δικό του signal (π.χ. «Ακύρωση»), το τιμάμε κι αυτό.
      if (opts.signal) {
        if (opts.signal.aborted) { clearTimeout(timer); throw new KhmdisError('ABORTED', 'Η αναζήτηση ακυρώθηκε.'); }
        opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      try {
        const res = await fetch(target, {
          method,
          headers: Object.assign(
            { 'Accept': responseType === 'json' ? 'application/json' : '*/*' },
            opts.body ? { 'Content-Type': 'application/json' } : {},
            opts.headers || {}
          ),
          body: opts.body || undefined,
          signal: controller.signal,
          credentials: 'omit',
          redirect: 'follow'
        });
        clearTimeout(timer);

        if (!res.ok) {
          // 4xx = οριστικό, δεν ξαναπροσπαθούμε· 5xx = προσωρινό
          const err = new KhmdisError('HTTP_' + res.status, 'HTTP ' + res.status + ' ' + res.statusText, { url, status: res.status });
          if (res.status >= 400 && res.status < 500 && res.status !== 429) throw err;
          lastError = err;
          continue;
        }

        let out;
        if (responseType === 'blob') out = await res.blob();
        else if (responseType === 'text') out = await res.text();
        else {
          const text = await res.text();
          if (!text.trim()) out = null;
          else {
            try { out = JSON.parse(text); }
            catch (e) {
              throw new KhmdisError('BAD_JSON',
                'Η απάντηση δεν ήταν έγκυρο JSON. Συνήθως σημαίνει ότι ο proxy ή το ΚΗΜΔΗΣ ' +
                'επέστρεψε σελίδα σφάλματος.', { url, sample: text.slice(0, 200) });
            }
          }
        }
        if (cacheKey) cacheSet(cacheKey, out);
        return out;

      } catch (e) {
        clearTimeout(timer);
        if (e instanceof KhmdisError && /^HTTP_4/.test(e.code)) throw e;
        if (e instanceof KhmdisError && (e.code === 'NO_PROXY' || e.code === 'BAD_JSON')) throw e;
        if (e.name === 'AbortError') {
          lastError = new KhmdisError('TIMEOUT', 'Λήξη χρόνου αναμονής (' + (config.timeout / 1000) + 's).', { url });
        } else {
          lastError = new KhmdisError('NETWORK',
            resolveMode() === 'worker'
              ? 'Αποτυχία δικτύου. Έλεγξε ότι το URL του Worker είναι σωστό και ότι ο Worker είναι ενεργός.'
              : 'Αποτυχία δικτύου προς το ΚΗΜΔΗΣ.', { url, cause: String(e && e.message || e) });
        }
      }
    }
    throw lastError || new KhmdisError('UNKNOWN', 'Άγνωστο σφάλμα δικτύου.', { url });
  }

  /** Εκτελεί εργασίες παράλληλα με όριο ταυτόχρονων. */
  async function pool(items, worker, limit) {
    const max = Math.max(1, limit || config.concurrency);
    const results = new Array(items.length);
    let cursor = 0;
    async function run() {
      while (cursor < items.length) {
        const i = cursor++;
        try { results[i] = { ok: true, value: await worker(items[i], i) }; }
        catch (e) { results[i] = { ok: false, error: e }; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(max, items.length) }, run));
    return results;
  }

  /* ======================================================================
   * 7. API ΚΗΜΔΗΣ
   * ==================================================================== */

  /** Κανονικοποιεί τις διάφορες μορφές απάντησης σε πίνακα εγγραφών. */
  function toRecords(json) {
    if (!json) return [];
    if (Array.isArray(json)) return json;
    if (Array.isArray(json.content)) return json.content;
    if (Array.isArray(json.items)) return json.items;
    if (Array.isArray(json.results)) return json.results;
    if (Array.isArray(json.data)) return json.data;
    if (typeof json === 'object' && (json.referenceNumber || json.id)) return [json];
    return [];
  }

  /**
   * Ερώτημα σε ένα στάδιο του opendata API.
   * @param {string} stageKey  request|notice|auction|contract|payment
   * @param {object} filter    π.χ. { referenceNumber: '26SYMV019210768' }
   */
  async function queryStage(stageKey, filter, options) {
    const opts = options || {};
    const page = opts.page || 0;
    const url = OPENDATA_BASE + '/' + stageKey + '?page=' + page;
    const json = await httpRequest(url, {
      method: 'POST',
      body: JSON.stringify(filter || {}),
      signal: opts.signal,
      retries: opts.retries
    });
    return toRecords(json);
  }

  /** Φέρνει τα μεταδεδομένα ενός συγκεκριμένου ΑΔΑΜ. */
  async function fetchRecord(adam, options) {
    const id = clean(adam);
    const stage = stageOfAdam(id);
    if (stage === UNKNOWN_STAGE) {
      throw new KhmdisError('BAD_ADAM', 'Μη αναγνωρίσιμη μορφή ΑΔΑΜ: ' + id);
    }
    const rows = await queryStage(stage.key, { referenceNumber: id }, options);
    if (!rows.length) throw new KhmdisError('NOT_FOUND', 'Δεν βρέθηκε εγγραφή για τον ΑΔΑΜ ' + id + '.');
    const exact = rows.find(r => clean(r.referenceNumber) === id) || rows[0];
    return { adam: id, stage, data: exact };
  }

  /**
   * URL του συνημμένου PDF.
   * @param {boolean} viaProxy true όταν θα το κατεβάσουμε με fetch (ZIP export).
   *        Για απλό άνοιγμα σε νέα καρτέλα δεν χρειάζεται proxy — δεν ισχύει CORS.
   */
  function attachmentUrl(adam, viaProxy) {
    const id = clean(adam);
    const stage = stageOfAdam(id);
    const direct = OPENDATA_BASE + '/' + stage.key + '/attachment/' + encodeURIComponent(id);
    return viaProxy ? proxied(direct) : direct;
  }

  /** Η επίσημη δημόσια σελίδα της εγγραφής. */
  function officialUrl(adam) {
    return PUBLIC_PAGE + '?referenceNumber=' + encodeURIComponent(clean(adam));
  }

  /** Σύνδεσμος Διαύγειας για ένα ΑΔΑ. */
  function diavgeiaUrl(ada) {
    return DIAVGEIA + '/decision/view/' + encodeURIComponent(String(ada || '').trim());
  }

  /* ======================================================================
   * 8. ΕΞΑΓΩΓΗ ΟΥΣΙΑΣΤΙΚΩΝ ΣΤΟΙΧΕΙΩΝ ΑΠΟ ΜΙΑ ΕΓΓΡΑΦΗ
   * ==================================================================== */

  /**
   * Περπατάει ΟΛΟ το δέντρο της εγγραφής και μαζεύει ζεύγη (κλειδί, τιμή).
   * Το χρησιμοποιούμε για στοχευμένη συλλογή ΑΦΜ/ονομάτων, αντί για τυφλό regex.
   */
  function walk(obj, visit, path) {
    path = path || '';
    if (obj === null || obj === undefined) return;
    if (Array.isArray(obj)) { obj.forEach((v, i) => walk(v, visit, path + '[' + i + ']')); return; }
    if (typeof obj === 'object') {
      for (const k of Object.keys(obj)) {
        const child = obj[k];
        const p = path ? path + '.' + k : k;
        if (child !== null && typeof child === 'object') walk(child, visit, p);
        else visit(k, child, p, obj);
      }
      return;
    }
    visit('', obj, path, null);
  }

  /**
   * ΑΦΜ: συλλέγονται ΜΟΝΟ από πεδία που ονομάζονται σαν ΑΦΜ **και** περνούν
   * τον αλγόριθμο ελέγχου. Έτσι δεν μπερδεύονται με ημερομηνίες ή ποσά —
   * που ήταν το πρόβλημα της παλιάς έκδοσης.
   */
  function extractVats(data) {
    const found = new Map();  // αφμ -> { vat, keys:Set, role }
    walk(data, (key, value, path) => {
      if (value == null || value === '') return;
      const s = String(value).trim();
      if (!/^\d{9}$/.test(s)) return;
      if (!VAT_KEY_RE.test(key) && !VAT_KEY_RE.test(path)) return;
      if (!isValidVat(s)) return;
      if (!found.has(s)) found.set(s, { vat: s, paths: [] });
      found.get(s).paths.push(path);
    });

    const list = Array.from(found.values());
    const orgVat = clean(getBy(data, ['organizationVatNumber', 'organisationVatNumber', 'authorityVatNumber']));
    return list.map(item => {
      const isOrg = item.vat === orgVat ||
        item.paths.some(p => /organization|organisation|authority|αναθετ/i.test(p));
      return { vat: item.vat, role: isOrg ? 'authority' : 'contractor', paths: item.paths };
    });
  }

  const PARTY_NAME_RE = /^(name|fullName|companyName|contractorName|supplierName|memberOrganizationName|organizationName)$/i;

  /**
   * Μαζεύει «συμβαλλόμενους» (όνομα + ΑΦΜ) ΟΠΟΥΔΗΠΟΤΕ μέσα στην εγγραφή.
   *
   * Απαραίτητο: το ΚΗΜΔΗΣ δεν τους βάζει στην κορυφή. Στην πραγματικότητα
   * βρίσκονται σε contractingDataDetails.contractingMembersDataList — οπότε
   * το να κοιτάς μόνο τα κλειδιά της κορυφής δεν βρίσκει κανέναν ανάδοχο.
   */
  function collectParties(obj, out, path) {
    out = out || [];
    path = path || '';
    if (!obj || typeof obj !== 'object') return out;

    if (Array.isArray(obj)) {
      obj.forEach((v, i) => collectParties(v, out, path + '[' + i + ']'));
      return out;
    }

    const keys = Object.keys(obj);
    const vatKey = keys.find(k =>
      VAT_KEY_RE.test(k) && typeof obj[k] === 'string' && /^\d{9}$/.test(obj[k].trim()));
    const nameKey = keys.find(k =>
      PARTY_NAME_RE.test(k) && typeof obj[k] === 'string' && obj[k].trim());

    if (vatKey || nameKey) {
      out.push({
        name: nameKey ? String(obj[nameKey]).trim() : null,
        vat: vatKey ? String(obj[vatKey]).trim() : null,
        path: path
      });
    }
    keys.forEach(k => {
      const v = obj[k];
      if (v && typeof v === 'object') collectParties(v, out, path ? path + '.' + k : k);
    });
    return out;
  }

  /** Διαδρομές που ανήκουν στην αναθέτουσα αρχή, όχι στον ανάδοχο. */
  const AUTHORITY_PATH_RE = /(^|\.)organization|authority|signers|unitsOperator|αναθετ/i;

  /** Επωνυμίες αναδόχων — όλα εκτός της αναθέτουσας αρχής. */
  function extractContractors(data) {
    const orgVat = clean(getBy(data, [
      'organizationVatNumber', 'organisationVatNumber', 'greekOrganizationVatNumber'
    ]) || '');
    const names = new Set();

    collectParties(data).forEach(party => {
      if (!party.name) return;
      if (party.vat && clean(party.vat) === orgVat) return;
      if (AUTHORITY_PATH_RE.test(party.path)) return;
      names.add(party.name);
    });

    if (!names.size) {
      ['contractorName', 'supplierName', 'awardContractorName', 'economicOperatorName']
        .forEach(k => { if (data && data[k]) names.add(String(data[k]).trim()); });
    }
    return Array.from(names).filter(Boolean);
  }

  /**
   * Τα πεδία με τα οποία το ΚΗΜΔΗΣ δηλώνει ΡΗΤΑ τους γειτονικούς κρίκους.
   * Καταγράφηκαν από πραγματική απάντηση του API — δεν είναι εικασία.
   */
  const LINK_FIELDS = [
    'prevReferenceNo', 'previousRequestReferenceNumber', 'previousReferenceNumber',
    'requestRefNo', 'noticeReferenceNumber', 'auctionRefNo', 'contractRefNo',
    'nextRefNo', 'nextExtended', 'nextModified',
    'paymentRefNo', 'approvedRequestsList', 'relatedReferenceNumbers'
  ];

  /** Όλοι οι ΑΔΑΜ που η ίδια η εγγραφή δηλώνει ως συνδεδεμένους. */
  function extractLinks(data) {
    const out = new Set();
    const push = v => {
      if (v == null) return;
      if (Array.isArray(v)) { v.forEach(push); return; }
      if (typeof v === 'object') { push(v.referenceNumber || v.value || v.key); return; }
      const s = clean(v);
      if (isAdam(s)) out.add(s);
    };
    LINK_FIELDS.forEach(f => push(data && data[f]));
    // Το ΚΗΜΔΗΣ βάζει σύνδεσμο και μέσα σε κάθε τμήμα της σύμβασης
    const objects = data && data.objectDetailsList;
    if (Array.isArray(objects)) {
      objects.forEach(o => LINK_FIELDS.forEach(f => push(o && o[f])));
    }
    return Array.from(out);
  }

  /** Όλοι οι CPV της εγγραφής, με περιγραφή τμήματος. */
  function extractCpvs(data) {
    const codes = new Set();
    const pushCode = v => {
      if (v == null) return;
      if (typeof v === 'object') { if (v.key) codes.add(String(v.key)); else if (v.code) codes.add(String(v.code)); return; }
      const s = String(v).trim();
      if (/^\d{6,8}(-\d)?$/.test(s)) codes.add(s);
    };
    const objects = getBy(data, ['objectDetailsList', 'objects', 'items']);
    if (Array.isArray(objects)) objects.forEach(o => (o && Array.isArray(o.cpvs) ? o.cpvs : []).forEach(pushCode));
    ['cpvItems', 'cpvs', 'cpv', 'mainCpv', 'cpvCode'].forEach(k => {
      const v = data && data[k];
      if (Array.isArray(v)) v.forEach(pushCode); else pushCode(v);
    });
    return Array.from(codes).map(describeCpv);
  }

  /** Ποσότητες από τα αντικείμενα της σύμβασης. */
  function extractQuantities(data) {
    const objects = getBy(data, ['objectDetailsList', 'objects', 'items']);
    if (!Array.isArray(objects)) return [];
    return objects
      .map(o => o && o.quantity)
      .filter(v => v !== undefined && v !== null && v !== '');
  }

  /** Οι βασικές οικονομικές τιμές μιας εγγραφής. */
  function extractAmounts(data) {
    return {
      withoutVat: toNumber(getBy(data, [
        'totalCostWithoutVAT', 'estimatedTotalCostWithoutVAT', 'contractBudget',
        'budgetWithoutVAT', 'budget', 'amountWithoutVAT'
      ])),
      withVat: toNumber(getBy(data, [
        'totalCostWithVAT', 'estimatedTotalCostWithVAT', 'budgetWithVAT', 'amountWithVAT', 'totalAmount'
      ]))
    };
  }

  /** Η κύρια ημερομηνία μιας εγγραφής, ανάλογα με το στάδιο. */
  function extractDate(data) {
    return getBy(data, [
      'contractSignedDate', 'signedDate', 'submissionDate', 'publicationDate', 'createdDate', 'startDate'
    ]);
  }

  /**
   * Συγκεντρωτική «περίληψη» εγγραφής — ό,τι χρειάζεται το UI και οι εξαγωγές.
   */
  function summarize(node) {
    const d = node.data || {};
    const amounts = extractAmounts(d);
    const vats = extractVats(d);
    // Τα ονόματα πεδίων καταγράφηκαν από πραγματική απάντηση του API.
    // Οι εναλλακτικές κρατιούνται γιατί κάθε στάδιο διαφέρει ελαφρώς.
    return {
      adam: node.adam,
      stage: node.stage,
      title: getBy(d, ['title', 'subject', 'description']),
      date: extractDate(d),
      esidis: getBy(d, ['systemicNumber', 'esidisNumber', 'systemNumber']),
      previousAdam: clean(getBy(d, [
        'prevReferenceNo', 'previousRequestReferenceNumber', 'previousReferenceNumber', 'requestRefNo'
      ]) || '') || null,
      links: extractLinks(d),
      ada: getBy(d, [
        'diavgeiaADA', 'contractRelatedADA.number3', 'contractRelatedADA.number2',
        'contractRelatedADA.number1', 'decisionRelatedAda', 'cancellationADA', 'ada'
      ]),
      aaht: getBy(d, ['aaht']),
      contractNumber: getBy(d, ['contractNumber']),
      organizationName: getBy(d, [
        'organization.value', 'organizationName', 'organisationName', 'authorityName',
        'contractingDataDetails.unitsOperator.value'
      ]),
      organizationVat: getBy(d, [
        'organizationVatNumber', 'organisationVatNumber', 'greekOrganizationVatNumber'
      ]),
      procedureType: getBy(d, ['procedureType']),
      contractType: getBy(d, ['contractType']),
      legalContext: getBy(d, ['legalContext']),
      assignCriteria: getBy(d, ['assignCriteria']),
      city: getBy(d, ['nutsCity', 'nutsCode.value']),
      duration: getBy(d, ['contractDuration']),
      durationUnit: getBy(d, ['contractDurationUnitOfMeasure']),
      cancelled: d.cancelled === true,
      funding: getBy(d, [
        'fundingDetails.regularBudgetFundedProgramRef', 'fundingDetails.publicFundingRef',
        'fundingDetails.espaFundProgramRef', 'fundingDetails.cofundProgramRef'
      ]),
      contractors: extractContractors(d),
      contractorVats: vats.filter(v => v.role === 'contractor').map(v => v.vat),
      authorityVats: vats.filter(v => v.role === 'authority').map(v => v.vat),
      cpvs: extractCpvs(d),
      quantities: extractQuantities(d),
      amountWithoutVat: amounts.withoutVat,
      amountWithVat: amounts.withVat,
      startDate: getBy(d, ['startDate']),
      endDate: getBy(d, ['endDate']),
      fieldCount: flatten(d).length
    };
  }

  /* ======================================================================
   * 9. ΣΑΡΩΣΗ ΑΛΥΣΙΔΑΣ (BFS, μπρος και πίσω)
   * ==================================================================== */

  /**
   * Μετατρέπει ΑΔΑ Διαύγειας ή Α/Α ΕΣΗΔΗΣ σε έναν τουλάχιστον ΑΔΑΜ,
   * ψάχνοντας στο opendata της Διαύγειας.
   */
  async function resolveViaDiavgeia(term, options) {
    if (!config.useDiavgeia) return [];
    const url = DIAVGEIA + '/opendata/search.json?q=' + encodeURIComponent('"' + term + '"') + '&size=10';
    try {
      const json = await httpRequest(url, { signal: options && options.signal, retries: 1 });
      return scanAdams(json);
    } catch (e) {
      return [];
    }
  }

  /** Ψάχνει ΑΔΑΜ μέσα στη δημόσια HTML σελίδα του ΚΗΜΔΗΣ (συμπληρωματική πηγή). */
  async function scanPublicPage(adam, options) {
    try {
      const html = await httpRequest(officialUrl(adam), {
        responseType: 'text',
        signal: options && options.signal,
        retries: 1
      });
      return scanAdams(html);
    } catch (e) {
      return [];
    }
  }

  /**
   * Χτίζει ΟΛΟΚΛΗΡΗ την αλυσίδα ξεκινώντας από οτιδήποτε
   * (ΑΔΑΜ, ΑΔΑ Διαύγειας, Α/Α ΕΣΗΔΗΣ).
   *
   * @param {string} input
   * @param {object} options { onProgress(msg, pct), signal }
   * @returns {Promise<{nodes:Array, seed:string, warnings:Array}>}
   */
  async function buildChain(input, options) {
    const opts = options || {};
    const report = (msg, pct) => { if (opts.onProgress) opts.onProgress(msg, pct); };
    const warnings = [];
    const term = clean(input);
    const type = detectInputType(term);

    if (type === 'empty') throw new KhmdisError('EMPTY', 'Δεν δόθηκε αναγνωριστικό.');

    /* --- Βήμα 1: βρες τουλάχιστον έναν ΑΔΑΜ ------------------------- */
    let seeds = [];
    if (type === 'adam') {
      seeds = [term];
    } else {
      report('Αναζήτηση ΑΔΑΜ για «' + term + '» στη Διαύγεια…', 5);
      seeds = await resolveViaDiavgeia(term, opts);
      if (!seeds.length && type === 'esidis') {
        // Δεύτερη ευκαιρία: ρώτα κατευθείαν το ΚΗΜΔΗΣ ανά στάδιο με τον Α/Α συστήματος
        report('Αναζήτηση με Α/Α ΕΣΗΔΗΣ στο ΚΗΜΔΗΣ…', 10);
        const res = await pool(STAGE_LIST, async stage => {
          const rows = await queryStage(stage.key, { systemicNumber: term }, { signal: opts.signal, retries: 0 });
          return rows.map(r => clean(r && r.referenceNumber)).filter(isAdam);
        }, config.concurrency);
        res.forEach(r => { if (r.ok) seeds = seeds.concat(r.value); });
        seeds = Array.from(new Set(seeds));
      }
      if (!seeds.length) {
        throw new KhmdisError('NO_SEED',
          'Δεν βρέθηκε ΑΔΑΜ για «' + term + '». Δοκίμασε απευθείας με ΑΔΑΜ ' +
          '(π.χ. 26SYMV019210768) ή έλεγξε τον Α/Α ΕΣΗΔΗΣ / ΑΔΑ.');
      }
    }

    /* --- Βήμα 2: BFS σε δύο κατευθύνσεις ---------------------------- */
    const nodes = new Map();          // adam -> { adam, stage, data }
    const queue = seeds.map(a => ({ adam: a, depth: 0 }));
    const seen = new Set(seeds);
    let processed = 0;

    while (queue.length && nodes.size < config.maxNodes) {
      if (opts.signal && opts.signal.aborted) throw new KhmdisError('ABORTED', 'Η αναζήτηση ακυρώθηκε.');

      // Δουλεύουμε σε παρτίδες, για παραλληλία
      const batch = queue.splice(0, config.concurrency);
      const pct = Math.min(90, 15 + Math.round((processed / Math.max(1, processed + queue.length + batch.length)) * 70));
      report('Σάρωση αλυσίδας… (' + nodes.size + ' πράξεις, ' + queue.length + ' σε αναμονή)', pct);

      const fetched = await pool(batch, async item => {
        const rec = await fetchRecord(item.adam, { signal: opts.signal });
        return { item, rec };
      }, config.concurrency);

      const expand = [];
      fetched.forEach((r, i) => {
        processed++;
        if (!r.ok) {
          const failedAdam = batch[i].adam;
          if (!(r.error instanceof KhmdisError) || r.error.code !== 'NOT_FOUND') {
            warnings.push('Ο ΑΔΑΜ ' + failedAdam + ' δεν ανακτήθηκε: ' + (r.error && r.error.message));
          }
          return;
        }
        const { item, rec } = r.value;
        nodes.set(rec.adam, rec);
        if (item.depth < config.maxDepth) expand.push({ rec, depth: item.depth });
      });

      if (!expand.length) continue;

      // Διεύρυνση: (α) ΑΔΑΜ μέσα στα ίδια τα δεδομένα, (β) απόγονοι, (γ) HTML σελίδα
      // Η ίδια η εγγραφή δηλώνει τους γείτονές της (auctionRefNo, paymentRefNo,
      // prevReferenceNo, noticeReferenceNumber…), οπότε η διεύρυνση δεν κοστίζει
      // ούτε ένα αίτημα. Παλιότερα ρωτούσαμε το API με εικαζόμενα φίλτρα — τα
      // οποία δεν υποστηρίζονται, και φόρτωναν τον server με 10 άχρηστες κλήσεις
      // ανά κόμβο.
      const discovered = expand.map(entry => {
        const out = new Set(extractLinks(entry.rec.data));
        scanAdams(entry.rec.data).forEach(a => out.add(a));
        return { ok: true, value: { depth: entry.depth, adams: Array.from(out) } };
      });

      // Προαιρετική επιπλέον πηγή: η δημόσια σελίδα. Κλειστή από προεπιλογή —
      // κοστίζει ένα αίτημα ανά κόμβο και σπάνια προσθέτει κάτι.
      if (config.scanPublicPage) {
        const pages = await pool(expand, entry => scanPublicPage(entry.rec.adam, opts),
          Math.max(1, Math.floor(config.concurrency / 2)));
        pages.forEach((r, i) => {
          if (r.ok) r.value.forEach(a => discovered[i].value.adams.push(a));
        });
      }

      discovered.forEach(r => {
        if (!r.ok) return;
        r.value.adams.forEach(a => {
          if (!isAdam(a) || seen.has(a)) return;
          seen.add(a);
          queue.push({ adam: a, depth: r.value.depth + 1 });
        });
      });
    }

    if (nodes.size >= config.maxNodes) {
      warnings.push('Η σάρωση σταμάτησε στο όριο των ' + config.maxNodes +
        ' πράξεων. Ανέβασε το όριο στις Ρυθμίσεις αν χρειάζεσαι περισσότερες.');
    }
    if (!nodes.size) throw new KhmdisError('EMPTY_CHAIN', 'Δεν ανακτήθηκε καμία εγγραφή.');

    /* --- Βήμα 3: ταξινόμηση κατά στάδιο και ημερομηνία -------------- */
    const list = Array.from(nodes.values()).map(n => Object.assign({}, n, { summary: summarize(n) }));
    list.sort((a, b) => {
      if (a.stage.order !== b.stage.order) return a.stage.order - b.stage.order;
      const da = toDate(a.summary.date), db = toDate(b.summary.date);
      if (da && db && da.getTime() !== db.getTime()) return da - db;
      return a.adam.localeCompare(b.adam);
    });

    report('Ολοκληρώθηκε: ' + list.length + ' πράξεις.', 100);
    return { nodes: list, seed: seeds[0], warnings };
  }

  /* ======================================================================
   * 10. ΟΙΚΟΝΟΜΙΚΗ ΑΝΑΛΥΣΗ
   * ==================================================================== */

  /**
   * Συγκεντρωτικά ανά στάδιο + έλεγχοι συνέπειας.
   * Οι «σημαίες» είναι ενδείξεις για έλεγχο, όχι ευρήματα — το API μπορεί
   * να μην περιέχει όλα τα στάδια (π.χ. τμηματικές πληρωμές σε άλλη αλυσίδα).
   */
  function analyze(nodes) {
    const byStage = {};
    STAGE_LIST.forEach(s => { byStage[s.key] = { stage: s, count: 0, withoutVat: 0, withVat: 0, items: [] }; });
    byStage[UNKNOWN_STAGE.key] = { stage: UNKNOWN_STAGE, count: 0, withoutVat: 0, withVat: 0, items: [] };

    nodes.forEach(n => {
      const bucket = byStage[n.stage.key] || byStage[UNKNOWN_STAGE.key];
      bucket.count++;
      bucket.items.push(n);
      if (n.summary.amountWithoutVat != null) bucket.withoutVat += n.summary.amountWithoutVat;
      if (n.summary.amountWithVat != null) bucket.withVat += n.summary.amountWithVat;
    });

    const req = byStage.request, con = byStage.contract, pay = byStage.payment;
    const flags = [];

    // Απορρόφηση: πληρωμές έναντι συμβατικού ποσού
    let absorption = null;
    if (con.count && con.withVat > 0 && pay.count) {
      absorption = pay.withVat / con.withVat;
      if (absorption > 1.005) {
        flags.push({
          level: 'warn',
          text: 'Οι πληρωμές (' + money(pay.withVat) + ') υπερβαίνουν το συμβατικό ποσό (' +
                money(con.withVat) + '). Έλεγξε για συμπληρωματική σύμβαση ή πληρωμές άλλης αλυσίδας.'
        });
      }
    }

    // Έκπτωση: σύμβαση έναντι εγκεκριμένου αιτήματος
    let savings = null;
    if (req.count && req.withoutVat > 0 && con.count && con.withoutVat > 0) {
      savings = 1 - (con.withoutVat / req.withoutVat);
      if (savings < -0.005) {
        flags.push({
          level: 'warn',
          text: 'Το συμβατικό ποσό χωρίς ΦΠΑ (' + money(con.withoutVat) + ') υπερβαίνει το αιτηθέν (' +
                money(req.withoutVat) + ').'
        });
      }
    }

    // Ελλείποντα στάδια
    const missing = STAGE_LIST.filter(s => !byStage[s.key].count);
    if (missing.length) {
      flags.push({
        level: 'info',
        text: 'Δεν εντοπίστηκαν πράξεις στα στάδια: ' + missing.map(s => s.short).join(', ') +
              '. Μπορεί να μην απαιτούνται (π.χ. απευθείας ανάθεση) ή να μην έχουν καταχωριστεί ακόμη.'
      });
    }

    // Ανάδοχοι και ΑΦΜ συγκεντρωτικά
    const contractors = new Set(), contractorVats = new Set(), authorities = new Set(), cpvs = new Map();
    nodes.forEach(n => {
      n.summary.contractors.forEach(c => contractors.add(c));
      n.summary.contractorVats.forEach(v => contractorVats.add(v));
      if (n.summary.organizationName) authorities.add(n.summary.organizationName);
      n.summary.cpvs.forEach(c => { if (c.code) cpvs.set(c.code, c); });
    });

    const dates = nodes.map(n => toDate(n.summary.date)).filter(Boolean).sort((a, b) => a - b);

    return {
      total: nodes.length,
      byStage,
      absorption,
      savings,
      flags,
      contractors: Array.from(contractors),
      contractorVats: Array.from(contractorVats),
      authorities: Array.from(authorities),
      cpvs: Array.from(cpvs.values()),
      firstDate: dates[0] || null,
      lastDate: dates[dates.length - 1] || null,
      durationDays: dates.length > 1 ? Math.round((dates[dates.length - 1] - dates[0]) / 86400000) : null
    };
  }

  /* ======================================================================
   * 11. ΕΞΑΓΩΓΕΣ
   * ==================================================================== */

  /** Οι στήλες του πίνακα εξαγωγής — μία γραμμή ανά πράξη. */
  const EXPORT_COLUMNS = [
    { key: 'order',          label: 'Α/Α',                     get: (n, i) => i + 1,                       type: 'n' },
    { key: 'stage',          label: 'Στάδιο',                  get: n => n.stage.label },
    { key: 'adam',           label: 'ΑΔΑΜ',                    get: n => n.adam },
    { key: 'title',          label: 'Τίτλος',                  get: n => n.summary.title || '' },
    { key: 'date',           label: 'Ημερομηνία',              get: n => fmtDate(n.summary.date) },
    { key: 'esidis',         label: 'Α/Α ΕΣΗΔΗΣ',              get: n => n.summary.esidis || '' },
    { key: 'ada',            label: 'ΑΔΑ Διαύγειας',           get: n => n.summary.ada || '' },
    { key: 'contractNumber', label: 'Αριθμός σύμβασης',        get: n => n.summary.contractNumber || '' },
    { key: 'authority',      label: 'Αναθέτουσα Αρχή',         get: n => n.summary.organizationName || '' },
    { key: 'authorityVat',   label: 'ΑΦΜ Αναθέτουσας',         get: n => n.summary.organizationVat || '' },
    { key: 'contractors',    label: 'Ανάδοχος/οι',             get: n => n.summary.contractors.join(' | ') },
    { key: 'contractorVats', label: 'ΑΦΜ Αναδόχου/ων',         get: n => n.summary.contractorVats.join(' | ') },
    { key: 'withoutVat',     label: 'Αξία χωρίς ΦΠΑ (€)',      get: n => n.summary.amountWithoutVat, type: 'money' },
    { key: 'withVat',        label: 'Αξία με ΦΠΑ (€)',         get: n => n.summary.amountWithVat,    type: 'money' },
    { key: 'cpv',            label: 'CPV',                     get: n => n.summary.cpvs.map(c => c.code).join(' | ') },
    { key: 'cpvLabel',       label: 'Τμήμα CPV',               get: n => Array.from(new Set(n.summary.cpvs.map(c => c.divisionLabel).filter(Boolean))).join(' | ') },
    { key: 'startDate',      label: 'Έναρξη',                  get: n => n.summary.startDate ? fmtDate(n.summary.startDate) : '' },
    { key: 'endDate',        label: 'Λήξη',                    get: n => n.summary.endDate ? fmtDate(n.summary.endDate) : '' },
    { key: 'previousAdam',   label: 'Προηγούμενος ΑΔΑΜ',       get: n => n.summary.previousAdam || '' },
    { key: 'pdf',            label: 'Σύνδεσμος PDF',           get: n => attachmentUrl(n.adam, false) },
    { key: 'official',       label: 'Επίσημη εγγραφή',         get: n => officialUrl(n.adam) }
  ];

  function buildTable(nodes) {
    return {
      header: EXPORT_COLUMNS.map(c => c.label),
      types: EXPORT_COLUMNS.map(c => c.type || 's'),
      rows: nodes.map((n, i) => EXPORT_COLUMNS.map(c => {
        const v = c.get(n, i);
        return v === null || v === undefined ? '' : v;
      }))
    };
  }

  /* ---- CSV ------------------------------------------------------------ */

  /**
   * CSV με ερωτηματικό ως διαχωριστικό και BOM, ώστε το Excel σε ελληνικά
   * Windows να το ανοίγει σωστά με διπλό κλικ.
   */
  function toCsv(nodes) {
    const t = buildTable(nodes);
    const cell = v => {
      if (typeof v === 'number') return String(v).replace('.', ',');
      const s = String(v == null ? '' : v);
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [t.header.map(cell).join(';')];
    t.rows.forEach(r => lines.push(r.map(cell).join(';')));
    return '﻿' + lines.join('\r\n');
  }

  /* ---- XLSX (χωρίς εξωτερική βιβλιοθήκη, με JSZip) --------------------- */

  const xmlEsc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // Το XML 1.0 δεν δέχεται control characters
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  function colLetter(index) {
    let s = '', n = index + 1;
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  function sheetXml(table) {
    const rowsXml = [];
    const mkRow = (values, rowIndex, styleId) => {
      const cells = values.map((v, ci) => {
        const ref = colLetter(ci) + (rowIndex + 1);
        const isNum = typeof v === 'number' && Number.isFinite(v);
        if (isNum) {
          const s = table.types[ci] === 'money' ? ' s="2"' : '';
          return '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>';
        }
        const s = styleId != null ? ' s="' + styleId + '"' : '';
        return '<c r="' + ref + '" t="inlineStr"' + s + '><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
      }).join('');
      return '<row r="' + (rowIndex + 1) + '">' + cells + '</row>';
    };
    rowsXml.push(mkRow(table.header, 0, 1));
    table.rows.forEach((r, i) => rowsXml.push(mkRow(r, i + 1, null)));

    const cols = table.header.map((h, i) =>
      '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' +
      Math.min(60, Math.max(12, String(h).length + 6)) + '" customWidth="1"/>').join('');

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<cols>' + cols + '</cols>' +
      '<sheetData>' + rowsXml.join('') + '</sheetData>' +
      '<autoFilter ref="A1:' + colLetter(table.header.length - 1) + (table.rows.length + 1) + '"/>' +
      '</worksheet>';
  }

  const XLSX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00&quot; €&quot;"/></numFmts>' +
    '<fonts count="2">' +
      '<font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF0B5EA8"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function requireJSZip() {
    const JZ = global.JSZip;
    if (typeof JZ === 'undefined') {
      throw new KhmdisError('NO_JSZIP',
        'Λείπει η βιβλιοθήκη JSZip — χρειάζεται για εξαγωγή ZIP και Excel. ' +
        'Βεβαιώσου ότι φορτώνεται το jszip.min.js.');
    }
    return JZ;
  }

  /** Παράγει πραγματικό .xlsx (OOXML) χωρίς επιπλέον εξάρτηση πέρα από το JSZip. */
  async function toXlsxBlob(nodes, sheetName) {
    const JZ = requireJSZip();
    const zip = new JZ();
    const table = buildTable(nodes);
    const name = xmlEsc((sheetName || 'Αλυσίδα ΚΗΜΔΗΣ').slice(0, 31));

    zip.file('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>');

    zip.folder('_rels').file('.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>');

    const xl = zip.folder('xl');
    xl.file('workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + name + '" sheetId="1" r:id="rId1"/></sheets></workbook>');
    xl.file('styles.xml', XLSX_STYLES);
    xl.folder('_rels').file('workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>');
    xl.folder('worksheets').file('sheet1.xml', sheetXml(table));

    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }

  /* ---- Πλήρες πακέτο ZIP ---------------------------------------------- */

  /** Αναγνώσιμη περίληψη σε απλό κείμενο. */
  function toPlainText(nodes, stats) {
    const L = [];
    L.push('ΜΕΤΑΔΕΔΟΜΕΝΑ ΑΛΥΣΙΔΑΣ ΚΗΜΔΗΣ');
    L.push('='.repeat(60));
    L.push('Παραγωγή: ' + new Date().toLocaleString('el-GR'));
    L.push('Πράξεις: ' + nodes.length);
    if (stats) {
      L.push('');
      L.push('ΣΥΓΚΕΝΤΡΩΤΙΚΑ');
      L.push('-'.repeat(60));
      STAGE_LIST.forEach(s => {
        const b = stats.byStage[s.key];
        if (!b || !b.count) return;
        L.push(s.label + ': ' + b.count + ' πράξ. | χωρίς ΦΠΑ ' + money(b.withoutVat) + ' | με ΦΠΑ ' + money(b.withVat));
      });
      if (stats.absorption != null) L.push('Απορρόφηση πληρωμών: ' + (stats.absorption * 100).toFixed(1) + '%');
      if (stats.savings != null) L.push('Έκπτωση έναντι αιτήματος: ' + (stats.savings * 100).toFixed(1) + '%');
      if (stats.contractors.length) L.push('Ανάδοχοι: ' + stats.contractors.join(' | '));
      if (stats.contractorVats.length) L.push('ΑΦΜ αναδόχων: ' + stats.contractorVats.join(' | '));
      stats.flags.forEach(f => L.push((f.level === 'warn' ? '[!] ' : '[i] ') + f.text));
    }
    L.push('');
    nodes.forEach((n, i) => {
      L.push('='.repeat(60));
      L.push('[' + String(i + 1).padStart(2, '0') + '] ' + n.stage.label.toUpperCase());
      L.push('ΑΔΑΜ: ' + n.adam);
      L.push('-'.repeat(60));
      flatten(n.data).forEach(([k, v]) => L.push(k + ': ' + v));
      L.push('');
    });
    return L.join('\r\n');
  }

  /**
   * Το πλήρες πακέτο: PDF κάθε πράξης + metadata + JSON + CSV + Excel.
   * @param {object} options { onProgress(msg, pct), includePdf }
   */
  async function buildZip(nodes, stats, options) {
    const opts = options || {};
    const report = (msg, pct) => { if (opts.onProgress) opts.onProgress(msg, pct); };
    const JZ = requireJSZip();
    const zip = new JZ();
    const includePdf = opts.includePdf !== false;

    zip.file('00_Μεταδεδομένα.txt', toPlainText(nodes, stats));
    zip.file('00_Δεδομένα.json', JSON.stringify({
      generatedAt: new Date().toISOString(),
      tool: 'ΚΗΜΔΗΣ Υπερ-Εργαλείο v' + VERSION,
      count: nodes.length,
      records: nodes.map(n => ({ adam: n.adam, stage: n.stage.key, summary: n.summary, data: n.data }))
    }, null, 2));
    zip.file('00_Πίνακας.csv', toCsv(nodes));

    try {
      const xlsxBlob = await toXlsxBlob(nodes);
      zip.file('00_Πίνακας.xlsx', xlsxBlob);
    } catch (e) {
      zip.file('00_Πίνακας_ΣΦΑΛΜΑ.txt', 'Αποτυχία δημιουργίας Excel: ' + (e && e.message));
    }

    if (includePdf) {
      const failures = [];
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        report('Λήψη PDF ' + (i + 1) + '/' + nodes.length + '…', Math.round((i / nodes.length) * 90));
        const prefix = String(i + 1).padStart(2, '0') + '_' +
                       n.stage.short.replace(/[\\\/:*?"<>|]/g, '-') + '_' + n.adam;
        try {
          const blob = await httpRequest(attachmentUrl(n.adam, false), {
            responseType: 'blob', retries: 1, cache: false
          });
          if (blob && blob.size > 0) zip.file(prefix + '.pdf', blob);
          else failures.push(n.adam + ': κενό αρχείο');
        } catch (e) {
          failures.push(n.adam + ': ' + (e && e.message));
        }
      }
      if (failures.length) {
        zip.file('00_PDF_που_δεν_κατέβηκαν.txt',
          'Τα παρακάτω συνημμένα δεν ανακτήθηκαν:\r\n\r\n' + failures.join('\r\n') +
          '\r\n\r\nΜπορείς να τα ανοίξεις χειροκίνητα από τους συνδέσμους στο 00_Πίνακας.csv');
      }
    }

    report('Συμπίεση…', 95);
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  /** Κατέβασμα ενός Blob/κειμένου με σωστό όνομα αρχείου. */
  function download(content, filename, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  }

  /* ======================================================================
   * 12. ΔΙΑΓΝΩΣΤΙΚΑ
   * ==================================================================== */

  /** Ελέγχει βήμα-βήμα τι δουλεύει και τι όχι — για γρήγορο εντοπισμό βλάβης. */
  async function diagnose(sampleAdam) {
    const probe = clean(sampleAdam || '') || null;
    const out = { mode: resolveMode(), workerUrl: config.workerUrl || null, checks: [] };
    const add = (name, ok, detail) => out.checks.push({ name, ok, detail });

    if (out.mode === 'worker') {
      if (!config.workerUrl) {
        add('Ρύθμιση Worker', false, 'Δεν έχει οριστεί URL Worker.');
        return out;
      }
      try {
        const res = await fetch(config.workerUrl.replace(/\/+$/, '') + '/health', { method: 'GET' });
        const body = await res.text();
        add('Worker προσβάσιμος', res.ok, 'HTTP ' + res.status + ' — ' + body.slice(0, 120));
      } catch (e) {
        add('Worker προσβάσιμος', false, String(e && e.message || e));
      }
    } else {
      add('Λειτουργία', true, 'Απευθείας κλήσεις (επέκταση Chrome) — δεν χρειάζεται proxy.');
    }

    try {
      const rows = await queryStage('contract', probe ? { referenceNumber: probe } : {}, { retries: 0 });
      add('API ΚΗΜΔΗΣ (στάδιο: σύμβαση)', true, 'Επέστρεψε ' + rows.length + ' εγγραφές.');
      if (rows.length) {
        add('Πεδία 1ης εγγραφής', true, Object.keys(rows[0]).slice(0, 25).join(', '));
      }
    } catch (e) {
      add('API ΚΗΜΔΗΣ (στάδιο: σύμβαση)', false, (e && e.code ? '[' + e.code + '] ' : '') + (e && e.message));
    }

    if (config.useDiavgeia) {
      try {
        const json = await httpRequest(DIAVGEIA + '/opendata/search.json?q=test&size=1', { retries: 0 });
        add('Διαύγεια opendata', !!json, 'OK');
      } catch (e) {
        add('Διαύγεια opendata', false, (e && e.message) || 'άγνωστο σφάλμα');
      }
    }

    add('JSZip (ZIP/Excel)', typeof global.JSZip !== 'undefined',
        typeof global.JSZip !== 'undefined' ? 'Φορτωμένο' : 'Δεν φορτώθηκε — ZIP/Excel δεν θα δουλέψουν.');

    return out;
  }

  /* ======================================================================
   * 13. ΔΗΜΟΣΙΑ ΔΙΕΠΑΦΗ
   * ==================================================================== */

  global.KHMDIS = {
    VERSION,
    KHMDHS_ORIGIN, OPENDATA_BASE, PUBLIC_PAGE, SEARCH_PAGE, DIAVGEIA,
    STAGES, STAGE_LIST, STAGE_BY_CODE, UNKNOWN_STAGE,
    KhmdisError,
    config, configure, resolveMode, isExtensionContext, proxied, autodetectProxy,
    clean, isAdam, isAda, isEsidis, detectInputType, stageOfAdam, yearOfAdam, scanAdams,
    isValidVat, describeCpv, CPV_DIVISIONS,
    toNumber, money, num, toDate, fmtDate, fmtVal, flatten, getBy, escapeHtml,
    httpRequest, pool, clearCache,
    queryStage, fetchRecord, attachmentUrl, officialUrl, diavgeiaUrl, toRecords,
    walk, extractVats, extractContractors, extractCpvs, extractQuantities,
    extractAmounts, extractDate, summarize,
    buildChain, resolveViaDiavgeia, extractLinks, collectParties,
    analyze,
    EXPORT_COLUMNS, buildTable, toCsv, toXlsxBlob, toPlainText, buildZip, download,
    diagnose
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.KHMDIS;

})(typeof globalThis !== 'undefined' ? globalThis : self);
