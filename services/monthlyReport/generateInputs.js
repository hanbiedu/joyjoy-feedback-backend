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
// generateInputs.js
const inputs = {
  flow: {
    weeks: Array.isArray(weeklyFeedbacks) ? weeklyFeedbacks : [],
    domainSeries: weeklyAggregated?.domainSeries || null,
    domainTrend: monthlyTrend?.domainTrend || null,
    topUpDomains: monthlyTrend?.topUpDomains || [],
    topDownDomains: monthlyTrend?.topDownDomains || [],
    highlight: signals?.highlight || null,
    caution: signals?.caution || null,
  },
  teacher_note: {
    avg_signal_levels: signals?.avg_signal_levels || null,
    highlight: signals?.highlight || null,
    caution: signals?.caution || null,
    coreDomain: monthlyTrend?.coreDomain || null,
  },
  domains: {
    coreDomain: monthlyTrend?.coreDomain || null,
    domainMeans: weeklyAggregated?.domainMeans || {},
    domainTrend: monthlyTrend?.domainTrend || null,
    topUpDomains: monthlyTrend?.topUpDomains || [],
    topDownDomains: monthlyTrend?.topDownDomains || [],
  },
};

return {
  meta,
  inputs, // ✅ 추가
  weeklyAggregated: weeklyAggregated ?? null,
  monthlyTrend: monthlyTrend ?? null,
  signals: signals ?? null,
  parentProfile: parentProfile ?? null,
};

}

module.exports = { generateMonthlyInputs };
