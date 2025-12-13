// index.js - JOYJOY 피드백 백엔드 (line2 + options + LLM)

// ---------------------------
// 0) 기본 서버 셋업
// ---------------------------
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

try {
  require.resolve("openai");
  console.log("✅ openai 모듈 로드 가능");
} catch (e) {
  console.log("❌ openai 모듈 로드 불가", e?.message);
}



const feedbackItems = require("./items/feedback_items.json"); // 🔥 경로 주의!

const app = express();

// OpenAI SDK는 호출 시점에 client를 생성합니다(키 누락/갱신 이슈 방지)

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: "*",
  })
);

app.get("/", (req, res) => {
  res.send("JOYJOY Feedback Backend is running.");
});

// ---------------------------
// 1) 관찰 텍스트 생성 유틸들
// ---------------------------

// 선택된 option 라벨 찾기
function getSelectedOptionLabel(itemId, value) {
  const key = `item${itemId}`;
  const meta = feedbackItems[key];
  if (!meta || !meta.options) return "";
  const opt = meta.options.find((o) => String(o.value) === String(value));
  return opt ? opt.label : "";
}

// 각 활동별 line2 + 선택 옵션 문장을 합쳐 "관찰 내용" 만들기
function buildActivitiesText(ageMonth, items) {
  return items
    .map((it, idx) => {
      const key = `item${it.id}`;
      const meta = feedbackItems[key];
      if (!meta) return "";

      const optionLabel = getSelectedOptionLabel(it.id, it.value);
      const baseText = `${meta.line2} ${optionLabel}`.trim();

      return `${idx + 1}. ${meta.line1}
- 관찰 내용: ${baseText}
- 선택 수준(level): ${it.value}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

// LLM에 넘길 프롬프트 만들기
// ---------------------------
// 1) LLM 프롬프트 v1.2 (발달 맥락 문단 전용)
//    - LLM은 "문단 3문장"만 생성
//    - 제목(①...) + line2는 서버가 고정 출력
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


// (옵션) line3가 비어있을 때를 대비한 안전 문장
function getSafeLine3(line3) {
  const t = (line3 || "").trim();
  return t.length > 0 ? t : "교사의 안내에 따라 천천히 참여해 보였어요.";
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

// ---------------------------
// 2) OpenAI LLM 호출 (Responses API)
// ---------------------------
// ---------------------------
// 2) OpenAI LLM 호출 (SDK + Responses API)
//    - item별로 "발달 맥락 문단(3문장)"만 생성
// ---------------------------
async function generateDevParagraphsBatch({ name, ageMonth, itemsForLLM }) {
  console.log("🔥 generateDevParagraphsBatch HIT", process.env.RENDER_GIT_COMMIT);

  // ✅ OpenAI client 생성(스코프 문제 해결)
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

  const resp = await client.responses.create({
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

    // ✅ 너의 파싱(it.id / it.devParagraph)과 100% 일치하는 스키마로 고정
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
                  devParagraph: { type: "string" }
                }
              }
            }
          }
        }
      }
    },
    

    // 6개 × 3문장이라 300은 빠듯할 수 있어 약간 여유
    max_output_tokens: 900,
  });

  // ✅ output_text 직파싱 (extractOutputText 불필요)
  // const jsonText = (resp.output_text || "").trim();
  // if (!jsonText) throw new Error("Empty output_text");
  // const obj = JSON.parse(jsonText);

  const raw = (resp.output_text || "");
  


  console.log("🧾 resp.output_text length:", raw.length);
  console.log("🧾 resp.output_text head:", raw.slice(0, 200));
  console.log("🧾 resp.output_text tail:", raw.slice(-200));

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

function safeParseJsonFromText(s) {
  if (!s) throw new Error("Empty model output");
  const text = s.trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model output");
  }

  const jsonOnly = text.slice(start, end + 1);
  return JSON.parse(jsonOnly);
}




// 3줄 강제(모델이 살짝 흔들려도 안전장치)
function normalize3Lines(dev) {
  // 줄 기준으로 자르고 3줄로 맞추기
  const lines = dev.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  if (lines.length >= 3) return `${lines[0]}\n${lines[1]}\n${lines[2]}`;

  // 줄이 1~2줄이면 문장 단위로 쪼개서 보정
  const s = dev.replace(/\r?\n/g, " ").trim();
  const sentences = s.split(/(?<=[.!?]|요\.)\s+/).map(t => t.trim()).filter(Boolean);

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

async function generateLLMFeedback(data) {
  const fallbackText = buildFallbackText(data);

  const name = data.childName || "아이";
  const ageMonth = data.ageMonth ? Number(data.ageMonth) : null;
  const items = Array.isArray(data.items) ? data.items : [];

  if (items.length === 0) return fallbackText;

  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY가 설정되어 있지 않습니다. 템플릿 문장만 사용합니다.");
    return fallbackText;
  }

  try {
    // 1) LLM에 보낼 item 목록 구성
    const itemsForLLM = [];
    for (const it of items) {
      const key = `item${it.id}`;
      const meta = feedbackItems[key];
      if (!meta) continue;

      itemsForLLM.push({
        id: Number(it.id),
        title: meta.line1 || "",
        line2: meta.line2 || "",
        line3: getSelectedOptionLabel(it.id, it.value) || "교사의 안내에 따라 천천히 참여해 보였어요.",
      });
    }

    if (itemsForLLM.length === 0) return fallbackText;

    // 2) ✅ 여기서 LLM 1회 호출로 id->devParagraph 맵 받기
    const devMap = await generateDevParagraphsBatch({ name, ageMonth, itemsForLLM });

    // 3) 서버가 최종 섹션 조립
    const sections = [];
    for (const x of itemsForLLM) {
      const devParagraph = devMap.get(x.id) || normalize3Lines("이 월령의 아이들은 다양한 경험을 통해 감각과 조절 능력을 천천히 키워 가는 시기예요.\n교사의 안내 속에서 활동을 이어가며 스스로 시도하려는 모습이 관찰되었어요.\n반복 경험이 쌓일수록 더 편안하고 자연스럽게 확장될 수 있어요.");
      sections.push(buildFinalSection({ title: x.title, line2: x.line2, devParagraph }));
    }

    // ✅ 섹션 구분 줄바꿈
    return sections.join("\n\n");
  } catch (err) {
    console.error("OpenAI 호출 중 에러:", err);
    return fallbackText;
  }
}


// ---------------------------
// 3) 자동 피드백 생성 API
// ---------------------------
app.post("/api/auto-feedback", async (req, res) => {
  try {
    console.log("💥 /api/auto-feedback 호출됨!");
    const data = req.body || {};
    console.log("auto-feedback 요청 데이터:", JSON.stringify(data, null, 2));

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

// ---------------------------
// 4) 피드백 저장 API (현재는 콘솔 로그만)
// ---------------------------
app.post("/api/feedback", (req, res) => {
  try {
    const data = req.body || {};
    console.log("피드백 저장 요청 도착:", JSON.stringify(data, null, 2));

    // TODO: 나중에 여기서 DB 저장 추가

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

// ---------------------------
// 5) 서버 실행
// ---------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🔥 JOYJOY LLM 서버 시작됨!");
  console.log(`✅ Server listening on port ${PORT}`);
});
