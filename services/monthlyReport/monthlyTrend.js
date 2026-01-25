// services/monthlyReport/monthlyTrend.js
// ✅ Wrapper 포함 버전
// - index.js가 호출하는 analyzeMonthlyTrend({ageMonth, domainSeries}) 유지
// - 주차 불연속(1-5 등) 대응
// - domainSeries 길이 다름 허용

const SIGNAL_KEYS = [
  "engagement_level",
  "persistence_level",
  "teacher_prompt_level",
  "self_initiation_level",
  
];

function isNum(x) {
  return Number.isFinite(x);
}

function mean(arr) {
  const xs = (arr || []).filter(isNum);
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function buildDomainTrend(domainSeries) {
  const out = {};
  const ds = domainSeries || {};

  for (const [domain, series0] of Object.entries(ds)) {
    const series = Array.isArray(series0) ? series0.map(Number).filter(isNum) : [];
    const first = series.length ? series[0] : null;
    const last = series.length ? series[series.length - 1] : null;

    out[domain] = {
      series,
      first,
      last,
      delta: first != null && last != null ? (last - first) : null,
      mean: mean(series),
    };
  }
  return out;
}

/**
 * ✅ index.js 호환 Wrapper
 * @param {{ageMonth:number, domainSeries:Record<string, number[]>}} param0
 * @returns {{
 *   coreDomain: string|null,
 *   domainTrend: Record<string, {series:number[], first:number|null, last:number|null, delta:number|null, mean:number|null}>,
 *   topUpDomains: string[],
 *   topDownDomains: string[]
 * }}
 */
function analyzeMonthlyTrend({ ageMonth, domainSeries }) {
  // ageMonth는 당장 여기서 직접 쓰지 않아도 됨(추후 기준치/가중치 넣을 자리)
  const domainTrend = buildDomainTrend(domainSeries);

  // coreDomain: "평균이 가장 높은 도메인" (빈값이면 null)
  let coreDomain = null;
  let best = -Infinity;

  for (const [domain, t] of Object.entries(domainTrend)) {
    if (t.mean == null) continue;
    if (t.mean > best) {
      best = t.mean;
      coreDomain = domain;
    }
  }

  // 상승/하락: delta 기준으로 정렬(불연속 주차에서도 first/last로 계산됨)
  const ups = [];
  const downs = [];

  for (const [domain, t] of Object.entries(domainTrend)) {
    if (t.delta == null) continue;
    if (t.delta > 0) ups.push([domain, t.delta]);
    if (t.delta < 0) downs.push([domain, t.delta]);
  }

  ups.sort((a, b) => b[1] - a[1]);        // 큰 상승부터
  downs.sort((a, b) => a[1] - b[1]);      // 더 큰 하락(음수)부터

  const topUpDomains = ups.slice(0, 2).map(x => x[0]);
  const topDownDomains = downs.slice(0, 2).map(x => x[0]);

  return {
    coreDomain,
    domainTrend,
    topUpDomains,
    topDownDomains,
  };
}

module.exports = analyzeMonthlyTrend;
module.exports.analyzeMonthlyTrend = analyzeMonthlyTrend;
module.exports.buildDomainTrend = buildDomainTrend;
module.exports.SIGNAL_KEYS = SIGNAL_KEYS;
