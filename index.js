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

// const feedbackItems = require("./items/feedback_items.json"); // 🔥 경로 주의!

const app = express();

// OpenAI SDK는 호출 시점에 client를 생성합니다(키 누락/갱신 이슈 방지)

app.use(express.json({ limit: "1mb" }));

// ✅ JSON body 파싱 실패를 JSON으로 반환 (라우트보다 위에 있어야 함)
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    console.error("[JSON_PARSE_ERROR]", err.message);
    return res.status(400).json({
      success: false,
      message: "Invalid JSON body",
      debug_error: err.message,
    });
  }
  next(err);
});

app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: "*",
  })
);

const ttsRouter = require("./tts");
app.use("/api", ttsRouter);






app.get("/", (req, res) => {
  res.send("JOYJOY Feedback Backend is running.");
});

// ---------------------------
// ✅ 12-3 클레이 "평균(월령) 맥락" 적용 규칙(서버 고정)
// - 비교 가능한 항목에만 적용: ① ② ③ ⑤
// - 나머지(④ ⑥)는 평균/월령 언급 금지
// ---------------------------
const AGE_NORM_ALLOWED_IDS = new Set([1, 2, 3, 5]);

// ---------------------------
// 1) 관찰 텍스트 생성 유틸들
// ---------------------------

// ---------------------------
// 1) LLM 프롬프트 v1.3 (발달 맥락 문단 전용 + 12-3 규칙 반영)
// ---------------------------
const DEV_PARA_BATCH_INSTRUCTIONS_V13 = `
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

- items: 각 item은 id, title, line2(활동 설명), line3(교사 관찰), useAgeNorm(boolean)로 구성
  - useAgeNorm=true: "월령 평균(이 시기/34개월 전후)" 맥락을 허용
  - useAgeNorm=false: "월령 평균/또래 일반화" 표현을 금지(월령/이 시기/34개월 전후/또래 등 언급 금지)


  [스타일 룰(styleRules) - 적용 규칙]
- 입력 JSON에 styleRules가 있으면, devParagraph의 '표현 방식'만 styleRules에 맞게 조절하라.
- 사실(= title/line2/line3에 있는 내용)과 관찰의 의미를 바꾸지 마라. 새로운 사실을 추가하지 마라.
- 길이/문장 스타일:
  - styleRules.length=short: 각 문장을 짧고 단순하게 쓴다(불필요한 설명 최소화).
  - styleRules.sentenceStyle=shortSentences: 문장 길이를 짧게 유지한다.
- 톤:
  - tone=professional: 더 담백하고 정보 중심(과한 감탄/이모지 금지)
  - tone=warm: 더 따뜻하고 공감 문장 1개까지 허용(과장 금지)
  - tone=neutralWarm: 기본(담백+부드럽게)

- mustAvoid에 해당하는 표현은 추가로 금지한다(진단/또래비교/불안유발/숙제톤 등).

[추가 출력 - 총평(summary)]
- summary는 수업 전체를 한 단락으로 정리한 문장이다.
- 개별 활동을 1~5번처럼 나열하지 말고, 공통 흐름/참여 모습/경험의 의미를 묶어라.
- 부모성향(styleRules)을 가장 적극적으로 반영하라(톤/정보 밀도/관점).
- styleRules.focus에 따라 summary의 첫 문장 초점을 정한다:
  - participation: 참여 태도/집중/시도 중심
  - emotionalSafety: 편안함/안정감/즐거움 중심
  - developmentMeaning: 경험의 의미/쌓임 중심
  - ageFit: 무리 없는 흐름/자연스러운 과정 중심
- title/line2/line3 범위를 벗어난 새로운 사실(예: 집에서의 행동, 성향 단정)은 추가하지 마라.
- 진단/또래비교/불안유발 표현은 devParagraph와 동일하게 금지한다.
- 길이는 2~3문장으로 제한한다(줄바꿈 없이 한 줄 텍스트).
- '총평', '마무리', 번호, 제목 같은 표식은 쓰지 말고 문장만 출력하라.
- summary에는 아이 이름을 최대 1회만 사용할 수 있다(안 써도 됨).


[핵심 작성 규칙 - 12-3 표준]
- useAgeNorm=true인 항목에서만 월령 맥락(예: '이 시기의 아이들', '34개월 전후')을 사용할 수 있다.
- 월령 맥락 문구는 문장 '도입부 고정'으로 반복하지 말고, 문장 중간/후반에 자연스럽게 섞어라.
  - 금지 예: "이 시기의 아이들은 ..."로 1문장 시작
  - 권장 예: "…경험은 34개월 전후에 중요한 역할을 해요."
- 월령 맥락은 3문장 중 최대 1~2문장에만 사용하고, 나머지는 관찰(line2/line3) 기반 해석으로 구성하라.
- useAgeNorm=false 항목은 오직 '아이의 관찰 + 의미'로만 작성하라(월령/또래/평균/이 시기 등 언급 금지).

[금지]
- 진단/검사/치료/지연/장애/ADHD/자폐 등 의료/진단 뉘앙스 금지
- 또래 대비 우열/비교(“또래보다”, “뛰어남”) 금지
- 불안 유발 표현(걱정/문제/이상/부족) 금지

[표현 톤]
- 긍정적이고 안정적인 한국어 존댓말
- 예: “~시기예요.” “~단계로 보여요.” “~경험이 중요해요.”
`.trim();


