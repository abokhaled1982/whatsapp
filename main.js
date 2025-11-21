require("dotenv").config();
const fs = require("fs/promises");
const path = require("path");

// Importiere unsere Tools
const { startWatcher, downloadImage, getSentDeals, addSentDeal, ensureImageFolderExists } = require("./src/watcher");

// Importiere die Services
// Facebook Service wieder aktiviert
const fbService = require("./src/facebook_service");
const waService = require("./src/whatsapp_service");

async function processDeal(fullPath) {
  const fileName = path.basename(fullPath);
  const productId = fileName.replace(path.extname(fileName), "");

  // 1. Dubletten-Check (Zentral)
  const sentDeals = await getSentDeals();
  if (sentDeals.includes(productId)) {
    console.log(`[MAIN] ⏭️ Deal ${productId} wurde bereits bearbeitet.`);
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

    // 4. Parallel an BEIDE Dienste senden
    console.log("[MAIN] 🚀 Verteile an Facebook & WhatsApp...");

    // Wir nutzen Promise.allSettled, damit ein Fehler bei FB nicht WhatsApp stoppt (und umgekehrt)
    const results = await Promise.allSettled([
      fbService.sendPost(data, localImagePath), // Index 0
      waService.sendMessage(data, localImagePath), // Index 1
    ]);

    // Ergebnisse prüfen
    const fbResult = results[0];
    const waResult = results[1];

    if (fbResult.status === "rejected") console.error(`[MAIN] ❌ FB Fehler: ${fbResult.reason}`);
    if (waResult.status === "rejected") console.error(`[MAIN] ❌ WA Fehler: ${waResult.reason}`);

    if (fbResult.status === "fulfilled") console.log(`[MAIN] ✅ Facebook Post gesendet.`);
    if (waResult.status === "fulfilled") console.log(`[MAIN] ✅ WhatsApp Nachricht gesendet.`);

    // 5. Als "Gesendet" markieren (wenn mindestens einer erfolgreich war oder generell)
    await addSentDeal(productId);
    console.log("[MAIN] ✅ Deal Verarbeitung abgeschlossen.");
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
  // Wir warten, bis Facebook UND WhatsApp bereit sind
  try {
    await Promise.all([fbService.init(), waService.init()]);
  } catch (error) {
    console.error("❌ Fehler bei der Initialisierung der Services:", error);
    // Optional: Prozess beenden, wenn Init fehlschlägt
    // process.exit(1);
  }

  console.log("----------------------------------------");
  console.log("✅ Alle Services (FB & WA) bereit!");

  // 2. Watcher starten
  startWatcher(processDeal);
}

startSystem();
