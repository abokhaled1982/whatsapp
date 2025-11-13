// offer_message.js
// Neu implementiertes Modul zur Erzeugung attraktiver WhatsApp-Angebotsnachrichten
// - Entfernt unerwünschte Sterne
// - Macht Preise / Prozente fett (WhatsApp-kompatibel: *Text*)
// - Baut einen übersichtlichen, gut lesbaren Nachrichtentext
// - Exportiert createOfferMessage(data)

/**
 * Hilfsfunktionen
 */

/** Entfernt alle sichtbaren Sternchen aus dem Text (einfach und doppelt) */
function stripStars(text) {
  if (text == null) return "";
  return String(text).replace(/\*/g, "").trim();
}

/**
 * Normalisiert Whitespaces und einige ähnliche Unicode-Zeichen,
 * entfernt zero-width chars und normalisiert Sternchen auf ASCII '*'
 */
function normalizeSpacesAndChars(str) {
  if (str == null) return "";
  let s = String(str);

  // 1) Replace common non-breaking/thin/other spaces with normal space
  s = s.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ");

  // 2) Remove zero-width characters (ZWJ, ZWNJ, BOM, etc.)
  s = s.replace(/[\u200C\u200D\uFEFF]/g, "");

  // 3) Normalize star characters to ASCII asterisk
  //    (covers some visually-similar unicode stars)
  s = s.replace(/[\u2217\u2605\u2736\u204E]/g, "*");

  // 4) Trim and collapse multiple spaces to single
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

// --- Robustes Hervorheben von Preisen/Prozenten ---
function boldPricesAndPercentsSafe(text) {
  if (!text) return "";

  // 1) Normalisieren
  let t = normalizeSpacesAndChars(text);

  // 2) Euro-Beträge markieren: z.B. 12,34 € oder 12.34€ oder 9 €
  t = t.replace(/(\d{1,3}(?:[.,]\d{1,2})?)\s?€/g, (_, amt) => {
    return `*${amt} €*`;
  });

  // 3) Prozent markieren: -20% oder 40 %
  t = t.replace(/(-?\d{1,3}(?:[.,]\d{1,2})?)\s?%/g, (_, num) => {
    return `*${num}%*`;
  });

  // 4) Falls aus irgendeinem Grund "**" entstanden ist, reduzieren
  t = t.replace(/\*\*/g, "*");

  return t;
}

/** Kurze Hilfserkennung ob ein Wert "N/A", leer oder null ist */
function isEmptyValue(v) {
  if (v == null) return true;
  const s = String(v).trim();
  return s === "" || s.toUpperCase() === "N/A" || s === "-";
}

/** Clean: trim & ensure string */
function cleanValue(v) {
  if (v == null) return "";
  return String(v).trim();
}

/**
 * Erzeugt die WhatsApp-Nachricht als String
 * @param {Object} data - JSON-Objekt mit Produktdaten (siehe Beispiele)
 * @param {Object} [opts] - optionale Einstellungen
 *    opts.show_extra_info (bool) -> zeigt units_sold, availability, shipping_info falls vorhanden
 */
function createOfferMessage(data = {}, opts = {}) {
  const showExtra = !!opts.show_extra_info;

  // Rohdaten
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

  // --- 1) Titel (fett)
  const titleBlock = `*${stripStars(title)}*`;

  // --- 2) Rabatttext: bereinigen & Preise/Prozente fett machen
  let rabattBlock = "";
  if (!isEmptyValue(rabattTextRaw)) {
    rabattBlock = boldPricesAndPercentsSafe(rabattTextRaw);
  }

  // --- 3) Preiszeile: wir bauen eine kompakte Preis-Zusammenfassung
  let priceParts = [];

  if (!isEmptyValue(priceRaw)) {
    const p = boldPricesAndPercentsSafe(String(priceRaw));
    // Emoji + Space für bessere Mobile-Parsing-Compat
    priceParts.push(`💶 ${p.startsWith("*") ? p : `*${stripStars(p)}*`}`);
  }

  if (!isEmptyValue(originalPriceRaw)) {
    const op = stripStars(String(originalPriceRaw));
    priceParts.push(`~${op}~`);
  }

  if (!isEmptyValue(discountRaw)) {
    // korrigiert: Aufruf der safe-Version
    const d = boldPricesAndPercentsSafe(String(discountRaw));
    priceParts.push(d.startsWith("*") ? d : `*${stripStars(d)}*`);
  }

  const priceLine = priceParts.join("  ").trim();

  // --- 4) Coupon Code (falls vorhanden)
  let couponBlock = "";
  if (!isEmptyValue(couponCode)) {
    couponBlock = `🏷️ *Wichtig:* \`${cleanValue(couponCode)}\``;
  }

  // --- 5) Optional: extra Info (Units, Verfügbarkeit, Versand)
  let extraLines = [];
  if (showExtra) {
    if (!isEmptyValue(unitsSold)) extraLines.push(`📦 Verkauft: ${stripStars(cleanValue(unitsSold))}`);
    if (!isEmptyValue(availability)) extraLines.push(`✅ Verfügbarkeit: ${stripStars(cleanValue(availability))}`);
    if (!isEmptyValue(shippingInfo)) extraLines.push(`🚚 Versand: ${stripStars(cleanValue(shippingInfo))}`);
  }

  // --- 6) CTA Block
  let ctaBlock = "";
  if (!isEmptyValue(affiliateUrl)) {
    ctaBlock = `🛒 *DIREKT ZUM ANGEBOT!* 🚀\n${affiliateUrl}`;
  } else {
    ctaBlock = `🛒 *Interesse?* Antworte mit "Info" für Details.`;
  }

  // --- 7) Aufbau der finalen Nachricht
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
    .filter(Boolean)
    .join("\n\n");
  return message.trim();
}

// Export
module.exports = {
  createOfferMessage,
  // Für Tests / Debugging exportiere ich auch die Hilfen:
  _helpers: {
    stripStars,
    normalizeSpacesAndChars,
    boldPricesAndPercentsSafe,
    cleanValue,
    isEmptyValue,
  },
};
