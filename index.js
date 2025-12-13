// index.js - JOYJOY 피드백 백엔드 (todayLesson JSON + todayActivityHtml LLM 1회 + HTML render)

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

const feedbackItems = require("./items/feedback_items.json"); // 🔥 경로 확인

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: "*" }));

// ---------------------------
// 0) OpenAI Client
// ---------------------------
function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ---------------------------
// 1) 공통 유틸
// ---------------------------
function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeParseJsonFromText(s) {
  if (!s) throw new Error("Empty model output");
  const text = String(s).trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model output");
  }
  const jsonOnly = text.slice(start, end + 1);
  return JSON.parse(jsonOnly);
}

// <br>만 허용, 다른 태그 제거 (보수적 sanitize)
function sanitizeBrOnly(html = "") {
  const t = String(html || "");
  return t
    .replace(/<(?!br\s*\/?>)[^>]+>/gi, "") // <br> 제외 태그 제거
    .replace(/\r?\n/g, ""); // 줄바꿈 제거
}

// (옵션) line3가 비어있을 때 안전 문장
function getSafeLine3(line3) {
  const t = (line3 || "").trim();
  return t.length > 0 ? t : "교사의 안내에 따라 천천히 참여해 보였어요.";
}

// 선택된 option 라벨 찾기
function getSelectedOptionLabel(itemId, value) {
  const key = `item${itemId}`;
  const meta = feedbackItems[key];
  if (!meta || !meta.options) return "";
  const opt = meta.options.find((o) => String(o.value) === String(value));
  return opt ? opt.label : "";
}

// ---------------------------
// 2) (기존) DevParagraph 생성용 LLM 프롬프트/함수
//     - /api/auto-feedback 용
// ---------------------------
const DEV_PARA_BATCH_INSTRUCTIONS_V12 = `
[출력 규칙]
- 출력은 반드시 한 줄(JSON 한 덩어리)로만 반환한다. 줄바꿈을 포함하지 않는다.
- JSON 이외의 텍스트를 출력하면 실패다.
- 제목, 활동 설명, 번호, 불릿, 레벨 숫자(1~4)는 절대 작성하지 마라.
- 오직 devParagraph(3문장, 3줄)만 작성하라.
- 각 문장은 줄바꿈 1회로 구분(총 3줄)
- title/line2/line3 내용을 벗어난 추측 추가 금지
- 아이 이름은 devParagraph 당 최대 1회 사용(안 써도 됨)
- label/value는 내부 점수이며, 어떤 문장에도 2: 같은 점수 표기를 절대 출력하지 않는다.

너는 조이조이(JoyJoy) 수업 피드백에서 ‘월령 기반 발달 맥락 해석 문단’만 작성하는 AI다.

[입력]
- 아동 이름, 월령
- items: 각 item은 id, title, line2(활동 설명), line3(교사 관찰)로 구성

[출력 형식: JSON만]
{
  "items": [
    { "id": 1, "devParagraph": "문장1\\n문장2\\n문장3" },
    ...
  ]
}

[금지]
- 진단/검사/치료/지연/장애/ADHD/자폐 등 의료/진단 뉘앙스 금지
- 또래 대비 우열/비교(“또래보다”, “뛰어남”) 금지
- 불안 유발 표현(걱정/문제/이상/부족) 금지

[표현 톤]
- 긍정적이고 안정적인 한국어 존댓말
- 예: “~시기예요.” “~단계로 보여요.” “~경험이 중요해요.”
`.trim();

