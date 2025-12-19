// services/whatsapp_service.js
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const { createOfferMessage } = require("./whatsapp_message");

// --- KONFIGURATION ---
const SESSION_PATH = "./session-data";
const CLIENT_ID = process.env.CLIENT_ID || "sport-bot-1";
const RECIPIENT = process.env.RECIPIENT || "";
const GROUP_NAME = process.env.GROUP_NAME || "";
const CHANNEL_ID = process.env.CHANNEL_ID || "";

let client;
let isReady = false;

// --- HILFSFUNKTIONEN ---

async function resolveDestination() {
  if (CHANNEL_ID) return CHANNEL_ID;

  if (GROUP_NAME) {
    const chats = await client.getChats();
    const group = chats.find(
      (c) => c.isGroup && c.name.toLowerCase() === GROUP_NAME.toLowerCase()
    );
    if (group) return group.id._serialized;
  }

  if (RECIPIENT) {
    return `${RECIPIENT.replace(/\D/g, "")}@c.us`;
  }
  return null;
}

// --- HAUPTFUNKTIONEN ---

function init() {
  return new Promise((resolve) => {
    console.log("[WHATSAPP] ⏳ Starte Client...");

    client = new Client({
      authStrategy: new LocalAuth({
        dataPath: SESSION_PATH,
        clientId: CLIENT_ID,
      }),
      puppeteer: {
        headless: true, // Setze auf false, wenn du den Browser sehen willst zum Debuggen
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-extensions",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu"
        ],
      },
    });

    client.on("qr", (qr) => qrcode.generate(qr, { small: true }));

    client.on("ready", () => {
      console.log("[WHATSAPP] 🟢 Bereit!");
      isReady = true;
      resolve();
    });

    client.initialize();
  });
}

async function sendMessage(data, localImagePath) {
  if (!isReady) {
    console.error("[WHATSAPP] ❌ Noch nicht bereit.");
    return false;
  }

  try {
    const target = await resolveDestination();
    if (!target) {
      console.error("[WHATSAPP] ❌ Kein Ziel (Gruppe/Channel) gefunden.");
      return false;
    }

    const caption = createOfferMessage(data).trim();

    // --- BILD VERSAND ---
    if (localImagePath && fs.existsSync(localImagePath)) {
      try {
        // Nutzt die eingebaute Funktion der Library (Sauberer & Stabiler)
        // Resolving path ist wichtig für Windows
        const fullPath = path.resolve(localImagePath);
        
        const media = MessageMedia.fromFilePath(fullPath);

        // Senden
        await client.sendMessage(target, media, { caption });
        console.log(`[WHATSAPP] 📤 Bild+Text gesendet an ${target}`);
        
      } catch (imgError) {
        console.error(`[WHATSAPP] ⚠️ Bild-Fehler (Sende nur Text): ${imgError.message}`);
        // Fallback: Nur Text senden
        await client.sendMessage(target, caption);
      }
    } else {
      // Kein Bild vorhanden -> Nur Text senden
      await client.sendMessage(target, caption);
      console.log(`[WHATSAPP] 📤 Nur Text gesendet (Bild fehlte)`);
    }

    return true;
  } catch (e) {
    console.error(`[WHATSAPP] ❌ Fehler beim Senden: ${e.message}`);
    return true; 
  }
}

module.exports = { init, sendMessage };