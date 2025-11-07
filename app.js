// app.js
// Haupt-Engine für BeaconBay FleetView
// Verantwortlich für Bluetooth-Logik, Zustandsverwaltung und DOM-Updates.

// 1. Module importieren
// WICHTIG: ErrorManager *zuerst* importieren und initialisieren.
// Dadurch werden auch Fehler abgefangen, die während des Imports
// anderer Module oder bei der Initialisierung von app.js auftreten.
import { initErrorManager, log, warn, error } from './errorManager.js';

// CONFIG importieren, das alle unsere Einstellungen enthält.
import { CONFIG } from './config.js';

// 2. Globaler App-Zustand (State)
// Wir verwenden eine Map für 'detectedAssets'.
// Vorteil: O(1) Zugriff, Update und Prüfung (mit .has()),
// was viel schneller ist als ein Array.find() bei vielen Geräten.
// Key: device.id (string), Value: FtsAsset (object)
const detectedAssets = new Map();
let scan = null; // Hält die Referenz zum aktiven Web Bluetooth Scan-Objekt
let tickerInterval = null; // Hält die Referenz zum UI-Update-Ticker (setInterval)

// 3. DOM-Referenzen
// Diese werden nach 'DOMContentLoaded' zugewiesen.
let btnStartScan, cockpitGrid, modal, btnCloseModal, btnSaveName;
let currentInspectedId = null; // Merkt sich, welches Asset (device.id) gerade im Modal geöffnet ist

// 4. Initialisierung der App
document.addEventListener('DOMContentLoaded', () => {
    // Zuerst den Error Manager initialisieren, damit er das DOM findet.
    initErrorManager();

    // DOM-Referenzen zuweisen
    btnStartScan = document.getElementById('btn-start-scan');
    cockpitGrid = document.getElementById('cockpit-grid');
    modal = document.getElementById('inspector-modal');
    btnCloseModal = document.getElementById('btn-close-modal');
    btnSaveName = document.getElementById('btn-save-name');
    
    // Titel aus der Konfiguration setzen
    document.getElementById('app-title').textContent = CONFIG.APP_TITLE;

    // Event-Listener registrieren
    btnStartScan.addEventListener('click', toggleScan);
    btnCloseModal.addEventListener('click', hideInspectorModal);
    btnSaveName.addEventListener('click', saveNickname);
    
    // Gespeicherte Nicknames aus dem localStorage laden (passiert im Hintergrund)
    loadNicknames();
    log("App initialisiert. Bereit für Scan.");
});

/**
 * Startet oder stoppt den BLE-Scan.
 * Wird vom 'btn-start-scan' aufgerufen.
 */
async function toggleScan() {
    // Defensives Programmieren: Prüfen, ob der Button existiert
    if (!btnStartScan) {
        error("Start-Button nicht gefunden.");
        return;
    }

    if (scan && scan.active) {
        // --- Scan stoppen ---
        try {
            scan.stop();
            log("Scan gestoppt.");
            btnStartScan.textContent = "Scan starten";
            btnStartScan.classList.remove('scanning');
            
            // Stoppt den UI-Ticker, um Ressourcen zu sparen
            if (tickerInterval) clearInterval(tickerInterval);
            tickerInterval = null;
        } catch (e) {
            error(`Fehler beim Stoppen des Scans: ${e.message}`);
        }
    } else {
        // --- Scan starten ---
        await startScan();
    }
}

/**
 * Baut die Filter-Optionen aus der config.js und startet den Web Bluetooth Scan.
 */
