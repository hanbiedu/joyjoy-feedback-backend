// services/monthlyReport/generateInputs.js
// ✅ index.js(월간 파이프라인)가 넘기는 형태를 그대로 받아서
//    llmInputBuilder(buildLLMInput)가 쓰기 쉬운 형태로 "묶어서" 반환한다.

function generateMonthlyInputs({
  child,
  ageMonth,
  year,
  month,
  weeklyAggregated,
  monthlyTrend,
  signals,
  parentProfile,
  // 확장용(있어도 되고 없어도 됨)
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

  return {
    meta,

    // 월간 산출물들(그대로 전달)
    weeklyAggregated: weeklyAggregated ?? null,
    monthlyTrend: monthlyTrend ?? null,
    signals: signals ?? null,

    // 부모성향
    parentProfile: parentProfile ?? null,
  };
}

module.exports = { generateMonthlyInputs };
