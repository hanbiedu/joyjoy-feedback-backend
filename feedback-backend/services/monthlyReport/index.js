// services/monthlyReport/index.js  (CommonJS)

const { generateMonthlyInputs } = require("./generateInputs");
const { buildLLMInput } = require("./llmInputBuilder");
const { aggregateWeekly } = require("./weeklyAggregate");
const { analyzeMonthlyTrend } = require("./monthlyTrend");
const { generateSignals } = require("./signals");

// =========================
// 월간 리포트 생성 메인 함수
// =========================
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

  // 4) LLM 입력 원천(✅ 슬림화)
  const slimDomainsInput = {
    core_domain: monthlyTrend?.coreDomain ?? null,
    domain_means: weeklyAggregated?.domainMeans ?? {},
    domain_series: weeklyAggregated?.domainSeries ?? {},
    domain_trend: monthlyTrend?.domainTrend ?? {},
    topUpDomains: monthlyTrend?.topUpDomains ?? [],
    topDownDomains: monthlyTrend?.topDownDomains ?? [],
    signals: signals ?? {},
  };

  // ✅ generateMonthlyInputs 우회: buildLLMInput이 기대하는 형태로 직접 구성
  const llmInputs = {
    meta: {
      ym: payload?.ym ?? null,
      child: { name: child?.name ?? "", age_month: ageMonth },
      locale: "ko-KR",
      timezone: "Asia/Seoul",
    },
    inputs: {
      flow: {
        weeks: weeklyAggregated?.weeklySignals?.map((w) => ({
          week: w.week,
          signals: w.signals,
        })) ?? [],
        highlight: signals?.highlight ?? null,
        caution: signals?.caution ?? null,
      },
      teacher_note: {
        avg_signal_levels: signals?.avg_signal_levels ?? null,
        highlight: signals?.highlight ?? null,
        caution: signals?.caution ?? null,
        coreDomain: monthlyTrend?.coreDomain ?? null,
        hard_rules: [
          "언어(language) 영역 언급 금지",
          "다른 아이와 비교 금지",
          "부족/지연/문제 같은 부정적 진단 표현 금지",
        ],
        tone_hint_from_parent_profile: null,
      },
    },
    // ✅ llmInputBuilder에서 domains_input을 먼저 읽게 되어있음
    domains_input: slimDomainsInput,
    parentProfile: parentProfile ?? null,
  };

  // 5) 프롬프트 조립
  const llmPrompt = buildLLMInput(llmInputs);

  // 6) LLM 호출 (✅ TIMEOUT/HTTP/파싱 등 에러 타입 분리)
  const llmCall = await callOpenAI(llmPrompt);

  // ✅ TIMEOUT은 "실패"라기보다 "시간 초과" 상태로 프론트가 처리해야 함
  if (llmCall?.ok === false && llmCall?.error_type === "TIMEOUT") {
    return {
      ok: false,
      status: "TIMEOUT",
      message: "LLM_REQUEST_TIMEOUT",
      retry_after_sec: 10,
      // 디버그가 필요하면 남기되, 프론트에 과다 노출 싫으면 제거 가능
      debug: { weeklyAggregated, monthlyTrend, signals },
    };
  }

  // ✅ 그 외 호출 실패
  if (llmCall?.ok === false) {
    return {
      ok: false,
      status: "LLM_ERROR",
      error_type: llmCall?.error_type ?? "UNKNOWN",
      message: llmCall?.message ?? "LLM_CALL_FAILED",
      http_status: llmCall?.http_status ?? null,
      debug: { weeklyAggregated, monthlyTrend, signals },
    };
  }

  // ✅ 성공: { ok:true, parsed/text/raw... }
  const llmResult = llmCall;

  // 7) 후처리: 2문장 강제
  if (llmResult?.parsed?.parent_tone_comment) {
    llmResult.parsed.parent_tone_comment = forceTwoSentences(
      llmResult.parsed.parent_tone_comment
    );
  }

  if (Array.isArray(llmResult?.parsed?.domain_analysis)) {
    llmResult.parsed.domain_analysis = llmResult.parsed.domain_analysis.map((d) => ({
      ...d,
      summary: forceTwoSentences(d.summary),
    }));
  }

  return {
    ok: true,
    core_domain: monthlyTrend?.coreDomain ?? null,
    domain_idx_mean_json: weeklyAggregated?.domainMeans ?? {},
    llmPrompt,
    llmResult: llmResult.parsed || llmResult.text,
    debug: { weeklyAggregated, monthlyTrend, signals },
  };
}

