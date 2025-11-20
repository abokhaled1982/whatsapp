// facebook_router.js - Mit Heartbeat um Chrome wach zu halten

require("dotenv").config();
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const { startWatcher, downloadImage, getSentDeals, addSentDeal, ensureImageFolderExists } = require("./watcher");

const { createFacebookMessage } = require("./facebook_message");

// =============================
// KONFIGURATION
// =============================
const PORT = 8080;

// =============================
// WEBSOCKET SERVER SETUP
// =============================
console.log(`--- FACEBOOK ROUTER GESTARTET ---`);
const wss = new WebSocket.Server({ port: PORT });

console.log(`📡 WebSocket Server läuft auf Port ${PORT}`);
console.log(`👀 Warte auf Signale vom Watcher...`);

wss.on("connection", (ws) => {
  console.log("✅ Neue Verbindung: Chrome Extension ist verbunden!");
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("close", () => {
    console.log("❌ Verbindung zu einem Client verloren.");
  });
});

// --- HEARTBEAT / KEEP-ALIVE ---
// Sendet alle 15 Sekunden ein Signal, damit Chrome nicht einschläft
setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      // Sende Ping-Objekt (einfacher als Low-Level Ping für JSON Parsing)
      client.send(JSON.stringify({ type: "ping" }));
    }
  });
}, 15000); // Alle 15 Sekunden (muss unter 30s sein!)

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

  const sentDeals = await getSentDeals();
  if (sentDeals.includes(productId)) {
    console.log(`⏭️  Schon gesendet: ${productId}`);
    return;
  }

  console.log(`🔔 VERARBEITE JETZT: ${fileName}`);

  try {
    const content = fs.readFileSync(fullPath, "utf8");
    const data = JSON.parse(content);

    let imageUrl = data.image_url || (data.images?.[0] ?? null);

    if (!data.title || !data.affiliate_url) {
      console.log("❌ Ungültige Datei.");
      return;
    }

    const localImagePath = await downloadImage(imageUrl, productId);
    const fbText = createFacebookMessage(data);

    let payload = {
      type: "post", // Markiere dies als echten Post
      text: fbText,
      image: null,
    };

    if (localImagePath) {
      const base64Image = convertFileToBase64(localImagePath);
      if (base64Image) {
        payload.image = base64Image;
      }
    }

    let clientCount = 0;
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(payload));
        clientCount++;
      }
    });

    if (clientCount > 0) {
      console.log(`📤 An ${clientCount} Client(s) gesendet.`);
      await addSentDeal(productId);
    } else {
      console.log("⚠️ Kein Client verbunden! Chrome schläft wohl.");
    }
  } catch (err) {
    console.error(`❌ Fehler beim Verarbeiten: ${err.message}`);
  }
}

async function startFbRouter() {
  await ensureImageFolderExists();
  startWatcher(routeNewFacebookOffer);
}

startFbRouter();
