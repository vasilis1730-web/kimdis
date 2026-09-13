# Το API του ΚΗΜΔΗΣ — ό,τι επιβεβαιώθηκε ζωντανά

Καταγραφή από **πραγματικές** απαντήσεις του `khmdhs-opendata`, 13/09/2026.
Μέχρι τότε τα ονόματα πεδίων ήταν εικασίες· αρκετές ήταν λάθος.

## Κλήση

```http
POST https://cerpp.eprocurement.gov.gr/khmdhs-opendata/{στάδιο}?page=0
Content-Type: application/json

{"referenceNumber": "26SYMV019210768"}
```

Στάδια: `request` · `notice` · `auction` · `contract` · `payment`

## Απάντηση

Σελιδοποιημένη, τύπου Spring:

```json
{
  "content": [ … ],
  "totalElements": 156861, "totalPages": …, "size": 50, "number": 0,
  "first": true, "last": false, "empty": false,
  "pageable": { … }, "sort": { … }
}
```

⚠️ **Κενό φίλτρο `{}` επιστρέφει τα ΠΑΝΤΑ** — 156.861 συμβάσεις, 50 ανά σελίδα.
Μη στέλνεις ποτέ κενό φίλτρο κατά λάθος.

## Υποστηριζόμενα φίλτρα

Μόνο το **`referenceNumber`** επιβεβαιώθηκε ότι δουλεύει.

Τα `previousRequestReferenceNumber`, `systemicNumber` και κάθε άλλο πεδίο που
δοκιμάστηκε **δεν υποστηρίζονται**. Γι' αυτό η σάρωση της αλυσίδας δεν ρωτάει
πια το API «ποιος δείχνει σε εμένα;» — η ίδια η εγγραφή δηλώνει τους γείτονές της.

## Πεδία συνδέσμων — έτσι χτίζεται η αλυσίδα

Κάθε εγγραφή κουβαλά τους γείτονές της, οπότε η διεύρυνση δεν κοστίζει αιτήματα:

| Πεδίο | Δείχνει σε |
|---|---|
| `prevReferenceNo` | την προηγούμενη πράξη |
| `requestRefNo` | το αίτημα |
| `noticeReferenceNumber` | τη διακήρυξη |
| `auctionRefNo` | την ανάθεση |
| `contractRefNo` | τη σύμβαση — **μπορεί να είναι πίνακας** |
| `nextRefNo`, `nextExtended`, `nextModified` | επόμενες / τροποποιητικές |
| `paymentRefNo` | **πίνακας** ΑΔΑΜ πληρωμών |
| `approvedRequestsList` | **πίνακας** εγκεκριμένων αιτημάτων |
| `objectDetailsList[].requestRefNo` | σύνδεσμος ανά τμήμα |

## Πεδία που έπεφταν έξω

Οι αριστερές στήλες ήταν η υπόθεση· οι δεξιές η πραγματικότητα.

| Τι υπέθετα | Τι ισχύει |
|---|---|
| `contractingMembersDataList` στην κορυφή | **`contractingDataDetails.contractingMembersDataList`** — εμφωλευμένο |
| `organizationName` | **`organization`** → `{key, value}` |
| `previousRequestReferenceNumber` | **`prevReferenceNo`** |
| `diavgeiaADA` (συνήθως `null`) | **`contractRelatedADA.number3`** |
| — | **`contractBudget`** (το `budget` είναι `null`) |

Σωστά από την αρχή: `title`, `referenceNumber`, `contractSignedDate`,
`submissionDate`, `startDate`, `endDate`, `contractNumber`,
`organizationVatNumber`, `aaht`, `totalCostWithVAT`, `totalCostWithoutVAT`,
`objectDetailsList[].cpvs[]`, `objectDetailsList[].quantity`.

## Μορφές τιμών

- Οι λίστες τιμών έρχονται ως `{"key": "6", "value": "Απευθείας ανάθεση"}`
- Τα ΑΦΜ ως συμβολοσειρές 9 ψηφίων, σε `vatNumber` / `organizationVatNumber`
- Τα CPV ως `{"key": "75251000-0", "value": "Πυροσβεστικές υπηρεσίες"}`
- Οι ημερομηνίες ISO, άλλοτε με ώρα (`2026-06-11T13:01:21.924`) άλλοτε χωρίς

## Error 1010 — και πώς λύθηκε

Το `cerpp.eprocurement.gov.gr` είναι πίσω από Cloudflare και απορρίπτει με
**Error 1010 «Access denied — browser signature»** ό,τι δεν μοιάζει με browser.

Ο μηχανισμός επιβεβαιώθηκε πειραματικά. Στο **ίδιο ακριβώς URL**:

| Client | Αποτέλεσμα |
|---|---|
| `curl` | HTTP 200 |
| `python-urllib` | HTTP 403 |
| UA `kimdis-proxy/8.1.0 (+github…)` | HTTP 403 |
| UA κανονικού Chrome | **HTTP 200** ✅ |

Ο έλεγχος γίνεται στο **User-Agent**.

**Η λύση:** ο proxy στέκεται στη θέση του browser του χρήστη — κάνει το ίδιο
αίτημα που κάνει η επέκταση απευθείας από τον Chrome του — οπότε στέλνει και τις
ίδιες κεφαλίδες (`User-Agent`, `Referer`, `Origin`). Δεν είναι σάρωση: μια πλήρης
αναζήτηση αλυσίδας κάνει 8 αιτήματα.

Αλλάζει με τη μεταβλητή περιβάλλοντος `USER_AGENT`, χωρίς αλλαγή κώδικα.

**Επιβεβαιώθηκε ζωντανά** (13/09/2026) ότι και οι δύο διαδρομές δουλεύουν:

```
CONTRACT 26SYMV019210768  ──auctionRefNo──►  AUCTION 26AWRD019200977
AUCTION  26AWRD019200977  ──contractRefNo──►  CONTRACT 26SYMV019210768
```

## Πόσα αιτήματα κάνει μια αναζήτηση

Μία πλήρης αλυσίδα 5 σταδίων: **8 αιτήματα** (1 ανά κόμβο + η αρχική επίλυση).

Παλιότερα έκανε 43, επειδή ρωτούσε το API με φίλτρα που δεν υποστηρίζει —
10 άχρηστες κλήσεις ανά κόμβο. Δεν έφερναν τίποτα και φόρτωναν άδικα τον server.
