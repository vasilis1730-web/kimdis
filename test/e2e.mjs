/* End-to-end έλεγχος στον πραγματικό Chromium, με προσομοιωμένο API ΚΗΜΔΗΣ.
   node test/e2e.mjs   (χρειάζεται τοπικό server στο :8765) */
import { chromium } from '/tmp/claude-0/-home-user-kimdis/4eb64f42-fd49-56e2-aedc-2f0d860a6992/scratchpad/node_modules/playwright-core/index.mjs';

const BASE = 'http://127.0.0.1:8765/';
const WORKER = 'https://mock-worker.test';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
};

/* ---------- Πλαστά δεδομένα: μια πλήρης αλυσίδα 5 σταδίων ---------- */
const VAT_CONTRACTOR = '998877663';   // έγκυρο ψηφίο ελέγχου
const VAT_AUTHORITY  = '997578653';
const SYS = '198765';

const REC = {
  '24REQ000000101': {
    referenceNumber: '24REQ000000101', title: 'Πρωτογενές αίτημα για συντήρηση οδικού δικτύου',
    signedDate: '2024-02-10', totalCostWithoutVAT: 10000, totalCostWithVAT: 12400,
    organizationName: 'ΔΗΜΟΣ ΡΟΔΟΥ', organizationVatNumber: VAT_AUTHORITY,
    objectDetailsList: [{ cpvs: [{ key: '45233142-6', value: 'Εργασίες επισκευής οδών' }], quantity: 1 }]
  },
  '24PROC000000102': {
    referenceNumber: '24PROC000000102', title: 'Διακήρυξη ανοικτού διαγωνισμού',
    signedDate: '2024-03-01', previousRequestReferenceNumber: '24REQ000000101',
    systemicNumber: SYS, estimatedTotalCostWithoutVAT: 10000,
    organizationName: 'ΔΗΜΟΣ ΡΟΔΟΥ', organizationVatNumber: VAT_AUTHORITY
  },
  '24AWRD000000103': {
    referenceNumber: '24AWRD000000103', title: 'Κατακύρωση αποτελέσματος διαγωνισμού',
    signedDate: '2024-05-20', systemicNumber: SYS,
    organizationName: 'ΔΗΜΟΣ ΡΟΔΟΥ', organizationVatNumber: VAT_AUTHORITY,
    awardMembersDataList: [{ name: 'ΑΛΦΑ ΤΕΧΝΙΚΗ ΑΕ', vatNumber: VAT_CONTRACTOR }]
  },
  '26SYMV019210768': {
    referenceNumber: '26SYMV019210768', title: 'Σύμβαση συντήρησης οδικού δικτύου Δήμου Ρόδου',
    contractSignedDate: '2024-06-15', contractNumber: '145/2024', systemicNumber: SYS,
    totalCostWithoutVAT: 8000, totalCostWithVAT: 9920,
    startDate: '2024-07-01', endDate: '2025-06-30', diavgeiaADA: 'ΨΨ4Ξ46ΜΤΛ6-Ξ7Θ',
    organizationName: 'ΔΗΜΟΣ ΡΟΔΟΥ', organizationVatNumber: VAT_AUTHORITY,
    contractingMembersDataList: [{ name: 'ΑΛΦΑ ΤΕΧΝΙΚΗ ΑΕ', vatNumber: VAT_CONTRACTOR }],
    objectDetailsList: [{ cpvs: [{ key: '45233142-6', value: 'Εργασίες επισκευής οδών' }], quantity: 2 }]
  },
  '24PAY000000104': {
    referenceNumber: '24PAY000000104', title: 'Εντολή πληρωμής 1ου λογαριασμού',
    signedDate: '2024-09-30', totalCostWithoutVAT: 4000, totalCostWithVAT: 4960,
    organizationName: 'ΔΗΜΟΣ ΡΟΔΟΥ', organizationVatNumber: VAT_AUTHORITY,
    contractingMembersDataList: [{ name: 'ΑΛΦΑ ΤΕΧΝΙΚΗ ΑΕ', vatNumber: VAT_CONTRACTOR }]
  }
};
const CHILDREN = {
  '24REQ000000101': ['24PROC000000102'],
  '24PROC000000102': ['24AWRD000000103'],
  '24AWRD000000103': ['26SYMV019210768'],
  '26SYMV019210768': ['24PAY000000104']
};
const STAGE_OF = a => ({ REQ: 'request', PROC: 'notice', AWRD: 'auction', SYMV: 'contract', PAY: 'payment' })[
  /\d{2}(REQ|PROC|AWRD|SYMV|PAY)/.exec(a)[1]];

