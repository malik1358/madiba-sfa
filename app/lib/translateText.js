const TRANSLATION_CACHE_LIMIT = 200;
const translationCache = new Map();

export function needsEnglishTranslation(arabicText, englishText) {
  const arabic = String(arabicText || "").trim();
  if (!arabic) return false;
  // Arabic is the source of truth. Always refresh English so it cannot drift
  // from an older remark (e.g. "Will transfer today" left over after Arabic changed).
  void englishText;
  return true;
}

function cacheKey(from, to, source) {
  return `${from}|${to}|${source}`;
}

function readTranslationCache(from, to, source) {
  const key = cacheKey(from, to, source);
  if (!translationCache.has(key)) return "";
  const value = translationCache.get(key);
  // Refresh insertion order for a simple LRU behaviour.
  translationCache.delete(key);
  translationCache.set(key, value);
  return value;
}

function writeTranslationCache(from, to, source, translated) {
  const key = cacheKey(from, to, source);
  if (translationCache.has(key)) translationCache.delete(key);
  translationCache.set(key, translated);
  while (translationCache.size > TRANSLATION_CACHE_LIMIT) {
    const oldestKey = translationCache.keys().next().value;
    translationCache.delete(oldestKey);
  }
}

export function clearTranslationCache() {
  translationCache.clear();
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

  const cached = readTranslationCache(from, to, source);
  if (cached) return cached;

  const googleTranslated = await translateWithGoogle(source, from, to);
  if (googleTranslated) {
    writeTranslationCache(from, to, source, googleTranslated);
    return googleTranslated;
  }

  const myMemoryTranslated = await translateWithMyMemory(source, from, to);
  if (myMemoryTranslated) {
    writeTranslationCache(from, to, source, myMemoryTranslated);
    return myMemoryTranslated;
  }

  return "";
}

export {
  parseGoogleTranslatePayload,
  parseMyMemoryPayload,
};
