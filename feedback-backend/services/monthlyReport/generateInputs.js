// services/monthlyReport/generateInputs.js

function safeParseJson(s) {
  if (!s || typeof s !== "string") return null;
  try { return JSON.parse(s); } catch { return null; }
}

function pickDomains2PlusAlpha({ coreDomain, topUpDomains, domainMeans }) {
  const picked = [];
  const add = (d) => {
    if (!d) return;
    if (!picked.includes(d)) picked.push(d);
  };

  add(coreDomain);                // 1) 핵심
  add(topUpDomains?.[0]);         // 2) 상승1

  // alpha: social 우선(없으면 평균 높은 것)
  if (!picked.includes("social") && domainMeans?.social != null) add("social");

  if (picked.length < 2) {
    // 혹시 데이터가 빈 경우 방어
    const sorted = Object.entries(domainMeans || {})
      .filter(([,v]) => Number.isFinite(v))
      .sort((a,b) => b[1] - a[1])
      .map(([k]) => k);
    for (const d of sorted) add(d);
  }

  return picked.slice(0, 3); // ✅ 2+알파 = 최대 3개까지만
}

function filterObjByKeys(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  }
  return out;
}

function generateMonthlyInputs({
  child,
  ageMonth,
  year,
  month,
  ym,
  parent_id,

  weeklyFeedbacks,
  weeklyAggregated,
  monthlyTrend,
  signals,
  parentProfile,
}) {
  const meta = {
    parent_id: parent_id ?? null,
    ym: ym ?? (year && month ? `${year}-${String(month).padStart(2, "0")}` : null),
    child: child ?? null,
    age_month: Number(ageMonth || 0) || null,
    locale: "ko-KR",
    timezone: "Asia/Seoul",
  };

  const coreDomain = monthlyTrend?.coreDomain ?? null;
  const domainMeans = weeklyAggregated?.domainMeans ?? {};
  const domainTrend = monthlyTrend?.domainTrend ?? {};
  const topUpDomains = monthlyTrend?.topUpDomains ?? [];
  const topDownDomains = monthlyTrend?.topDownDomains ?? [];

  // ✅ 2+알파 선택
  const selectedDomains = pickDomains2PlusAlpha({ coreDomain, topUpDomains, domainMeans });

  // ✅ weeks 구성: feedback_text 절대 넣지 말고 summary_json만 사용
  const weeks = (Array.isArray(weeklyFeedbacks) ? weeklyFeedbacks : []).map((w) => {
    const summaryObj = safeParseJson(w?.summary_json) || null;

    return {
      week: Number(w?.week) || Number(String(w?.lesson || "").split("-")[1]) || null,
      lesson: String(w?.lesson || "").trim() || null,
      // summary는 선택된 도메인만 (언어 없음)
      summary: summaryObj ? filterObjByKeys(summaryObj, selectedDomains) : null,
      // items_json은 길어도 숫자라 괜찮지만, 원하면 빼도 됨
      // items_json: w?.items_json || null,
    };
  });

  // ✅ LLM에 줄 입력 묶음 (llmInputBuilder가 그대로 stringify)
  const inputs = {
    flow: {
      weeks,
      highlight: signals?.highlight ?? null,
      caution: signals?.caution ?? null,
    },
    teacher_note: {
      avg_signal_levels: signals?.avg_signal_levels ?? null,
      highlight: signals?.highlight ?? null,
      caution: signals?.caution ?? null,
      coreDomain,
      // ✅ 언어 금지 명시(모델 흔들림 방지)
      hard_rules: [
        "언어(language) 영역 언급 금지",
        "다른 아이와 비교 금지",
        "부족/지연/문제 같은 부정적 진단 표현 금지",
      ],
      tone_hint_from_parent_profile: parentProfile ?? null,
    },
    domains: {
      coreDomain,
      selectedDomains,
      domainMeans: filterObjByKeys(domainMeans, selectedDomains),
      domainTrend: filterObjByKeys(domainTrend, selectedDomains),
      topUpDomains: topUpDomains.filter(d => selectedDomains.includes(d)),
      topDownDomains: topDownDomains.filter(d => selectedDomains.includes(d)),
    }
  };

  return {
    meta,
    inputs,
  };
}

module.exports = { generateMonthlyInputs };
