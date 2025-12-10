document.addEventListener("DOMContentLoaded", () => {
  console.log("feedback.js loaded!");

  const form = document.getElementById("feedbackForm");
  const preview = document.getElementById("jsonPreview");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const data = {
      childName: form.childName.value,
      ageMonth: form.ageMonth.value,
      items: {
        item1: form.item1.value,
      }
    };

    // JSON 미리보기 표시
    preview.textContent = JSON.stringify(data, null, 2);

    // Render 백엔드 URL (⭐ 필수로 바꿔 넣기!)
    const BACKEND_URL = "https://joyjoy-feedback-backend.onrender.com";

    try {
      const response = await fetch(`${BACKEND_URL}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });

      const result = await response.json();
      console.log("서버 응답:", result);

      alert("서버 전송 성공!");

    } catch (err) {
      console.error("전송 오류:", err);
      alert("서버 전송 실패");
    }
  });
});
