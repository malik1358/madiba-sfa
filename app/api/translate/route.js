import { translateText } from "../../lib/translateText.js";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const text = String(body.text || "").trim();
    const from = String(body.from || "ar").trim();
    const to = String(body.to || "en").trim();

    if (!text) {
      return Response.json({ success: false, error: "Text is required" }, { status: 400 });
    }

    const translatedText = await translateText(text, { from, to });
    if (!translatedText) {
      return Response.json({ success: false, error: "Translation failed" }, { status: 502 });
    }

    return Response.json({ success: true, translatedText });
  } catch (error) {
    console.error("Translation error:", error);
    return Response.json(
      { success: false, error: error.message || "Translation failed" },
      { status: 500 },
    );
  }
}
