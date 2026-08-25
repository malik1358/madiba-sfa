export function needsEnglishTranslation(arabicText, englishText) {
  const arabic = String(arabicText || "").trim();
  const english = String(englishText || "").trim();
  if (!arabic) return false;
  if (!english) return true;
  return english === arabic;
}

function parseGoogleTranslatePayload(payload) {
  const translated = Array.isArray(payload?.[0])
    ? payload[0].map((part) => String(part?.[0] || "")).join("")
    : "";
  return translated.trim();
}

function parseMyMemoryPayload(payload) {
  const translated = String(payload?.responseData?.translatedText || "").trim();
  if (!translated) return "";
  if (/^MYMEMORY WARNING:/i.test(translated)) return "";
  return translated;
}

async function translateWithGoogle(source, from, to) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(source)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "MadibaSFA/1.0 (translate)",
    },
  });

  if (!response.ok) return "";

  const payload = await response.json().catch(() => []);
  return parseGoogleTranslatePayload(payload);
}

async function translateWithMyMemory(source, from, to) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(source)}&langpair=${encodeURIComponent(from)}|${encodeURIComponent(to)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) return "";

  const payload = await response.json().catch(() => ({}));
  return parseMyMemoryPayload(payload);
}

export async function translateText(text, { from = "ar", to = "en" } = {}) {
  const source = String(text || "").trim();
  if (!source) return "";
  if (from === to) return source;

  const googleTranslated = await translateWithGoogle(source, from, to);
  if (googleTranslated) return googleTranslated;

  const myMemoryTranslated = await translateWithMyMemory(source, from, to);
  if (myMemoryTranslated) return myMemoryTranslated;

  return "";
}

export {
  parseGoogleTranslatePayload,
  parseMyMemoryPayload,
};
