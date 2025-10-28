// watcher.js - FINAL VERSION mit User-Agent-Header

const chokidar = require('chokidar');
const fsp = require('fs/promises'); 
const fs = require('fs'); 
const path = require('path');
const axios = require('axios');

// --- KONFIGURATION ---
const WATCH_FOLDER = 'C:\\Users\\walgh\\Desktop\\scraper\\data\\out'; 
const SENT_FILE_PATH = path.join(__dirname, 'sent.json');
const IMAGE_DOWNLOAD_FOLDER = path.join(__dirname, 'images');

// --- WICHTIG: User-Agent-Header zur Simulation eines Browsers ---
const DOWNLOAD_HEADERS = {
    // Standard-User-Agent eines modernen Chrome-Browsers
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
};

// --- HILFSFUNKTIONEN ---

async function ensureImageFolderExists() {
    try {
        await fsp.mkdir(IMAGE_DOWNLOAD_FOLDER, { recursive: true });
    } catch (error) {
        console.error(`[FEHLER] Konnte Ordner ${IMAGE_DOWNLOAD_FOLDER} nicht erstellen: ${error.message}`);
    }
}

async function getSentDeals() {
    try {
        await ensureImageFolderExists(); 
        const data = await fsp.readFile(SENT_FILE_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        return [];
    }
}

async function addSentDeal(newId) {
    const sentDeals = await getSentDeals();
    if (!sentDeals.includes(newId)) {
        sentDeals.push(newId);
        try {
            await fsp.writeFile(SENT_FILE_PATH, JSON.stringify(sentDeals, null, 2));
            console.log(`[VERFOLGUNG] Produkt-ID ${newId} zur sent.json hinzugefügt.`);
        } catch (error) {
            console.error('Fehler beim Schreiben der sent.json:', error.message);
        }
    }
}

/**
 * Lädt ein Bild von einer URL herunter und speichert es lokal.
 */
async function downloadImage(url, productId) {
    if (!url || String(url).trim().toUpperCase() === 'N/A' || !url.startsWith('http')) {
        console.log('[DOWNLOAD] Keine gültige Bild-URL gefunden. Überspringe Download.');
        return null;
    }
    
    const extensionMatch = url.match(/\.(png|jpg|jpeg|webp|gif)/i);
    const extension = extensionMatch ? extensionMatch[0] : '.jpg'; 
    const localFilePath = path.join(IMAGE_DOWNLOAD_FOLDER, `${productId}${extension}`);
    
    console.log(`[DOWNLOAD] Starte Download für ${productId} von: ${url}`);

    try {
        const writer = fs.createWriteStream(localFilePath); 
        
        const response = await axios({
            url: url,
            method: 'GET',
            responseType: 'stream',
            timeout: 15000, 
            headers: DOWNLOAD_HEADERS // <<< HIER IST DIE KORREKTUR
        });

        if (response.status !== 200) {
            writer.close();
            await fsp.unlink(localFilePath).catch(() => {}); 
            throw new Error(`HTTP Fehlerstatus: ${response.status}`);
        }

        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', (err) => {
                fsp.unlink(localFilePath).catch(() => {});
                reject(err);
            });
        });

        console.log(`[DOWNLOAD] ✅ Erfolgreich gespeichert unter: ${localFilePath}`);
        return localFilePath;

    } catch (error) {
        console.error(`[DOWNLOAD-FEHLER] Konnte Bild nicht speichern/herunterladen für ${productId}: ${error.message}`);
        return null; 
    }
}

// --- WATCHER SETUP ---

/**
 * Startet den Chokidar-Watcher und registriert die Callback-Funktion des Routers.
 */
function startWatcher(callback) {
    const watcher = chokidar.watch(WATCH_FOLDER, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 2000,
            pollInterval: 100
        }
    });

    watcher
        .on('add', callback)
        .on('error', error => console.error(`[WATCHER-FEHLER]: ${error}`))
        .on('ready', () => {
            console.log(`[WATCHER-BEREIT] Überwache Ordner: ${WATCH_FOLDER}`);
        });

    return watcher;
}

// --- EXPORTE ---
module.exports = {
    startWatcher,
    downloadImage, 
    getSentDeals, 
    addSentDeal, 
    ensureImageFolderExists,
    WATCH_FOLDER,
    IMAGE_DOWNLOAD_FOLDER,
    SENT_FILE_PATH
};