// routes/monthlyReport.js
const express = require("express");
const router = express.Router();

const monthlyReportService = require("../services/monthlyReport"); 
// ✅ services/monthlyReport/index.js 가 module.exports = { ... } 형태여야 함

router.post("/generate", async (req, res) => {
  try {
    const payload = req.body || {};
    const result = await monthlyReportService.generateMonthlyReport(payload);
    return res.json({ ok: true, llmResult: result });
  } catch (e) {
    console.error("❌ /api/monthly/generate error:", e?.stack || e);
    return res.status(500).json({ ok: false, message: "MONTHLY_GENERATE_FAILED" });
  }
});

module.exports = router;


console.log("[HIT] /api/monthly/generate", new Date().toISOString());

