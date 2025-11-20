// main.js - Die Zentrale für BEIDE Dienste
require("dotenv").config();
const fs = require("fs/promises");
const path = require("path");

// Importiere unsere Tools
const { startWatcher, downloadImage, getSentDeals, addSentDeal, ensureImageFolderExists } = require("./src/watcher");

// Importiere die neuen Services
// (Achte darauf, dass die Dateien im Unterordner 'services' liegen,
// oder pass den Pfad hier an, wenn sie im gleichen Ordner liegen)
const fbService = require("./src/facebook_service"); // oder "./facebook_service"
const waService = require("./src/whatsapp_service"); // oder "./whatsapp_service"

async function processDeal(fullPath) {
  const fileName = path.basename(fullPath);
  const productId = fileName.replace(path.extname(fileName), "");

  // 1. Dubletten-Check (Zentral)
  const sentDeals = await getSentDeals();
  if (sentDeals.includes(productId)) {
    console.log(`[MAIN] ⏭️  Deal ${productId} wurde bereits bearbeitet.`);
    return;
  }

  console.log(`[MAIN] 🔔 Neuer Deal erkannt: ${fileName}`);

  try {
    // 2. Daten lesen
    const content = await fs.readFile(fullPath, "utf8");
    const data = JSON.parse(content);

    if (!data.title || !data.affiliate_url) {
      console.log("[MAIN] ❌ Ungültige Daten.");
      return;
    }

    // 3. Bild EINMAL herunterladen (für alle Dienste)
    let imageUrl = data.image_url || (data.images?.[0] ?? null);
    const localImagePath = await downloadImage(imageUrl, productId);

    // 4. Parallel (oder nacheinander) an beide Dienste senden
    console.log("[MAIN] 🚀 Verteile an Dienste...");

    // Wir nutzen Promise.allSettled, damit ein Fehler bei FB nicht WhatsApp stoppt (und umgekehrt)
    const results = await Promise.allSettled([fbService.sendPost(data, localImagePath), waService.sendMessage(data, localImagePath)]);

    // Ergebnisse prüfen
    const fbResult = results[0];
    const waResult = results[1];

    if (fbResult.status === "rejected") console.error(`[MAIN] ❌ FB Fehler: ${fbResult.reason}`);
    if (waResult.status === "rejected") console.error(`[MAIN] ❌ WA Fehler: ${waResult.reason}`);

    // 5. Als "Gesendet" markieren (nur wenn mindestens einer erfolgreich war)
    // Du kannst hier entscheiden: Soll es markiert werden, wenn EINER es geschafft hat?
    await addSentDeal(productId);
    console.log("[MAIN] ✅ Deal abgeschlossen.");
  } catch (err) {
    console.error(`[MAIN] ❌ Kritischer Fehler: ${err.message}`);
  }
}

async function startSystem() {
  console.log("========================================");
  console.log("   🚀 MULTI-CHANNEL BOT STARTET...      ");
  console.log("========================================");

  await ensureImageFolderExists();

  // 1. Services initialisieren
  // Wir warten, bis WhatsApp bereit ist und der FB-Server läuft
  await Promise.all([fbService.init(), waService.init()]);

  console.log("----------------------------------------");
  console.log("✅ Alle Services bereit!");

  // 2. Watcher starten (mit der Random-Logik aus watcher.js)
  // Wir übergeben unsere zentrale processDeal Funktion
  startWatcher(processDeal);
}

startSystem();
