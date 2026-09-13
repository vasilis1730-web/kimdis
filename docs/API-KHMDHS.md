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
| `contractRefNo` | τη σύμβαση |
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

## ⚠️ Το ΚΗΜΔΗΣ μπλοκάρει server-side κλήσεις

Το `cerpp.eprocurement.gov.gr` είναι πίσω από Cloudflare και επιστρέφει
**Error 1010 — «Access denied, browser signature»** σε αιτήματα που δεν μοιάζουν
με κανονικό browser. Οι πρώτες κλήσεις του Worker πέρασαν· μετά άρχισε να κόβει
μόνιμα (δοκιμάστηκε επί ~3 λεπτά, χωρίς ανάκαμψη — δεν είναι rate limit).

**Τι σημαίνει πρακτικά:**

| | |
|---|---|
| 🧩 **Επέκταση Chrome** | Δουλεύει — οι κλήσεις φεύγουν από τον ίδιο σου τον browser |
| 🌐 **Online μέσω Worker** | Μπορεί να κοπεί με Error 1010 |

Αν η online έκδοση δώσει 403, η εφαρμογή το εξηγεί και παραπέμπει στην επέκταση.

## Πόσα αιτήματα κάνει μια αναζήτηση

Μία πλήρης αλυσίδα 5 σταδίων: **8 αιτήματα** (1 ανά κόμβο + η αρχική επίλυση).

Παλιότερα έκανε 43, επειδή ρωτούσε το API με φίλτρα που δεν υποστηρίζει —
10 άχρηστες κλήσεις ανά κόμβο. Δεν έφερναν τίποτα και φόρτωναν άδικα τον server.