// ---------------------------
// 주간 요약(summary_json) 전용 프롬프트
// ---------------------------
const WEEKLY_SUMMARY_BY_DOMAIN_PROMPT = `
너는 조이조이(JoyJoy) 주간 수업 요약 생성기다.

출력은 반드시 JSON 하나로만 반환한다.

규칙:
1) summary_by_domain은 아래 5개 키를 반드시 모두 포함한다.
   - sensory, cognition, language, motor, social
2) 각 값은 부모 홈 화면에 바로 보여줄 한 줄 요약이다.
3) 과장, 진단, 비교 표현은 금지한다.
4) 해당 영역의 관찰 item이 없으면
   "이번 수업은 활동 참여 중심으로 관찰했어요."를 사용한다.
`.trim();





// ---------------------------
// 부모성향(설문) → LLM 스타일 룰 변환
// parentPref 형태: { q1:"1~4", q2:"1~4", q3:"1~4" }
// ---------------------------
function buildStyleRules(parentPref) {
  const q1 = String(parentPref?.q1 ?? "").trim();
  const q2 = String(parentPref?.q2 ?? "").trim();
  const q3 = String(parentPref?.q3 ?? "").trim();

  // ✅ 기본값(설문이 없거나 깨졌을 때도 안전하게)
  const rules = {
    // devParagraph는 3문장/3줄 고정이므로,
    // "길이"는 문장 길이/정보량을 조절하는 용도
    length: "medium",               // short | medium | long
    tone: "neutralWarm",            // neutralWarm | warm | professional
    sentenceStyle: "normal",        // shortSentences | normal
    focus: [],                      // ["participation","varietyExperience","developmentMeaning","ageFit","emotionalSafety"]
    ctaStyle: "optional",           // optional | options | stepByStep
    ctaCount: 1,                    // 0~2 (문장 수 제한상 2 넘기지 말기)
    reassuranceLevel: "low",        // low | medium | high
    mustAvoid: [
      "medicalDiagnosis",
      "peerComparison",
      "anxietyTrigger",
      "homeworkTone",
    ],
  };

  // ---------------------------
  // Q1: 피드백에서 궁금한 것
  // 1 월령 적합 / 2 반응·참여 / 3 발달 도움 / 4 편안·즐거움
  // (설문 문구는 pasted.txt 참고) :contentReference[oaicite:2]{index=2}
  // ---------------------------
  if (q1 === "1") rules.focus.push("ageFit");
  if (q1 === "2") rules.focus.push("participation");
  if (q1 === "3") rules.focus.push("developmentMeaning");
  if (q1 === "4") rules.focus.push("emotionalSafety");

  // ---------------------------
  // Q2: 선택 이유
  // 1 발달경험 / 2 다양한 놀이 / 3 안정 / 4 맞춤
  // ---------------------------
  if (q2 === "1") rules.focus.push("developmentMeaning");
  if (q2 === "2") rules.focus.push("varietyExperience");
  if (q2 === "3") rules.focus.push("emotionalSafety");
  if (q2 === "4") rules.focus.push("personalization");



  // ---------------------------
  // 불안 완화 강도(안정/월령중심이면 조금 올림)
  // ---------------------------
  // 길이(정보 밀도) – q1/q2만 반영
  if (q1 === "3" || q2 === "1" || q2 === "4") {
    rules.length = "long";   // 발달 의미/맞춤 관심
  } else {
    rules.length = "medium"; // 기본
  }


  // ---------------------------
  // 중복 제거 + focus 비었으면 기본값
  // ---------------------------
  rules.focus = Array.from(new Set(rules.focus));
  if (rules.focus.length === 0) rules.focus = ["participation"];

  return rules;
}





