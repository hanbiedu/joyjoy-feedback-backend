// index.js
// ★ 각 항목별 패턴 정의 (기본 버전)
// 클레이 크리스마스 티라이트 수업 전용 템플릿
const feedbackPatterns = {
  item1: { // ① 클레이 촉감 탐색
    1: "클레이를 만지는 것을 조금 낯설어하면서도 교사의 지원 속에서 천천히 촉감을 경험했어요.",
    2: "말랑한 촉감을 즐기며 손과 발로 여러 압력을 시도해 보며 촉감 경험을 폭넓게 했어요.",
    3: "클레이를 스스로 잡고 눌러보며 다양한 모양을 만들 정도로 적극적으로 탐색했어요.",
    4: "강하게 누르기, 약하게 누르기 등을 스스로 조절하며 촉감과 힘 조절을 아주 안정적으로 보여줬어요."
  },
  item2: { // ② 빨대를 사용해 모양 만들기
    1: "빨대를 잡는 동작이 아직은 서툴러 교사의 도움이 필요했지만 차분히 따라 해보려는 모습이 있었어요.",
    2: "빨대를 잡고 동그라미·네모 등 간단한 도형을 만들어 보며 소근육 사용을 연습했어요.",
    3: "빨대를 적절한 길이로 구부리거나 조합해서 여러 도형을 스스로 만들어 보는 탐색이 잘 되었어요.",
    4: "기존 도형을 넘어서 자신이 떠올린 모양까지 표현하며 손 조절과 공간 감각이 매우 풍부하게 나타났어요."
  },
  item3: { // ③ 쿠키틀로 모양 찍기
    1: "쿠키틀을 클레이 위에 올려두는 정도로 시도하며 활동에 서서히 익숙해졌어요.",
    2: "교사의 안내에 따라 쿠키틀을 꾹 눌러 모양을 찍어보며 도형 변화를 경험했어요.",
    3: "여러 번 눌러보며 모양이 생기고 사라지는 과정을 즐기며 반복 놀이터를 만들었어요.",
    4: "쿠키틀을 바꾸어 쓰거나 겹쳐 쓰는 등 자신만의 규칙으로 모양 변화를 적극적으로 시도했어요."
  },
  item4: { // ④ 교재 위에 모양 붙이기
    1: "어디에 붙일지 고민하는 시간이 필요해 교사의 제안을 따라 붙여보는 정도로 참여했어요.",
    2: "교재의 그림을 보며 ‘여기에 붙여볼까?’ 하고 말로 확인하며 붙이는 경험을 했어요.",
    3: "위·아래, 안·밖 등을 스스로 구분하며 적절한 위치를 찾아 모양을 배치했어요.",
    4: "구성 전체를 살피며 균형 있게 붙이고 싶은 위치를 계획하는 모습이 보여 공간 구성력이 돋보였어요."
  },
  item5: { // ⑤ 클레이 색 섞기 & 꾸미기
    1: "두 색을 섞는 과정이 아직 낯설어 살짝 만져보는 정도로 관찰 위주의 참여를 했어요.",
    2: "색을 비비며 ‘색이 변했네!’를 함께 확인하며 색 변화에 흥미를 보였어요.",
    3: "원하는 색이 나올 때까지 섞어 보고, 나온 색으로 자유롭게 장식하는 모습을 보였어요.",
    4: "색을 섞어 새로운 색을 만들고, 작품 전체 톤까지 고려해 꾸미는 등 표현력이 매우 풍부했어요."
  },
  item6: { // ⑥ 지점토로 크리스마스 티라이트 홀더 만들기
    1: "지점토 촉감과 작업이 아직 낯설어 작은 부분만 만져보며 천천히 적응했어요.",
    2: "클레이와 지점토를 비교해 보며 차이를 느끼고, 교사의 도움으로 트리 모양을 완성해 보았어요.",
    3: "혼자서도 트리 모양을 만들고 구멍을 뚫는 과정을 잘 따라가며 작업 순서를 이해했어요.",
    4: "트리 모양, 구멍 위치, 장식까지 스스로 계획해 자신만의 티라이트 홀더를 완성하는 집중력이 뛰어났어요."
  }
};


// 점수를 1~4 범위로 정리 (숫자 아니면 2점 정도로 기본 처리)
function normalizeScore4(score) {
  const n = Number(score);
  if (Number.isNaN(n)) return 2;
  if (n < 1) return 1;
  if (n > 4) return 4;
  return n;
}

// 활동 이름(옵션) – 문장 앞에 살짝 넣어주고 싶을 때 사용
const activityLabels = {
  item1: "클레이 촉감 탐색",
  item2: "빨대를 사용해 모양 만들기",
  item3: "쿠키틀로 모양 찍기",
  item4: "교재 위에 모양 붙이기",
  item5: "클레이 색 섞기 & 꾸미기",
  item6: "지점토로 크리스마스 티라이트 홀더 만들기"
};

// 메인 자동 피드백 생성 함수
function buildAutoFeedback(data) {
  const name = data.childName || "아이";
  const ageMonth = data.ageMonth ? Number(data.ageMonth) : null;

  const header = ageMonth
    ? `${ageMonth}개월 ${name}의 오늘 클레이 크리스마스 티라이트 수업 참여 모습을 정리해 보았어요.\n`
    : `${name}의 오늘 클레이 크리스마스 티라이트 수업 참여 모습을 정리해 보았어요.\n`;

  const order = ["item1", "item2", "item3", "item4", "item5", "item6"];

  const perItem = {};
  const lines = [];

  order.forEach((key, index) => {
    const rawScore = data[key];
    if (rawScore === undefined || rawScore === null || rawScore === "") {
      return; // 점수 안 들어온 항목은 건너뜀
    }

    const score = normalizeScore4(rawScore);
    const patterns = feedbackPatterns[key];
    if (!patterns) return;

    const sentence = patterns[score];
    if (!sentence) return;

    const label = activityLabels[key];
    const numberedLabel = label ? `${index + 1}. ${label}` : `${index + 1}.`;

    // 한 항목 블록
    const block = `● ${numberedLabel}\n${sentence}`;

    lines.push(block);

    // perItem 객체에도 저장 (프론트에서 항목별로 쓰고 싶을 때 사용 가능)
    perItem[key] = {
      label,
      score,
      sentence
    };
  });

  const body = lines.join("\n\n");
  const text = `${header}\n${body}`;

  return { text, perItem };
}




const express = require("express");
const cors = require("cors");

const app = express();

// Render에서 자동으로 PORT 환경변수를 줌.
// 로컬에서는 10000번 포트 사용
const PORT = process.env.PORT || 10000;

// JSON 요청 본문 파싱
app.use(express.json());
// CORS 허용 (프론트에서 호출 가능하게)
app.use(cors());

// 헬스체크 / 테스트용
app.get("/", (req, res) => {
  res.send("JoyJoy feedback backend running ✅");
});

// 피드백 받는 API (나중에 카카오 전송 로직이 여기 들어감)
// ★ 자동 문장 생성 엔드포인트
// 예) POST https://joyjoy-feedback-backend.onrender.com/api/auto-feedback
// body: { childName, ageMonth, item1, item2, item3, item4, item5, item6 }
app.post("/api/auto-feedback", (req, res) => {
  try {
    const data = req.body || {};

    const { text, perItem } = buildAutoFeedback(data);

    return res.json({
      success: true,
      autoText: text,
      perItem
    });
  } catch (error) {
    console.error("auto-feedback error:", error);
    return res.status(500).json({
      success: false,
      message: "자동 피드백 생성 중 오류가 발생했어요."
    });
  }
});


// 서버 시작
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
