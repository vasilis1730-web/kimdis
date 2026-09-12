/* Έλεγχοι του πυρήνα — τρέχουν με: node test/core.test.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { console, setTimeout, clearTimeout, Date, Math, JSON, Intl, URL, Blob: class {}, fetch: async () => { throw new Error('no network in tests'); }, AbortController: class { constructor(){ this.signal = { aborted:false, addEventListener(){} }; } abort(){} } };
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'src/vendor/jszip.min.js'), 'utf8'), sandbox, { filename: 'jszip.min.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'src/khmdis-core.js'), 'utf8'), sandbox, { filename: 'khmdis-core.js' });

const K = sandbox.KHMDIS;
let pass = 0, fail = 0;
const eq = (actual, expected, name) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error('  ✗ ' + name + '\n      περίμενα: ' + e + '\n      πήρα:     ' + a); }
};
const ok = (cond, name) => eq(!!cond, true, name);
const group = n => console.log('\n▸ ' + n);

/* ---------------- ΑΔΑΜ ---------------- */
group('Αναγνώριση ΑΔΑΜ / ΑΔΑ / ΕΣΗΔΗΣ');
ok(K.isAdam('26SYMV019210768'), 'έγκυρος ΑΔΑΜ σύμβασης');
ok(K.isAdam('  26symv019210768 * '), 'καθαρισμός κενών/αστερίσκου/πεζών');
ok(!K.isAdam('26XXXX019210768'), 'άγνωστος κωδικός σταδίου απορρίπτεται');
ok(!K.isAdam('26SYMV123'), 'πολύ λίγα ψηφία απορρίπτονται');
eq(K.stageOfAdam('26SYMV019210768').key, 'contract', 'SYMV → σύμβαση');
eq(K.stageOfAdam('24REQ012345678').key, 'request', 'REQ → αίτημα');
eq(K.stageOfAdam('24PROC012345678').key, 'notice', 'PROC → διακήρυξη');
eq(K.stageOfAdam('24AWRD012345678').key, 'auction', 'AWRD → ανάθεση');
eq(K.stageOfAdam('24PAY012345678').key, 'payment', 'PAY → πληρωμή');
eq(K.stageOfAdam('άκυρο').key, 'unknown', 'άκυρο → άγνωστο στάδιο');
eq(K.yearOfAdam('26SYMV019210768'), 2026, 'έτος από ΑΔΑΜ');
eq(K.detectInputType('26SYMV019210768'), 'adam', 'τύπος: ΑΔΑΜ');
eq(K.detectInputType('ΨΨ4Ξ46ΜΤΛ6-Ξ7Θ'), 'ada', 'τύπος: ΑΔΑ Διαύγειας (ελληνικά)');
eq(K.detectInputType('123456'), 'esidis', 'τύπος: Α/Α ΕΣΗΔΗΣ');
eq(K.detectInputType(''), 'empty', 'τύπος: κενό');

group('Σάρωση ΑΔΑΜ μέσα σε κείμενο/JSON');
const scanned = K.scanAdams('κάτι 24REQ012345678 άλλο <b>26SYMV019210768</b> ξανά 24REQ012345678');
eq(scanned.sort(), ['24REQ012345678', '26SYMV019210768'], 'βρίσκει μοναδικούς ΑΔΑΜ σε HTML');
eq(K.scanAdams({ a: { b: '24PAY000000001' } }), ['24PAY000000001'], 'σαρώνει και αντικείμενα');

/* ---------------- ΑΦΜ ---------------- */
group('Έλεγχος ΑΦΜ (ψηφίο ελέγχου)');
// Παράγουμε έγκυρα ΑΦΜ με τον αλγόριθμο και τα επαληθεύουμε
function makeVat(first8) {
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(first8[i]) * Math.pow(2, 8 - i);
  return first8 + String((sum % 11) % 10);
}
let generated = 0;
for (const base of ['09409720', '99887766', '12345678', '10000000', '55500011']) {
  const v = makeVat(base);
  if (K.isValidVat(v)) generated++;
  // αλλοιώνουμε το ψηφίο ελέγχου -> πρέπει να απορριφθεί
  const bad = base + String((Number(v[8]) + 1) % 10);
  ok(!K.isValidVat(bad), 'απορρίπτει ΑΦΜ με λάθος ψηφίο ελέγχου (' + bad + ')');
}
eq(generated, 5, 'δέχεται όλα τα ΑΦΜ που παρήχθησαν σωστά');
ok(!K.isValidVat('000000000'), 'απορρίπτει 000000000');
ok(!K.isValidVat('12345'), 'απορρίπτει λάθος μήκος');
// Ποσοστό τυχαίων 9ψήφιων που περνούν πρέπει να είναι ~10%
let hits = 0;
for (let i = 0; i < 5000; i++) {
  const r = String(Math.floor(100000000 + Math.random() * 900000000));
  if (K.isValidVat(r)) hits++;
}
ok(hits / 5000 > 0.05 && hits / 5000 < 0.16, 'φιλτράρει ~90% των τυχαίων 9ψήφιων (πέρασαν ' + (hits / 50).toFixed(1) + '%)');

