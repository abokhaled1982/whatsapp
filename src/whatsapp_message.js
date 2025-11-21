// whatsapp_message.js
// Modul zur Erzeugung von WhatsApp-Nachrichten
// FIX: Sendet IMMER einen Text (verhindert Absturz bei gleichen Preisen),
// aber zeigt keinen Streichpreis, wenn kein echter Rabatt vorliegt.

/**
 * Hilfsfunktionen
 */

/** Entfernt alle sichtbaren Sternchen aus dem Text */
function stripStars(text) {
  if (text == null) return "";
  return String(text).replace(/\*/g, "").trim();
}

/** Normalisiert Whitespaces und Unicode-Zeichen */
function normalizeSpacesAndChars(str) {
  if (str == null) return "";
  let s = String(str);
  s = s.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " "); // Spaces
  s = s.replace(/[\u200C\u200D\uFEFF]/g, ""); // Zero-width
  s = s.replace(/[\u2217\u2605\u2736\u204E]/g, "*"); // Stars
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// --- Robustes Hervorheben von Preisen/Prozenten ---
function boldPricesAndPercentsSafe(text) {
  if (!text) return "";
  let t = normalizeSpacesAndChars(text);

  // Euro fett
  t = t.replace(/(\d{1,3}(?:[.,]\d{1,2})?)\s?€/g, (_, amt) => `*${amt} €*`);
  // Prozent fett
  t = t.replace(/(-?\d{1,3}(?:[.,]\d{1,2})?)\s?%/g, (_, num) => `*${num}%*`);
  // Doppelte Sterne fixen
  t = t.replace(/\*\*/g, "*");
  return t;
}

function isEmptyValue(v) {
  if (v == null) return true;
  const s = String(v).trim();
  return s === "" || s.toUpperCase() === "N/A" || s === "-";
}

function cleanValue(v) {
  if (v == null) return "";
  return String(v).trim();
}

/** * Parst Preise (z.B. "121,51 €") zu Zahlen (121.51) für Vergleiche
 */
function parsePrice(str) {
  if (!str) return null;
  // Nur Zahlen, Komma, Punkt, Minus
  let s = String(str)
    .replace(/[^0-9.,-]/g, "")
    .trim();
  if (!s) return null;

  // Deutsche Logik: 1.200,50 -> 1200.50
  if (s.includes(",")) {
    s = s.replace(/\./g, ""); // Tausenderpunkte weg
    s = s.replace(",", "."); // Komma zu Punkt
  }
  const val = parseFloat(s);
  return isNaN(val) ? null : val;
}

/**
 * Hauptfunktion: Erzeugt Nachricht
 */
function createOfferMessage(data = {}, opts = {}) {
  const showExtra = !!opts.show_extra_info;

  // Rohdaten holen
  const title = cleanValue(data.title || data.name || "Unbekanntes Produkt");
  const affiliateUrl = cleanValue(data.affiliate_url || data.url || "");

  const priceRaw = data.price?.raw || data.price || data.deal_price || "";
  const originalPriceRaw = data.original_price?.raw || data.original_price || "";

  const discountRaw = data.discount_percent || data.discount || data.discount_amount || "";
  const rabattTextRaw = data.rabatt_text || data.coupon?.more || data.coupon?.description || "";
  const couponCode = data.coupon?.code || data.coupon_code || "";

  const unitsSold = data.units_sold || "";
  const availability = data.availability || "";
  const shippingInfo = data.shipping_info || "";

  // --- PREISVERGLEICH ---
  const pCurrent = parsePrice(priceRaw);
  const pOriginal = parsePrice(originalPriceRaw);

  let showStrikeThrough = false;

  // Zeige Streichpreis NUR, wenn Originalpreis existiert UND höher ist (+0.01 Toleranz)
  if (pOriginal !== null && pCurrent !== null) {
    if (pOriginal > pCurrent + 0.01) {
      showStrikeThrough = true;
    }
  } else if (!isEmptyValue(originalPriceRaw) && isEmptyValue(priceRaw)) {
    // Nur Originalpreis vorhanden
    showStrikeThrough = true;
  }

  // --- NACHRICHT AUFBAUEN ---

  // 1) Titel
  const titleBlock = `*${stripStars(title)}*`;

  // 2) Rabatt-Text (Preise fett machen)
  let rabattBlock = "";
  if (!isEmptyValue(rabattTextRaw)) {
    rabattBlock = boldPricesAndPercentsSafe(rabattTextRaw);
  }

  // 3) Preiszeile
  let priceParts = [];

  // Aktueller Preis
  if (!isEmptyValue(priceRaw)) {
    const p = boldPricesAndPercentsSafe(String(priceRaw));
    priceParts.push(`💶 ${p.startsWith("*") ? p : `*${stripStars(p)}*`}`);
  }

  // Alter Preis (nur wenn showStrikeThrough true ist)
  if (showStrikeThrough) {
    const op = stripStars(String(originalPriceRaw));
    priceParts.push(`~${op}~`);
  }

  // Rabatt Prozent
  if (!isEmptyValue(discountRaw)) {
    const d = boldPricesAndPercentsSafe(String(discountRaw));
    priceParts.push(d.startsWith("*") ? d : `*${stripStars(d)}*`);
  }

  const priceLine = priceParts.join("  ").trim();

  // 4) Coupon
  let couponBlock = "";
  if (!isEmptyValue(couponCode)) {
    couponBlock = `🏷️ *Wichtig:* \`${cleanValue(couponCode)}\``;
  }

  // 5) Extra Infos
  let extraLines = [];
  if (showExtra) {
    if (!isEmptyValue(unitsSold)) extraLines.push(`📦 Verkauft: ${stripStars(cleanValue(unitsSold))}`);
    if (!isEmptyValue(availability)) extraLines.push(`✅ Verfügbarkeit: ${stripStars(cleanValue(availability))}`);
    if (!isEmptyValue(shippingInfo)) extraLines.push(`🚚 Versand: ${stripStars(cleanValue(shippingInfo))}`);
  }

  // 6) CTA
  let ctaBlock = "";
  if (!isEmptyValue(affiliateUrl)) {
    ctaBlock = `🛒 *DIREKT ZUM ANGEBOT!* 🚀\n${affiliateUrl}`;
  } else {
    ctaBlock = `🛒 *Interesse?* Antworte mit "Info".`;
  }

  // Zusammenbauen
  const blocks = [];
  blocks.push(titleBlock);
  if (rabattBlock) blocks.push(rabattBlock);

  if (priceLine || couponBlock) {
    const priceAndCoupon = [priceLine, couponBlock].filter(Boolean).join("\n");
    blocks.push(priceAndCoupon);
  }

  if (extraLines.length) blocks.push(extraLines.join("\n"));
  if (ctaBlock) blocks.push(ctaBlock);

  const message = blocks
    .map((b) => b.trim())
    .filter(Boolean) // Filtert leere Strings
    .join("\n\n");

  // Fallback: Falls message leer ist (sehr unwahrscheinlich), leeren String zurückgeben, kein null
  return message ? message.trim() : "";
}

module.exports = {
  createOfferMessage,
  _helpers: {
    stripStars,
    normalizeSpacesAndChars,
    boldPricesAndPercentsSafe,
    cleanValue,
    isEmptyValue,
    parsePrice,
  },
};
