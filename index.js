// index.js

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
app.post("/api/feedback", (req, res) => {
  console.log("받은 피드백 데이터:", req.body);

  // 일단은 받은 내용 그대로 돌려주기 (테스트용)
  res.json({
    ok: true,
    received: req.body,
  });
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
