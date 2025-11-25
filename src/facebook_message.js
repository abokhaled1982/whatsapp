// facebook_message.js
// Optimiertes Layout für den Facebook-Feed
// Ziel: Wichtige Infos VOR dem "Mehr anzeigen"-Button

/** Entfernt Sternchen aus importierten Texten */
function stripStars(text) {
  if (text == null) return "";
  return String(text).replace(/\*/g, "").trim();
}

/** Hilfsfunktion für saubere Werte */
function cleanValue(v) {
  if (v == null || v === "N/A" || v === "null") return "";
  return String(v).trim();
}

function createFacebookMessage(data = {}) {
  // 1. Daten bereinigen
  const title = stripStars(data.title || data.name || "Super Angebot");
  const url = cleanValue(data.affiliate_url || data.url);

  const price = cleanValue(data.price?.raw || data.price || data.deal_price);
  const oldPrice = cleanValue(data.original_price?.raw || data.original_price);
  const discount = cleanValue(data.discount_percent || data.discount);

  const couponCode = cleanValue(data.coupon?.code || data.coupon_code);
  // Nimm rabatt_text oder description, falls vorhanden
  const extraText = stripStars(data.rabatt_text || data.feature_text || "");

  // --- AUFBAU DER NACHRICHT ---

  // ZEILE 1: Der "Hook" (Titel kurz halten wenn möglich, oder einfach Emoji davor)
  // Wir nutzen 🔴 oder 🔥 als Stopper.
  let msg = `${title}\n`;

  // ZEILE 2: Die "Rechnung" (Preis | Alter Preis | Rabatt)
  // Facebook kann kein Durchstreichen, daher: "statt X"
  let priceLineParts = [];

  if (price) priceLineParts.push(`💶 Nur ${price}`);
  if (oldPrice && oldPrice !== price) priceLineParts.push(`(statt ${oldPrice})`);
  if (discount && discount !== "N/A") priceLineParts.push(`| ${discount} Rabatt 📉`);

  if (priceLineParts.length > 0) {
    msg += `${priceLineParts.join(" ")}\n`;
  }

  // ZEILE 3: Der Call-to-Action (Muss sichtbar sein!)
  if (url) {
    msg += `👉 Zum Deal: ${url}\n`;
  }

  // --- AB HIER: "UNTER DEM KNICK" (Alles was danach kommt ist Bonus) ---

  let details = [];

  // Coupon Box (nur wenn Code existiert)
  if (couponCode && couponCode !== "N/A") {
    details.push(`Code an der Kasse: ${couponCode}`);
  }

  // Extra Info (nur wenn relevant)
  if (extraText && extraText.length > 5 && extraText !== "N/A") {
    details.push(`ℹ${extraText}`);
  }

  // Wenn wir Details haben, fügen wir sie mit Abstand an
  if (details.length > 0) {
    msg += `\n${details.join("\n")}\n`;
  }

  // Hashtags ganz unten (für die Suche, stören oben nur)
  msg += `\n#Angebot #Schnäppchen #Deal #Sparen #Amazon`;

  return msg.trim();
}

module.exports = { createFacebookMessage };
