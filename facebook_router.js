// facebook_router.js - Verbindet Watcher mit WebSocket Client

require("dotenv").config();
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

// Importiere deine bestehenden Helper
const { startWatcher, downloadImage, getSentDeals, addSentDeal, ensureImageFolderExists, WATCH_FOLDER } = require("./watcher");

const { createFacebookMessage } = require("./facebook_message");

// =============================
// KONFIGURATION
// =============================
const PORT = 8080; // Port für die Chrome Extension

// =============================
// WEBSOCKET SERVER SETUP
// =============================
console.log(`--- FACEBOOK ROUTER START ---`);
const wss = new WebSocket.Server({ port: PORT });

console.log(`📡 WebSocket Server läuft auf Port ${PORT}`);
console.log(`👀 Überwache Ordner: ${WATCH_FOLDER}`);

wss.on("connection", (ws) => {
  console.log("✅ Neue Verbindung: Chrome Extension ist verbunden!");
});

// =============================
// LOGIK: DATEI -> BASE64
// =============================
function convertFileToBase64(filePath) {
  try {
    const fileBitmap = fs.readFileSync(filePath);
    return Buffer.from(fileBitmap).toString("base64");
  } catch (err) {
    console.error(`❌ Fehler bei Base64 Umwandlung: ${err.message}`);
    return null;
  }
}

// =============================
// ROUTER LOGIK
// =============================
async function routeNewFacebookOffer(fullPath) {
  const fileName = path.basename(fullPath);
  const productId = fileName.replace(path.extname(fileName), "");

  // 1. Prüfung: Wurde der Deal schon gesendet?
  const sentDeals = await getSentDeals();
  if (sentDeals.includes(productId)) {
    console.log(`⏭️ Schon gesendet (laut sent.json): ${productId}`);
    return;
  }

  console.log(`🔔 Neuer Facebook-Kandidat: ${fileName}`);

  try {
    // 2. JSON lesen
    const content = fs.readFileSync(fullPath, "utf8");
    const data = JSON.parse(content);

    let imageUrl = data.image_url || (data.images?.[0] ?? null);

    if (!data.title || !data.affiliate_url) {
      console.log("❌ Ungültige Datei – Titel oder URL fehlen.");
      return;
    }

    // 3. Bild herunterladen (nutzt deine watcher.js Logic)
    const localImagePath = await downloadImage(imageUrl, productId);

    // 4. Text generieren
    const fbText = createFacebookMessage(data);

    // 5. Payload für Chrome Extension bauen
    let payload = {
      text: fbText,
      image: null,
    };

    // Wenn Bild vorhanden, in Base64 umwandeln für WebSocket
    if (localImagePath) {
      const base64Image = convertFileToBase64(localImagePath);
      if (base64Image) {
        payload.image = base64Image;
      }
    }

    // 6. An alle verbundenen Clients (Extension) senden
    let clientCount = 0;
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(payload));
        clientCount++;
      }
    });

    if (clientCount > 0) {
      console.log(`📤 An ${clientCount} Client(s) gesendet: ${data.title.substring(0, 30)}...`);
      // Erst als "gesendet" markieren, wenn Clients da waren
      await addSentDeal(productId);
    } else {
      console.log("⚠️ Kein Client verbunden! Deal wird beim nächsten Start erneut versucht (nicht in sent.json gespeichert).");
    }
  } catch (err) {
    console.error(`❌ Fehler beim Verarbeiten: ${err.message}`);
  }
}

// =============================
// START
// =============================
async function startFbRouter() {
  await ensureImageFolderExists();
  // Startet den Watcher mit der Facebook-Callback-Funktion
  startWatcher(routeNewFacebookOffer);
}

startFbRouter();
