export function needsEnglishTranslation(arabicText, englishText) {
  const arabic = String(arabicText || "").trim();
  const english = String(englishText || "").trim();
  if (!arabic) return false;
  if (!english) return true;
  return english === arabic;
}

export async function translateText(text, { from = "ar", to = "en" } = {}) {
  const source = String(text || "").trim();
  if (!source) return "";
  if (from === to) return source;

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(source)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "MadibaSFA/1.0 (translate)",
    },
  });

  if (!response.ok) return "";

  const payload = await response.json().catch(() => []);
  const translated = Array.isArray(payload?.[0])
    ? payload[0].map((part) => String(part?.[0] || "")).join("")
    : "";

  return translated.trim();
}
