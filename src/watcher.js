// watcher.js - FINAL VERSION mit Zufalls-Verzögerung (Random Delay)

const chokidar = require("chokidar");
const fsp = require("fs/promises");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const os = require("os");

// --- KONFIGURATION ---
const HOME_DIR = os.homedir();
const WATCH_FOLDER = path.join(HOME_DIR, "Desktop", "scraper", "data", "out");
const SENT_FILE_PATH = path.join(__dirname, "sent.json");
const IMAGE_DOWNLOAD_FOLDER = path.join(__dirname, "images");

// --- VERZÖGERUNGS-KONFIGURATION (in Sekunden) ---
const MIN_DELAY_SECONDS = 33; // Mindestens 10 Sekunden warten
const MAX_DELAY_SECONDS = 63; // Maximal 40 Sekunden warten (Anpassbar)

const DOWNLOAD_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
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
    const data = await fsp.readFile(SENT_FILE_PATH, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") return [];
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
      console.error("Fehler beim Schreiben der sent.json:", error.message);
    }
  }
}

async function downloadImage(url, productId) {
  if (!url || String(url).trim().toUpperCase() === "N/A" || !url.startsWith("http")) {
    console.log("[DOWNLOAD] Keine gültige Bild-URL gefunden. Überspringe Download.");
    return null;
  }

  const extensionMatch = url.match(/\.(png|jpg|jpeg|webp|gif)/i);
  const extension = extensionMatch ? extensionMatch[0] : ".jpg";
  const localFilePath = path.join(IMAGE_DOWNLOAD_FOLDER, `${productId}${extension}`);

  console.log(`[DOWNLOAD] Starte Download für ${productId} von: ${url}`);

  try {
    const writer = fs.createWriteStream(localFilePath);

    const response = await axios({
      url: url,
      method: "GET",
      responseType: "stream",
      timeout: 15000,
      headers: DOWNLOAD_HEADERS,
    });

    if (response.status !== 200) {
      writer.close();
      await fsp.unlink(localFilePath).catch(() => {});
      throw new Error(`HTTP Fehlerstatus: ${response.status}`);
    }

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", (err) => {
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
 * Startet den Chokidar-Watcher mit ZUFÄLLIGER VERZÖGERUNG.
 */
function startWatcher(callback) {
  const watcher = chokidar.watch(WATCH_FOLDER, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100,
    },
  });

  watcher
    .on("add", (filePath) => {
      // 1. Berechne Zufallszeit zwischen MIN und MAX
      const minMs = MIN_DELAY_SECONDS * 1000;
      const maxMs = MAX_DELAY_SECONDS * 1000;
      const randomDelay = Math.floor(Math.random() * (maxMs - minMs + 1) + minMs);
      const seconds = (randomDelay / 1000).toFixed(1);

      const fileName = path.basename(filePath);

      console.log(`---------------------------------------------------`);
      console.log(`[WATCHER] 👁️  Neue Datei erkannt: ${fileName}`);
      console.log(`[TIMER] ⏳ Warte zufällig ${seconds} Sekunden vor Verarbeitung...`);
      console.log(`---------------------------------------------------`);

      // 2. Verzögerte Ausführung
      setTimeout(() => {
        console.log(`[TIMER] 🚀 Zeit abgelaufen! Starte Verarbeitung für: ${fileName}`);
        callback(filePath); // Hier wird deine routeNewFacebookOffer Funktion aufgerufen
      }, randomDelay);
    })
    .on("error", (error) => console.error(`[WATCHER-FEHLER]: ${error}`))
    .on("ready", () => {
      console.log(`[WATCHER-BEREIT] Überwache Ordner: ${WATCH_FOLDER}`);
      console.log(`[MODUS] Zufalls-Intervall aktiv: ${MIN_DELAY_SECONDS}s bis ${MAX_DELAY_SECONDS}s`);
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
  SENT_FILE_PATH,
};