// 3줄 강제 보정
function normalize3Lines(dev) {
  const lines = String(dev || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (lines.length >= 3) return `${lines[0]}\n${lines[1]}\n${lines[2]}`;

  const s = String(dev || "").replace(/\r?\n/g, " ").trim();
  const sentences = s
    .split(/(?<=[.!?]|요\.)\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const a = sentences[0] || s;
  const b = sentences[1] || sentences[0] || s;
  const c = sentences[2] || sentences[1] || sentences[0] || s;
  return `${a}\n${b}\n${c}`;
}

// item 1개 섹션(제목 + line2 + LLM문단) 만들기
function buildFinalSection({ title, line2, devParagraph }) {
  return `${title}
${line2}

${devParagraph}`.trim();
}

// LLM 실패 시 템플릿 기반 백업문
function buildFallbackText(data) {
  const name = data.childName || "아이";
  const ageMonth = data.ageMonth ? Number(data.ageMonth) : null;
  const items = Array.isArray(data.items) ? data.items : [];

  const header = ageMonth
    ? `${ageMonth}개월 ${name}의 오늘 수업 참여 모습을 정리해 보았어요.`
    : `${name}의 오늘 수업 참여 모습을 정리해 보았어요.`;

  const bullets = items
    .map((it) => {
      const key = `item${it.id}`;
      const meta = feedbackItems[key];
      if (!meta) return "";

      const optionLabel = getSelectedOptionLabel(it.id, it.value);
      const baseText = `${meta.line2} ${optionLabel}`.trim();
      return baseText ? `● ${baseText}` : "";
    })
    .filter(Boolean);

  if (bullets.length === 0) return header;
  return `${header}\n\n${bullets.join("\n\n")}`;
}

async function generateDevParagraphsBatch({ name, ageMonth, itemsForLLM }) {
  const client = getOpenAIClient();
  if (!client) throw new Error("OPENAI_API_KEY missing");

  const payload = {
    childName: name,
    ageMonth,
    items: itemsForLLM.map((x) => ({
      id: x.id,
      title: x.title,
      line2: x.line2,
      line3: x.line3,
    })),
  };

  const requestOptions = {
    model: "gpt-4.1-mini-2025-04-14",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              DEV_PARA_BATCH_INSTRUCTIONS_V12 +
              "\n\n" +
              "반드시 JSON만 출력한다. JSON 외 텍스트는 절대 출력하지 않는다.\n" +
              "devParagraph에는 숫자 레벨(예: '4:', '3')을 절대 포함하지 마라.",
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(payload) }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "joyjoy_dev_paragraph_batch",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["items"],
          properties: {
            items: {
              type: "array",
              minItems: 1,
              maxItems: 6,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "devParagraph"],
                properties: {
                  id: { type: "integer" },
                  devParagraph: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    max_output_tokens: 900,
  };

  let raw = "";
  try {
    const resp = await client.responses.create(requestOptions);
    raw = resp.output_text || "";
  } catch (e) {
    console.error("❌ generateDevParagraphsBatch first call failed:", e);
    // 1회 재시도
    const resp2 = await client.responses.create(requestOptions);
    raw = resp2.output_text || "";
  }

  const obj = safeParseJsonFromText(raw);
  const arr = Array.isArray(obj?.items) ? obj.items : [];

  const map = new Map();
  for (const it of arr) {
    const id = Number(it?.id);
    const dev = typeof it?.devParagraph === "string" ? it.devParagraph.trim() : "";
    if (!Number.isNaN(id) && dev) map.set(id, normalize3Lines(dev));
  }
  return map;
}

async function generateLLMFeedback(data) {
  const fallbackText = buildFallbackText(data);

  const name = data.childName || "아이";
  const ageMonth = data.ageMonth ? Number(data.ageMonth) : null;
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) return fallbackText;

  const client = getOpenAIClient();
  if (!client) {
    console.warn("OPENAI_API_KEY가 설정되어 있지 않습니다. 템플릿 문장만 사용합니다.");
    return fallbackText;
  }

  try {
    const itemsForLLM = [];
    for (const it of items) {
      const key = `item${it.id}`;
      const meta = feedbackItems[key];
      if (!meta) continue;

      itemsForLLM.push({
        id: Number(it.id),
        title: meta.line1 || "",
        line2: meta.line2 || "",
        line3: getSelectedOptionLabel(it.id, it.value) || getSafeLine3(""),
      });
    }

    if (itemsForLLM.length === 0) return fallbackText;

    const devMap = await generateDevParagraphsBatch({ name, ageMonth, itemsForLLM });

    const sections = [];
    for (const x of itemsForLLM) {
      const devParagraph =
        devMap.get(x.id) ||
        normalize3Lines(
          "이 월령의 아이들은 다양한 경험을 통해 감각과 조절 능력을 천천히 키워 가는 시기예요.\n교사의 안내 속에서 활동을 이어가며 스스로 시도하려는 모습이 관찰되었어요.\n반복 경험이 쌓일수록 더 편안하고 자연스럽게 확장될 수 있어요."
        );

      sections.push(buildFinalSection({ title: x.title, line2: x.line2, devParagraph }));
    }

    return sections.join("\n\n");
  } catch (err) {
    console.error("OpenAI 호출 중 에러:", err);
    return fallbackText;
  }
}

// ---------------------------
// 3) (신규) 오늘의 활동 HTML 생성 (LLM 1회)
//     - /api/feedback/html 용
// ---------------------------
const TODAY_ACTIVITY_HTML_INSTRUCTIONS = `
[출력 규칙]
- 출력은 반드시 JSON만 반환한다. (다른 텍스트 금지)
- JSON 형식:
  { "todayActivityHtml": "..." }

[작성 규칙]
- 반드시 ①~⑥ 번호를 사용한다.
- 각 항목은 '제목형식(① ...)' + 1~2문장
- 줄바꿈은 <br>만 사용 (다른 HTML 태그 금지)
- 발달 평가/진단/또래 비교/불안 유발 표현 금지
- 아이 이름/개월수 언급 금지
- 입력 items의 title(line1)/line2/line3(관찰)만 근거로 작성
`.trim();

async function generateTodayActivityHtml({ itemsForLLM }) {
  const client = getOpenAIClient();
  if (!client) throw new Error("OPENAI_API_KEY missing");

  if (!Array.isArray(itemsForLLM) || itemsForLLM.length === 0) {
    return "① 오늘 진행한 활동을 정리 중이에요.<br>② 수업 내용을 곧 확인하실 수 있어요.";
  }

  const payload = {
    items: itemsForLLM.map((x) => ({
      id: x.id,
      title: x.title,
      line2: x.line2,
      line3: x.line3,
    })),
  };

  const resp = await client.responses.create({
    model: "gpt-4.1-mini-2025-04-14",
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: TODAY_ACTIVITY_HTML_INSTRUCTIONS }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(payload) }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "joyjoy_today_activity_html",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["todayActivityHtml"],
          properties: {
            todayActivityHtml: { type: "string" },
          },
        },
      },
    },
    max_output_tokens: 700,
  });

  const raw = resp.output_text || "";
  const obj = safeParseJsonFromText(raw);
  return sanitizeBrOnly(obj.todayActivityHtml || "");
}

