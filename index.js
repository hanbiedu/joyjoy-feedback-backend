// index.js - JOYJOY 피드백 백엔드 (LLM + line2 + options 기반)

// ---------------------------
// 0) 기본 서버 셋업
// ---------------------------
const express = require("express");
const cors = require("cors");
const feedbackItems = require("../items/feedback_items.json"); // line1·2·options 정의

const app = express();

// JSON 파싱
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS 허용 (필요하면 origin 수정)
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
// 1) 관찰 텍스트 생성 유틸들
// ---------------------------

// itemId와 선택 value로 feedback_items.json 안의 옵션 라벨 찾기
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
      // line2 + 선택 옵션 라벨을 합쳐 관찰 내용으로 사용
      const baseText = `${meta.line2} ${optionLabel}`.trim();

      return `${idx + 1}. ${meta.line1}
- 관찰 내용: ${baseText}
- 선택 수준(level): ${it.value}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

// LLM 프롬프트용 전체 입력 텍스트 만들기
function buildLLMPrompt(data) {
  const name = data.childName || "아이";
  const ageMonth = data.ageMonth ? Number(data.ageMonth) : null;
  const items = Array.isArray(data.items) ? data.items : [];

  const activitiesText = buildActivitiesText(ageMonth, items);

  const header = ageMonth
    ? `${ageMonth}개월 아동 "${name}"의 오늘 수업 참여 모습이야.`
    : `아동 "${name}"의 오늘 수업 참여 모습이야.`;

  const guide = `
너는 영유아 오감·발달 놀이 전문 브랜드 "조이조이"의 발달전문가야.

[역할]
- 부모에게 보내는 수업 후 발달 피드백 문장을 작성한다.
- 입력으로 각 활동의 제목(line1), 활동 설명(line2), 그리고 교사가 선택한 관찰 문장(옵션 라벨)이 주어진다.
- 이 관찰 내용을 바탕으로, 아이의 월령을 고려해 현재 발달 수준과 강점을 설명한다.
- 숫자(level 1~4)는 직접 언급하지 말고, "아직 경험을 쌓는 단계", "또래 수준", "또래보다 적극적"처럼 자연스러운 표현으로만 간접적으로 반영한다.
- 발달이 아직 미성숙한 부분은 "조금 더 연습이 필요한 모습", "천천히 도와주면 좋아요"처럼 긍정적인 표현으로 설명한다.
- 문체는 "~했어요", "~보였어요"와 같은 보고서 톤의 한국어 존댓말을 사용한다.
- 전체 출력은 2~3개의 단락으로 작성하고, 각 단락은 2~4문장 정도로 한다.
- 마지막에 가정에서 해볼 수 있는 아주 간단한 놀이·격려 문장을 한 줄 정도로 제안한다.

[아동 정보]
- 이름: ${name}
- 월령: ${ageMonth ? ageMonth + "개월" : "월령 정보 없음"}

[활동별 관찰 내용]
${activitiesText}

위 정보를 바탕으로, 부모님께 전달할 오늘의 맞춤 발달 피드백(line4 역할의 분석 텍스트)을 작성해줘.
`;

  return `${header}\n\n${guide}`;
}

// 템플릿 기반 백업용 문장 (LLM 실패 시 사용)
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
// 2) OpenAI LLM 호출 함수 (Responses API 사용)
// ---------------------------
async function generateLLMFeedback(data) {
  const apiKey = process.env.OPENAI_API_KEY;
  const fallbackText = buildFallbackText(data);

  console.log("현재 OPENAI_API_KEY 존재 여부:", !!apiKey);

  // 키가 없으면 바로 템플릿 기반 문장 사용
  if (!apiKey) {
    console.warn("OPENAI_API_KEY가 설정되어 있지 않습니다. 템플릿 문장만 사용합니다.");
    return fallbackText;
  }

  const prompt = buildLLMPrompt(data);
  console.log("LLM에 보낼 prompt 일부:\n", prompt.slice(0, 500));

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
    console.log("OpenAI raw response (부분):", JSON.stringify(result, null, 2).slice(0, 800));

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
    console.log("auto-feedback 요청 데이터:", JSON.stringify(data, null, 2));

    // 프론트에서 이미 line2 + options 기반 선택값(items: [{id, value}])을 보내줌
    const llmText = await generateLLMFeedback(data);
    const ruleBasedText = buildFallbackText(data);

    return res.json({
      success: true,
      autoText: llmText,   // textarea에 넣을 최종 문장
      backupText: ruleBasedText, // 혹시 모를 백업용
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
    console.log("피드백 저장 요청 도착:", JSON.stringify(data, null, 2));

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