async function startScan() {
    log("Bluetooth-Scan wird angefordert...");
    
    // Schritt 0: Prüfen, ob Web Bluetooth überhaupt verfügbar ist.
    if (!navigator.bluetooth) {
        error("Web Bluetooth API nicht auf diesem Gerät/Browser verfügbar. (HTTPS erforderlich?)");
        return;
    }

    // Schritt 1: Filter-Optionen dynamisch aus CONFIG.FTS_PROFILES erstellen
    const filters = CONFIG.FTS_PROFILES.map(profile => {
        if (profile.type === 'service') {
            return { services: [profile.uuid] };
        }
        if (profile.type === 'manufacturer') {
            // Das Format für manufacturerData ist [{ companyIdentifier: ID }]
            return { manufacturerData: [{ companyIdentifier: profile.companyId }] };
        }
        warn(`Ungültiges Profil-Typ in config.js: ${profile.type}`);
        return null; // Ungültiges Profil
    }).filter(Boolean); // Entfernt alle 'null'-Einträge

    if (filters.length === 0) {
        error("Keine gültigen FTS-Profile in config.js definiert. Scan kann nicht starten.");
        return;
    }

    log(`Scan startet mit ${filters.length} Filtern.`);
    
    try {
        // Schritt 2: Scan anfordern
        const scanOptions = {
            ...CONFIG.SCAN_OPTIONS, // Lädt keepRepeatedDevices: true, etc.
            filters: filters        // Fügt unsere dynamischen Filter hinzu
        };
        
        scan = await navigator.bluetooth.requestLEScan(scanOptions);
        
        // Schritt 3: Event-Listener für empfangene Pakete registrieren
        navigator.bluetooth.addEventListener('advertisementreceived', handleAdvertisement);

        // UI aktualisieren
        btnStartScan.textContent = "Scan läuft... (Stoppen)";
        btnStartScan.classList.add('scanning');
        log("Scan aktiv. Warte auf FTS-Pakete...");

        // Schritt 4: UI-Ticker starten, der LEDs und "Zuletzt gesehen" aktualisiert
        if (tickerInterval) clearInterval(tickerInterval);
        tickerInterval = setInterval(updateAllAssetStatus, CONFIG.TICKER_INTERVAL_MS);

    } catch (e) {
        // Häufigster Fehler: Benutzer bricht den Scan-Dialog ab ("AbortError")
        if (e.name === 'AbortError') {
            warn("Scan-Anforderung vom Benutzer abgebrochen.");
        } else {
            error(`Scan fehlgeschlagen: ${e.message}`);
        }
        btnStartScan.textContent = "Scan starten";
        btnStartScan.classList.remove('scanning');
    }
}

/**
 * Verarbeitet jedes empfangene BLE-Paket.
 * Dies ist die "heißeste" Funktion der App und muss performant sein.
 * @param {BluetoothLEAdvertisementEvent} event - Das Event-Objekt von der API.
 */
function handleAdvertisement(event) {
    const deviceId = event.device.id;
    const rssi = event.rssi;
    const now = new Date(); // Zeitstempel der Erfassung

    // Schritt 1: Relevante Daten extrahieren (Payload & zugehöriges Profil)
    const { payload, profile } = extractRelevantPayload(event);
    
    // Ignorieren, falls das Paket zwar dem Filter entsprach, wir aber 
    // die spezifischen Daten (Service/Manufacturer) nicht finden/dekodieren können.
    if (!payload) return; 

    // Schritt 2: Prüfen, ob Asset neu ist oder aktualisiert wird
    const existingAsset = detectedAssets.get(deviceId);

    if (existingAsset) {
        // ---- UPDATE eines bekannten Assets ----
        existingAsset.rssi = rssi;
        existingAsset.lastSeen = now;
        existingAsset.payload = payload; // Immer den neusten Payload speichern
        
        // RSSI-Verlauf für Inspektor speichern (nur die letzten 20)
        existingAsset.rssiHistory.push(rssi);
        if (existingAsset.rssiHistory.length > 20) {
            existingAsset.rssiHistory.shift(); // Ältesten Wert entfernen
        }
        
        // DOM-Element (Kachel) aktualisieren
        updateFtsTile(existingAsset);
    } else {
        // ---- NEUES Asset entdeckt ----
        log(`Neues FTS erkannt: ID ${deviceId.substring(0, 8)}... (${profile.profileName})`);
        
        const newAsset = {
            id: deviceId,
            rssi: rssi,
            lastSeen: now,
            payload: payload,
            profileName: profile.profileName,
            name: "Unbenanntes FTS", // Standard-Nickname
            rssiHistory: [rssi], // Verlauf initialisieren
            domElement: null // Referenz auf die Kachel (wird gleich gesetzt)
        };
        
        // Gespeicherten Nickname laden, falls vorhanden
        const savedName = localStorage.getItem(`nickname_${deviceId}`);
        if (savedName) newAsset.name = savedName;
        
        // Neues Asset im State speichern
        detectedAssets.set(deviceId, newAsset);
        
        // DOM-Element (Kachel) neu erstellen
        createFtsTile(newAsset);
    }
}

