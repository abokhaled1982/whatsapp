// services/whatsapp_service.js
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const { createOfferMessage } = require("./whatsapp_message"); // Pfad anpassen

// Konfig
const SESSION_PATH = "./session-data";
const CLIENT_ID = process.env.CLIENT_ID || "sport-bot-1";
const RECIPIENT = process.env.RECIPIENT || "";
const GROUP_NAME = process.env.GROUP_NAME || "";
const CHANNEL_ID = process.env.CHANNEL_ID || "";

let client;
let isReady = false;

async function resolveDestination() {
  if (CHANNEL_ID) return CHANNEL_ID;

  if (GROUP_NAME) {
    const chats = await client.getChats();
    const group = chats.find((c) => c.isGroup && c.name.toLowerCase() === GROUP_NAME.toLowerCase());
    if (group) return group.id._serialized;
  }

  if (RECIPIENT) {
    return `${RECIPIENT.replace(/\D/g, "")}@c.us`;
  }
  return null;
}

function init() {
  return new Promise((resolve) => {
    console.log("[WHATSAPP] ⏳ Starte Client...");
    client = new Client({
      authStrategy: new LocalAuth({ dataPath: SESSION_PATH, clientId: CLIENT_ID }),
      puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"] },
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
    return;
  }

  try {
    const target = await resolveDestination();
    if (!target) {
      console.error("[WHATSAPP] ❌ Kein Ziel (Gruppe/Channel) gefunden.");
      return;
    }

    const caption = createOfferMessage(data).trim();

    if (localImagePath && fs.existsSync(localImagePath)) {
      const media = MessageMedia.fromFilePath(localImagePath);
      await client.sendMessage(target, media, { caption });
      console.log(`[WHATSAPP] 📤 Bild+Text gesendet an ${target}`);
    } else {
      await client.sendMessage(target, caption);
      console.log(`[WHATSAPP] 📤 Nur Text gesendet (Bild fehlte)`);
    }
    return true;
  } catch (e) {
    console.error(`[WHATSAPP] ❌ Fehler beim Senden: ${e.message}`);
    return false;
  }
}

module.exports = { init, sendMessage };
