// services/monthlyReport/index.js  (CommonJS)

const generateInputs = require("./generateInputs");
const buildLLMInput = require("./llmInputBuilder");
const { aggregateWeekly } = require("./weeklyAggregate");
const analyzeMonthlyTrend = require("./monthlyTrend"); // ✅ 파일명이 monthlytrend.js 라면 이렇게
const { generateSignals } = require("./signals");


// 월간 리포트 생성 메인 함수
async function generateMonthlyReport({
  child,
  ageMonth,
  year,
  month,
  weeklyFeedbacks,
  parentProfile,
}) {
  // 1) 주차별 집계
  const weeklyAggregated = aggregateWeekly({
    ageMonth,
    weeklyFeedbacks,
  });

  // 2) 월간 추세
  const monthlyTrend = analyzeMonthlyTrend({
    ageMonth,
    domainSeries: weeklyAggregated.domainSeries,
  });

  // 3) 시그널
  const signals = generateSignals({
    ageMonth,
    weeklyAggregated,
    monthlyTrend,
  });

  // 4) LLM 입력 원천
  const llmInputs = generateInputs({
    child,
    ageMonth,
    year,
    month,
    weeklyAggregated,
    monthlyTrend,
    signals,
    parentProfile,
  });

  // 5) 프롬프트 조립
  const llmPrompt = buildLLMInput(llmInputs);

  const llm = await callOpenAI(llmPrompt); // ✅ 추가


  return {
    ok: true,
    core_domain: monthlyTrend.coreDomain,
    domain_idx_mean_json: weeklyAggregated.domainMeans,
    llmPrompt,

    llmResult: llm.parsed || llm.text, // ✅ 추가

    debug: { weeklyAggregated, monthlyTrend, signals },
  };

}

module.exports = { generateMonthlyReport };


async function callOpenAI(llmPrompt) {
  const fetch = global.fetch || require("node-fetch");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("MISSING_OPENAI_API_KEY");

  // ✅ Structured Outputs(json_schema) 지원 모델 권장: gpt-4o-mini 계열 :contentReference[oaicite:2]{index=2}
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      one_line: { type: "string" },
      flow_summary: { type: "string" },           // 2~3문장
      change_points: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
      parent_tone_comment: { type: "string" },    // 4문장
      core_domain: { type: ["string", "null"] },
      domain_idx_mean_json: {
        type: "object",
        additionalProperties: { type: "number" }
      }
    },
    required: ["one_line", "flow_summary", "change_points", "parent_tone_comment", "core_domain", "domain_idx_mean_json"]
  };

  // ✅ llmPrompt는 기존 buildLLMInput 결과(문자열) 그대로 넣는다
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
      // ✅ Responses API에서 Structured Outputs는 text.format :contentReference[oaicite:3]{index=3}
      text: {
        format: {
          type: "json_schema",
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

  // ✅ Structured Outputs 결과는 output_text에 JSON 문자열로 들어오는 케이스가 일반적
  const rawText =
    json.output_text ||
    json?.output?.[0]?.content?.map(c => c?.text).filter(Boolean).join("") ||
    null;

  if (!rawText) return { raw: json, text: null, parsed: null };

  let parsed = null;
  try { parsed = JSON.parse(rawText); } catch { parsed = null; }

  return { raw: json, text: rawText, parsed };
}


