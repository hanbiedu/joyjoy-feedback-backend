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
          // weeks가 꼭 필요하면 여기에서 최소 정보만 넣어도 됨
          weeks: weeklyAggregated?.weeklySignals?.map(w => ({
            week: w.week,
            signals: w.signals,
            // byDomainValues는 크면 느려지니 필요시만
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

  const llm = await callOpenAI(llmPrompt);
  if (llm?.parsed?.parent_tone_comment) {
    llm.parsed.parent_tone_comment = forceTwoSentences(llm.parsed.parent_tone_comment);
  }
  

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
  const fetch = global.fetch || require("node-fetch");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("MISSING_OPENAI_API_KEY");

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 120000); // ✅ 60초

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
          { role: "user", content: String(llmPrompt) }
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
                core_domain: { type: "string", enum: ["sensory","cognition","motor","social"] },

            
                // ⬇️ 추가
                domain_analysis: {
                  type: "array",
                  minItems: 2,
                  maxItems: 3,          // 2 + α (최대 1)
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      domain: { type: "string", enum: ["sensory", "cognition", "motor", "social"] },

                      summary: { type: "string" }
                    },
                    required: ["domain", "summary"]
                  }
                }
              },
              required: [
                "one_line",
                "flow_summary",
                "change_points",
                "parent_tone_comment",
                "core_domain",
                "domain_analysis"   // ⬅️ 필수로
              ]
            }
            
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
  } finally {
    clearTimeout(t);
  }
}


function splitSentencesKo(text) {
  if (!text) return [];
  // 아주 단순 문장 분리: . ! ? 기준 (끝에 공백/줄바꿈 허용)
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function joinTwoIntoOne(a, b) {
  if (!a) return b || "";
  if (!b) return a || "";
  // a가 "…습니다." 형태면 "…고," 로 바꿔 자연스럽게 연결
  const a2 = a.replace(/습니다\.$/, "고,").replace(/했어요\.$/, "했고,");
  // b는 그대로 이어붙임
  return `${a2} ${b}`;
}

function forceTwoSentences(text) {
  const s = splitSentencesKo(text);

  if (s.length <= 2) return text; // 이미 2문장 이하

  // 4문장 이상이면: 앞2개 합치고, 뒤는 나머지 합쳐 2문장으로
  const first = joinTwoIntoOne(s[0], s[1]);

  // 뒤쪽은 2문장으로 압축: (3,4,5...)를 하나로 만들고 마지막은 계획문이 보이게 유지
  let tail = s.slice(2).join(" ");
  // tail이 너무 길면 3+4만 묶고 나머지는 뒤에 붙이기(상황 따라)
  // 여기선 단순히 전체를 하나로 둠
  // 필요하면 더 정교화 가능

  // tail도 문장 2개 이상이면 첫 문장만 유지하고 나머지는 붙여 1문장으로 압축
  const t = splitSentencesKo(tail);
  if (t.length >= 2) {
    const second = joinTwoIntoOne(t[0], t.slice(1).join(" "));
    return `${first} ${second}`.trim();
  }
  return `${first} ${tail}`.trim();
}



