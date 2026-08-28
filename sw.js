<script>
    // Base URL του OpenData API του ΚΗΜΔΗΣ
    const API_BASE_URL = 'https://cerpp.eprocurement.gov.gr/khmdhs-opendata/api/v1';

    // Endpoints βάσει σταδίου
    const endpoints = {
        primary: '/primaryRequests',
        approved: '/approvedRequests',
        tender: '/callsForTender',
        contract: '/contracts',
        payment: '/payments'
    };

    async function fetchMetadata(stage) {
        const adam = document.getElementById('adamInput').value.trim();
        const resultsDiv = document.getElementById('results');

        if (!adam) {
            resultsDiv.innerHTML = '<p class="error" style="text-align: center;">Παρακαλώ εισάγετε έναν έγκυρο ΑΔΑΜ.</p>';
            return;
        }

        resultsDiv.innerHTML = '<p class="loading">Ανάκτηση δεδομένων από το ΚΗΜΔΗΣ...</p>';

        // Το πραγματικό URL του ΚΗΜΔΗΣ
        const targetUrl = `${API_BASE_URL}${endpoints[stage]}/${encodeURIComponent(adam)}`;
        
        // Χρήση του AllOrigins ως CORS Proxy για να μην μας μπλοκάρει ο browser
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;

        try {
            // Χτυπάμε τον proxy αντί για το ΚΗΜΔΗΣ απευθείας
            const response = await fetch(proxyUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error(`Δεν βρέθηκε εγγραφή με ΑΔΑΜ "${adam}" στο στάδιο που επιλέξατε. Βεβαιωθείτε ότι ο ΑΔΑΜ ανήκει σε αυτό το στάδιο.`);
                }
                const errorText = await response.text();
                throw new Error(`Σφάλμα Server (Κωδικός: ${response.status}). <br>Μήνυμα: ${errorText}`);
            }

            const data = await response.json();

            if (!data || Object.keys(data).length === 0) {
                resultsDiv.innerHTML = '<p class="error" style="text-align: center;">Η απάντηση ήταν άδεια. Δεν υπάρχουν δεδομένα.</p>';
                return;
            }

            resultsDiv.innerHTML = `<ul class="json-tree">${buildJsonTree(data)}</ul>`;

        } catch (error) {
            console.error("Σφάλμα:", error);
            resultsDiv.innerHTML = `
                <p class="error">Υπήρξε σφάλμα:</p>
                <div class="debug-info">
                    ${error.message}<br><br>
                    <strong>URL που ζητήθηκε:</strong> ${targetUrl}
                </div>
            `;
        }
    }

    // Συνάρτηση μετατροπής JSON σε καθαρή HTML δομή
    function buildJsonTree(obj) {
        if (obj === null) return '<span class="json-null">null</span>';
        
        if (typeof obj !== 'object') {
            if (typeof obj === 'string') return `<span class="json-string">"${obj}"</span>`;
            if (typeof obj === 'number') return `<span class="json-number">${obj}</span>`;
            if (typeof obj === 'boolean') return `<span class="json-boolean">${obj}</span>`;
            return `<span>${obj}</span>`;
        }

        let html = '';
        const isArray = Array.isArray(obj);

        for (let key in obj) {
            if (obj.hasOwnProperty(key)) {
                const value = obj[key];
                const displayKey = isArray ? `[${key}]` : key;
                
                html += `<li>`;
                html += `<span class="json-key">${displayKey}:</span> `;
                
                if (typeof value === 'object' && value !== null) {
                    html += `<ul class="json-tree">${buildJsonTree(value)}</ul>`;
                } else {
                    html += buildJsonTree(value);
                }
                html += `</li>`;
            }
        }
        return html;
    }
</script>