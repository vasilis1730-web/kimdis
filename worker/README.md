# kimdis-proxy — ο Worker που λύνει το CORS

## Γιατί χρειάζεται

Ο browser **απαγορεύει** σε μια σελίδα να διαβάσει απάντηση από άλλον domain,
εκτός αν εκείνος ο domain στείλει κεφαλίδες CORS. Το ΚΗΜΔΗΣ δεν τις στέλνει.

- **Η επέκταση Chrome** δεν έχει το πρόβλημα: το `host_permissions` στο
  `manifest.json` της δίνει άδεια να καλεί απευθείας το ΚΗΜΔΗΣ.
- **Η online σελίδα** δεν έχει τέτοιο προνόμιο. Χρειάζεται έναν ενδιάμεσο.

Ο Worker κάνει την κλήση από τη μεριά του server — εκεί δεν υπάρχει CORS — και
σου επιστρέφει την απάντηση με τις σωστές κεφαλίδες.

```
Browser ──► kimdis-proxy (Cloudflare) ──► cerpp.eprocurement.gov.gr
        ◄──  + κεφαλίδες CORS       ◄──
```

## Εγκατάσταση (μία φορά, ~5 λεπτά)

### 1. Λογαριασμός
Φτιάξε δωρεάν λογαριασμό στο <https://dash.cloudflare.com/sign-up>.
Το δωρεάν πακέτο δίνει **100.000 αιτήματα την ημέρα** — υπεραρκετά.

### 2. Εγκατάσταση wrangler
```bash
npm install -g wrangler
wrangler login
```

### 3. Deploy
```bash
cd worker
wrangler deploy
```

Στο τέλος θα τυπώσει κάτι σαν:
```
Published kimdis-proxy
  https://kimdis-proxy.<το-όνομά-σου>.workers.dev
```

**Αντίγραψε αυτό το URL.**

### 4. Σύνδεση με την εφαρμογή
Άνοιξε την online εφαρμογή → **⚙️ Ρυθμίσεις** → επικόλλησε το URL → **Αποθήκευση**.
Πάτα **Διαγνωστικά** για να επιβεβαιώσεις ότι όλα απαντούν.

Το URL αποθηκεύεται τοπικά στον browser σου (`localStorage`). Μπορείς επίσης να
το περάσεις στη διεύθυνση: `...?proxy=https://kimdis-proxy.xxx.workers.dev`

### Εναλλακτικά, χωρίς τερματικό
Dashboard → **Workers & Pages** → **Create** → **Start with Hello World** →
**Deploy** → **Edit code** → επικόλλησε όλο το `worker.js` → **Deploy**.

## Κλείδωμα στη δική σου σελίδα (συνιστάται)

Μόλις δημοσιεύσεις τη σελίδα, περιόρισε ποιος μπορεί να χρησιμοποιεί τον Worker:

```toml
# worker/wrangler.toml
[vars]
ALLOWED_ORIGINS = "https://vasilis1730-web.github.io"
```
και ξανά `wrangler deploy`. Ή από το Dashboard → Worker → Settings →
Variables → `ALLOWED_ORIGINS`.

## Έλεγχος ότι ζει

```bash
curl https://kimdis-proxy.xxx.workers.dev/health
```
```json
{ "ok": true, "service": "kimdis-proxy", "version": "8.0.0", ... }
```

## Τι επιτρέπει και τι όχι

| | |
|---|---|
| Επιτρεπτοί hosts | `cerpp.eprocurement.gov.gr`, `diavgeia.gov.gr` — **τίποτα άλλο** |
| Πρωτόκολλο | μόνο `https` |
| Μέθοδοι | `GET`, `POST`, `OPTIONS` |
| Μέγιστο σώμα | 256 KB |
| Cookies / Authorization | δεν προωθούνται ποτέ, σε καμία κατεύθυνση |
| Cache | 5 λεπτά για GET, στο δίκτυο της Cloudflare |

Ο Worker είναι **ανοιχτός relay μόνο προς δύο δημόσιους κυβερνητικούς
ιστότοπους**· δεν μπορεί να χρησιμοποιηθεί για πρόσβαση σε τίποτα άλλο.

## Κόστος

Μηδέν για κανονική χρήση. Το δωρεάν πακέτο καλύπτει 100.000 αιτήματα/ημέρα·
μια πλήρης αναζήτηση αλυσίδας κάνει τυπικά 10–40.