module.exports = { generateMonthlyReport };

// =====================================
// ✅ OpenAI 호출(Responses API) + 타임아웃
// - TIMEOUT / HTTP_ERROR / PARSE_ERROR 구분
// =====================================
async function callOpenAI(llmPrompt) {
  const fetch = global.fetch || require("node-fetch");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, error_type: "CONFIG", message: "MISSING_OPENAI_API_KEY" };

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const controller = new AbortController();
  const timeoutMs = 120000; // ✅ 120초 (원하면 90초로 낮춰도 됨)
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        temperature: 0.2,
        max_output_tokens: 700,
        input: [
          { role: "system", content: "You must output ONLY valid JSON that matches the schema." },
          { role: "user", content: String(llmPrompt) },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "monthly_report",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                one_line: { type: "string" },
                flow_summary: { type: "string" },
                change_points: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
                parent_tone_comment: { type: "string" },
                core_domain: { type: "string", enum: ["sensory", "cognition", "motor", "social"] },
                domain_analysis: {
                  type: "array",
                  minItems: 2,
                  maxItems: 3, // 2 + α (최대 1)
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      domain: { type: "string", enum: ["sensory", "cognition", "motor", "social"] },
                      summary: { type: "string" },
                    },
                    required: ["domain", "summary"],
                  },
                },
              },
              required: [
                "one_line",
                "flow_summary",
                "change_points",
                "parent_tone_comment",
                "core_domain",
                "domain_analysis",
              ],
            },
          },
        },
      }),
    });

    // ✅ HTTP 에러 시에도 body를 최대한 읽어서 메시지 확보
    const json = await r.json().catch(() => ({}));

    if (!r.ok) {
      const msg = json?.error?.message || `OPENAI_HTTP_${r.status}`;
      return {
        ok: false,
        error_type: "HTTP_ERROR",
        http_status: r.status,
        message: msg,
        raw: json,
      };
    }

    const rawText =
      json.output_text ||
      json?.output?.[0]?.content?.map((c) => c?.text).filter(Boolean).join("") ||
      null;

    if (!rawText) {
      return {
        ok: false,
        error_type: "EMPTY_OUTPUT",
        message: "OPENAI_EMPTY_OUTPUT_TEXT",
        raw: json,
      };
    }

    let parsed = null;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return {
        ok: false,
        error_type: "PARSE_ERROR",
        message: "OPENAI_OUTPUT_JSON_PARSE_FAILED",
        raw: json,
        text: rawText,
      };
    }

    return { ok: true, raw: json, text: rawText, parsed };
  } catch (e) {
    // ✅ AbortError를 TIMEOUT으로 명확히 구분
    if (e?.name === "AbortError") {
      return {
        ok: false,
        error_type: "TIMEOUT",
        message: "LLM_REQUEST_TIMEOUT",
        timeout_ms: timeoutMs,
      };
    }
    return {
      ok: false,
      error_type: "NETWORK_ERROR",
      message: e?.message || "OPENAI_NETWORK_ERROR",
    };
  } finally {
    clearTimeout(t);
  }
}

// =========================
// 2문장 강제 유틸
// =========================
function splitSentencesKo(text) {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinTwoIntoOne(a, b) {
  if (!a) return b || "";
  if (!b) return a || "";
  const a2 = a.replace(/습니다\.$/, "고,").replace(/했어요\.$/, "했고,");
  return `${a2} ${b}`;
}

function forceTwoSentences(text) {
  const s = splitSentencesKo(text);
  if (s.length <= 2) return text;

  const first = joinTwoIntoOne(s[0], s[1]);
  let tail = s.slice(2).join(" ");

  const t = splitSentencesKo(tail);
  if (t.length >= 2) {
    const second = joinTwoIntoOne(t[0], t.slice(1).join(" "));
    return `${first} ${second}`.trim();
  }
  return `${first} ${tail}`.trim();
}
