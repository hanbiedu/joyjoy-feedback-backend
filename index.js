// index.js - JOYJOY 피드백 백엔드 (LLM + 템플릿)

// ---------------------------
// 0) 기본 서버 셋업
// ---------------------------
const express = require("express");
const cors = require("cors");

const app = express();

// JSON 파싱
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS 허용 (필요하면 도메인 제한 가능)
app.use(
  cors({
    origin: "*",
  })
);

// 헬스체크용 기본 라우트
app.get("/", (req, res) => {
  res.send("JOYJOY Feedback Backend is running.");
});

// ---------------------------
// 1) 피드백 패턴 (템플릿 그대로)
// ---------------------------
const feedbackPatterns = {
  item1: {
    // ① 클레이 촉감 탐색
    1: "클레이를 만지는 것을 조금 낯설어하면서도 교사의 지원 속에서 천천히 촉감을 경험했어요.",
    2: "말랑한 촉감을 즐기며 손과 발로 여러 압력을 시도해 보며 촉감 경험을 폭넓게 했어요.",
    3: "클레이를 스스로 잡고 눌러보며 다양한 모양을 만들 정도로 적극적으로 탐색했어요.",
    4: "강하게 누르기, 약하게 누르기 등을 스스로 조절하며 촉감과 힘 조절을 아주 안정적으로 보여줬어요.",
  },
  item2: {
    // ② 빨대를 사용해 모양 만들기
    1: "빨대를 잡는 동작이 아직은 서툴러 교사의 도움이 필요했지만 차분히 따라 해보려는 모습이 있었어요.",
    2: "빨대를 잡고 동그라미·네모 등 간단한 도형을 만들어 보며 소근육 사용을 연습했어요.",
    3: "빨대를 적절한 길이로 구부리거나 조합해서 여러 도형을 스스로 만들어 보는 탐색이 잘 되었어요.",
    4: "기존 도형을 넘어서 자신이 떠올린 모양까지 표현하며 손 조절과 공간 감각이 매우 풍부하게 나타났어요.",
  },
  item3: {
    // ③ 쿠키틀로 모양 찍기
    1: "쿠키틀을 클레이 위에 올려두는 정도로 시도하며 활동에 서서히 익숙해졌어요.",
    2: "교사의 안내에 따라 쿠키틀을 꾹 눌러 모양을 찍어보며 도형 변화를 경험했어요.",
    3: "여러 번 눌러보며 모양이 생기고 사라지는 과정을 즐기며 반복 놀이터를 만들었어요.",
    4: "쿠키틀을 바꾸어 쓰거나 겹쳐 쓰는 등 자신만의 규칙으로 모양 변화를 적극적으로 시도했어요.",
  },
  item4: {
    // ④ 교재 위에 모양 붙이기
    1: "어디에 붙일지 고민하는 시간이 필요해 교사의 제안을 따라 붙여보는 정도로 참여했어요.",
    2: "교재의 그림을 보며 ‘여기에 붙여볼까?’ 하고 말로 확인하며 붙이는 경험을 했어요.",
    3: "위·아래, 안·밖 등을 스스로 구분하며 적절한 위치를 찾아 모양을 배치했어요.",
    4: "구성 전체를 살피며 균형 있게 붙이고 싶은 위치를 계획하는 모습이 보여 공간 구성력이 돋보였어요.",
  },
  item5: {
    // ⑤ 클레이 색 섞기 & 꾸미기
    1: "두 색을 섞는 과정이 아직 낯설어 살짝 만져보는 정도로 관찰 위주의 참여를 했어요.",
    2: "색을 비비며 ‘색이 변했네!’를 함께 확인하며 색 변화에 흥미를 보였어요.",
    3: "원하는 색이 나올 때까지 섞어 보고, 나온 색으로 자유롭게 장식하는 모습을 보였어요.",
    4: "색을 섞어 새로운 색을 만들고, 작품 전체 톤까지 고려해 꾸미는 등 표현력이 매우 풍부했어요.",
  },
  item6: {
    // ⑥ 지점토로 크리스마스 티라이트 홀더 만들기
    1: "지점토 촉감과 작업이 아직 낯설어 작은 부분만 만져보며 천천히 적응했어요.",
    2: "클레이와 지점토를 비교해 보며 차이를 느끼고, 교사의 도움으로 트리 모양을 완성해 보았어요.",
    3: "혼자서도 트리 모양을 만들고 구멍을 뚫는 과정을 잘 따라가며 작업 순서를 이해했어요.",
    4: "트리 모양, 구멍 위치, 장식까지 스스로 계획해 자신만의 티라이트 홀더를 완성하는 집중력이 뛰어났어요.",
  },
};

function normalizeScore4(score) {
  const n = Number(score);
  if (Number.isNaN(n)) return null;
  if (n < 1) return 1;
  if (n > 4) return 4;
  return n;
}

