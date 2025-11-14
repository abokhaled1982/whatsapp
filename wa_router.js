// wa_router.js - Der Haupt-Controller mit WhatsApp-Integration

require("dotenv").config(); // Konfig aus .env laden
const fs = require('fs/promises');
const fsn = require('fs'); // Für synchronous file checks
const path = require('path');
const qrcode = require("qrcode-terminal"); // Für QR-Code Anzeige
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js"); // WhatsApp Client

// Importiere Logik von den Modulen
const { createOfferMessage } = require('./offer_message');
const { ensureWhatsappWidth } = require('./image_padding'); 
const { 
    startWatcher, 
    downloadImage, 
    getSentDeals, 
    addSentDeal, 
    ensureImageFolderExists,
    WATCH_FOLDER,
    IMAGE_DOWNLOAD_FOLDER,
    SENT_FILE_PATH
} = require('./watcher'); 

// --- WHATSAPP KONFIGURATION aus .env / index.js übernommen ---
// PFAD-KORREKTUR: Nutzt relative Pfade
const SESSION_PATH = process.env.SESSION_PATH || "./session-data"; 
const CLIENT_ID = process.env.CLIENT_ID || "sport-bot-1";
const RECIPIENT = process.env.RECIPIENT || ""; // 4917...
const GROUP_NAME = process.env.GROUP_NAME || "Test"; // "Meine Sport Community"

// Verwenden Sie eine globale Variable für den Client
let client; 
let initialized = false;
let reconnectTimer = null;

// ====================================================================
// ===== Utils (aus index.js übernommen) =====
// ====================================================================