/**
 * Sucht im Advertisement-Event nach den Payloads, die zu unseren Profilen passen.
 * @param {BluetoothLEAdvertisementEvent} event
 * @returns {object} - { payload: "0x...", profile: { ... } } oder { payload: null }
 */
function extractRelevantPayload(event) {
    for (const profile of CONFIG.FTS_PROFILES) {
        try {
            if (profile.type === 'service' && event.serviceData.has(profile.uuid)) {
                return { 
                    payload: dataViewToHexString(event.serviceData.get(profile.uuid)),
                    profile: profile 
                };
            }
            if (profile.type === 'manufacturer' && event.manufacturerData.has(profile.companyId)) {
                return { 
                    payload: dataViewToHexString(event.manufacturerData.get(profile.companyId)),
                    profile: profile 
                };
            }
        } catch (e) {
            warn(`Fehler beim Extrahieren der Payload für ${profile.profileName}: ${e.message}`);
        }
    }
    // Nichts gefunden, was zu unseren Profilen passt
    return { payload: null, profile: null };
}

/**
 * Erstellt eine neue FTS-Kachel im DOM und fügt sie dem Grid hinzu.
 * @param {object} asset - Das FtsAsset-Objekt aus 'detectedAssets'.
 */
function createFtsTile(asset) {
    const tile = document.createElement('div');
    tile.className = 'fts-tile';
    tile.dataset.deviceId = asset.id; // Wichtig, um die Kachel später wiederzufinden

    // Wir nutzen innerHTML für eine einfache und schnelle Erstellung der Kachelstruktur.
    // Selektoren werden für spätere Updates gespeichert.
    tile.innerHTML = `
        <div class="tile-header">
            <span class="led"></span>
            <span class="tile-name">${asset.name}</span>
        </div>
        <div class="tile-body">
            <div class="rssi-display">
                <span class="rssi-value">...</span>
                <span class="rssi-unit">dBm</span>
            </div>
            <div class="rssi-bar-wrapper">
                <div class="rssi-bar"></div>
            </div>
        </div>
        <div class="tile-footer">
            <span class="tile-payload-preview">...</span>
            <span class="tile-last-seen">...</span>
        </div>
    `;

    // Klick-Event für Inspektor hinzufügen
    tile.addEventListener('click', () => showInspectorModal(asset.id));

    // Wichtige DOM-Knoten der Kachel im Asset-Objekt speichern.
    // Dies vermeidet ständige 'querySelector'-Aufrufe in 'updateFtsTile'.
    asset.dom = {
        tile: tile,
        led: tile.querySelector('.led'),
        name: tile.querySelector('.tile-name'),
        rssiValue: tile.querySelector('.rssi-value'),
        rssiBar: tile.querySelector('.rssi-bar'),
        payload: tile.querySelector('.tile-payload-preview'),
        lastSeen: tile.querySelector('.tile-last-seen')
    };

    cockpitGrid.appendChild(tile);
    
    // Direkt nach Erstellung das erste Mal aktualisieren
    updateFtsTile(asset);
    updateSingleAssetStatus(asset); // Auch den Status sofort setzen
}