async function fetchParentPrefFromPhp(parent_id) {
  if (!parent_id) return null;



  const url = `https://jo2jo2.co.kr/feedback/parents/getParentPref.php?parent_id=${encodeURIComponent(parent_id)}`;

  try {
    const fetch = global.fetch || require("node-fetch");
    const r = await fetch(url, { method: "GET" });
    const txt = await r.text(); // 먼저 text로 받고
    let j = null;
    try { j = JSON.parse(txt); } catch { }

    console.log("fetchParentPrefFromPhp status:", r.status, "body:", txt.slice(0, 200));

    if (!r.ok || !j || j.ok !== true) return null;
    return j.answers || null;
  } catch (e) {
    console.error("fetchParentPrefFromPhp error:", e?.message || e);
    console.error("fetchParentPrefFromPhp cause:", e?.cause || null);
    return null;
  }
}



function toKidCallName(fullName = "") {
  const name = String(fullName).trim().split(/\s+/).pop() || "";
  const isHangul = /^[가-힣]+$/.test(name);

  if (!isHangul) return name; // 영문/기타는 그대로

  const doubleSurnames = new Set([
    "남궁", "제갈", "선우", "서문", "황보", "독고", "사공", "공손", "동방", "어금", "망절", "장곡"
  ]);

  // 복성 + 이름(2) = 4글자
  if (name.length === 4 && doubleSurnames.has(name.slice(0, 2))) {
    const given = name.slice(2); // 2글자
    return given; // "민수"
  }

  // 일반 성(1) + 이름(2) = 3글자
  if (name.length === 3) {
    return name.slice(1); // "한비"
  }

  // 성(1) + 이름(1) = 2글자
  if (name.length === 2) {
    return name.slice(1) + "이"; // "윤이"
  }

  // 그 외(예: 4글자 이상인데 복성 아님 / 예외 이름): 마지막 2글자 권장
  if (name.length >= 2) return name.slice(-2);

  return name;
}


