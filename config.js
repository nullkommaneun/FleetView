// config.js
// Enthält alle globalen Einstellungen für die FleetView-App.
// Dies ist die zentrale Steuerzentrale für die App.

export const CONFIG = {
    // 1. App-Verhalten
    APP_TITLE: "BeaconBay FleetView",
    // Intervall (in Millisekunden), in dem die UI den Status (LED, 'Zuletzt gesehen')
    // für alle Kacheln überprüft und aktualisiert.
    TICKER_INTERVAL_MS: 2000, // 2 Sekunden

    // 2. FTS Asset-Profile (Das "Gehirn" des Filters)
    // Diese Liste definiert, welche Geräte als FTS (Fahrerloses Transport-System)
    // erkannt und in der App angezeigt werden sollen.
    FTS_PROFILES: [
        {
            profileName: "FTS-Gruppe Ladestation (Typ A)",
            type: 'service', // Filtert nach einer bestimmten Service-UUID
            uuid: '0xfcf1' // Beispiel: Kurzform für 0000fcf1-0000-1000-8000-00805f9b34fb
        },
        {
            profileName: "FTS 'M.' (Typ B)",
            type: 'manufacturer', // Filtert nach einer Hersteller-ID
            companyId: 0xa212 // Beispiel: Eine fiktive Hersteller-ID
        }
    ],

    // 3. UI-Schwellenwerte (Für die Kachel-Optik)
    RSSI_STATUS: {
        // RSSI (Received Signal Strength Indicator) in dBm.
        // Stärker als dieser Wert = Grün (Stark)
        STRONG: -75,
        // Schwächer als dieser Wert = Rot/Orange (Schwach)
        WEAK: -88
        // Alles dazwischen wird als "Mittel" (Gelb) eingestuft.
    },

    LED_STATUS: {
        // Definiert die Farben der "Aktivitäts-LED" auf der Kachel.
        // Gesehen in den letzten X Millisekunden = Grün (Aktiv)
        ACTIVE_MS: 5000,    // 5 Sekunden
        // Gesehen in den letzten Y Millisekunden = Gelb (Inaktiv)
        INACTIVE_MS: 30000  // 30 Sekunden
        // Älter als INACTIVE_MS = Rot (Signal verloren)
    },
    
    // 4. Bluetooth Scan-Optionen
    // Diese Optionen werden direkt an navigator.bluetooth.requestLEScan() übergeben.
    SCAN_OPTIONS: {
        // Wichtig: true, damit wir 'advertisementreceived' kontinuierlich
        // für RSSI-Updates desselben Geräts erhalten.
        keepRepeatedDevices: true,
        
        // Wichtig: false. Wir wollen NUR Geräte, die unseren Filtern entsprechen.
        // Die Filter selbst werden dynamisch in app.js aus FTS_PROFILES generiert.
        acceptAllAdvertisements: false 
    }
};
 
