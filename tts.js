const express = require("express");
const textToSpeech = require("@google-cloud/text-to-speech");

const router = express.Router();

function getClient() {
  const keyJson = process.env.GOOGLE_TTS_KEY_JSON;
  if (!keyJson) throw new Error("Missing GOOGLE_TTS_KEY_JSON");
  const credentials = JSON.parse(keyJson);
  return new textToSpeech.TextToSpeechClient({ credentials });
}

// ✅ 라우트 붙었는지 확인용
router.get("/tts-ping", (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ✅ 실제 TTS
router.post("/tts", async (req, res) => {
  try {
    const { ssml, text, voiceName } = req.body || {};
    const inputText = String(ssml || text || "").trim();
    if (!inputText) return res.status(400).send("ssml or text is required");

    const client = getClient();

    const request = {
      input: ssml ? { ssml: inputText } : { text: inputText },
      voice: {
        languageCode: "ko-KR",
        name: String(voiceName || "ko-KR-Neural2-A"),
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 0.92,
        pitch: 0.0,
      },
    };

    const [response] = await client.synthesizeSpeech(request);
    const audio = response.audioContent;

    if (!audio) return res.status(500).send("Empty audio");

    res.set("Content-Type", "audio/mpeg");
    res.send(audio);
  } catch (e) {
    console.error("[TTS ERROR]", e);
    res.status(500).send("TTS failed");
  }
});

module.exports = router;