function escapeRegExp(s = "") {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * fullName(백채유) → callName(채유)로 통일하고,
 * callName/fullName 뒤에 붙은 '님/씨'를 (공백 포함) 제거한다.
 */
function normalizeKidNameInText(text, fullName) {
  try {
    if (!text) return text;

    const full = String(fullName || "").trim();
    const call = toKidCallName(full);

    // full이 비어있으면 "님/씨"만 정리하지 말고 그대로 반환 (안전)
    if (!full) return text;

    const fullEsc = escapeRegExp(full);
    const callEsc = escapeRegExp(call);

    text = text.replace(
      new RegExp(`${fullEsc}\\s*(은|는|이|가|을|를|와|과)`, "g"),
      `${call}$1`
    );

    // 1) "백채유 님" / "백채유님" / "백채유  님은" → "채유는"
    text = text.replace(new RegExp(`${fullEsc}\\s*(님|씨)`, "g"), call);

    // 2) callName 쪽도 동일 정리: "채유 님" → "채유"
    text = text.replace(new RegExp(`${callEsc}\\s*(님|씨)`, "g"), call);

    // 3) 조사 붙는 케이스까지 정리: "채유 님은" → "채유는"
    // (위 1,2로 대부분 해결되지만 안전하게)
    text = text.replace(new RegExp(`${callEsc}\\s*(은|는|이|가|을|를|와|과)`, "g"), `${call}$1`);

    return text;
  } catch (e) {
    console.error("normalizeKidNameInText ERROR:", e?.stack || e);
    return text; // 실패해도 원문 반환 (절대 생성이 멈추지 않게)
  }
}

// (옵션) line3가 비어있을 때를 대비한 안전 문장
function getSafeLine3(line3) {
  const t = (line3 || "").trim();
  return t.length > 0 ? t : "교사의 안내에 따라 천천히 참여해 보였어요.";
}

// LLM 실패 시 템플릿 기반 백업문
function buildFallbackText(pack, data) {
  const name = data.childName || data.child_name || "아이";
  const ageMonthRaw = data.ageMonth ?? data.age_month;
  const ageMonth =
    ageMonthRaw !== undefined && ageMonthRaw !== null && ageMonthRaw !== ""
      ? Number(ageMonthRaw)
      : null;

  const items = Array.isArray(data.items) ? data.items : [];

  const header = ageMonth
    ? `${ageMonth}개월 ${name}의 오늘 수업 참여 모습을 정리해 보았어요.`
    : `${name}의 오늘 수업 참여 모습을 정리해 보았어요.`;

  const bullets = items
    .map((it) => {
      const id = Number(it.id);
      if (!Number.isFinite(id)) return "";

      const key = `item${id}`;
      const meta = pack?.[key];
      if (!meta) return ""; // pack에 없는 item은 스킵 (예: item6 등)

      const optionLabel =
        meta.options?.find((o) => String(o.value) === String(it.value))?.label || "";

      // label이 "1: ..." 형태면 번호 제거하고 문장만 쓰고 싶을 때:
      const cleanedLabel = optionLabel.replace(/^\s*\d+\s*:\s*/, "").trim();

      const baseText = `${meta.line2} ${cleanedLabel}`.trim();
      return baseText ? `● ${baseText}` : "";
    })
    .filter(Boolean);

  if (bullets.length === 0) return header;
  return `${header}\n\n${bullets.join("\n\n")}`;
}


// ---------------------------
// 2) OpenAI LLM 호출 (SDK + Responses API)
//    - item별로 "발달 맥락 문단(3문장)"만 생성
// ---------------------------
async function generateDevParagraphsBatch({ name, ageMonth, itemsForLLM, styleRules }) {
  console.log("🔥 generateDevParagraphsBatch HIT", process.env.RENDER_GIT_COMMIT);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const payload = {
    childName: name,
    ageMonth,
    styleRules: styleRules || null,
    items: itemsForLLM.map((x) => ({
      id: x.id,
      domain: x.domain || null,
      title: x.title,
      line2: x.line2,
      line3: x.line3,
      useAgeNorm: !!x.useAgeNorm,
    })),
  };

  const reqOptions = {
    model: "gpt-4.1-mini-2025-04-14",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              DEV_PARA_BATCH_INSTRUCTIONS_V13 +
              "\n\n" +
              "반드시 JSON만 출력한다. JSON 외 텍스트는 절대 출력하지 않는다.\n" +
              "devParagraph에는 숫자 레벨(예: '4:', '3')을 절대 포함하지 마라.\n" +
              "items 배열과 summary 문자열, summary_by_domain 객체를 반드시 함께 출력한다.",
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
          required: ["items", "summary", "summary_by_domain"],
          properties: {
            items: {
              type: "array",
              minItems: 1,
              maxItems: 12,
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
            summary: { type: "string" },
            summary_by_domain: {
              type: "object",
              additionalProperties: false,
              required: ["sensory", "cognition", "language", "motor", "social"],
              properties: {
                sensory: { type: "string" },
                cognition: { type: "string" },
                language: { type: "string" },
                motor: { type: "string" },
                social: { type: "string" },
              },
            },
          },
        },
      },
    },
    max_output_tokens: 900,
  };

  async function callOnce() {
    const resp = await client.responses.create(reqOptions);
    return (resp.output_text || "");
  }

  let raw = await callOnce();
  let obj;

  try {
    obj = safeParseJsonFromText(raw);
  } catch (e) {
    console.error("❌ JSON parse failed. retry once.", e);
    const raw2 = await callOnce();
    obj = safeParseJsonFromText(raw2);
  }

  const arr = Array.isArray(obj?.items) ? obj.items : [];

  const devMap = new Map();
  for (const it of arr) {
    const id = Number(it?.id);
    const dev = typeof it?.devParagraph === "string" ? it.devParagraph.trim() : "";
    if (!Number.isNaN(id) && dev) devMap.set(id, normalize3Lines(dev));
  }

  let summary = typeof obj?.summary === "string" ? obj.summary.trim() : "";
  if (summary) {
    summary = summary.replace(/\r?\n+/g, " ").replace(/\s{2,}/g, " ").trim();
  }

  // ✅ 여기서 선언(이게 없어서 ReferenceError 났던 것)
  const summary_by_domain =
    obj?.summary_by_domain && typeof obj.summary_by_domain === "object"
      ? obj.summary_by_domain
      : null;

  return { devMap, summary, summary_by_domain };
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
  const lines = dev.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  if (lines.length >= 3) return `${lines[0]}\n${lines[1]}\n${lines[2]}`;

  const s = dev.replace(/\r?\n/g, " ").trim();
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


