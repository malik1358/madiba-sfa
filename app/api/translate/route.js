import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeText(value) {
  return String(value || "").trim();
}

async function translateWithGoogle(text, from, to) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Google translate request failed.");
  const payload = await response.json();
  const lines = Array.isArray(payload?.[0]) ? payload[0].map((chunk) => String(chunk?.[0] || "")).filter(Boolean) : [];
  return lines.join(" ").trim();
}

async function translateWithMyMemory(text, from, to) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(from)}|${encodeURIComponent(to)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("MyMemory translate request failed.");
  const payload = await response.json();
  return normalizeText(payload?.responseData?.translatedText);
}

export async function POST(request) {
  try {
    const body = await request.json();
    const text = normalizeText(body?.text);
    const from = normalizeText(body?.from || "ar").toLowerCase();
    const to = normalizeText(body?.to || "en").toLowerCase();

    if (!text) {
      return NextResponse.json({ success: false, error: "Text is required." }, { status: 400 });
    }

    let translated = "";
    let provider = "google";

    try {
      translated = await translateWithGoogle(text, from, to);
    } catch {
      provider = "mymemory";
      translated = await translateWithMyMemory(text, from, to);
    }

    if (!translated) translated = text;

    return NextResponse.json({
      success: true,
      translatedText: translated,
      provider,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message || "Unable to translate text.",
    }, { status: 500 });
  }
}
