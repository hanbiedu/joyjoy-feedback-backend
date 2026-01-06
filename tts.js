import express from "express";
import textToSpeech from "@google-cloud/text-to-speech";

const router = express.Router();

function getClient() {
  const keyJson = process.env.GOOGLE_TTS_KEY_JSON;
  if (!keyJson) throw new Error("Missing GOOGLE_TTS_KEY_JSON");

  const credentials = JSON.parse(keyJson);
  return new textToSpeech.TextToSpeechClient({ credentials });
}

// 아주 간단한 메모리 캐시(같은 문장은 재생만 → 비용 절감)
const cache = new Map(); // key -> Buffer
const MAX_CACHE = 200;

router.post("/tts", async (req, res) => {
  try {
    const { ssml, text, voiceName } = req.body || {};
    const inputText = (ssml || text || "").trim();
    if (!inputText) return res.status(400).send("ssml or text is required");

    const cacheKey = JSON.stringify({ inputText, voiceName: voiceName || "ko-KR-Neural2-A" });
    if (cache.has(cacheKey)) {
      res.set("Content-Type", "audio/mpeg");
      return res.send(cache.get(cacheKey));
    }

    const client = getClient();

    const request = {
      input: ssml ? { ssml: inputText } : { text: inputText },
      voice: {
        languageCode: "ko-KR",
        name: voiceName || "ko-KR-Neural2-A",
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 0.92,
        pitch: 0.0,
      },
    };

    const [response] = await client.synthesizeSpeech(request);
    const audio = response.audioContent; // Buffer

    if (audio) {
      cache.set(cacheKey, audio);
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    }

    res.set("Content-Type", "audio/mpeg");
    res.send(audio);
  } catch (e) {
    console.error(e);
    res.status(500).send("TTS failed");
  }
});

export default router;