let apiCalls = 0;

/* ---------------------------------------------------------------- */

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ locale: 'el-GR' });
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));

// Προρυθμίζουμε τον Worker ώστε η εφαρμογή να ξεκινήσει έτοιμη
await page.addInitScript(worker => {
  localStorage.setItem('khmdis.settings.v8', JSON.stringify({
    workerUrl: worker, theme: 'light', concurrency: 4, maxNodes: 80,
    useDiavgeia: true, includePdf: false
  }));
}, WORKER);

// Προσομοίωση του Worker
await page.route(WORKER + '/**', async route => {
  const req = route.request();
  const u = new URL(req.url());

  if (u.pathname === '/health') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, service: 'mock' }) });
  }

  const upstream = new URL(u.searchParams.get('url'));
  apiCalls++;
  const json = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });

  // Δημόσια HTML σελίδα -> δεν προσθέτει τίποτα καινούργιο
  if (upstream.pathname.includes('home.xhtml')) {
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>καμία αναφορά</body></html>' });
  }
  if (upstream.hostname.includes('diavgeia')) {
    return json({ decisions: [{ ada: 'ΨΨ4Ξ46ΜΤΛ6-Ξ7Θ', subject: 'σχετικό 26SYMV019210768' }] });
  }

  // POST στο opendata
  const stage = upstream.pathname.split('/').filter(Boolean).pop();
  let filter = {};
  try { filter = JSON.parse(req.postData() || '{}'); } catch (e) {}

  if (filter.referenceNumber) {
    const rec = REC[filter.referenceNumber];
    return json({ content: rec && STAGE_OF(filter.referenceNumber) === stage ? [rec] : [] });
  }
  if (filter.previousRequestReferenceNumber) {
    const kids = (CHILDREN[filter.previousRequestReferenceNumber] || []).filter(a => STAGE_OF(a) === stage);
    return json({ content: kids.map(a => REC[a]) });
  }
  if (filter.systemicNumber) {
    return json({ content: Object.values(REC).filter(r => r.systemicNumber === filter.systemicNumber && STAGE_OF(r.referenceNumber) === stage) });
  }
  if (filter.organizationVatNumber) {
    return json({ content: Object.values(REC).filter(r => STAGE_OF(r.referenceNumber) === stage) });
  }
  return json({ content: [] });
});

/* =============== 1. Φόρτωση =============== */
console.log('\n▸ Φόρτωση εφαρμογής');
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#__khmdis_app__', { timeout: 10000 });
check('η εφαρμογή προσαρτήθηκε', await page.isVisible('#__khmdis_app__'));
check('ο δείκτης φόρτωσης αφαιρέθηκε', !(await page.isVisible('#boot').catch(() => false)));
check('τίτλος σωστός', (await page.textContent('.km-title')).includes('ΚΗΜΔΗΣ'));
check('αναφέρεται ο προγραμματιστής', (await page.textContent('.km-dev')).includes('V. Diakolios'));
check('δεν εμφανίστηκε προειδοποίηση για Worker (είναι ρυθμισμένος)',
  !(await page.locator('.km-alert-info').filter({ hasText: 'Cloudflare Worker' }).count()));
