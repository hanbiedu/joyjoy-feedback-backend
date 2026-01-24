// services/monthlyReport/generateInputs.js

function generateMonthlyInputs({
  child,
  ageMonth,
  year,
  month,
  weeklyAggregated,
  monthlyTrend,
  signals,
  parentProfile,

  // ✅ 추가: 주간 원본도 받기 (flow 구성용)
  weeklyFeedbacks,

  parent_id,
  ym,
  child_name,
  age_month,
}) {
  const meta = {
    child: child ?? (child_name ? { name: child_name } : null),
    ageMonth: ageMonth ?? age_month ?? null,
    year: year ?? null,
    month: month ?? null,
    ym: ym ?? (year && month ? `${year}-${String(month).padStart(2, "0")}` : null),
    parent_id: parent_id ?? null,
    parentProfile: parentProfile ?? null,
  };

  // ✅ 핵심: buildLLMInput이 읽는 monthlyInputs.inputs.* 를 여기서 생성
  const inputs = {
    flow: {
      // 주차별 “월간 흐름” 재료: 주차 순서 + (가능하면) lesson/요약
      weeks: (Array.isArray(weeklyFeedbacks) ? weeklyFeedbacks : []).map((w) => ({
        week: Number(w?.week) || Number(String(w?.lesson || "").split("-")[1]) || null,
        lesson: w?.lesson ?? null,
        // 원본이 뭐든 일단 전달(LLM이 참고)
        summary_json: w?.summary_json ?? null,
        feedback_text: w?.feedback_text ?? null,
      })),
      // 집계/추세/시그널도 같이 넣어서 “흐름 문장” 근거가 생기게
      domainSeries: weeklyAggregated?.domainSeries ?? null,
      domainTrend: monthlyTrend?.domainTrend ?? null,
      topUpDomains: monthlyTrend?.topUpDomains ?? [],
      topDownDomains: monthlyTrend?.topDownDomains ?? [],
      highlight: signals?.highlight ?? null,
      caution: signals?.caution ?? null,
    },

    teacher_note: {
      // signals.js가 만든 월간 시그널 요약을 그대로 근거로 제공
      avg_signal_levels: signals?.avg_signal_levels ?? null,
      highlight: signals?.highlight ?? null,
      caution: signals?.caution ?? null,
      coreDomain: monthlyTrend?.coreDomain ?? null,
    },

    domains: {
      // 핵심 도메인/평균/추세를 “도메인 입력”으로 명확히 제공
      coreDomain: monthlyTrend?.coreDomain ?? null,
      domainMeans: weeklyAggregated?.domainMeans ?? {},
      domainTrend: monthlyTrend?.domainTrend ?? null,
      topUpDomains: monthlyTrend?.topUpDomains ?? [],
      topDownDomains: monthlyTrend?.topDownDomains ?? [],
    },
  };

  return {
    meta,
    inputs, // ✅ 이거 하나로 flow/domains 비어있는 문제 끝
    weeklyAggregated: weeklyAggregated ?? null,
    monthlyTrend: monthlyTrend ?? null,
    signals: signals ?? null,
    parentProfile: parentProfile ?? null,
  };
}

module.exports = { generateMonthlyInputs };
