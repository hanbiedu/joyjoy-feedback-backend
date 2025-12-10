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
        item2: form.item2?.value,
        item3: form.item3?.value,
        item4: form.item4?.value,
        item5: form.item5?.value,
        item6: form.item6?.value,
      }
    };

    // JSON 미리보기 업데이트
    preview.textContent = JSON.stringify(data, null, 2);

    // 🔥 Render 백엔드로 보내기
    try {
      const response = await fetch("https://joyjoy-feedback-backend.onrender.com/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });

      const result = await response.json();
      console.log("서버 응답:", result);

      alert("서버 전송 완료!");

    } catch (err) {
      console.error("전송 오류:", err);
      alert("서버 전송 실패");
    }
  });
});