/**
 * Aktualisiert eine bestehende FTS-Kachel im DOM mit den neuesten Daten.
 * Diese Funktion wird sehr häufig aufgerufen (bei jedem Paket).
 * @param {object} asset - Das FtsAsset-Objekt.
 */
function updateFtsTile(asset) {
    // Defensives Programmieren: Prüfen, ob DOM-Referenzen existieren
    if (!asset.dom) return;

    // 1. RSSI-Wert und Balken aktualisieren
    asset.dom.rssiValue.textContent = asset.rssi;
    
    // RSSI (-100 bis -30) in Prozent (0-100) umrechnen für den Balken
    // (Annahme: -100 ist 0%, -30 ist 100%. Bereich = 70)
    const percent = Math.max(0, Math.min(100, (asset.rssi + 100) / 70 * 100));
    asset.dom.rssiBar.style.width = `${percent}%`;
    
    // Balken-Farbe basierend auf Konfiguration ändern
    const rssiConfig = CONFIG.RSSI_STATUS;
    let rssiClass = 'rssi-medium';
    if (asset.rssi > rssiConfig.STRONG) {
        rssiClass = 'rssi-strong';
    } else if (asset.rssi < rssiConfig.WEAK) {
        rssiClass = 'rssi-weak';
    }
    // SetProperty ist performanter als className, wenn sich nur eine Klasse ändert
    asset.dom.rssiBar.className = `rssi-bar ${rssiClass}`;

    // 2. Nickname aktualisieren (falls im Modal geändert)
    if (asset.dom.name.textContent !== asset.name) {
        asset.dom.name.textContent = asset.name;
    }
    
    // 3. Payload-Vorschau aktualisieren (nur die ersten 20 Zeichen)
    asset.dom.payload.textContent = `${asset.payload.substring(0, 20)}...`;

    // 4. Status-LED und Zeitstempel
    // Diese werden jetzt vom 'updateAllAssetStatus'-Ticker separat aktualisiert,
    // um die Performance in 'handleAdvertisement' zu verbessern.
    // Wir rufen es hier nur einmalig auf, damit die Kachel sofort den richtigen Status hat.
    updateSingleAssetStatus(asset, new Date().getTime());
}

/**
 * Periodischer Ticker, der "Zuletzt gesehen" und LED-Status *aller* Kacheln aktualisiert.
 * Läuft alle TICKER_INTERVAL_MS (z.B. alle 2 Sek.).
 */
function updateAllAssetStatus() {
    const now = new Date().getTime();
    
    // Iteriert über alle erkannten Assets in der Map
    for (const asset of detectedAssets.values()) {
        updateSingleAssetStatus(asset, now);
    }
}

/**
 * Aktualisiert den Zeit/LED-Status für ein *einzelnes* Asset.
 * @param {object} asset - Das FtsAsset-Objekt
 * @param {number} [now] - Optionaler Zeitstempel (wird vom Ticker übergeben)
 */
function updateSingleAssetStatus(asset, now = new Date().getTime()) {
    if (!asset.dom) return; // Kachel noch nicht gezeichnet

    const diffMs = now - asset.lastSeen.getTime();
    const diffSec = Math.round(diffMs / 1000);

    const ledConfig = CONFIG.LED_STATUS;
    let ledClass = 'led-red'; // Standard: Signal verloren
    let lastSeenText = `verloren (>${ledConfig.INACTIVE_MS / 1000}s)`;

    if (diffMs < ledConfig.ACTIVE_MS) {
        ledClass = 'led-green';
        lastSeenText = diffSec === 0 ? "gerade eben" : `vor ${diffSec}s`;
    } else if (diffMs < ledConfig.INACTIVE_MS) {
        ledClass = 'led-yellow';
        lastSeenText = `vor ${diffSec}s`;
    }
    
    asset.dom.led.className = `led ${ledClass}`;
    asset.dom.lastSeen.textContent = lastSeenText;
}


// 5. Modal-Logik (Inspektions-Ansicht)

