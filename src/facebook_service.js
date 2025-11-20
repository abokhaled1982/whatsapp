// services/facebook_service.js
const WebSocket = require("ws");
const fs = require("fs");
const { createFacebookMessage } = require("./facebook_message"); // Pfad ggf. anpassen

let wss;
const PORT = 8080;

function init() {
  return new Promise((resolve) => {
    console.log(`[FACEBOOK] 📡 Starte WebSocket Server auf Port ${PORT}...`);
    wss = new WebSocket.Server({ port: PORT });

    wss.on("connection", (ws) => {
      console.log("[FACEBOOK] ✅ Chrome Extension verbunden!");
      ws.isAlive = true;
      ws.on("pong", () => {
        ws.isAlive = true;
      });
    });

    // Heartbeat (Ping alle 15s)
    setInterval(() => {
      if (!wss) return;
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: "ping" }));
        }
      });
    }, 15000);

    resolve();
  });
}

function convertFileToBase64(filePath) {
  try {
    const fileBitmap = fs.readFileSync(filePath);
    return Buffer.from(fileBitmap).toString("base64");
  } catch (err) {
    console.error(`[FACEBOOK] ❌ Fehler Base64: ${err.message}`);
    return null;
  }
}

async function sendPost(data, localImagePath) {
  if (!wss) {
    console.error("[FACEBOOK] ❌ Server nicht gestartet.");
    return;
  }

  // Text generieren
  const fbText = createFacebookMessage(data);

  // Payload bauen
  let payload = {
    type: "post",
    text: fbText,
    image: null,
  };

  if (localImagePath) {
    const base64 = convertFileToBase64(localImagePath);
    if (base64) payload.image = base64;
  }

  // An Clients senden
  let sentCount = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(payload));
      sentCount++;
    }
  });

  if (sentCount > 0) {
    console.log(`[FACEBOOK] 📤 An Extension gesendet.`);
    return true;
  } else {
    console.log(`[FACEBOOK] ⚠️ Kein Client verbunden.`);
    return false;
  }
}

module.exports = { init, sendPost };