function log(msg) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${msg}`);
}

function ensureDir(p) {
    try {
        if (!fsn.existsSync(p)) {
            fsn.mkdirSync(p, { recursive: true });
        }
    } catch (e) {
        console.error(`[ERROR] Konnte Ordner nicht erstellen: ${p}`, e);
    }
}

// ===== Vorbereitungen =====
ensureDir(SESSION_PATH);
ensureDir(path.resolve("./logs"));


// ====================================================================
// ===== WHATSAPP SENDELOGIK =====
// ====================================================================

/**
 * Löst die Zieladresse (Nummer oder Gruppen-ID) auf.
 */
async function resolveDestination() {
    if (GROUP_NAME) {
        const needle = GROUP_NAME.toLowerCase();
        // Gibt eine Liste aller Chats zurück
        const chats = await client.getChats();
        const group = chats.find(
            (c) => c.isGroup && c.name && c.name.toLowerCase() === needle
        );

        if (group) {
            return group.id._serialized;
        }

        const similar = chats
            .filter(
                (c) => c.isGroup && c.name && c.name.toLowerCase().includes(needle)
            )
            .slice(0, 10)
            .map((c) => c.name);
        
        if (similar.length) {
            throw new Error(
                `Gruppe "${GROUP_NAME}" nicht exakt gefunden. Ähnlich: ${similar.join(
                    " | "
                )}`
            );
        }
        throw new Error(`Gruppe "${GROUP_NAME}" nicht gefunden.`);
    }

    if (!RECIPIENT) {
        throw new Error("Weder GROUP_NAME noch RECIPIENT in .env gesetzt.");
    }
    const phone = RECIPIENT.replace(/\D/g, "");
    if (!phone)
        throw new Error(
            "RECIPIENT muss nur Ziffern enthalten (Ländervorwahl ohne +)."
        );
    // WhatsApp-Format für Einzelchat
    return `${phone}@c.us`; 
}

/**
 * Sendet ein lokal gespeichertes Bild mit einer Bildunterschrift.
 * @param {string} imagePath - Lokaler Pfad zum Bild.
 * @param {string} caption - Der Nachrichtentext.
 */
async function sendImageWithCaption(imagePath, caption) {
    if (!fsn.existsSync(imagePath)) {
        throw new Error(`Bild nicht gefunden: ${imagePath}`);
    }
    const to = await resolveDestination();
    // MessageMedia erstellt die nötige Datenstruktur für WhatsApp
    const media = MessageMedia.fromFilePath(imagePath); 
    
    await client.sendMessage(to, media, { caption: caption });
    log(`📤 Angebot erfolgreich gesendet an ${to} (${path.basename(imagePath)})`);
}

// ====================================================================
// ===== WHATSAPP CLIENT INITIALISIERUNG / RECONNECT =====
// ====================================================================

/**
 * Initialisiert den Client und startet den Reconnect-Mechanismus.
 */
async function initializeSafe() {
    if (initialized) return;

    client = new Client({
        authStrategy: new LocalAuth({
            dataPath: SESSION_PATH, // fester Pfad -> Session bleibt
            clientId: CLIENT_ID,
        }),
        puppeteer: {
            // Empfohlen, um unter Linux/Headless zu funktionieren:
            args: ['--no-sandbox', '--disable-setuid-sandbox'], 
        },
        // timeout-Einstellungen für mehr Robustheit
        qrMaxRetries: 3, 
        takeoverOnConflict: true,
    });

    client.on("qr", (qr) => {
        // QR-Code im Terminal anzeigen
        qrcode.generate(qr, { small: true });
        log("🔑 QR-Code erhalten. Bitte scannen Sie ihn.");
    });

    client.on("authenticated", () => {
        log("✅ Authentifiziert!");
    });

    client.on("ready", () => {
        initialized = true;
        log("🟢 WhatsApp Client ist bereit!");
    });
    
    client.on('auth_failure', (msg) => {
        // Der Client konnte die Session nicht laden
        log(`❌ Authentifizierungsfehler: ${msg}`);
        // WICHTIG: Erneuter Start notwendig
        process.exit(1);
    });
    
    client.on('disconnected', (reason) => {
        initialized = false;
        log(`🔴 Verbindung getrennt: ${reason}. Versuche Reconnect in 30s...`);
        // Verzögerter Reconnect-Versuch (nur ein Timer zur Zeit)
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
            log("🔄 Starte Reconnect-Versuch...");
            client.initialize(); 
        }, 30000);
    });

    try {
        await client.initialize();
    } catch (e) {
        log(`Fataler Fehler beim Initialisieren: ${e.message}`);
        process.exit(1);
    }
}

// ====================================================================
// ===== HAUPT-ROUTING LOGIK =====
// ====================================================================

/**
 * Routet die neu erkannte Angebotsdatei zum WhatsApp-Versand.
 */
async function routeNewOffer(fullPath) {
    const fileName = path.basename(fullPath);
    let localImagePath = null; // Muss im finally-Block verfügbar sein
    
    // 1. Prüfen, ob schon gesendet
    const productId = fileName.replace(path.extname(fileName), '');
    const sentDeals = await getSentDeals();
    
    if (sentDeals.includes(productId)) {
        log(`⏭️ Deal ${productId} (${fileName}) wurde bereits gesendet. Überspringe.`);
        return; 
    }

    log(`🔔 Neue Datei erkannt: ${fileName}. Starte Verarbeitung...`);

    try {
        // 2. Datei einlesen und parsen
        const content = await fs.readFile(fullPath, 'utf8');
        const data = JSON.parse(content);
        
        // --- NEUE LOGIK: Bild-URL extrahieren (unterstützt image_url ODER images[0]) ---
        let imageUrl = data.image_url;
        if (!imageUrl && data.images && Array.isArray(data.images) && data.images.length > 0) {
            imageUrl = data.images[0]; // Wählt das erste Bild aus dem Array
        }

        // 3. Grundlegende Datenprüfung
        // WICHTIG: Prüft jetzt auf die NEUE `imageUrl` Variable
        if (!imageUrl || !data.title || !data.affiliate_url) {
            log(`❌ [FEHLER] Datei ${fileName} ist unvollständig (Bild-URL, Titel oder Link fehlt).`);
            log(`Details: URL: ${!!imageUrl}, Titel: ${!!data.title}, Link: ${!!data.affiliate_url}`);
            return;
        }

        // 4. Bild herunterladen (lokaler Pfad wird zurückgegeben)
        localImagePath = await downloadImage(imageUrl, productId); // Nutzt die extrahierte URL

        if (!localImagePath) {
            log(`❌ [FEHLER] Konnte kein Bild für ${productId} herunterladen. Überspringe.`);
            return;
        }

        // 💡 Bild verarbeiten (Padding hinzufügen, falls hochkant)
        try {
            const paddedPath = await ensureWhatsappWidth(localImagePath, {
                // Weißen Hintergrund setzen, da JPEG keine Transparenz unterstützt
                background: { r: 255, g: 255, b: 255, alpha: 1 } 
            });

            // Wenn ein neues, gepaddetes Bild erstellt wurde
            if (paddedPath !== localImagePath) {
                // Lösche das Originalbild, um Speicherplatz zu sparen
                await fs.unlink(localImagePath).catch(e => log(`[INFO] Konnte Originalbild ${localImagePath} nicht löschen: ${e.message}`));
                localImagePath = paddedPath;
            }
        } catch (e) {
            log(`⚠️ [PADDING-FEHLER] Bild-Padding fehlgeschlagen: ${e.message}. Sende Originalbild.`);
            // Bei Fehler senden wir einfach das (möglicherweise schmale) Originalbild weiter
        }
        
        // 5. Nachricht zusammenstellen
        const captionText = createOfferMessage(data)
            .trim();
            
        await sendImageWithCaption(localImagePath, captionText);

        // 6. Deal als "gesendet" markieren (Funktion aus watcher.js)
        await addSentDeal(productId);
        
    } catch (error) {
        log(`❌ [FEHLER] Konnte Datei ${fileName} nicht verarbeiten/routen: ${error.message}`);
    } finally {
        // Aufräumlogik...
        if (localImagePath && fsn.existsSync(localImagePath)) {
            // Wenn Sie die Bilder nach dem Senden löschen möchten, kommentieren Sie die folgende Zeile ein:
            // await fs.unlink(localImagePath).catch(e => log(`[INFO] Konnte Bild ${localImagePath} nicht löschen: ${e.message}`));
        }
    }
}

// ====================================================================
// ===== CONTROLLER START =====
// ====================================================================

/**
 * Startet den WhatsApp Router (den Controller).
 */
async function startWaRouter() {
    // 1. Setup: Stellt sicher, dass der Bilder-Ordner existiert (Funktion aus watcher.js)
    await ensureImageFolderExists();
    
    log(`Controller aktiv. Überwache Ordner: ${WATCH_FOLDER}`);
    log(`Bilder werden nach: ${IMAGE_DOWNLOAD_FOLDER} heruntergeladen.`);
    log(`Sent-Liste: ${SENT_FILE_PATH}`);

    // 2. WhatsApp Client initialisieren und auf Ready warten
    await initializeSafe(); 

    // 3. Startet den Watcher und registriert die Router-Funktion als Callback
    startWatcher(routeNewOffer);
}

// Start den Prozess
startWaRouter();