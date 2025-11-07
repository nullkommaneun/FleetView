// errorManager.js
// Ein robuster, visueller In-App Logger.
// Fängt globale Fehler und console.log-Aufrufe ab und zeigt sie in der UI an.
// Dies ist entscheidend für das Debugging auf mobilen Geräten ohne F12-Konsole.

// DOM-Elemente für die Konsole
// HINWEIS: Diese werden sofort gesucht. Das Skript muss nach dem HTML-Body
// oder in einem 'DOMContentLoaded'-Event geladen werden. In unserem Fall
// stellt app.js sicher, dass dies erst nach DOMContentLoaded initialisiert wird.
const consoleBody = document.getElementById('console-body');
const consoleHeader = document.getElementById('console-header');
const errorConsole = document.getElementById('error-console');
const toggleButton = document.getElementById('btn-toggle-console');

// Backup der originalen Konsolenfunktionen, bevor wir sie überschreiben.
const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
};

/**
 * Fügt eine formatierte Nachricht zur visuellen Konsole im DOM hinzu.
 * @param {string} msg - Die anzuzeigende Nachricht.
 * @param {string} level - 'log', 'warn', 'error', 'info'. Dient als CSS-Klasse.
 */
function visualLog(msg, level = 'log') {
    // Failsafe: Wenn das DOM-Element aus irgendeinem Grund nicht bereit ist,
    // (z.B. bei einem sehr frühen Fehler), brechen wir ab.
    if (!consoleBody) return; 

    const entry = document.createElement('p');
    entry.className = `log-${level}`; // Für CSS-Styling (z.B. .log-error)
    
    // Zeitstempel hinzufügen für einfaches Debugging
    const time = new Date().toLocaleTimeString('de-DE');
    entry.textContent = `[${time}] ${msg}`;
    
    consoleBody.appendChild(entry);
    
    // Automatisch nach unten scrollen, um den neuesten Eintrag zu sehen
    consoleBody.scrollTop = consoleBody.scrollHeight;
}

/**
 * Macht die Konsole sichtbar. Wird typischerweise bei Fehlern aufgerufen.
 */
function showConsole() {
    if (errorConsole) {
        errorConsole.classList.remove('console-hidden');
        toggleButton.textContent = 'Minimieren';
    }
}

/**
 * Initialisiert den Error Manager.
 * Diese Funktion überschreibt globale Fehlerhandler und Konsolenfunktionen.
 * Muss als allererstes Skript in app.js aufgerufen werden.
 */
export function initErrorManager() {
    // Überprüfen, ob die UI-Elemente vorhanden sind.
    if (!errorConsole || !consoleHeader || !toggleButton || !consoleBody) {
        original.error("ErrorManager: UI-Elemente nicht gefunden. Visueller Logger kann nicht initialisiert werden.");
        return;
    }

    // 1. Globale JavaScript-Fehler abfangen (z.B. "undefined is not a function")
    window.onerror = (message, source, lineno, colno, error) => {
        const fullMessage = `[Globaler Fehler] ${message} in ${source} (Zeile: ${lineno})`;
        
        // An beide Konsolen senden:
        original.error(fullMessage, error); // An F12-Konsole
        visualLog(fullMessage, 'error');    // An UI-Konsole
        
        showConsole(); // Konsole bei Fehler automatisch öffnen
        
        // Verhindert, dass der Browser-Standard-Fehlerdialog (z.B. gelbes Dreieck) erscheint.
        return true; 
    };

    // 2. Globale Promise-Fehler abfangen (z.B. fetch-Fehler ohne .catch())
    window.onunhandledrejection = (event) => {
        const fullMessage = `[Promise-Fehler] Grund: ${event.reason}`;
        
        original.error(fullMessage, event);
        visualLog(fullMessage, 'error');
        showConsole();
    };

    // 3. Konsolenfunktionen überschreiben (Intercepting)
    // Wir leiten jeden Aufruf an die F12-Konsole UND an unsere UI-Konsole weiter.
    
    console.log = (...args) => {
        const msg = args.map(String).join(' ');
        original.log.apply(console, args); // Originale Funktion aufrufen
        visualLog(msg, 'log');
    };
    
    console.warn = (...args) => {
        const msg = args.map(String).join(' ');
        original.warn.apply(console, args);
        visualLog(msg, 'warn');
        showConsole(); // Bei Warnungen auch anzeigen
    };
    
    console.error = (...args) => {
        const msg = args.map(String).join(' ');
        original.error.apply(console, args);
        visualLog(msg, 'error');
        showConsole(); // Bei Fehlern definitiv anzeigen
    };
    
    console.info = (...args) => {
        const msg = args.map(String).join(' ');
        original.info.apply(console, args);
        visualLog(msg, 'info');
    };
    
    // 4. UI-Events für die Konsole (Minimieren/Maximieren)
    // Wir nutzen den Header als Klick-Ziel, nicht nur den Button.
    consoleHeader.addEventListener('click', () => {
        errorConsole.classList.toggle('console-hidden');
        // Text des Buttons anpassen
        const isHidden = errorConsole.classList.contains('console-hidden');
        toggleButton.textContent = isHidden ? 'Maximieren' : 'Minimieren';
    });
    
    // Verhindern, dass ein Klick auf den Button das Toggle-Event des Headers doppelt auslöst
    toggleButton.addEventListener('click', (e) => e.stopPropagation());

    console.log("Error Manager initialisiert. Alle Logs werden nun abgefangen.");
}

// Exportiere die neuen, überschriebenen Logger-Funktionen,
// damit app.js sie direkt mit 'import { log } from ...' verwenden kann.
export const log = console.log;
export const warn = console.warn;
export const error = console.error;
export const info = console.info;
