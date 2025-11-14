// wa_router.js - Der Haupt-Controller mit WhatsApp-Integration

require("dotenv").config(); // Konfig aus .env laden
const fs = require('fs/promises');
const fsn = require('fs'); // Für synchronous file checks
const path = require('path');
const qrcode = require("qrcode-terminal"); // Für QR-Code Anzeige
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js"); // WhatsApp Client

// Importiere Logik von den Modulen
const { createOfferMessage } = require('./offer_message');
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
const SESSION_PATH = process.env.SESSION_PATH || "./session-data"; 
const CLIENT_ID = process.env.CLIENT_ID || "sport-bot-1";

const RECIPIENT = process.env.RECIPIENT || ""; // 4917...
const GROUP_NAME = process.env.GROUP_NAME || "Test"; // "Meine Sport Community"

// Verwenden Sie eine globale Variable für den Client
let client; 
let initialized = false;
let reconnectTimer = null;

// ===== Utils (aus index.js übernommen) =====
function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    // Beachten Sie: Die Log-Funktion erfordert 'path' und 'fs' (non-promises)
    fsn.appendFile(path.resolve("./logs/wa.log"), line + "\n", () => {});
}

function ensureDir(p) {
    try {
        fsn.mkdirSync(p, { recursive: true });
    } catch {}
}

function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
}
// ===========================================

// --- WHATSAPP-FUNKTIONEN (aus index.js übernommen) ---

async function initializeSafe() {
    try {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        log("🚀 Initialisiere Client…");
        
        ensureDir(SESSION_PATH);
        ensureDir(path.resolve("./logs"));
        log(`🔒 Session-Ordner: ${SESSION_PATH}`);
        log(`🪪 Client-ID: ${CLIENT_ID}`);

        // Client anlegen
        client = new Client({
            authStrategy: new LocalAuth({
                dataPath: SESSION_PATH,
                clientId: CLIENT_ID,
            }),
            puppeteer: {
                headless: true, 
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-extensions",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-features=FirstPartySets",
                ],
            },
            takeoverOnConflict: true,
            takeoverTimeoutMs: 60_000,
        });

        // Events registrieren
        client.on("qr", (qr) => {
            console.clear();
            log("🔐 QR-Code – scanne in WhatsApp > Verknüpfte Geräte");
            qrcode.generate(qr, { small: true });
        });
        client.on("authenticated", () => log("✅ Authentifiziert (Cookies geladen)."));
        client.on("auth_failure", (m) => log("❌ Auth-Fehler: " + m));
        client.on("ready", async () => {
            log("✅ WhatsApp bereit.");
            if (!initialized) {
                initialized = true;
                await waitForChatsLoaded(); // Wichtig: Chats müssen geladen sein, bevor Gruppen/Kontakte aufgelöst werden können.
                log("🔄 WhatsApp-Integration ist aktiv und bereit zum Versenden.");
            }
        });
        client.on("disconnected", (reason) => {
            log("⚠️ Disconnected: " + reason);
            scheduleReconnect();
        });
        client.on("change_state", (state) => log("ℹ️ State: " + state));
        client.on("loading_screen", (percent, msg) => {
            log(`⌛ Loading: ${percent}% - ${msg}`);
        });

        await client.initialize();

    } catch (e) {
        log("❌ Initialize-Fehler: " + (e?.message || e));
        scheduleReconnect(10_000);
    }
}

function scheduleReconnect(delayMs = 5_000) {
    if (reconnectTimer) return;
    log(`🔁 Reconnect in ${delayMs / 1000}s geplant…`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        initializeSafe();
    }, delayMs);
}

async function waitForChatsLoaded(timeoutMs = 30_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        // client.getChats() kann fehlschlagen, wenn noch nicht bereit
        const chats = await client.getChats().catch(() => []); 
        if (chats && chats.length > 0) {
            const groups = chats.filter((c) => c.isGroup);
            log(`📚 Chats: ${chats.length} (Gruppen: ${groups.length})`);
            return;
        }
        await sleep(500);
    }
    // Werfen Sie keinen Fehler, sondern protokollieren Sie es. Der Client ist wahrscheinlich trotzdem in Ordnung, aber die Adressauflösung kann fehlschlagen.
    log("⚠️ Warnung: Chats wurden nicht rechtzeitig geladen. Die Adressauflösung kann fehlschlagen."); 
}