check('η μπάρα εξαγωγών είναι κρυφή πριν από αποτελέσματα', !(await page.isVisible('#kmExportBar')));
check('το κουμπί Ακύρωση είναι κρυφό όσο δεν τρέχει αναζήτηση', !(await page.isVisible('#kmCancel')));
check('ο πίνακας ρυθμίσεων είναι κλειστός', !(await page.isVisible('#kmSettings')));

/* =============== 2. Αναζήτηση αλυσίδας =============== */
console.log('\n▸ Αναζήτηση πλήρους αλυσίδας από τον ΜΕΣΑΙΟ κρίκο');
await page.fill('#kmAdam', '24AWRD000000103');     // ξεκινάμε από τη μέση επίτηδες
await page.click('#kmSearch');
await page.waitForSelector('.km-card', { timeout: 25000 });
await page.waitForFunction(() => !document.querySelector('#kmSearch').disabled, { timeout: 25000 });
check('το Ακύρωση ξανακρύφτηκε μετά την αναζήτηση', !(await page.isVisible('#kmCancel')));

const cards = await page.locator('.km-card').count();
check('βρήκε και τα 5 στάδια (μπρος + πίσω)', cards === 5, cards + ' κάρτες');

const stageTexts = await page.locator('.km-card-stage').allTextContents();
check('σειρά σταδίων σωστή',
  stageTexts.map(t => t.replace(/[^Α-Ωα-ωίϊΐόάέύϋΰήώ ]/g, '').trim())
    .every((t, i) => ['Πρωτογενές', 'Πρόσκληση', 'Ανάθεση', 'Σύμβαση', 'Εντολή'].some(s => stageTexts[i].includes(s))),
  JSON.stringify(stageTexts));

const body = await page.textContent('#kmResults');
check('εμφανίζει τον ανάδοχο', body.includes('ΑΛΦΑ ΤΕΧΝΙΚΗ ΑΕ'));
check('εμφανίζει το ΑΦΜ αναδόχου', body.includes(VAT_CONTRACTOR));
check('εμφανίζει τον αριθμό σύμβασης', body.includes('145/2024'));
check('εμφανίζει το ΑΔΑ Διαύγειας', body.includes('ΨΨ4Ξ46ΜΤΛ6-Ξ7Θ'));
check('αναλύει το CPV σε περιγραφή', body.includes('Κατασκευαστικές εργασίες'));
check('ημερομηνίες σε ελληνική μορφή', /\d{2}\/\d{2}\/\d{4}/.test(body));

const pdfHref = await page.locator('.km-link[href*="attachment"]').first().getAttribute('href');
check('τα PDF links περιέχουν το στάδιο (bug v7 διορθωμένο)',
  pdfHref.includes('/contract/attachment/') || pdfHref.includes('/request/attachment/'), pdfHref);
check('κανένα "undefined" στη σελίδα', !body.includes('undefined'));

/* =============== 3. Οικονομική ανάλυση =============== */
console.log('\n▸ Οικονομική ανάλυση');
const summary = await page.textContent('#kmSummary');
check('σύνολο πράξεων', summary.includes('5'));
check('συμβατικό ποσό με ΦΠΑ', summary.replace(/\s/g, '').includes('9.920,00'), summary.slice(0, 200));
check('πληρωμές', summary.replace(/\s/g, '').includes('4.960,00'));
check('απορρόφηση 50%', summary.includes('50,0%'));
check('έκπτωση 20%', summary.includes('20,0%'));
check('υπόλοιπο σύμβασης', summary.replace(/\s/g, '').includes('4.960,00'));
const doneSteps = await page.locator('.km-tl-step.done').count();
check('χρονοδιάγραμμα: 5 ολοκληρωμένα στάδια', doneSteps === 5, doneSteps);

/* =============== 4. Εξαγωγές =============== */
console.log('\n▸ Εξαγωγές');
check('η μπάρα εξαγωγών εμφανίστηκε', await page.isVisible('#kmExportBar'));

