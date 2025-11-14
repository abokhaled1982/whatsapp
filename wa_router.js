// wa_router.js - Der Haupt-Controller mit WhatsApp-Integration

require("dotenv").config();
const fs = require("fs/promises");
const fsn = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

const { createOfferMessage } = require("./offer_message");

const { startWatcher, downloadImage, getSentDeals, addSentDeal, ensureImageFolderExists, WATCH_FOLDER, IMAGE_DOWNLOAD_FOLDER, SENT_FILE_PATH } = require("./watcher");

// =============================
// CONFIG
// =============================
const SESSION_PATH = process.env.SESSION_PATH || "./session-data";
const CLIENT_ID = process.env.CLIENT_ID || "sport-bot-1";
const RECIPIENT = process.env.RECIPIENT || "";
const GROUP_NAME = process.env.GROUP_NAME || "";
const CHANNEL_ID = process.env.CHANNEL_ID || "";

let client;
let initialized = false;
let reconnectTimer = null;

// =============================
// UTILS
// =============================
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function ensureDir(p) {
  if (!fsn.existsSync(p)) {
    fsn.mkdirSync(p, { recursive: true });
  }
}

ensureDir(SESSION_PATH);
ensureDir(path.resolve("./logs"));

// =============================
// DESTINATION RESOLVER
// =============================

async function resolveDestination() {
  // 1) WhatsApp-Kanal
  if (CHANNEL_ID) {
    if (!CHANNEL_ID.endsWith("@newsletter")) {
      throw new Error(`CHANNEL_ID "${CHANNEL_ID}" ist ungültig – muss mit "@newsletter" enden.`);
    }
    log(`Ziel: WhatsApp-Kanal: ${CHANNEL_ID}`);
    return CHANNEL_ID;
  }

  // 2) Gruppe
  if (GROUP_NAME) {
    const needle = GROUP_NAME.toLowerCase();
    const chats = await client.getChats();
    const group = chats.find((c) => c.isGroup && c.name.toLowerCase() === needle);
    if (group) {
      log(`Ziel: Gruppe "${GROUP_NAME}" → ${group.id._serialized}`);
      return group.id._serialized;
    }
    throw new Error(`Gruppe "${GROUP_NAME}" nicht gefunden.`);
  }

  // 3) Einzel-Empfänger
  if (RECIPIENT) {
    const phone = RECIPIENT.replace(/\D/g, "");
    if (!phone) throw new Error("RECIPIENT ist ungültig.");
    return `${phone}@c.us`;
  }

  throw new Error("Kein Ziel gesetzt (weder CHANNEL_ID, GROUP_NAME noch RECIPIENT).");
}

// =============================
// IMAGE SENDER
// =============================
async function sendImageWithCaption(imagePath, caption) {
  if (!fsn.existsSync(imagePath)) throw new Error(`Bild fehlt: ${imagePath}`);

  const to = await resolveDestination();
  const media = MessageMedia.fromFilePath(imagePath);
  await client.sendMessage(to, media, { caption });
  log(`📤 Gesendet nach ${to}: ${path.basename(imagePath)}`);
}

// =============================
// CLIENT INIT
// =============================
async function initializeSafe() {
  if (initialized) return;

  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: SESSION_PATH,
      clientId: CLIENT_ID,
    }),
    puppeteer: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
    qrMaxRetries: 3,
    takeoverOnConflict: true,
  });

  client.on("qr", (qr) => qrcode.generate(qr, { small: true }));
  client.on("authenticated", () => log("✅ Authentifiziert!"));
  client.on("ready", async () => {
    initialized = true;
    log("🟢 WhatsApp Client ist bereit! (Verbose Chat Dump folgt)");

    try {
      const chats = await client.getChannels();

      log(`Gesamtanzahl Chats: ${chats.length}`);

      // Detaillierter Dump (nur console, nicht zu große Objekte)
      chats.forEach((c, idx) => {
        try {
          const id = c.id && c.id._serialized ? c.id._serialized : JSON.stringify(c.id);
          const type = c.isGroup ? "GROUP" : c.isChannel ? "CHANNEL" : "DIRECT";
          const name = c.name || (c.contact && c.contact.pushname) || "(kein name)";
          const server = (c.id && c.id.server) || "(kein server)";
          log(`#${idx} - ${type} - name: ${name} - id: ${id} - server: ${server}`);
        } catch (e) {
          log(`#${idx} - Fehler beim Auslesen eines Chats: ${e.message}`);
        }
      });

      // Suchen nach möglichen Channel-IDs (endend mit @newsletter)
      const newsletterChats = chats.filter((c) => c.id && c.id._serialized && c.id._serialized.endsWith("@newsletter"));
      if (newsletterChats.length) {
        log("🔍 Gefundene @newsletter Chats:");
        newsletterChats.forEach((c) => log(`   ${c.name} -> ${c.id._serialized}`));
      } else {
        log("ℹ️ Keine @newsletter-JIDs in getChats() gefunden.");
      }
    } catch (e) {
      log(`⚠️ Fehler beim Auflisten der Chats: ${e.message}`);
    }
  });

  client.on("auth_failure", (msg) => {
    log(`❌ Auth-Fehler: ${msg}`);
    process.exit(1);
  });

  client.on("disconnected", (reason) => {
    initialized = false;
    log(`🔴 Verbindung weg: ${reason} – Reconnect in 30s`);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => client.initialize(), 30000);
  });

  await client.initialize();
}

// =============================
// OFFER ROUTER
// =============================
async function routeNewOffer(fullPath) {
  const fileName = path.basename(fullPath);
  const productId = fileName.replace(path.extname(fileName), "");
  let localImagePath = null;

  const sentDeals = await getSentDeals();
  if (sentDeals.includes(productId)) {
    log(`⏭️ Schon gesendet: ${productId}`);
    return;
  }

  log(`🔔 Neues Angebot: ${fileName}`);

  try {
    const content = await fs.readFile(fullPath, "utf8");
    const data = JSON.parse(content);

    let imageUrl = data.image_url || (data.images?.[0] ?? null);

    if (!imageUrl || !data.title || !data.affiliate_url) {
      log("❌ Ungültige Datei – wichtige Daten fehlen.");
      return;
    }

    // 1. Bild herunterladen
    localImagePath = await downloadImage(imageUrl, productId);
    if (!localImagePath) {
      log("❌ Bild-Download fehlgeschlagen.");
      return;
    }

    // ----------------------------------------------------
    // 🗑️ Entfernter Block:
    // Der gesamte try/catch-Block für das Padding wurde entfernt.
    // Das Bild wird nun unverändert gesendet.
    // ----------------------------------------------------

    // 2. Bild unverändert senden
    await sendImageWithCaption(localImagePath, createOfferMessage(data).trim());
    await addSentDeal(productId);
  } catch (err) {
    log(`❌ Fehler beim Verarbeiten: ${err.message}`);
  }
}

// =============================
// CONTROLLER START
// =============================
async function startWaRouter() {
  await ensureImageFolderExists();

  log(`Überwache Ordner: ${WATCH_FOLDER}`);
  log(`Image-Output: ${IMAGE_DOWNLOAD_FOLDER}`);
  log(`Sent-Liste: ${SENT_FILE_PATH}`);

  await initializeSafe();
  startWatcher(routeNewOffer);
}

startWaRouter();