/**
 * Öffnet das Inspektor-Modal und füllt es mit den Daten des gewählten Assets.
 * @param {string} deviceId - Die ID des Assets, das inspiziert werden soll.
 */
function showInspectorModal(deviceId) {
    const asset = detectedAssets.get(deviceId);
    if (!asset) {
        warn(`Asset ${deviceId} für Modal nicht im State gefunden.`);
        return;
    }
    
    currentInspectedId = deviceId; // ID für den Speicher-Button merken
    
    log(`Inspektor geöffnet für: ${asset.name} (${asset.id})`);

    // Modal mit Daten füllen
    document.getElementById('inspector-name').value = asset.name;
    document.getElementById('inspector-id').textContent = asset.id;
    document.getElementById('inspector-payload').textContent = asset.payload;
    
    // RSSI-Verlauf als Text anzeigen (neueste Werte zuletzt)
    document.getElementById('inspector-rssi-history').textContent = asset.rssiHistory.join(', ');

    // Modal anzeigen
    modal.classList.remove('modal-hidden');
}

/**
 * Schließt das Inspektor-Modal.
 */
function hideInspectorModal() {
    modal.classList.add('modal-hidden');
    currentInspectedId = null; // Gemerkte ID zurücksetzen
    log("Inspektor geschlossen.");
}

/**
 * Speichert den geänderten Nickname im localStorage UND im App-State.
 */
function saveNickname() {
    if (!currentInspectedId) return;

    const asset = detectedAssets.get(currentInspectedId);
    if (!asset) return;

    const newName = document.getElementById('inspector-name').value;
    
    // Nur speichern, wenn der Name nicht leer ist
    if (newName && newName.trim() !== "") {
        asset.name = newName.trim();
        
        // Persistenz: Wir speichern den Namen im localStorage,
        // damit er beim nächsten App-Start wieder da ist.
        try {
            localStorage.setItem(`nickname_${asset.id}`, asset.name);
            log(`Nickname für ${asset.id} gespeichert als: ${asset.name}`);
        } catch (e) {
            // Kann fehlschlagen, wenn localStorage voll ist oder (im privaten Modus)
            error(`Speichern des Nicknames fehlgeschlagen: ${e.message}`);
        }
        
        // Kachel im Hintergrund sofort aktualisieren
        updateFtsTile(asset);
        hideInspectorModal();
    } else {
        warn("Speichern fehlgeschlagen: Nickname darf nicht leer sein.");
    }
}

/**
 * Lädt beim Start alle gespeicherten Nicknames.
 * Diese Funktion wird nur beim Laden der App aufgerufen.
 * Die Nicknames werden dann in 'handleAdvertisement' angewendet,
 * wenn das Asset *zum ersten Mal* gesehen wird.
 */
function loadNicknames() {
    // Diese Funktion muss nichts aktiv tun, außer zu loggen.
    // Der eigentliche Ladevorgang ('localStorage.getItem') findet
    // in 'handleAdvertisement' statt, wenn ein *neues* Gerät entdeckt wird.
    log("Lade gespeicherte Nicknames aus localStorage (passiv)...");
}


// 6. Hilfsfunktionen

/**
 * Wandelt ein DataView-Objekt (von der BLE API) in einen
 * lesbaren, formatierten Hex-String um.
 * @param {DataView} dataView - Der Roh-Payload.
 * @returns {string} - z.B. "0x04 37 4E 31..." oder "N/A"
 */
function dataViewToHexString(dataView) {
    if (!dataView || dataView.byteLength === 0) {
        return "N/A (leere Payload)";
    }
    
    let hexString = "0x";
    for (let i = 0; i < dataView.byteLength; i++) {
        let byte = dataView.getUint8(i).toString(16).toUpperCase();
        // Sicherstellen, dass jeder Byte-Wert zweistellig ist (z.B. 0F statt F)
        hexString += (byte.length === 1 ? '0' : '') + byte + ' ';
    }
    return hexString.trim(); // Leerzeichen am Ende entfernen
}
