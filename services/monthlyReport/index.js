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
    weeklyFeedbacks,
    weeklyAggregated,
    monthlyTrend,
    signals,
    parentProfile,

    // ✅ 추가
    weeklyFeedbacks,
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

// ✅ services/monthlyReport/index.js 에서 callOpenAI() 전체 교체

async function callOpenAI(llmPrompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("MISSING_OPENAI_API_KEY");

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  // node 18+ fetch는 undici 기반. Render에서 HeadersTimeout이 자주 나서 timeout을 늘려준다.
  const { Agent } = require("undici");
  const dispatcher = new Agent({
    connectTimeout: 30_000,
    headersTimeout: 120_000, // ✅ 핵심: 헤더 타임아웃 증가
    bodyTimeout: 120_000,
  });

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      one_line: { type: "string" },
      flow_summary: { type: "string" },
      change_points: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
      parent_tone_comment: { type: "string" },
      core_domain: { type: ["string", "null"] },
    },
    required: ["one_line", "flow_summary", "change_points", "parent_tone_comment", "core_domain"],
  };

  const inputText =
    typeof llmPrompt === "string" ? llmPrompt : JSON.stringify(llmPrompt);

  // ✅ 재시도(네트워크/타임아웃 계열만)
  const MAX_RETRY = 2;
  let lastErr = null;

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    const controller = new AbortController();
    const hardTimeout = setTimeout(() => controller.abort(), 130_000); // 최종 안전장치

    try {
      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        dispatcher,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          store: false,
          input: [
            { role: "system", content: "You must output ONLY valid JSON that matches the schema." },
            { role: "user", content: inputText },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "monthly_report",
              strict: true,
              schema,
            },
          },
        }),
      });

      clearTimeout(hardTimeout);

      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        // OpenAI 에러는 그대로 보여주기
        const msg = json?.error?.message || `OPENAI_HTTP_${r.status}`;
        throw new Error(msg);
      }

      const rawText =
        json.output_text ||
        json?.output?.[0]?.content?.map((c) => c?.text).filter(Boolean).join("") ||
        null;

      if (!rawText) return { raw: json, text: null, parsed: null };

      let parsed = null;
      try { parsed = JSON.parse(rawText); } catch { parsed = null; }

      return { raw: json, text: rawText, parsed };
    } catch (e) {
      clearTimeout(hardTimeout);
      lastErr = e;

      const msg = String(e?.message || "");
      const isTimeoutLike =
        msg.includes("UND_ERR_HEADERS_TIMEOUT") ||
        msg.includes("Headers Timeout") ||
        msg.includes("fetch failed") ||
        msg.includes("aborted");

      // 타임아웃/네트워크 계열만 재시도
      if (attempt < MAX_RETRY && isTimeoutLike) {
        // 짧은 백오프
        await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }

  // 여기까지 오면 실패
  throw lastErr || new Error("OPENAI_FETCH_FAILED");
}