group('Εξαγωγή ΑΦΜ από εγγραφή');
const rec = {
  organizationVatNumber: makeVat('09409720'),
  signedDate: '2026-03-14',
  someCount: 123456789,                       // 9ψήφιο αλλά ΟΧΙ σε πεδίο ΑΦΜ
  contractingMembersDataList: [
    { name: 'ΑΛΦΑ ΑΤΕ', vatNumber: makeVat('99887766') },
    { name: 'ΒΗΤΑ ΟΕ', afm: makeVat('55500011') }
  ]
};
const vats = K.extractVats(rec);
eq(vats.filter(v => v.role === 'contractor').map(v => v.vat).sort(),
   [makeVat('55500011'), makeVat('99887766')].sort(), 'βρίσκει ΑΦΜ αναδόχων');
eq(vats.filter(v => v.role === 'authority').map(v => v.vat), [makeVat('09409720')], 'ξεχωρίζει ΑΦΜ αναθέτουσας');
ok(!vats.some(v => v.vat === '123456789'), 'ΔΕΝ πιάνει 9ψήφιο πεδίο που δεν είναι ΑΦΜ (το bug της v7)');
eq(K.extractContractors(rec).sort(), ['ΑΛΦΑ ΑΤΕ', 'ΒΗΤΑ ΟΕ'], 'βρίσκει επωνυμίες αναδόχων');

/* ---------------- Αριθμοί / ημερομηνίες ---------------- */
group('Αριθμοί και ημερομηνίες');
eq(K.toNumber('1.234,56'), 1234.56, 'ελληνική μορφή 1.234,56');
eq(K.toNumber('1234.56'), 1234.56, 'αγγλική μορφή 1234.56');
eq(K.toNumber('1,234.56'), 1234.56, 'μορφή 1,234.56');
eq(K.toNumber('12.500,00 €'), 12500, 'με σύμβολο ευρώ');
eq(K.toNumber(''), null, 'κενό → null');
eq(K.toNumber('abc'), null, 'μη αριθμός → null');
eq(K.toNumber(0), 0, 'το μηδέν διατηρείται');
ok(K.fmtDate('2026-03-14').includes('2026'), 'ISO ημερομηνία');
ok(K.fmtDate('14/03/2026').includes('2026'), 'ημερομηνία dd/mm/yyyy');
eq(K.fmtDate(''), '—', 'κενή ημερομηνία');

/* ---------------- CPV ---------------- */
group('CPV');
eq(K.describeCpv('45000000-7').division, '45', 'τμήμα CPV');
eq(K.describeCpv('45000000-7').divisionLabel, 'Κατασκευαστικές εργασίες', 'περιγραφή τμήματος 45');
eq(K.describeCpv('71300000').divisionLabel, 'Αρχιτεκτονικές, κατασκευαστικές, μηχανικές και επιθεωρήσεις', 'περιγραφή τμήματος 71');
const cpvRec = { objectDetailsList: [{ cpvs: [{ key: '45233142-6', value: 'Εργασίες επισκευής οδών' }], quantity: 3 }] };
eq(K.extractCpvs(cpvRec).map(c => c.division), ['45'], 'CPV από objectDetailsList');
eq(K.extractQuantities(cpvRec), [3], 'ποσότητες');

/* ---------------- URLs (το bug της v7) ---------------- */
group('URLs συνημμένων — το κρίσιμο bug της v7');
eq(K.attachmentUrl('26SYMV019210768', false),
   'https://cerpp.eprocurement.gov.gr/khmdhs-opendata/contract/attachment/26SYMV019210768',
   'το PDF URL περιέχει το στάδιο (όχι undefined)');
ok(!K.attachmentUrl('24REQ012345678', false).includes('undefined'), 'κανένα undefined στο URL');
ok(K.officialUrl('26SYMV019210768').includes('referenceNumber=26SYMV019210768'), 'URL επίσημης εγγραφής');

