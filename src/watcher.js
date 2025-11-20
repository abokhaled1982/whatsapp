// watcher.js - Polling Version (Warteschlange)
const fsp = require("fs/promises");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const os = require("os");

// --- KONFIGURATION ---
const HOME_DIR = os.homedir();
const WATCH_FOLDER = path.join(HOME_DIR, "Desktop", "scraper", "data", "out");
const SENT_FILE_PATH = path.join(__dirname,"../", "sent.json");
const IMAGE_DOWNLOAD_FOLDER = path.join(__dirname, "../", "images");

// --- ZEIT-EINSTELLUNG (in Sekunden) ---
// Lange Wartezeit, wenn die Queue leer ist (z.B. 10 Minuten)
const IDLE_CYCLE_SECONDS = 600;
// Drosselung zwischen ZWEI Deals (Ihr Wunsch: ca. 5 Minuten)
const THROTTLE_SECONDS = 300;

const DOWNLOAD_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
};

// --- HILFSFUNKTIONEN ---

// Pausiert die Ausführung für x Millisekunden
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureImageFolderExists() {
  try {
    await fsp.mkdir(IMAGE_DOWNLOAD_FOLDER, { recursive: true });
  } catch (error) {
    console.error(`[FEHLER] Ordner-Fehler: ${error.message}`);
  }
}

async function getSentDeals() {
  try {
    await ensureImageFolderExists();
    const data = await fsp.readFile(SENT_FILE_PATH, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") return []; // Datei existiert noch nicht
    return [];
  }
}

async function addSentDeal(newId) {
  const sentDeals = await getSentDeals();
  if (!sentDeals.includes(newId)) {
    sentDeals.push(newId);
    try {
      await fsp.writeFile(SENT_FILE_PATH, JSON.stringify(sentDeals, null, 2));
    } catch (error) {
      console.error("Fehler beim Schreiben der sent.json:", error.message);
    }
  }
}

async function downloadImage(url, productId) {
  if (!url || String(url).trim().toUpperCase() === "N/A" || !url.startsWith("http")) {
    return null;
  }

  const extensionMatch = url.match(/\.(png|jpg|jpeg|webp|gif)/i);
  const extension = extensionMatch ? extensionMatch[0] : ".jpg";
  const localFilePath = path.join(IMAGE_DOWNLOAD_FOLDER, `${productId}${extension}`);

  try {
    if (fs.existsSync(localFilePath)) return localFilePath; // Schon da?

    const writer = fs.createWriteStream(localFilePath);
    const response = await axios({
      url: url,
      method: "GET",
      responseType: "stream",
      timeout: 15000,
      headers: DOWNLOAD_HEADERS,
    });

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    return localFilePath;
  } catch (error) {
    console.error(`[DOWNLOAD-FEHLER] Bild für ${productId} fehlgeschlagen: ${error.message}`);
    return null;
  }
}

// --- POLLING LOGIK (Der neue Kern) ---

async function startWatcher(processCallback) {
  console.log(`[WATCHER] 👁️  Polling-Modus gestartet.`);
  console.log(`[WATCHER] ⏱️  Zyklus-Zeit (Leerlauf): ${IDLE_CYCLE_SECONDS} Sekunden.`);
  console.log(`[WATCHER] ⏱️  Drosselung (Zwischen Deals): ${THROTTLE_SECONDS} Sekunden (ca. 5 Minuten).`);
  console.log(`[WATCHER] 📂 Ordner: ${WATCH_FOLDER}`);

  // Endlosschleife
  while (true) {
    let waitTime = IDLE_CYCLE_SECONDS;
    try {
      // 1. Listen abrufen
      const allFiles = await fsp.readdir(WATCH_FOLDER);
      const sentDeals = await getSentDeals();

      // 2. Nur JSON-Dateien und ungesendet filtern
      const jsonFiles = allFiles.filter((f) => f.endsWith(".json"));

      // 3. Nach "ungesendet" filtern
      const candidates = jsonFiles
        .map((fileName) => ({
          fileName,
          id: fileName.replace(".json", ""),
          fullPath: path.join(WATCH_FOLDER, fileName),
        }))
        .filter((candidate) => !sentDeals.includes(candidate.id));

      if (candidates.length > 0) {
        console.log(`\n---------------------------------------------------`);
        console.log(`[POLLING] 🎯 ${candidates.length} neue Deals in der Warteschlange gefunden.`);

        // 4. Alle Treffer nacheinander verarbeiten
        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];

          console.log(`\n[POLLING] Bearbeite Deal ${i + 1}/${candidates.length}: ${candidate.fileName}`);

          // Verarbeiten (Aufruf an main.js)
          await processCallback(candidate.fullPath);

          // 5. Drosselung nach JEDER gesendeten Nachricht
          // (außer nach der letzten Nachricht des aktuellen Batches)
          if (i < candidates.length - 1) {
            console.log(`[THROTTLE] ⏳ Warte ${THROTTLE_SECONDS}s (ca. 5 Minuten) vor der nächsten Nachricht...`);
            await sleep(THROTTLE_SECONDS * 1000);
          }
        }
        console.log(`---------------------------------------------------`);
        console.log(`[POLLING] ✅ Warteschlange abgearbeitet.`);

        // Nach Abarbeitung der Queue, warten wir die IDLE_CYCLE_SECONDS, um den Ordner erneut zu prüfen.
        waitTime = IDLE_CYCLE_SECONDS;
      } else {
        // Keine neuen Dateien gefunden
        process.stdout.write(".");
        waitTime = IDLE_CYCLE_SECONDS; // Warten die Standardzeit
      }
    } catch (err) {
      console.error(`[WATCHER-CRASH] Fehler im Loop: ${err.message}`);
      // Kurze Pause bei Fehler, damit CPU nicht brennt
      waitTime = 5;
    }

    // 6. Warten vor dem nächsten Check.
    await sleep(waitTime * 1000);
  }
}

// --- EXPORTE ---
module.exports = {
  startWatcher,
  downloadImage,
  getSentDeals,
  addSentDeal,
  ensureImageFolderExists,
  WATCH_FOLDER, // Für Debugging
};