// ---------------------------
// 4) 수업 템플릿(JSON) 로더
//     templates/text/{month}.json 의 lessons[templateKey]
// ---------------------------
function loadLessonByTemplateKey(templateKey) {
  if (!templateKey || typeof templateKey !== "string") {
    throw new Error("templateKey가 필요합니다. 예: '12-3'");
  }

  const monthKeyRaw = templateKey.split("-")[0]; // "12-3" -> "12"
  if (!/^\d{1,2}$/.test(monthKeyRaw)) {
    throw new Error(`templateKey 형식이 올바르지 않습니다: ${templateKey}`);
  }

  const monthKey = String(Number(monthKeyRaw)).padStart(2, "0"); // "1" -> "01"
  const monthFilePath = path.join(process.cwd(), "templates", "text", `${monthKey}.json`);

  const raw = fs.readFileSync(monthFilePath, "utf-8");
  const monthJson = JSON.parse(raw);

  const lesson = monthJson?.lessons?.[templateKey];
  if (!lesson) {
    throw new Error(`해당 templateKey를 찾을 수 없습니다: ${templateKey} (file: ${monthKey}.json)`);
  }

  return lesson;
}

function renderTodayLesson(lesson) {
  // 문장 1개로 확정
  return (lesson?.todayLesson?.default || "").trim();
}

// ---------------------------
// 5) Routes
// ---------------------------
app.get("/", (req, res) => {
  res.send("JOYJOY Feedback Backend is running.");
});

// (기존) 자동 피드백 생성 API
app.post("/api/auto-feedback", async (req, res) => {
  try {
    const data = req.body || {};
    const llmText = await generateLLMFeedback(data);
    const ruleBasedText = buildFallbackText(data);

    return res.json({
      success: true,
      autoText: llmText,
      backupText: ruleBasedText,
    });
  } catch (err) {
    console.error("/api/auto-feedback 처리 중 에러:", err);
    return res.status(500).json({
      success: false,
      message: "자동 피드백 생성 중 오류가 발생했습니다.",
    });
  }
});

// (기존) 피드백 저장 API (현재는 수신만)
app.post("/api/feedback", (req, res) => {
  try {
    const data = req.body || {};
    return res.json({
      success: true,
      message: "피드백이 임시로 저장(수신)되었습니다.",
      received: data,
    });
  } catch (err) {
    console.error("피드백 저장 중 에러:", err);
    return res.status(500).json({
      success: false,
      message: "피드백 저장 중 오류 발생",
    });
  }
});

// (신규) HTML 생성 API: lessonTitle/todayLesson은 JSON, todayActivity는 LLM 1회
app.post("/api/feedback/html", async (req, res) => {
  try {
    const data = req.body || {};
    const templateKey = data.templateKey || "12-3";

    // A) 수업 JSON 로드
    const lesson = loadLessonByTemplateKey(templateKey);
    const lessonTitle = lesson.lessonTitle || templateKey;
    const todayLessonText = renderTodayLesson(lesson);

    // B) items -> itemsForLLM 구성
    const items = Array.isArray(data.items) ? data.items : [];
    const itemsForLLM = [];

    for (const it of items) {
      const key = `item${it.id}`;
      const meta = feedbackItems[key];
      if (!meta) continue;

      itemsForLLM.push({
        id: Number(it.id),
        title: meta.line1 || "",
        line2: meta.line2 || "",
        line3: getSelectedOptionLabel(it.id, it.value) || getSafeLine3(""),
      });
    }

    // C) 오늘의 활동 HTML (LLM 1회)
    let todayActivityHtml = "";
    try {
      todayActivityHtml = await generateTodayActivityHtml({ itemsForLLM });
    } catch (e) {
      console.error("todayActivityHtml LLM 실패:", e);
      todayActivityHtml = "① 오늘 진행한 활동을 정리 중이에요.<br>② 수업 내용을 곧 확인하실 수 있어요.";
    }

    // D) HTML 템플릿 로드 & 치환
    const templatePath = path.join(process.cwd(), "templates", "feedback_template.html");
    let html = fs.readFileSync(templatePath, "utf-8");

    html = html
      .replaceAll("{{LESSON_TITLE}}", escapeHtml(lessonTitle))
      .replaceAll("{{TODAY_LESSON}}", escapeHtml(todayLessonText))
      .replaceAll("{{TODAY_ACTIVITY}}", todayActivityHtml);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (err) {
    console.error(err);
    return res.status(500).send("피드백 HTML 생성 오류");
  }
});

// ---------------------------
// 6) Server Start
// ---------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ JOYJOY 서버 시작됨: ${PORT}`);
});