for (const [id, ext] of [['#kmExpCsv', '.csv'], ['#kmExpJson', '.json'], ['#kmExpXlsx', '.xlsx']]) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click(id)
  ]);
  const name = download.suggestedFilename();
  check('κατέβηκε αρχείο ' + ext, name.endsWith(ext), name);
  const path = await download.path();
  const { statSync } = await import('node:fs');
  check('  το ' + ext + ' δεν είναι κενό', statSync(path).size > 200, statSync(path).size + ' bytes');
  if (ext === '.csv') {
    const { readFileSync } = await import('node:fs');
    const csv = readFileSync(path, 'utf8');
    check('  CSV έχει BOM', csv.charCodeAt(0) === 0xFEFF);
    check('  CSV έχει 5 γραμμές δεδομένων', csv.trim().split('\n').length === 6);
    check('  CSV περιέχει τον ανάδοχο', csv.includes('ΑΛΦΑ ΤΕΧΝΙΚΗ ΑΕ'));
  }
}

/* =============== 5. Καρτέλες & ρυθμίσεις =============== */
console.log('\n▸ Καρτέλες, θέμα, ρυθμίσεις');
await page.click('#kmTabBulk');
check('καρτέλα Μαζική ενεργή', await page.isVisible('#kmPanelBulk') && !(await page.isVisible('#kmPanelChain')));
await page.fill('#kmBulkInput', '26SYMV019210768\n24REQ000000101\nΑΚΥΡΟΣ-ΚΩΔΙΚΟΣ');
await page.click('#kmBulkRun');
await page.waitForSelector('.km-table', { timeout: 15000 });
const rows = await page.locator('.km-table tbody tr').count();
check('μαζική: 2 έγκυροι ΑΔΑΜ ανακτήθηκαν', rows === 2, rows + ' γραμμές');
check('μαζική: προειδοποίηση για τον άκυρο', (await page.textContent('#kmAlerts')).includes('ΑΚΥΡΟΣ'));

await page.click('#kmTabAdvanced');
check('καρτέλα Σύνθετη ενεργή', await page.isVisible('#kmPanelAdvanced'));
await page.fill('#kmAdvOrgVat', VAT_AUTHORITY);
await page.selectOption('#kmAdvStage', 'contract');
await page.click('#kmAdvRun');
await page.waitForSelector('.km-table', { timeout: 15000 });
check('σύνθετη: επέστρεψε αποτελέσματα', (await page.locator('.km-table tbody tr').count()) >= 1);

await page.click('#kmTabChain');
await page.click('#kmTheme');
check('εναλλαγή θέματος', ['dark', 'light'].includes(await page.getAttribute('#__khmdis_app__', 'data-theme')));
await page.click('#kmSettingsBtn');
check('άνοιξε ο πίνακας ρυθμίσεων', await page.isVisible('#kmSettings'));
await page.click('#kmRunDiag');
await page.waitForSelector('.km-diag-item', { timeout: 15000 });
const diag = await page.textContent('#kmDiagOut');
check('διαγνωστικά: ο Worker απαντά', diag.includes('Worker προσβάσιμος'));
check('διαγνωστικά: το JSZip φορτώθηκε', diag.includes('Φορτωμένο'));

/* =============== 6. Χωρίς proxy πουθενά =============== */
console.log('\n▸ Συμπεριφορά χωρίς κανένα proxy');
const page2 = await ctx.newPage();
await page2.addInitScript(() => localStorage.clear());
await page2.goto(BASE, { waitUntil: 'networkidle' });
await page2.waitForSelector('#__khmdis_app__');
await page2.waitForSelector('.km-alert-info', { timeout: 10000 });
check('εμφανίζει καθοδήγηση αντί να αποτύχει σιωπηλά',
  (await page2.textContent('#kmAlerts')).includes('Cloudflare Pages'));
check('ανοίγει αυτόματα τις ρυθμίσεις', await page2.isVisible('#kmSettings'));

/* =============== 6β. Αυτόματος εντοπισμός proxy στο ίδιο origin =============== */
console.log('\n▸ Αυτόματος εντοπισμός Pages Function στο /proxy');
const ctx3 = await browser.newContext({ locale: 'el-GR' });
const page3 = await ctx3.newPage();
await page3.addInitScript(() => localStorage.clear());

