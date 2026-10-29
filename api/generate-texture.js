// Generates a battle-map floor texture, or a sheet of props, with Gemini.
//
//   - The prompt is assembled server-side from the description and an optional
//     environment and condition (see lib/mapprompt.js), so the clauses that make
//     the image usable as a floor are enforced here rather than left to whoever
//     is typing.
//   - There is NO sign-in on this endpoint. It spends the owner's key on every
//     call, so deploy it where only people you trust can reach it (a private
//     Vercel project, deployment protection, or a network allowlist), or put
//     your own check at the top of the handler.
//   - Returns the image bytes rather than base64 JSON; base64 inflates it by a
//     third for no benefit and the browser re-encodes it anyway. The caller
//     shrinks it client-side.

import { buildTexturePrompt, buildSpritesPrompt } from "../lib/mapprompt.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = "gemini-3.1-flash-image";

async function callGeminiImage(prompt, apiKey) {
  const res = await fetch(`${GEMINI_BASE}/${MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"] }
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error("Gemini returned no image data");
  return {
    buf: Buffer.from(part.inlineData.data, "base64"),
    mime: part.inlineData.mimeType || "image/png"
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  res.setHeader("Cache-Control", "no-store");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    return res.status(503).json({ error: "GEMINI_API_KEY is not configured on this deployment" });
  }

  try {
    /* Two things this endpoint makes, from the same description: the floor,
       and the sixteen props that stand on it. One endpoint rather than two
       because the shape of the call is identical and only the wrapper around
       the description differs. */
    const body = req.body || {};
    const prompt = body.kind === "sprites"
      ? buildSpritesPrompt(body)
      : buildTexturePrompt(body);
    const { buf, mime } = await callGeminiImage(prompt, apiKey.trim());
    res.setHeader("Content-Type", mime);
    res.setHeader("X-Prompt", encodeURIComponent(prompt.slice(0, 900)));
    return res.status(200).send(buf);
  } catch (err) {
    console.error("[generate-texture]", err && err.message);
    return res.status(502).json({ error: err.message || "generation_failed" });
  }
}