// 점수 기반 요약 리스트 만들기 (LLM에 넘길 재료)
function buildSummaryFromPatterns(data) {
  const summaries = [];
  const order = ["item1", "item2", "item3", "item4", "item5", "item6"];

  order.forEach((key) => {
    const rawScore = data[key];
    if (rawScore === undefined || rawScore === null || rawScore === "") return;

    const score = normalizeScore4(rawScore);
    if (!score) return;

    const patterns = feedbackPatterns[key];
    if (!patterns) return;

    const sentence = patterns[score];
    if (!sentence) return;

    summaries.push(sentence);
  });

  return summaries;
}

// 템플릿만으로 만드는 기본 문장 (LLM 실패시 백업용)
function buildRuleBasedText(data, summaries) {
  const name = data.childName || "아이";
  const ageMonth = data.ageMonth ? Number(data.ageMonth) : null;

  const header = ageMonth
    ? `${ageMonth}개월 ${name}의 오늘 클레이 크리스마스 티라이트 수업 참여 모습을 정리해 보았어요.`
    : `${name}의 오늘 클레이 크리스마스 티라이트 수업 참여 모습을 정리해 보았어요.`;

  if (!summaries || summaries.length === 0) {
    return header;
  }

  return `${header}\n\n${summaries.map((s) => `● ${s}`).join("\n\n")}`;
}

// ---------------------------
// 2) OpenAI LLM 호출 함수 (SDK 없이 fetch 사용) - 수정 버전
// ---------------------------
async function generateLLMFeedback(data) {
  const apiKey = process.env.OPENAI_API_KEY;
  const summaries = buildSummaryFromPatterns(data);
  const fallbackText = buildRuleBasedText(data, summaries);

  console.log("현재 OPENAI_API_KEY 존재 여부:", !!apiKey);
  console.log("요약 리스트:", summaries);

  // 키 없으면 바로 템플릿으로
  if (!apiKey) {
    console.warn("OPENAI_API_KEY가 설정되어 있지 않습니다. 템플릿 문장만 사용합니다.");
    return fallbackText;
  }

  if (!summaries || summaries.length === 0) {
    return fallbackText;
  }

  const name = data.childName || "아이";
  const ageMonth = data.ageMonth ? Number(data.ageMonth) : null;

  const summaryText = summaries.map((s) => `- ${s}`).join("\n");

  const prompt = `
다음은 ${ageMonth ? ageMonth + "개월 " : ""}${name}의 오늘 수업에서 관찰한 발달 행동 요약이에요.
이 내용을 바탕으로 부모님께 전달할 수업 피드백을 작성해 주세요.

[관찰 요약]
${summaryText}

[작성 가이드]
- 전체 3~5문장 정도로 자연스럽게 이어지는 글로 작성해 주세요.
- 아이의 장점과 성장 가능성을 중심으로 부드럽게 표현해 주세요.
- '못한다, 문제다' 같은 단정적인 표현은 피하고, '~할 수 있도록 도와줄게요.'처럼 제안형 표현을 사용해 주세요.
- 조이조이 브랜드처럼 따뜻하고 세심한 톤으로, 한국어로 작성해 주세요.
`;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: prompt,
      }),
    });

    if (!response.ok) {
      console.error("OpenAI API 에러 상태:", response.status, await response.text());
      return fallbackText;
    }

    const result = await response.json();
    console.log("OpenAI raw response:", JSON.stringify(result, null, 2).slice(0, 1000));

    // ⚠ 여기서 실제 텍스트를 뽑아야 함
    let llmText;

    try {
      const outputArray = result.output || [];
      const messageItem = outputArray.find((item) => item.type === "message");
      const contentArray = messageItem?.content || [];
      const textItem = contentArray.find((c) => c.type === "output_text");
      llmText = textItem?.text?.trim();
    } catch (e) {
      console.error("LLM 응답 파싱 중 오류:", e);
    }

    if (!llmText) {
      console.warn("LLM 응답에서 텍스트를 찾지 못했습니다. 템플릿 문장을 사용합니다.");
      return fallbackText;
    }

    return llmText;
  } catch (err) {
    console.error("OpenAI 호출 중 에러:", err);
    return fallbackText;
  }
}


// ---------------------------
// 3) 자동 피드백 생성 API (LLM + 템플릿)
// ---------------------------
app.post("/api/auto-feedback", async (req, res) => {
  try {
    console.log("💥 /api/auto-feedback 호출됨!");
    const data = req.body || {};
    console.log("auto-feedback 요청 데이터:", data);

    const summaries = buildSummaryFromPatterns(data);
    const ruleBasedText = buildRuleBasedText(data, summaries);
    const llmText = await generateLLMFeedback(data);

    return res.json({
      success: true,
      autoText: llmText, // 프론트에서 textarea에 넣을 문장
      backupText: ruleBasedText,
      summaries,
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
// 4) 피드백 저장 API (현재는 콘솔 로그 + 성공 응답만)
// ---------------------------
app.post("/api/feedback", (req, res) => {
  try {
    const data = req.body || {};
    console.log("피드백 저장 요청 도착:", data);

    // TODO: 나중에 여기서 MySQL DB에 INSERT 작업 추가

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