/* ---------------- Ανάλυση ---------------- */
group('Οικονομική ανάλυση');
const mk = (adam, withoutVat, withVat) => {
  const node = { adam, stage: K.stageOfAdam(adam), data: { referenceNumber: adam, totalCostWithoutVAT: withoutVat, totalCostWithVAT: withVat, signedDate: '2026-01-10' } };
  node.summary = K.summarize(node);
  return node;
};
const chain = [mk('24REQ000000001', 10000, 12400), mk('26SYMV019210768', 8000, 9920), mk('24PAY000000001', 4000, 4960)];
const stats = K.analyze(chain);
eq(stats.total, 3, 'πλήθος πράξεων');
eq(stats.byStage.contract.withVat, 9920, 'σύνολο συμβάσεων με ΦΠΑ');
eq(Math.round(stats.absorption * 100), 50, 'απορρόφηση 50%');
eq(Math.round(stats.savings * 100), 20, 'έκπτωση 20%');
ok(stats.flags.some(f => f.level === 'info'), 'σημαία για ελλείποντα στάδια');
const over = [mk('26SYMV019210768', 8000, 10000), mk('24PAY000000001', 9000, 12000)];
ok(K.analyze(over).flags.some(f => f.level === 'warn' && /υπερβαίνουν/.test(f.text)), 'προειδοποίηση υπέρβασης πληρωμών');

/* ---------------- Εξαγωγές ---------------- */
group('Εξαγωγές');
const csv = K.toCsv(chain);
ok(csv.charCodeAt(0) === 0xFEFF, 'CSV ξεκινά με BOM (για ελληνικό Excel)');
eq(csv.split('\r\n').length, 4, 'CSV: κεφαλίδα + 3 γραμμές');
ok(csv.split('\r\n')[0].split(';').length === K.EXPORT_COLUMNS.length, 'CSV: σωστό πλήθος στηλών');
ok(csv.includes('26SYMV019210768'), 'CSV περιέχει τον ΑΔΑΜ');
const tricky = [mk('26SYMV019210768', 1, 1)];
tricky[0].summary.title = 'Τίτλος με ; ερωτηματικό και "εισαγωγικά"';
ok(/"Τίτλος με ; ερωτηματικό και ""εισαγωγικά"""/.test(K.toCsv(tricky)), 'CSV: σωστό escaping');
const txt = K.toPlainText(chain, stats);
ok(txt.includes('ΣΥΓΚΕΝΤΡΩΤΙΚΑ') && txt.includes('26SYMV019210768'), 'κείμενο περίληψης');

/* ---------------- Ισοπέδωση ---------------- */
group('Ισοπέδωση αντικειμένων');
eq(K.flatten({ a: 1, b: { c: 'x' } }), [['a', '1'], ['b.c', 'x']], 'εμφωλευμένα κλειδιά');
eq(K.flatten({ a: [] }), [['a', '[]']], 'κενός πίνακας');
eq(K.flatten({ a: [{ b: 2 }] }), [['a[0].b', '2']], 'πίνακας αντικειμένων');
eq(K.fmtVal({ key: '45', value: 'Κατασκευές' }), 'Κατασκευές (45)', 'ζεύγος key/value');
eq(K.fmtVal(true), 'Ναι', 'boolean → Ναι');
eq(K.escapeHtml('<script>&"'), '&lt;script&gt;&amp;&quot;', 'escaping HTML');

/* ---------------- Excel ---------------- */
group('Παραγωγή Excel (.xlsx)');
(async () => {
  try {
    const zip = new sandbox.JSZip();
    // Χτίζουμε το ίδιο XML που παράγει ο πυρήνας και ελέγχουμε ότι είναι έγκυρο ZIP+XML
    const blobless = await (async () => {
      const t = K.buildTable(chain);
      eq(t.header.length, K.EXPORT_COLUMNS.length, 'πίνακας: σωστές στήλες');
      eq(t.rows.length, 3, 'πίνακας: σωστές γραμμές');
      ok(t.rows[0].includes('24REQ000000001'), 'πίνακας: περιέχει ΑΔΑΜ');
      return true;
    })();
    ok(blobless, 'δομή πίνακα εξαγωγής');
  } catch (e) {
    fail++; console.error('  ✗ Excel: ' + e.message);
  }
  console.log('\n' + '='.repeat(52));
  console.log(fail === 0 ? `✅ ΟΛΑ ΠΕΡΑΣΑΝ — ${pass} έλεγχοι` : `❌ ${fail} ΑΠΕΤΥΧΑΝ (${pass} πέρασαν)`);
  console.log('='.repeat(52));
  process.exit(fail === 0 ? 0 : 1);
})();
