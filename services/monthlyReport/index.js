// services/monthlyReport/index.js  (CommonJS)

const { generateMonthlyInputs } = require("./generateInputs");
const { buildLLMInput } = require("./llmInputBuilder");
const { aggregateWeekly } = require("./weeklyAggregate");
const { analyzeMonthlyTrend } = require("./monthlyTrend");
const { generateSignals } = require("./signals");

// 월간 리포트 생성 메인 함수
async function generateMonthlyReport(payload) {
  // ✅ 라우트/호출부가 어떤 키로 보내도 안전하게 정규화
  const child =
    payload?.child ??
    (payload?.child_name ? { name: payload.child_name } : null);

  const ageMonth =
    Number(payload?.ageMonth ?? payload?.age_month ?? 0) || 0;

  const year =
    Number(payload?.year ?? (payload?.ym ? payload.ym.split("-")[0] : undefined));

  const month =
    Number(payload?.month ?? (payload?.ym ? payload.ym.split("-")[1] : undefined));

  const weeklyFeedbacks = Array.isArray(payload?.weeklyFeedbacks)
    ? payload.weeklyFeedbacks
    : [];

  const parentProfile =
    payload?.parentProfile ?? payload?.answers ?? null;

  if (!weeklyFeedbacks.length) {
    return {
      ok: false,
      message: "NO_WEEKLY_FEEDBACKS_FOR_MONTH",
    };
  }
  if (!Number.isFinite(month) || month <= 0) {
    return {
      ok: false,
      message: "MISSING_OR_INVALID_MONTH",
    };
  }

  // 1) 주차별 집계
  const weeklyAggregated = aggregateWeekly({
    ageMonth,
    weeklyFeedbacks,
  });

  // 2) 월간 추세 (domainSeries가 없을 수도 있으니 방어)
  const monthlyTrend = analyzeMonthlyTrend({
    ageMonth,
    domainSeries: weeklyAggregated?.domainSeries ?? null,
    weeklyAggregated,
  });

  // 3) 시그널
  const signals = generateSignals({
    ageMonth,
    weeklyAggregated,
    monthlyTrend,
  });

  // 4) LLM 입력 원천
  const llmInputs = generateMonthlyInputs({
    child,
    ageMonth,
    year: Number.isFinite(year) ? year : null,
    month,
    weeklyAggregated,
    monthlyTrend,
    signals,
    parentProfile,
  });

  // 5) 프롬프트 조립
  const llmPrompt = buildLLMInput(llmInputs);

  const llm = await callOpenAI(llmPrompt);

  return {
    ok: true,
    core_domain: monthlyTrend?.coreDomain ?? null,
    domain_idx_mean_json: weeklyAggregated?.domainMeans ?? {},
    llmPrompt,
    llmResult: llm.parsed || llm.text,
    debug: { weeklyAggregated, monthlyTrend, signals },
  };
}

module.exports = { generateMonthlyReport };

async function callOpenAI(llmPrompt) {
  const fetch = global.fetch || require("node-fetch");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("MISSING_OPENAI_API_KEY");

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      one_line: { type: "string" },
      flow_summary: { type: "string" },
      change_points: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
      parent_tone_comment: { type: "string" },
      core_domain: { type: ["string", "null"] },
      domain_idx_mean_json: { type: "object", additionalProperties: { type: "number" } }
    },
    required: ["one_line", "flow_summary", "change_points", "parent_tone_comment", "core_domain", "domain_idx_mean_json"]
  };

  const inputText = (typeof llmPrompt === "string") ? llmPrompt : JSON.stringify(llmPrompt);

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        { role: "system", content: "You must output ONLY valid JSON that matches the schema." },
        { role: "user", content: inputText }
      ],
      text: { 
        format: { 
          type: "json_schema", 
          name: "monthly_report",
          strict: true, 
          schema 
        } 
      }
    }),
  });

  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = json?.error?.message || `OPENAI_HTTP_${r.status}`;
    throw new Error(msg);
  }

  const rawText =
    json.output_text ||
    json?.output?.[0]?.content?.map(c => c?.text).filter(Boolean).join("") ||
    null;

  if (!rawText) return { raw: json, text: null, parsed: null };

  let parsed = null;
  try { parsed = JSON.parse(rawText); } catch { parsed = null; }

  return { raw: json, text: rawText, parsed };
}
