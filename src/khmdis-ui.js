/*!
 * ΚΗΜΔΗΣ Υπερ-Εργαλείο — κοινή διεπαφή (khmdis-ui.js)
 * ---------------------------------------------------------------------------
 * Χτίζει ολόκληρη την εφαρμογή μέσα σε ένα στοιχείο. Το ίδιο αρχείο τρέχει
 * και στη σελίδα (online) και μέσα στην επέκταση (ως επικάλυψη).
 *
 * Απαιτεί: khmdis-core.js (και προαιρετικά jszip.min.js για ZIP/Excel)
 */
(function (global) {
  'use strict';

  const K = global.KHMDIS;
  if (!K) throw new Error('Το khmdis-core.js πρέπει να φορτωθεί πριν το khmdis-ui.js');

  const APP_ID = '__khmdis_app__';
  const STORE_KEY = 'khmdis.settings.v8';
  const HISTORY_KEY = 'khmdis.history.v8';
  const MAX_HISTORY = 25;

  /* ======================================================================
   * Αποθήκευση ρυθμίσεων
   * ==================================================================== */

  const DEFAULTS = {
    workerUrl: '',
    theme: 'auto',          // auto | light | dark
    concurrency: 4,
    maxNodes: 80,
    useDiavgeia: true,
    includePdf: true
  };

  /** Το localStorage μπορεί να είναι φραγμένο (ιδιωτική περιήγηση) — ποτέ σκέτο. */
  function safeGet(key) {
    try { return global.localStorage ? global.localStorage.getItem(key) : null; }
    catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { if (global.localStorage) global.localStorage.setItem(key, value); }
    catch (e) { /* αγνοούμε: η εφαρμογή δουλεύει και χωρίς αποθήκευση */ }
  }

  function loadSettings() {
    let stored = {};
    try { stored = JSON.parse(safeGet(STORE_KEY) || '{}') || {}; } catch (e) { stored = {}; }
    const s = Object.assign({}, DEFAULTS, stored);

    // Το ?proxy= στη διεύθυνση υπερισχύει (χρήσιμο για μοίρασμα έτοιμου συνδέσμου)
    try {
      const q = new URLSearchParams(global.location ? global.location.search : '');
      if (q.get('proxy')) s.workerUrl = q.get('proxy');
    } catch (e) { /* δεν υπάρχει location, π.χ. σε δοκιμές */ }

    return s;
  }
  function saveSettings(s) { safeSet(STORE_KEY, JSON.stringify(s)); }

  function loadHistory() {
    try { return JSON.parse(safeGet(HISTORY_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function pushHistory(entry) {
    const list = loadHistory().filter(h => h.input !== entry.input);
    list.unshift(entry);
    safeSet(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
  }

  /* ======================================================================
   * Μικροβοηθήματα DOM
   * ==================================================================== */

  const esc = K.escapeHtml;

  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function openCentered(url, name) {
    const w = Math.min(1180, global.screen ? global.screen.width - 80 : 1180);
    const ht = Math.min(840, global.screen ? global.screen.height - 120 : 840);
    const l = global.screen ? (global.screen.width - w) / 2 : 0;
    const t = global.screen ? (global.screen.height - ht) / 2 : 0;
    global.open(url, name, 'width=' + w + ',height=' + ht + ',top=' + t + ',left=' + l + ',scrollbars=yes,resizable=yes');
  }

  /** Μηνύματα σφάλματος με πρακτική συμβουλή, όχι απλώς τον κωδικό. */
  function explainError(err) {
    const code = err && err.code;
    const msg = (err && err.message) || String(err);
    const tips = {
      NO_PROXY: 'Άνοιξε τις <strong>⚙️ Ρυθμίσεις</strong> και καταχώρισε το URL του Cloudflare Worker. ' +
                'Οδηγίες: <code>worker/README.md</code> στο αποθετήριο.',
      NETWORK: 'Έλεγξε τη σύνδεσή σου. Αν χρησιμοποιείς Worker, δοκίμασε τα <strong>Διαγνωστικά</strong> ' +
               'για να δεις αν απαντά.',
      TIMEOUT: 'Το ΚΗΜΔΗΣ αργεί ή δεν απαντά. Δοκίμασε ξανά σε λίγο.',
      BAD_JSON: 'Ο server επέστρεψε σελίδα αντί για δεδομένα — συνήθως συντήρηση ή λάθος διεύθυνση proxy.',
      NOT_FOUND: 'Έλεγξε τον ΑΔΑΜ. Θυμήσου ότι κάθε στάδιο έχει δικό του ΑΔΑΜ (REQ, PROC, AWRD, SYMV, PAY).',
      NO_SEED: 'Δοκίμασε απευθείας με ΑΔΑΜ. Το ΑΔΑ/ΕΣΗΔΗΣ βρίσκεται μέσω Διαύγειας και δεν υπάρχει πάντα.',
      NO_JSZIP: 'Ανανέωσε τη σελίδα. Αν επιμένει, λείπει το αρχείο <code>jszip.min.js</code>.',
      HTTP_403: 'Ο Worker απέρριψε το αίτημα. Έλεγξε το <code>ALLOWED_ORIGINS</code> στις ρυθμίσεις του.',
      HTTP_404: 'Η διεύθυνση δεν βρέθηκε. Ίσως άλλαξε το API του ΚΗΜΔΗΣ.'
    };
    return { message: msg, tip: tips[code] || null, code: code || null };
  }

  /* ======================================================================
   * Το πρότυπο της εφαρμογής
   * ==================================================================== */

  function template(opts) {
    const closeBtn = opts.overlay
      ? '<button class="km-btn km-btn-ghost" id="kmClose" title="Κλείσιμο">Κλείσιμο ✕</button>' : '';

    return `
<div class="km-wrap">

  <div class="km-panel km-top">
    <div class="km-head">
      <div>
        <div class="km-title">ΚΗΜΔΗΣ — Υπερ-Εργαλείο Αναζήτησης</div>
        <div class="km-sub">Πλήρης αλυσίδα από ΑΔΑΜ, ΑΔΑ Διαύγειας ή Α/Α ΕΣΗΔΗΣ — με οικονομική ανάλυση και εξαγωγές</div>
        <div class="km-dev">Ανάπτυξη: <strong>developer V. Diakolios</strong><br>Δήμος Ρόδου — Διεύθυνση Τεχνικών Έργων και Υποδομών</div>
      </div>
      <div class="km-headbtns">
        <button class="km-btn km-btn-ghost km-btn-sm" id="kmTheme" title="Εναλλαγή θέματος">🌙</button>
        <button class="km-btn km-btn-ghost km-btn-sm" id="kmSettingsBtn" title="Ρυθμίσεις">⚙️ Ρυθμίσεις</button>
        ${closeBtn}
      </div>
    </div>

    <div class="km-tabs" role="tablist">
      <button class="km-tab" role="tab" id="kmTabChain"    aria-selected="true"  aria-controls="kmPanelChain">🔗 Αλυσίδα</button>
      <button class="km-tab" role="tab" id="kmTabBulk"     aria-selected="false" aria-controls="kmPanelBulk">📋 Μαζική</button>
      <button class="km-tab" role="tab" id="kmTabAdvanced" aria-selected="false" aria-controls="kmPanelAdvanced">🔎 Σύνθετη</button>
    </div>

    <!-- ΚΑΡΤΕΛΑ 1: ΑΛΥΣΙΔΑ -->
    <div class="km-tabpanel" id="kmPanelChain" role="tabpanel" aria-labelledby="kmTabChain">
      <div class="km-field">
        <label class="km-label" for="kmAdam">Αναγνωριστικό</label>
        <div class="km-searchbox">
          <input class="km-input km-input-adam" id="kmAdam" list="kmHistory" autocomplete="off"
                 placeholder="π.χ. 26SYMV019210768 — ή ΑΔΑ Διαύγειας ή Α/Α ΕΣΗΔΗΣ">
          <datalist id="kmHistory"></datalist>
          <button class="km-btn" id="kmSearch">Αναζήτηση</button>
          <button class="km-btn km-btn-ghost" id="kmCancel" hidden>Ακύρωση</button>
        </div>
        <div class="km-hint">Δώσε οποιοδήποτε κρίκο· η εφαρμογή βρίσκει όλη την αλυσίδα προς τα πίσω και προς τα εμπρός.</div>
      </div>
    </div>

    <!-- ΚΑΡΤΕΛΑ 2: ΜΑΖΙΚΗ -->
    <div class="km-tabpanel" id="kmPanelBulk" role="tabpanel" aria-labelledby="kmTabBulk" hidden>
      <div class="km-field">
        <label class="km-label" for="kmBulkInput">Λίστα ΑΔΑΜ — ένας ανά γραμμή (ή χωρισμένοι με κόμμα / κενό)</label>
        <textarea class="km-textarea" id="kmBulkInput" placeholder="26SYMV019210768&#10;24REQ012345678&#10;24PAY000000001"></textarea>
        <div class="km-hint">Επικόλλησε απευθείας από Excel. Αναγνωρίζονται αυτόματα μόνο έγκυροι ΑΔΑΜ.</div>
      </div>
      <div class="km-searchbox" style="margin-top:12px">
        <button class="km-btn" id="kmBulkRun">Ανάκτηση όλων</button>
        <button class="km-btn km-btn-ghost" id="kmBulkClear">Καθαρισμός</button>
      </div>
    </div>

    <!-- ΚΑΡΤΕΛΑ 3: ΣΥΝΘΕΤΗ -->
    <div class="km-tabpanel" id="kmPanelAdvanced" role="tabpanel" aria-labelledby="kmTabAdvanced" hidden>
      <div class="km-grid3">
        <div class="km-field">
          <label class="km-label" for="kmAdvStage">Στάδιο</label>
          <select class="km-select" id="kmAdvStage">
            ${K.STAGE_LIST.map(s => '<option value="' + s.key + '">' + esc(s.label) + '</option>').join('')}
          </select>
        </div>
        <div class="km-field">
          <label class="km-label" for="kmAdvOrgVat">ΑΦΜ Αναθέτουσας Αρχής</label>
          <input class="km-input" id="kmAdvOrgVat" placeholder="9 ψηφία" inputmode="numeric">
        </div>
        <div class="km-field">
          <label class="km-label" for="kmAdvCpv">CPV</label>
          <input class="km-input" id="kmAdvCpv" placeholder="π.χ. 45233142">
        </div>
        <div class="km-field">
          <label class="km-label" for="kmAdvFrom">Από ημερομηνία</label>
          <input class="km-input" id="kmAdvFrom" type="date">
        </div>
        <div class="km-field">
          <label class="km-label" for="kmAdvTo">Έως ημερομηνία</label>
          <input class="km-input" id="kmAdvTo" type="date">
        </div>
        <div class="km-field">
          <label class="km-label" for="kmAdvText">Λέξη-κλειδί στον τίτλο</label>
          <input class="km-input" id="kmAdvText" placeholder="π.χ. ασφαλτόστρωση">
        </div>
      </div>
      <div class="km-searchbox" style="margin-top:12px">
        <button class="km-btn" id="kmAdvRun">Αναζήτηση</button>
        <button class="km-btn km-btn-ghost" id="kmAdvClear">Καθαρισμός</button>
      </div>
      <div class="km-hint" style="margin-top:8px">
        Τα φίλτρα προωθούνται στο API του ΚΗΜΔΗΣ. Όσα δεν υποστηρίζονται από τον server
        εφαρμόζονται τοπικά στα αποτελέσματα.
      </div>
    </div>

    <div class="km-tools">
      <button class="km-tool km-tool-cpv"      id="kmToolCpv"      title="Επίσημο εργαλείο CPV">🔍 CPV</button>
      <button class="km-tool km-tool-diavgeia" id="kmToolDiavgeia" title="Αναζήτηση στη Διαύγεια">🏛️ ΔΙΑΥΓΕΙΑ</button>
      <button class="km-tool km-tool-search"   id="kmToolSearch"   title="Ελεύθερη αναζήτηση ΚΗΜΔΗΣ">🔎 ΛΕΞΗ-ΚΛΕΙΔΙ</button>
      <button class="km-tool km-tool-law"      id="kmToolLaw"      title="Νόμος 4412/2016">📖 Ν. 4412/16</button>
    </div>

    <div class="km-status">
      <div id="kmStatus" role="status" aria-live="polite">Έτοιμο. Δώσε ένα αναγνωριστικό και πάτα Αναζήτηση.</div>
      <div class="km-headbtns" id="kmExportBar" hidden>
        <button class="km-btn km-btn-green km-btn-sm" id="kmExpZip">📦 ZIP</button>
        <button class="km-btn km-btn-ghost km-btn-sm" id="kmExpXlsx">📊 Excel</button>
        <button class="km-btn km-btn-ghost km-btn-sm" id="kmExpCsv">📄 CSV</button>
        <button class="km-btn km-btn-ghost km-btn-sm" id="kmExpJson">{ } JSON</button>
        <button class="km-btn km-btn-ghost km-btn-sm" id="kmExpPrint">🖨️ Εκτύπωση</button>
      </div>
    </div>
    <div class="km-progress" id="kmProgress" hidden><div class="km-progress-bar" id="kmProgressBar"></div></div>
    <div id="kmAlerts"></div>
  </div>

  <!-- ΡΥΘΜΙΣΕΙΣ -->
  <div class="km-panel km-drawer" id="kmSettings" hidden>
    <h3>⚙️ Ρυθμίσεις</h3>
    <div class="km-field">
      <label class="km-label" for="kmWorkerUrl">URL του Cloudflare Worker (απαιτείται για την online χρήση)</label>
      <input class="km-input" id="kmWorkerUrl" placeholder="https://kimdis-proxy.xxx.workers.dev" spellcheck="false">
      <div class="km-hint" id="kmWorkerHint"></div>
    </div>
    <h4>Συμπεριφορά σάρωσης</h4>
    <div class="km-settings-row">
      <div class="km-field">
        <label class="km-label" for="kmConcurrency">Ταυτόχρονα αιτήματα</label>
        <input class="km-input" id="kmConcurrency" type="number" min="1" max="10" step="1">
        <div class="km-hint">Περισσότερα = ταχύτερα, αλλά πιο πιεστικά για τον server.</div>
      </div>
      <div class="km-field">
        <label class="km-label" for="kmMaxNodes">Μέγιστες πράξεις ανά αλυσίδα</label>
        <input class="km-input" id="kmMaxNodes" type="number" min="5" max="400" step="5">
      </div>
      <div class="km-field" style="justify-content:flex-end;gap:10px">
        <label class="km-check"><input type="checkbox" id="kmUseDiavgeia"> Χρήση Διαύγειας για ΑΔΑ / ΕΣΗΔΗΣ</label>
        <label class="km-check"><input type="checkbox" id="kmIncludePdf"> Λήψη PDF στο ZIP</label>
      </div>
    </div>
    <div class="km-headbtns" style="margin-top:16px">
      <button class="km-btn" id="kmSaveSettings">Αποθήκευση</button>
      <button class="km-btn km-btn-ghost" id="kmRunDiag">🩺 Διαγνωστικά</button>
      <button class="km-btn km-btn-ghost" id="kmClearCache">Καθαρισμός προσωρινής μνήμης</button>
    </div>
    <div id="kmDiagOut"></div>
  </div>

  <div id="kmSummary"></div>
  <div id="kmResults"><div class="km-empty">Δεν υπάρχουν ακόμη αποτελέσματα.</div></div>

  <div class="km-foot">
    ΚΗΜΔΗΣ Υπερ-Εργαλείο v${K.VERSION} · Δεδομένα από το
    <a href="https://cerpp.eprocurement.gov.gr/" target="_blank" rel="noopener">Κ.Η.Μ.ΔΗ.Σ.</a> και τη
    <a href="https://diavgeia.gov.gr/" target="_blank" rel="noopener">Διαύγεια</a><br>
    Τα δεδομένα ανήκουν στους φορείς τους· το εργαλείο απλώς τα συγκεντρώνει και τα παρουσιάζει.
  </div>
</div>`;
  }

  /* ======================================================================
   * Απόδοση: συγκεντρωτικά, χρονοδιάγραμμα, κάρτες
   * ==================================================================== */

  function pct(x) { return (x * 100).toFixed(1).replace('.', ',') + '%'; }

  /** Κάρτες στατιστικών + χρονοδιάγραμμα σταδίων + σημαίες ελέγχου. */
  function renderSummary(stats) {
    if (!stats || !stats.total) return '';

    const con = stats.byStage.contract;
    const pay = stats.byStage.payment;
    const req = stats.byStage.request;

    const cards = [];

    cards.push(`
      <div class="km-stat">
        <div class="km-stat-k">Πράξεις στην αλυσίδα</div>
        <div class="km-stat-v">${stats.total}</div>
        <div class="km-stat-sub">${stats.durationDays != null
          ? 'διάρκεια ' + stats.durationDays + ' ημερών' : 'σε ' + K.STAGE_LIST.filter(s => stats.byStage[s.key].count).length + ' στάδια'}</div>
      </div>`);

    if (con.count) {
      cards.push(`
        <div class="km-stat">
          <div class="km-stat-k">Συμβατικό ποσό</div>
          <div class="km-stat-v">${esc(K.money(con.withVat || con.withoutVat))}</div>
          <div class="km-stat-sub">${con.withVat ? 'με ΦΠΑ · χωρίς ΦΠΑ ' + esc(K.money(con.withoutVat)) : 'χωρίς ΦΠΑ'}</div>
        </div>`);
    }

    if (pay.count) {
      const over = stats.absorption != null && stats.absorption > 1.005;
      const width = stats.absorption != null ? Math.min(100, stats.absorption * 100) : 0;
      cards.push(`
        <div class="km-stat ${over ? 'km-stat-bad' : 'km-stat-good'}">
          <div class="km-stat-k">Πληρωμές</div>
          <div class="km-stat-v">${esc(K.money(pay.withVat))}</div>
          <div class="km-stat-sub">${pay.count} εντολ${pay.count === 1 ? 'ή' : 'ές'}${
            stats.absorption != null ? ' · απορρόφηση ' + pct(stats.absorption) : ''}</div>
          ${stats.absorption != null
            ? '<div class="km-meter"><div class="km-meter-bar' + (over ? ' over' : '') + '" style="width:' + width + '%"></div></div>'
            : ''}
        </div>`);

      if (stats.absorption != null && con.withVat > 0) {
        const remaining = con.withVat - pay.withVat;
        cards.push(`
          <div class="km-stat ${remaining < 0 ? 'km-stat-bad' : ''}">
            <div class="km-stat-k">Υπόλοιπο σύμβασης</div>
            <div class="km-stat-v">${esc(K.money(remaining))}</div>
            <div class="km-stat-sub">συμβατικό μείον πληρωμές</div>
          </div>`);
      }
    }

    if (stats.savings != null) {
      const good = stats.savings >= 0;
      cards.push(`
        <div class="km-stat ${good ? 'km-stat-good' : 'km-stat-bad'}">
          <div class="km-stat-k">${good ? 'Έκπτωση' : 'Υπέρβαση'} έναντι αιτήματος</div>
          <div class="km-stat-v">${pct(Math.abs(stats.savings))}</div>
          <div class="km-stat-sub">αίτημα ${esc(K.money(req.withoutVat))} → σύμβαση ${esc(K.money(con.withoutVat))} (χωρίς ΦΠΑ)</div>
        </div>`);
    }

    /* --- Χρονοδιάγραμμα σταδίων --- */
    const timeline = K.STAGE_LIST.map(s => {
      const b = stats.byStage[s.key];
      const done = b.count > 0;
      const amount = b.withVat || b.withoutVat;
      return `
        <div class="km-tl-step ${done ? 'done' : ''}">
          <div class="km-tl-dot" style="${done ? 'color:' + s.color : ''}">${s.icon}</div>
          <div class="km-tl-name">${esc(s.short)}</div>
          <div class="km-tl-count">${done ? b.count + ' πράξ.' : '—'}</div>
          ${done && amount ? '<div class="km-tl-amount">' + esc(K.money(amount)) + '</div>' : ''}
        </div>`;
    }).join('');

    /* --- Ταυτότητα αλυσίδας --- */
    const idRows = [];
    if (stats.authorities.length) idRows.push(['Αναθέτουσα Αρχή', stats.authorities.join(' | ')]);
    if (stats.contractors.length) idRows.push(['Ανάδοχος/οι', stats.contractors.join(' | ')]);
    if (stats.contractorVats.length) idRows.push(['ΑΦΜ αναδόχων', stats.contractorVats.join(' | ')]);
    if (stats.cpvs.length) {
      idRows.push(['CPV', stats.cpvs.map(c =>
        c.code + (c.divisionLabel ? ' — ' + c.divisionLabel : '')).join(' | ')]);
    }
    if (stats.firstDate && stats.lastDate) {
      idRows.push(['Χρονικό εύρος', K.fmtDate(stats.firstDate) + ' → ' + K.fmtDate(stats.lastDate)]);
    }

    const flags = stats.flags.map(f =>
      '<div class="km-alert km-alert-' + (f.level === 'warn' ? 'warn' : 'info') + '">' + esc(f.text) + '</div>'
    ).join('');

    return `
      <div class="km-stats">${cards.join('')}</div>
      <div class="km-panel" style="padding:18px;margin-bottom:18px">
        <div class="km-timeline">${timeline}</div>
        ${idRows.length ? '<div class="km-meta">' + idRows.map(([k, v]) =>
          '<div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>').join('') + '</div>' : ''}
        ${flags}
      </div>`;
  }

  /** Μία κάρτα ανά πράξη, με τα βασικά πεδία και όλα τα metadata σε πτυσσόμενο. */
  function renderCards(nodes) {
    if (!nodes.length) return '<div class="km-empty">Δεν βρέθηκαν πράξεις.</div>';

    return '<div class="km-list">' + nodes.map((n, index) => {
      const s = n.summary;
      const rows = [];
      const add = (k, v, mono) => {
        if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return;
        rows.push([k, Array.isArray(v) ? v.join(' | ') : v, mono]);
      };

      add('Ημερομηνία', s.date ? K.fmtDate(s.date) : null);
      add('Α/Α ΕΣΗΔΗΣ', s.esidis, true);
      add('Αριθμός σύμβασης', s.contractNumber, true);
      add('ΑΔΑ Διαύγειας', s.ada, true);
      add('ΑΑΗΤ', s.aaht, true);
      add('Αναθέτουσα Αρχή', s.organizationName);
      add('ΑΦΜ Αναθέτουσας', s.organizationVat, true);
      add('Ανάδοχος/οι', s.contractors);
      add('ΑΦΜ Αναδόχου/ων', s.contractorVats.length ? s.contractorVats : null, true);
      if (s.amountWithoutVat != null) add('Αξία χωρίς ΦΠΑ', K.money(s.amountWithoutVat));
      if (s.amountWithVat != null) add('Αξία με ΦΠΑ', K.money(s.amountWithVat));
      if (s.cpvs.length) {
        add('CPV', s.cpvs.map(c => c.code + (c.divisionLabel ? ' — ' + c.divisionLabel : '')));
      }
      add('Ποσότητες', s.quantities.length ? s.quantities.join(', ') : null);
      add('Έναρξη', s.startDate ? K.fmtDate(s.startDate) : null);
      add('Λήξη', s.endDate ? K.fmtDate(s.endDate) : null);
      add('Προηγούμενος ΑΔΑΜ', s.previousAdam, true);

      const all = K.flatten(n.data);

      return `
        <section class="km-card">
          <div class="km-card-head" style="border-left-color:${n.stage.color}">
            <div>
              <div class="km-card-stage" style="color:${n.stage.color}">
                <span>${n.stage.icon}</span><span>${esc(n.stage.label)}</span>
              </div>
              <div class="km-card-adam">${esc(n.adam)}</div>
            </div>
            <span class="km-chip km-chip-stage" style="background:${n.stage.color}">${index + 1} / ${nodes.length}</span>
          </div>
          <div class="km-card-body">
            ${s.title ? '<div class="km-card-title">' + esc(s.title) + '</div>' : ''}
            <div class="km-meta">
              ${rows.map(([k, v, mono]) =>
                '<div class="k">' + esc(k) + '</div><div class="v' + (mono ? ' mono' : '') + '">' + esc(v) + '</div>'
              ).join('')}
            </div>
            <div class="km-actions">
              <a class="km-link" href="${esc(K.attachmentUrl(n.adam, false))}" target="_blank" rel="noopener">📄 Άνοιγμα PDF</a>
              <a class="km-link" href="${esc(K.officialUrl(n.adam))}" target="_blank" rel="noopener">🏛️ Επίσημη εγγραφή</a>
              ${s.ada ? '<a class="km-link" href="' + esc(K.diavgeiaUrl(s.ada)) + '" target="_blank" rel="noopener">📋 Διαύγεια</a>' : ''}
              <button class="km-link" data-copy="${esc(n.adam)}">📋 Αντιγραφή ΑΔΑΜ</button>
              <button class="km-link" data-copyjson="${index}">{ } Αντιγραφή JSON</button>
            </div>
            <details class="km-details">
              <summary>Όλα τα μεταδεδομένα (${all.length} πεδία)</summary>
              <div class="km-kv">
                ${all.map(([k, v]) =>
                  '<div class="pk">' + esc(k) + '</div><div class="pv">' + esc(v) + '</div>').join('')}
              </div>
            </details>
          </div>
        </section>`;
    }).join('') + '</div>';
  }

  /** Πίνακας για μαζική αναζήτηση και σύνθετα φίλτρα. */
  function renderTable(nodes, failures) {
    const cols = [
      ['Στάδιο', n => n.stage.icon + ' ' + n.stage.short, ''],
      ['ΑΔΑΜ', n => n.adam, 'mono'],
      ['Τίτλος', n => n.summary.title || '—', 'wrap'],
      ['Ημερομηνία', n => n.summary.date ? K.fmtDate(n.summary.date) : '—', ''],
      ['Ανάδοχος', n => n.summary.contractors.join(', ') || '—', 'wrap'],
      ['Χωρίς ΦΠΑ', n => n.summary.amountWithoutVat != null ? K.money(n.summary.amountWithoutVat) : '—', 'num'],
      ['Με ΦΠΑ', n => n.summary.amountWithVat != null ? K.money(n.summary.amountWithVat) : '—', 'num'],
      ['PDF', n => '<a href="' + esc(K.attachmentUrl(n.adam, false)) + '" target="_blank" rel="noopener">άνοιγμα</a>', '']
    ];

    const failHtml = (failures && failures.length)
      ? '<div class="km-alert km-alert-warn"><strong>Δεν ανακτήθηκαν ' + failures.length + ':</strong>' +
        esc(failures.map(f => f.adam + ' (' + f.reason + ')').join(' · ')) + '</div>'
      : '';

    if (!nodes.length) return failHtml + '<div class="km-empty">Καμία εγγραφή δεν ανακτήθηκε.</div>';

    return failHtml + `
      <div class="km-tablewrap">
        <table class="km-table">
          <thead><tr>${cols.map(c => '<th>' + esc(c[0]) + '</th>').join('')}</tr></thead>
          <tbody>
            ${nodes.map(n => '<tr>' + cols.map(c => {
              const v = c[1](n);
              const isHtml = c[0] === 'PDF';
              return '<td class="' + c[2] + '">' + (isHtml ? v : esc(v)) + '</td>';
            }).join('') + '</tr>').join('')}
          </tbody>
        </table>
      </div>`;
  }

  /** Αποτελέσματα διαγνωστικού ελέγχου. */
  function renderDiagnostics(out) {
    return `
      <h4>Αποτελέσματα διαγνωστικού</h4>
      <div class="km-diag">
        <div class="km-diag-item">
          <div>${out.mode === 'worker' ? '🌐' : '🧩'}</div>
          <div class="km-diag-name">Λειτουργία</div>
          <div class="km-diag-detail">${out.mode === 'worker'
            ? 'Μέσω Worker: ' + esc(out.workerUrl || '(δεν ορίστηκε)')
            : 'Απευθείας (επέκταση Chrome)'}</div>
        </div>
        ${out.checks.map(c => `
          <div class="km-diag-item">
            <div>${c.ok ? '✅' : '❌'}</div>
            <div class="km-diag-name">${esc(c.name)}</div>
            <div class="km-diag-detail">${esc(c.detail || '')}</div>
          </div>`).join('')}
      </div>`;
  }

  /* ======================================================================
   * Προσάρτηση και λογική
   * ==================================================================== */

  /**
   * Χτίζει την εφαρμογή μέσα στο `container`.
   * @param {object} options { container, overlay }
   */
  function mount(options) {
    const opts = options || {};
    const overlay = !!opts.overlay;

    // Αν τρέχει ήδη (π.χ. ξαναπάτησε το εικονίδιο της επέκτασης), το αντικαθιστούμε.
    const existing = document.getElementById(APP_ID);
    if (existing) existing.remove();

    const root = document.createElement('div');
    root.id = APP_ID;
    if (overlay) root.className = 'km-overlay';
    root.innerHTML = template({ overlay });
    (opts.container || document.body).appendChild(root);

    const $ = sel => root.querySelector(sel);
    const settings = loadSettings();

    const state = {
      nodes: [],
      stats: null,
      controller: null,
      mode: 'chain',  // chain | bulk | advanced
      proxyAuto: false
    };

    /* ---- Ρυθμίσεις -> πυρήνας ---------------------------------------- */

    function applySettings() {
      K.configure({
        workerUrl: settings.workerUrl,
        concurrency: Math.max(1, Math.min(10, Number(settings.concurrency) || 4)),
        maxNodes: Math.max(5, Math.min(400, Number(settings.maxNodes) || 80)),
        useDiavgeia: !!settings.useDiavgeia,
        mode: K.isExtensionContext() ? 'direct' : (settings.workerUrl ? 'worker' : 'direct')
      });
      applyTheme();
    }

    function applyTheme() {
      let theme = settings.theme;
      if (theme === 'auto') {
        theme = (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
      }
      root.setAttribute('data-theme', theme);
      $('#kmTheme').textContent = theme === 'dark' ? '☀️' : '🌙';
      $('#kmTheme').title = 'Θέμα: ' + (settings.theme === 'auto' ? 'αυτόματο' : settings.theme);
    }

    /* ---- Κατάσταση / μηνύματα ---------------------------------------- */

    const setStatus = (html) => { $('#kmStatus').innerHTML = html; };

    function setProgress(value) {
      const bar = $('#kmProgress');
      if (value == null) { bar.hidden = true; return; }
      bar.hidden = false;
      $('#kmProgressBar').style.width = Math.max(0, Math.min(100, value)) + '%';
    }

    function clearAlerts() { $('#kmAlerts').innerHTML = ''; }

    function alertBox(level, title, body) {
      const div = document.createElement('div');
      div.className = 'km-alert km-alert-' + level;
      div.innerHTML = (title ? '<strong>' + esc(title) + '</strong>' : '') + body;
      $('#kmAlerts').appendChild(div);
      return div;
    }

    function showError(err) {
      const info = explainError(err);
      alertBox('error', 'Σφάλμα' + (info.code ? ' (' + info.code + ')' : ''),
        esc(info.message) + (info.tip ? '<br><br>' + info.tip : ''));
      setStatus('<span class="km-err">Η ενέργεια απέτυχε.</span>');
    }

    function setBusy(busy) {
      ['#kmSearch', '#kmBulkRun', '#kmAdvRun'].forEach(sel => { $(sel).disabled = busy; });
      $('#kmCancel').hidden = !busy;
      if (!busy) { setProgress(null); state.controller = null; }
    }

    /* ---- Αποτελέσματα ------------------------------------------------- */

    function showResults(nodes, stats, tableMode, failures) {
      state.nodes = nodes;
      state.stats = stats;
      $('#kmSummary').innerHTML = stats ? renderSummary(stats) : '';
      $('#kmResults').innerHTML = tableMode ? renderTable(nodes, failures) : renderCards(nodes);
      $('#kmExportBar').hidden = !nodes.length;
    }

    function refreshHistory() {
      const list = loadHistory();
      $('#kmHistory').innerHTML = list.map(hEntry =>
        '<option value="' + esc(hEntry.input) + '">' + esc(hEntry.count + ' πράξεις') + '</option>').join('');
    }

    /* ==================================================================
     * Αναζήτηση 1: πλήρης αλυσίδα
     * ================================================================ */

    async function searchChain() {
      const input = K.clean($('#kmAdam').value);
      clearAlerts();
      if (!input) {
        setStatus('<span class="km-err">Δώσε ΑΔΑΜ, ΑΔΑ Διαύγειας ή Α/Α ΕΣΗΔΗΣ.</span>');
        $('#kmAdam').focus();
        return;
      }

      showResults([], null, false);
      setBusy(true);
      setProgress(2);
      state.controller = new AbortController();

      try {
        const result = await K.buildChain(input, {
          signal: state.controller.signal,
          onProgress: (msg, p) => { setStatus(esc(msg)); if (p != null) setProgress(p); }
        });

        const stats = K.analyze(result.nodes);
        showResults(result.nodes, stats, false);

        if ($('#kmAdam').value.toUpperCase() !== result.seed && K.isAdam(result.seed)) {
          $('#kmAdam').value = result.seed;
        }
        result.warnings.forEach(w => alertBox('warn', null, esc(w)));

        setStatus('Ολοκληρώθηκε: <strong>' + result.nodes.length + '</strong> πράξεις στην αλυσίδα.');
        pushHistory({ input, at: Date.now(), count: result.nodes.length });
        refreshHistory();

      } catch (err) {
        if (err && err.code === 'ABORTED') setStatus('Η αναζήτηση ακυρώθηκε.');
        else showError(err);
      } finally {
        setBusy(false);
      }
    }

    /* ==================================================================
     * Αναζήτηση 2: μαζική λίστα ΑΔΑΜ
     * ================================================================ */

    async function searchBulk() {
      clearAlerts();
      const raw = $('#kmBulkInput').value || '';
      const candidates = Array.from(new Set(
        raw.split(/[\s,;]+/).map(K.clean).filter(Boolean)
      ));
      const valid = candidates.filter(K.isAdam);
      const invalid = candidates.filter(c => !K.isAdam(c));

      if (!valid.length) {
        setStatus('<span class="km-err">Δεν βρέθηκε κανένας έγκυρος ΑΔΑΜ στη λίστα.</span>');
        if (invalid.length) {
          alertBox('warn', 'Αγνοήθηκαν ' + invalid.length + ' γραμμές',
            esc(invalid.slice(0, 20).join(', ')) + (invalid.length > 20 ? ' …' : ''));
        }
        return;
      }

      showResults([], null, true);
      setBusy(true);
      state.controller = new AbortController();
      let done = 0;

      try {
        const results = await K.pool(valid, async adam => {
          const rec = await K.fetchRecord(adam, { signal: state.controller.signal });
          rec.summary = K.summarize(rec);
          return rec;
        }, K.config.concurrency);

        // Το pool δεν αναφέρει πρόοδο ανά στοιχείο· ενημερώνουμε στο τέλος κάθε παρτίδας
        done = results.length;
        setProgress(100);

        const nodes = [];
        const failures = [];
        results.forEach((r, i) => {
          if (r.ok) nodes.push(r.value);
          else failures.push({ adam: valid[i], reason: (r.error && r.error.code) || 'σφάλμα' });
        });

        nodes.sort((a, b) => a.stage.order - b.stage.order || a.adam.localeCompare(b.adam));
        showResults(nodes, nodes.length ? K.analyze(nodes) : null, true, failures);

        if (invalid.length) {
          alertBox('warn', 'Αγνοήθηκαν ' + invalid.length + ' μη έγκυρες γραμμές',
            esc(invalid.slice(0, 20).join(', ')) + (invalid.length > 20 ? ' …' : ''));
        }
        setStatus('Ανακτήθηκαν <strong>' + nodes.length + '</strong> από ' + valid.length + ' ΑΔΑΜ.');

      } catch (err) {
        if (err && err.code === 'ABORTED') setStatus('Ακυρώθηκε μετά από ' + done + ' εγγραφές.');
        else showError(err);
      } finally {
        setBusy(false);
      }
    }

    /* ==================================================================
     * Αναζήτηση 3: σύνθετα φίλτρα
     * ================================================================ */

    async function searchAdvanced() {
      clearAlerts();
      const stageKey = $('#kmAdvStage').value;
      const orgVat = K.clean($('#kmAdvOrgVat').value);
      const cpv = K.clean($('#kmAdvCpv').value);
      const from = $('#kmAdvFrom').value;
      const to = $('#kmAdvTo').value;
      const text = ($('#kmAdvText').value || '').trim().toLowerCase();

      if (!orgVat && !cpv && !from && !to && !text) {
        setStatus('<span class="km-err">Συμπλήρωσε τουλάχιστον ένα φίλτρο.</span>');
        return;
      }
      if (orgVat && !K.isValidVat(orgVat)) {
        alertBox('warn', 'Προσοχή στο ΑΦΜ',
          'Το «' + esc(orgVat) + '» δεν περνά τον έλεγχο ψηφίου ελέγχου. Η αναζήτηση θα γίνει ούτως ή άλλως.');
      }

      // Ό,τι μπορεί, στέλνεται στον server· τα υπόλοιπα φιλτράρονται τοπικά.
      const filter = {};
      if (orgVat) filter.organizationVatNumber = orgVat;
      if (cpv) filter.cpv = cpv;
      if (from) filter.dateFrom = from;
      if (to) filter.dateTo = to;

      showResults([], null, true);
      setBusy(true);
      setProgress(20);
      state.controller = new AbortController();

      try {
        setStatus('Αναζήτηση στο στάδιο «' + esc(K.STAGES[stageKey].short) + '»…');
        const rows = await K.queryStage(stageKey, filter, { signal: state.controller.signal });
        setProgress(70);

        let nodes = rows.map(data => {
          const adam = K.clean(data && data.referenceNumber);
          const node = { adam, stage: K.isAdam(adam) ? K.stageOfAdam(adam) : K.STAGES[stageKey], data };
          node.summary = K.summarize(node);
          return node;
        });

        const before = nodes.length;

        // Τοπικό φιλτράρισμα για ό,τι δεν τίμησε ο server
        if (text) nodes = nodes.filter(n => String(n.summary.title || '').toLowerCase().includes(text));
        if (cpv) nodes = nodes.filter(n => n.summary.cpvs.some(c => String(c.code).replace(/\D/g, '').startsWith(cpv.replace(/\D/g, ''))));
        if (orgVat) nodes = nodes.filter(n => !n.summary.organizationVat || K.clean(n.summary.organizationVat) === orgVat);
        if (from) { const d = new Date(from); nodes = nodes.filter(n => { const nd = K.toDate(n.summary.date); return !nd || nd >= d; }); }
        if (to) { const d = new Date(to); d.setHours(23, 59, 59); nodes = nodes.filter(n => { const nd = K.toDate(n.summary.date); return !nd || nd <= d; }); }

        setProgress(100);
        showResults(nodes, nodes.length ? K.analyze(nodes) : null, true);

        if (!nodes.length) {
          alertBox('info', 'Κανένα αποτέλεσμα',
            before > 0
              ? 'Ο server επέστρεψε ' + before + ' εγγραφές, αλλά καμία δεν πέρασε τα τοπικά φίλτρα.'
              : 'Το API δεν επέστρεψε εγγραφές. Το ΚΗΜΔΗΣ ενδέχεται να μην υποστηρίζει αυτόν τον συνδυασμό ' +
                'φίλτρων· δοκίμασε την <strong>🔎 ΛΕΞΗ-ΚΛΕΙΔΙ</strong> στην επίσημη σελίδα.');
        }
        setStatus('Βρέθηκαν <strong>' + nodes.length + '</strong> εγγραφές' +
          (before !== nodes.length ? ' (από ' + before + ' που επέστρεψε ο server)' : '') + '.');

      } catch (err) {
        if (err && err.code === 'ABORTED') setStatus('Η αναζήτηση ακυρώθηκε.');
        else showError(err);
      } finally {
        setBusy(false);
      }
    }

    /* ==================================================================
     * Εξαγωγές
     * ================================================================ */

    const stamp = () => new Date().toISOString().slice(0, 10);
    const baseName = () => 'KHMDIS_' + (state.nodes[0] ? state.nodes[0].adam : 'export') + '_' + stamp();

    async function withButton(btn, label, fn) {
      const original = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="km-spin"></span> ' + label;
      try { await fn(); }
      catch (err) { showError(err); }
      finally { btn.disabled = false; btn.innerHTML = original; }
    }

    function wireExports() {
      $('#kmExpCsv').onclick = () => K.download(K.toCsv(state.nodes), baseName() + '.csv', 'text/csv;charset=utf-8');

      $('#kmExpJson').onclick = () => K.download(
        JSON.stringify({
          generatedAt: new Date().toISOString(),
          tool: 'ΚΗΜΔΗΣ Υπερ-Εργαλείο v' + K.VERSION,
          count: state.nodes.length,
          statistics: state.stats ? {
            byStage: Object.keys(state.stats.byStage).reduce((acc, key) => {
              const b = state.stats.byStage[key];
              if (b.count) acc[key] = { count: b.count, withoutVat: b.withoutVat, withVat: b.withVat };
              return acc;
            }, {}),
            absorption: state.stats.absorption,
            savings: state.stats.savings,
            contractors: state.stats.contractors,
            contractorVats: state.stats.contractorVats
          } : null,
          records: state.nodes.map(n => ({ adam: n.adam, stage: n.stage.key, summary: n.summary, data: n.data }))
        }, null, 2),
        baseName() + '.json', 'application/json;charset=utf-8');

      $('#kmExpXlsx').onclick = e => withButton(e.currentTarget, 'Excel…', async () => {
        const blob = await K.toXlsxBlob(state.nodes);
        K.download(blob, baseName() + '.xlsx');
      });

      $('#kmExpZip').onclick = e => withButton(e.currentTarget, 'ZIP…', async () => {
        const blob = await K.buildZip(state.nodes, state.stats, {
          includePdf: settings.includePdf,
          onProgress: (msg, p) => { setStatus(esc(msg)); if (p != null) setProgress(p); }
        });
        K.download(blob, baseName() + '.zip');
        setStatus('Το ZIP κατέβηκε (' + state.nodes.length + ' πράξεις).');
        setProgress(null);
      });

      $('#kmExpPrint').onclick = () => {
        // Ανοίγουμε όλα τα πτυσσόμενα ώστε να τυπωθούν και τα πλήρη metadata
        root.querySelectorAll('details.km-details').forEach(d => { d.open = true; });
        global.print();
      };
    }

    /* ==================================================================
     * Σύνδεση συμβάντων
     * ================================================================ */

    function switchTab(mode) {
      state.mode = mode;
      const map = { chain: 'Chain', bulk: 'Bulk', advanced: 'Advanced' };
      Object.keys(map).forEach(key => {
        const selected = key === mode;
        $('#kmTab' + map[key]).setAttribute('aria-selected', String(selected));
        $('#kmPanel' + map[key]).hidden = !selected;
      });
    }

    function wire() {
      if (overlay) $('#kmClose').onclick = () => root.remove();

      $('#kmTabChain').onclick = () => switchTab('chain');
      $('#kmTabBulk').onclick = () => switchTab('bulk');
      $('#kmTabAdvanced').onclick = () => switchTab('advanced');

      $('#kmSearch').onclick = searchChain;
      $('#kmAdam').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); searchChain(); }
      });
      $('#kmBulkRun').onclick = searchBulk;
      $('#kmBulkClear').onclick = () => { $('#kmBulkInput').value = ''; showResults([], null, true); };
      $('#kmAdvRun').onclick = searchAdvanced;
      $('#kmAdvClear').onclick = () => {
        ['#kmAdvOrgVat', '#kmAdvCpv', '#kmAdvFrom', '#kmAdvTo', '#kmAdvText'].forEach(s => { $(s).value = ''; });
        showResults([], null, true);
      };

      $('#kmCancel').onclick = () => { if (state.controller) state.controller.abort(); };

      $('#kmToolCpv').onclick = () => openCentered('https://simap.ted.europa.eu/el/web/simap/cpv', 'CPV');
      $('#kmToolDiavgeia').onclick = () => openCentered(K.DIAVGEIA + '/search', 'DIAVGEIA');
      $('#kmToolSearch').onclick = () => openCentered(K.SEARCH_PAGE, 'KHMDIS_SEARCH');
      $('#kmToolLaw').onclick = () => global.open('https://eadhsy.gr/n4412/', '_blank', 'noopener');

      $('#kmTheme').onclick = () => {
        const order = ['auto', 'light', 'dark'];
        settings.theme = order[(order.indexOf(settings.theme) + 1) % order.length];
        saveSettings(settings);
        applyTheme();
      };

      /* --- Ρυθμίσεις --- */
      $('#kmSettingsBtn').onclick = () => {
        const panel = $('#kmSettings');
        panel.hidden = !panel.hidden;
        if (!panel.hidden) $('#kmWorkerUrl').focus();
      };

      $('#kmSaveSettings').onclick = () => {
        settings.workerUrl = ($('#kmWorkerUrl').value || '').trim().replace(/\/+$/, '');
        settings.concurrency = Number($('#kmConcurrency').value) || 4;
        settings.maxNodes = Number($('#kmMaxNodes').value) || 80;
        settings.useDiavgeia = $('#kmUseDiavgeia').checked;
        settings.includePdf = $('#kmIncludePdf').checked;
        saveSettings(settings);
        applySettings();
        updateWorkerHint();
        setStatus('Οι ρυθμίσεις αποθηκεύτηκαν.');
      };

      $('#kmClearCache').onclick = () => { K.clearCache(); setStatus('Η προσωρινή μνήμη καθαρίστηκε.'); };

      $('#kmRunDiag').onclick = e => withButton(e.currentTarget, 'Έλεγχος…', async () => {
        $('#kmDiagOut').innerHTML = '';
        const out = await K.diagnose(K.clean($('#kmAdam').value) || null);
        $('#kmDiagOut').innerHTML = renderDiagnostics(out);
      });

      /* --- Αντιγραφή (μέσω ανάθεσης συμβάντος) --- */
      root.addEventListener('click', async e => {
        const copyBtn = e.target.closest('[data-copy]');
        const jsonBtn = e.target.closest('[data-copyjson]');
        if (!copyBtn && !jsonBtn) return;
        e.preventDefault();

        const btn = copyBtn || jsonBtn;
        const text = copyBtn
          ? copyBtn.getAttribute('data-copy')
          : JSON.stringify(state.nodes[Number(jsonBtn.getAttribute('data-copyjson'))].data, null, 2);

        const original = btn.innerHTML;
        try {
          await navigator.clipboard.writeText(text);
          btn.innerHTML = '✅ Αντιγράφηκε';
        } catch (err) {
          // Το clipboard API θέλει ασφαλές context· εφεδρική μέθοδος
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.cssText = 'position:fixed;opacity:0';
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); btn.innerHTML = '✅ Αντιγράφηκε'; }
          catch (e2) { btn.innerHTML = '❌ Απέτυχε'; }
          document.body.removeChild(ta);
        }
        setTimeout(() => { btn.innerHTML = original; }, 1600);
      });

      wireExports();
    }

    function updateWorkerHint() {
      const hint = $('#kmWorkerHint');
      if (K.isExtensionContext()) {
        hint.innerHTML = 'Τρέχεις ως <strong>επέκταση Chrome</strong> — οι κλήσεις γίνονται απευθείας ' +
                         'και ο Worker δεν χρειάζεται.';
      } else if (settings.workerUrl) {
        hint.innerHTML = (state.proxyAuto
            ? '✅ Βρέθηκε <strong>αυτόματα</strong> στο ίδιο origin (Cloudflare Pages Function) — δεν χρειάζεται να αλλάξεις τίποτα. '
            : 'Ενεργός. ') +
          'Έλεγχος: <a href="' + esc(settings.workerUrl) + '/health" target="_blank" rel="noopener">' +
          esc(settings.workerUrl) + '/health</a>';
      } else {
        hint.innerHTML = 'Χωρίς Worker η online έκδοση <strong>δεν μπορεί</strong> να διαβάσει το ΚΗΜΔΗΣ ' +
                         '(ο browser το μπλοκάρει λόγω CORS). Οδηγίες: <code>worker/README.md</code>.';
      }
    }

    /* ---- Αρχικοποίηση ------------------------------------------------ */

    $('#kmWorkerUrl').value = settings.workerUrl;
    $('#kmConcurrency').value = settings.concurrency;
    $('#kmMaxNodes').value = settings.maxNodes;
    $('#kmUseDiavgeia').checked = settings.useDiavgeia;
    $('#kmIncludePdf').checked = settings.includePdf;

    applySettings();
    wire();
    switchTab('chain');
    refreshHistory();

    // Προσυμπλήρωση από τη διεύθυνση: ?adam=26SYMV019210768
    let preset = null;
    try {
      const q = new URLSearchParams(global.location ? global.location.search : '');
      preset = K.clean(q.get('adam') || q.get('q') || '') || null;
    } catch (e) { /* χωρίς location */ }
    if (preset) $('#kmAdam').value = preset;

    /* --- Εντοπισμός proxy και εκκίνηση -------------------------------- */
    (async function boot() {
      let ready = K.isExtensionContext() || !!settings.workerUrl;

      // Αν το site τρέχει σε Cloudflare Pages, το proxy είναι ήδη εκεί, στο
      // ίδιο origin. Το βρίσκουμε μόνοι μας αντί να ζητάμε ρύθμιση.
      if (!ready) {
        setStatus('Έλεγχος για ενσωματωμένο proxy…');
        const found = await K.autodetectProxy();
        if (found) {
          settings.workerUrl = found;
          saveSettings(settings);
          applySettings();
          $('#kmWorkerUrl').value = found;
          state.proxyAuto = true;
          ready = true;
        }
      }

      updateWorkerHint();

      if (ready) {
        setStatus(state.proxyAuto
          ? 'Έτοιμο — το proxy βρέθηκε αυτόματα. Δώσε ένα αναγνωριστικό και πάτα Αναζήτηση.'
          : 'Έτοιμο. Δώσε ένα αναγνωριστικό και πάτα Αναζήτηση.');
        if (preset) searchChain();
        return;
      }

      // Χωρίς proxy η online έκδοση δεν δουλεύει — το λέμε αντί να αποτύχει σιωπηλά.
      $('#kmSettings').hidden = false;
      alertBox('info', 'Χρειάζεται μία ρύθμιση πριν ξεκινήσεις',
        'Ο browser μπλοκάρει τις κλήσεις προς το ΚΗΜΔΗΣ (CORS), οπότε χρειάζεται ένας ενδιάμεσος. ' +
        'Ο ευκολότερος τρόπος είναι να ανεβάσεις το site σε <strong>Cloudflare Pages</strong>: ' +
        'το proxy φεύγει μαζί του και δεν χρειάζεται καμία ρύθμιση εδώ. ' +
        'Εναλλακτικά, καταχώρισε παρακάτω το URL ενός αυτόνομου Worker. ' +
        'Οδηγίες: <code>worker/README.md</code>.');
      setStatus('<span class="km-err">Δεν βρέθηκε proxy — δες τις Ρυθμίσεις παρακάτω.</span>');
    })();

    return {
      root,
      search: value => { $('#kmAdam').value = K.clean(value); return searchChain(); },
      destroy: () => root.remove(),
      getState: () => state
    };
  }

  global.KHMDIS_UI = { mount, renderSummary, renderCards, renderTable, renderDiagnostics, explainError, APP_ID };

})(typeof globalThis !== 'undefined' ? globalThis : self);