const fs = require("fs");
const path = require("path");

const ITEMS_DIR = path.join(__dirname, "items");

function loadMonthItems(month) {
  const filePath = path.join(ITEMS_DIR, `item${month}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`items file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function getTemplateItemById(monthItems, lessonKey, id) {
  const lesson = monthItems?.[lessonKey];
  if (!lesson) return null;
  const key = `item${Number(id)}`;
  return lesson?.[key] || null;
}

/**
 * DB에 저장된 items_json이 구버전([{id,value}])이어도
 * 템플릿(item{month}.json)로부터 domain/line1/line2를 채워서 반환한다.
 *
 * - 신버전([{id,value,domain,...}])은 그대로 통과
 * - value는 Number로 정규화
 */
function enrichItemsWithDomain(itemsArr, monthItems, lessonKey) {
  const src = Array.isArray(itemsArr) ? itemsArr : [];

  return src
    .map((it) => {
      const id = Number(it?.id);
      if (!Number.isFinite(id) || id <= 0) return null;

      const valueRaw = it?.value;
      const value =
        valueRaw === "" || valueRaw === null || valueRaw === undefined
          ? null
          : Number(valueRaw);

      // 이미 domain이 있으면 그대로 사용(신버전)
      if (it?.domain) {
        return {
          id,
          value,
          domain: String(it.domain),
          line1: it.line1 ? String(it.line1) : undefined,
          line2: it.line2 ? String(it.line2) : undefined,
        };
      }

      // 구버전이면 템플릿에서 찾아서 보완
      const tmpl = getTemplateItemById(monthItems, lessonKey, id);

      return {
        id,
        value,
        domain: tmpl?.domain ? String(tmpl.domain) : null,
        line1: tmpl?.line1 ? String(tmpl.line1) : undefined,
        line2: tmpl?.line2 ? String(tmpl.line2) : undefined,
      };
    })
    .filter(Boolean);
}



function getSelectedOptionLabelFromPack(pack, itemId, value) {
  const v = String(value ?? "").trim();
  if (!v) return ""; // ✅ 빈 값 방어

  const meta = pack[`item${itemId}`];
  if (!meta || !meta.options) return "";
  const opt = meta.options.find(o => String(o.value) === String(value));
  return opt ? opt.label : "";
}

async function generateLLMFeedback(data) {
  const name = data.childName || data.child_name || "아이";
  const ageMonthRaw = data.ageMonth ?? data.age_month;
  const ageMonth =
    ageMonthRaw !== undefined && ageMonthRaw !== null && ageMonthRaw !== ""
      ? Number(ageMonthRaw)
      : null;

  const items = Array.isArray(data.items) ? data.items : [];
  const month = Number(data.month);
  const lessonKey = String(data.lesson || "").trim(); // "1-1"

  const parentPref = data.parentPref || data.answers || null;
  const styleRules = buildStyleRules(parentPref || {});

  // ✅ 1) pack 먼저 확보
  let pack = null;
  let monthJson = null;

  try {
    monthJson = loadMonthItems(month);
    pack = monthJson?.[lessonKey] || null;
  } catch (e) {
    console.error("items json 로드 실패:", e);
    pack = null;
    monthJson = null;
  }


  // ✅ 2) pack 기반 fallback 준비 (pack이 없으면 안전 텍스트만)
  const fallbackText = pack
    ? buildFallbackText(pack, data)
    : (() => {
      // 다른 수업 내용이 섞이지 않도록 '헤더'만 생성
      const header = ageMonth
        ? `${ageMonth}개월 ${name}의 오늘 수업 참여 모습을 정리해 보았어요.`
        : `${name}의 오늘 수업 참여 모습을 정리해 보았어요.`;
      return header;
    })();

  // ✅ 3) pack 없으면 여기서 종료 (다른 수업 템플릿 절대 사용 금지)
  if (!pack) return { autoText: fallbackText, summary_by_domain: null };

  // ✅ items 없으면 fallback만
  if (items.length === 0) return { autoText: fallbackText, summary_by_domain: null };

  // ✅ API 키 없으면 fallback만
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY가 설정되어 있지 않습니다. 템플릿 문장만 사용합니다.");
    return { autoText: fallbackText, summary_by_domain: null };
  }


  try {
    // 4) LLM에 보낼 item 목록 구성 (pack 기준)
    const normItems = enrichItemsWithDomain(items, monthJson, lessonKey);

    const itemsForLLM = [];
    for (const it of normItems) {
      const v = String(it.value ?? "").trim();
      if (!v) continue; // ✅ 선택 안 한 항목은 무조건 제외

      const idNum = Number(it.id);
      if (!Number.isFinite(idNum)) continue;

      const meta = pack[`item${idNum}`];
      if (!meta) continue; // pack에 없는 item은 스킵 (예: item6)

      const optionLabel = getSelectedOptionLabelFromPack(pack, idNum, it.value);

      itemsForLLM.push({
        id: idNum,
        title: meta.line1 || "",
        line2: meta.line2 || "",
        line3: getSafeLine3(optionLabel),
        useAgeNorm: AGE_NORM_ALLOWED_IDS.has(idNum),
      });
    }

    if (itemsForLLM.length === 0) return { autoText: fallbackText, summary_by_domain: null };

    // 5) LLM 1회 호출
    const { devMap, summary, summary_by_domain  } = await generateDevParagraphsBatch({
      name,
      ageMonth,
      itemsForLLM,
      styleRules
    });


    // 6) 최종 섹션 조립
    const sections = [];
    for (const x of itemsForLLM) {
      const devParagraph =
        devMap.get(x.id) ||
        normalize3Lines(
          x.useAgeNorm
            ? "활동을 통해 감각을 세밀하게 느끼고 조절해 보는 경험이 중요해요.\n놀이 과정에서 스스로 시도하며 익혀 가는 모습이 자연스럽게 나타날 수 있어요.\n반복 경험이 쌓일수록 더 편안하게 확장될 수 있어요."
            : "활동 과정에서 자신의 방식으로 참여하며 경험을 쌓아 가는 모습이 관찰되었어요.\n놀이를 이어가며 시도하고 완성해 보는 경험이 의미 있게 이어질 수 있어요.\n차분히 반복하며 익혀 가는 과정이 도움이 될 수 있어요."
        );

      sections.push(buildFinalSection({ title: x.title, line2: x.line2, devParagraph }));
    }

    const out = sections.join("\n\n");
    console.log("[FINAL_HAS_SUMMARY]", !!summary, "[SUMMARY_LEN]", (summary || "").length);

    const finalOut = summary ? `${out}\n\n${summary}` : out;

    return {
      autoText: normalizeKidNameInText(finalOut, name),
      summary_by_domain: summary_by_domain || null,
    };

  } catch (err) {
    console.error("OpenAI 호출 중 에러:", err);
    return { autoText: fallbackText, summary_by_domain: null };
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

    // ✅ 1) parent_id 추출 (설문 저장 payload는 parent_id 사용) :contentReference[oaicite:3]{index=3}
    const parent_id = String(data.parent_id || data.parentId || data.hp || "").trim();

    // ✅ 2) body에 answers/parentPref 없으면 PHP에서 조회해서 주입
    if (!data.answers && !data.parentPref) {
      const answers = await fetchParentPrefFromPhp(parent_id);
      if (answers) data.answers = answers;     // ← generateLLMFeedback가 인식함 :contentReference[oaicite:4]{index=4}
      else data.answers = null;                 // 설문 없으면 null 유지
    }


    const { autoText, summary_by_domain } = await generateLLMFeedback(data);

    return res.json({
      success: true,
      autoText,
      summary_by_domain,
      build_marker: "2025-12-28-joyjoy-v_latest",
    });

  } catch (err) {
    console.error("자동 피드백 생성 에러:", err);

    const debug = String(req.query.debug || "") === "1";
    return res.status(500).json({
      success: false,
      message: "자동 피드백 생성 중 오류가 발생했습니다.",
      ...(debug
        ? {
          debug_error: String(err?.message || err),
          debug_stack: String(err?.stack || ""),
        }
        : {}),
    });
  }
});


// ---------------------------
// 4) 피드백 저장 API 
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


// ✅ Global error handler (가장 마지막)
app.use((err, req, res, next) => {
  console.error("[GLOBAL_ERROR]", err);
  res.status(500).json({
    success: false,
    message: "Internal Server Error (global)",
    debug_error: String(err?.message || err),
    debug_stack: String(err?.stack || ""),
  });
});


// ---------------------------
// 5) 서버 실행
// ---------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🔥 JOYJOY LLM 서버 시작됨!");
  console.log(`✅ Server listening on port ${PORT}`);
});
