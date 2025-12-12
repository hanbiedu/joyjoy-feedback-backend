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
const DEV_PARA_INSTRUCTIONS_V12 = `
너는 조이조이(JoyJoy) 수업 피드백에서 ‘월령 기반 발달 맥락 해석 문단’만 작성하는 AI다.

입력으로 주어지는 line2, line3은 이미 교사가 작성·선택한 ‘관찰 사실’이다.
이 내용을 바탕으로, 해당 월령의 일반적인 발달 흐름 속에서 아이의 현재 모습을 ‘안심·설명’하는 문단을 작성한다.

[출력 규칙 – 매우 중요]
- 반드시 3문장으로 작성한다.
- 문장마다 줄바꿈 1회 사용한다(총 3줄).
- 제목, 번호, 인삿말, 마무리 멘트는 쓰지 않는다.
- 오직 ‘발달 맥락 설명 문단’만 출력한다.

[금지]
- 진단/검사/치료/지연/장애/ADHD/자폐 등 의료·평가 표현 금지
- 또래 대비 우열/비교 표현 금지
- 불안 유발 표현(걱정/문제/이상/부족 등) 금지

[표현]
- “~시기예요”, “~단계로 보여요”, “~경험이 중요해요” 같은 완곡·안심 톤 사용
- line2, line3에 없는 내용을 추측해 추가하지 않는다
- 아이 이름은 최대 1회만 자연스럽게 사용한다

[문장 구조 가이드]
1문장: 해당 월령 또래의 일반적 발달 특징 설명
2문장: line2+line3 관찰을 근거로 아이의 현재 모습 해석
3문장: 지금 경험의 의미를 긍정적으로 정리
`;

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
async function generateDevParagraph({ name, ageMonth, line2, line3 }) {
  // 환경변수 키가 런타임에 설정되는 경우를 대비해, 호출 시점에 재주입
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY가 설정되어 있지 않습니다.");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const input = `
아이 이름: ${name || "아이"}
월령: ${ageMonth ? `${ageMonth}개월` : "월령 정보 없음"}

line2:
${line2 || ""}

line3:
${getSafeLine3(line3)}
  `.trim();

  // ✅ 여기서 v1.2 instructions를 실제로 넣는다
  const resp = await client.responses.create({
    model: "gpt-4.1-mini-2025-04-14", // 지금 쓰는 모델 유지 가능
    instructions: DEV_PARA_INSTRUCTIONS_V12,
    input,
  });

  // ✅ SDK/응답 포맷 차이를 견디는 안전 파서
  return extractOutputText(resp);
}


// ✅ Responses API output에서 output_text를 찾아서 합쳐주는 함수
function extractOutputText(resp) {
  if (!resp) return "";

  // 1) 어떤 SDK에선 output_text가 바로 붙기도 함
  if (typeof resp.output_text === "string" && resp.output_text.trim()) {
    return resp.output_text.trim();
  }

  // 2) 표준 Responses 형태: output[] → message → content[] → output_text.text
  const out = Array.isArray(resp.output) ? resp.output : [];
  const texts = [];

  for (const item of out) {
    if (item?.type !== "message") continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const c of content) {
      if (c?.type === "output_text" && typeof c.text === "string") {
        texts.push(c.text);
      }
    }
  }

  return texts.join("\n").trim();
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

  // 선택된 활동이 없으면 템플릿
  if (items.length === 0) return fallbackText;

  // 키 없으면 바로 템플릿
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY가 설정되어 있지 않습니다. 템플릿 문장만 사용합니다.");
    return fallbackText;
  }

  try {
    const sections = [];

    for (const it of items) {
      const key = `item${it.id}`;
      const meta = feedbackItems[key];
      if (!meta) continue;

      const title = meta.line1 || "";
      const line2 = meta.line2 || "";
      const line3 = getSelectedOptionLabel(it.id, it.value) || "교사의 안내에 따라 천천히 참여해 보였어요.";


      // LLM은 문단만 생성
      const devParagraph = await generateDevParagraph({
        name,
        ageMonth,
        line2,
        line3,
      });

      // 최종 섹션은 서버가 조립 (포맷 고정)
      sections.push(
        buildFinalSection({
          title,
          line2,
          devParagraph,
        })
      );
    }

    if (sections.length === 0) return fallbackText;

    // 여러 섹션이면 두 줄 띄워 구분
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