let autoProxyHits = 0;
// Προσομοιώνουμε τη Pages Function: /proxy/health και /proxy?url=…
await page3.route('**/proxy/health', route => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ ok: true, service: 'kimdis-proxy', version: '8.1.0' })
}));
await page3.route('**/proxy?*', async route => {
  autoProxyHits++;
  const up = new URL(new URL(route.request().url()).searchParams.get('url'));
  const j = x => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (up.pathname.includes('home.xhtml')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' });
  if (up.hostname.includes('diavgeia')) return j({});
  const stage = up.pathname.split('/').filter(Boolean).pop();
  let f = {}; try { f = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
  if (f.referenceNumber) { const r = REC[f.referenceNumber]; return j({ content: r && STAGE_OF(f.referenceNumber) === stage ? [r] : [] }); }
  if (f.previousRequestReferenceNumber) return j({ content: (CHILDREN[f.previousRequestReferenceNumber] || []).filter(a => STAGE_OF(a) === stage).map(a => REC[a]) });
  if (f.systemicNumber) return j({ content: Object.values(REC).filter(r => r.systemicNumber === f.systemicNumber && STAGE_OF(r.referenceNumber) === stage) });
  return j({ content: [] });
});

await page3.goto(BASE, { waitUntil: 'networkidle' });
await page3.waitForSelector('#__khmdis_app__');
await page3.waitForFunction(() => /αυτόματα|Ρυθμίσεις/.test(document.querySelector('#kmStatus').textContent), { timeout: 10000 });
check('ρυθμίστηκε μόνη της, χωρίς καμία ενέργεια χρήστη',
  (await page3.textContent('#kmStatus')).includes('αυτόματα'), await page3.textContent('#kmStatus'));
check('δεν ζητά ρύθμιση', !(await page3.isVisible('#kmSettings')));
check('αποθήκευσε το URL του proxy',
  (await page3.inputValue('#kmWorkerUrl')).endsWith('/proxy'), await page3.inputValue('#kmWorkerUrl'));

await page3.fill('#kmAdam', '26SYMV019210768');
await page3.click('#kmSearch');
await page3.waitForSelector('.km-card', { timeout: 25000 });
await page3.waitForFunction(() => !document.querySelector('#kmSearch').disabled, { timeout: 25000 });
check('η αναζήτηση δουλεύει μέσω του αυτόματου proxy',
  (await page3.locator('.km-card').count()) === 5, await page3.locator('.km-card').count());
check('οι κλήσεις πέρασαν όντως από το /proxy', autoProxyHits > 0, autoProxyHits);
await ctx3.close();

/* =============== 7. Κινητό =============== */
console.log('\n▸ Μικρή οθόνη (360px)');
const mob = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'el-GR' });
const mp = await mob.newPage();
await mp.addInitScript(w => localStorage.setItem('khmdis.settings.v8', JSON.stringify({ workerUrl: w })), WORKER);
await mp.goto(BASE, { waitUntil: 'networkidle' });
await mp.waitForSelector('#__khmdis_app__');
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('χωρίς οριζόντια κύλιση στα 360px', overflow <= 1, overflow + 'px υπερχείλιση');

/* =============== Σφάλματα κονσόλας =============== */
console.log('\n▸ Κονσόλα');
const real = consoleErrors.filter(e => !/favicon|sw\.js|service worker/i.test(e));
check('καμία εξαίρεση JavaScript', real.length === 0, real.slice(0, 3).join(' | '));

console.log('\n  (αιτήματα API που έγιναν: ' + apiCalls + ')');
await browser.close();

console.log('\n' + '='.repeat(52));
console.log(fail === 0 ? `✅ ΟΛΑ ΠΕΡΑΣΑΝ — ${pass} έλεγχοι` : `❌ ${fail} ΑΠΕΤΥΧΑΝ (${pass} πέρασαν)`);
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