async function resolveDestination() {
    if (!initialized) {
        throw new Error("WhatsApp Client ist noch nicht initialisiert oder bereit.");
    }
    if (GROUP_NAME && GROUP_NAME.trim()) {
        const chats = await client.getChats();
        const needle = GROUP_NAME.trim().toLowerCase();
        const exact = chats.find(
          (c) => c.isGroup && c.name && c.name.trim().toLowerCase() === needle
        );
        if (exact) return exact.id._serialized; // z.B. 12345@g.us

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
    return `${phone}@c.us`; // z.B. 4917012345678@c.us
}

/**
 * Sendet das Bild und die formatierte Nachricht.
 * @param {string} localImagePath - Der lokale Pfad zum Bild.
 * @param {string} captionText - Der Text für die Bildunterschrift.
 */
async function sendImageWithCaption(localImagePath, captionText) {
    if (!localImagePath || !fsn.existsSync(localImagePath)) {
        throw new Error(`Bild nicht gefunden/heruntergeladen: ${localImagePath}`);
    }
    
    // 1. Zieladresse auflösen
    const to = await resolveDestination();
    
    // 2. Medium erstellen
    const media = MessageMedia.fromFilePath(localImagePath); //
    
    // 3. Nachricht senden
    await client.sendMessage(to, media, { caption: captionText }); //
    log(`📤 Gesendet an ${to} (Bild & Caption)`);
}

// --- HAUPTROUTING-LOGIK ---

/**
 * Kernfunktion: Verarbeitet eine neue JSON-Datei. Wird vom Watcher aufgerufen.
 * @param {string} fullPath - Der vollständige Pfad zur neuen Datei.
 */
async function routeNewOffer(fullPath) {
    const fileName = path.basename(fullPath);
    log(`\n[ROUTER-EVENT] Neue Datei erkannt: ${fileName}`);

    if (!initialized) {
        log('[WARNUNG] WhatsApp ist noch nicht bereit. Überspringe Verarbeitung.');
        return;
    }

    // Nur .json Dateien verarbeiten
    if (path.extname(fileName).toLowerCase() !== '.json') return;
    
    const productId = fileName.replace('.json', '');
    const sentDeals = await getSentDeals();

    if (sentDeals.includes(productId)) {
        log(`[INFO] Deal ${productId} wurde bereits gesendet. Überspringe.`);
        return;
    }

    let localImagePath = null; // Muss außerhalb von try/catch deklariert werden
    
    try {
        // 1. Datei lesen und parsen
        const fileContent = await fs.readFile(fullPath, 'utf-8');
        const dealData = JSON.parse(fileContent);
        
        // 2. Bild herunterladen (Funktion aus watcher.js)
        const imageUrl = dealData.images?.[0];
        localImagePath = await downloadImage(imageUrl, productId);
        
        // 3. Nachricht formatieren (Funktion aus offer_message.js)
        const offerMessage = createOfferMessage(dealData, localImagePath);
        
        // 4. Nachricht auf der Konsole ausgeben
        log('--- Konsolen-Vorschau (WhatsApp-Format) ---');
        log(offerMessage);
        log('--- Ende der Vorschau ---');

        // 5. Nachricht via WhatsApp senden
        // Hier verwenden wir nur den reinen Text-Teil der Nachricht als Caption
        const captionText = offerMessage
            .split('🖼️ **BILD-STATUS**')[0] // Text vor dem Bild-Status
            .trim();
            
        await sendImageWithCaption(localImagePath, captionText);

        // 6. Deal als "gesendet" markieren (Funktion aus watcher.js)
        await addSentDeal(productId);
        
    } catch (error) {
        log(`❌ [FEHLER] Konnte Datei ${fileName} nicht verarbeiten/routen: ${error.message}`);
    } finally {
        // Optional: Nach erfolgreichem Versand das Bild löschen, um Speicherplatz zu sparen
        if (localImagePath && fsn.existsSync(localImagePath)) {
            // await fs.unlink(localImagePath).catch(e => log(`[INFO] Konnte Bild ${localImagePath} nicht löschen: ${e.message}`));
        }
    }
}

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

// Start des Routers beim Ausführen der Datei
startWaRouter();

// WICHTIG: kein logout()/destroy() am Ende!
// Prozess mit Ctrl+C beenden. Das lässt die Session-Dateien intakt.