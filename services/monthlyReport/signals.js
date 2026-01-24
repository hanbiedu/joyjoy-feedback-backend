// services/monthlyReport/signals.js
// ✅ option(1~8) 배열 -> signal(1~5) 계산 (혼합방식 v1)
// ✅ + 월간 generateSignals({ageMonth, weeklyAggregated, monthlyTrend}) wrapper 추가

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function toNums(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map(v => Number(v))
    .filter(v => Number.isFinite(v) && v >= 1 && v <= 8);
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// 중앙값(1~8) -> base(1~5)
function baseFromMedian(m) {
  if (m == null) return null;
  if (m <= 2) return 1;
  if (m <= 4) return 2;
  if (m === 5) return 3;
  if (m === 6) return 4;
  return 5; // 7~8
}

// 상단 비율(>=6) -> bonus (일반)
function bonusFromTopRatio(r) {
  if (r < 0.10) return 0;
  if (r < 0.30) return 0.5;
  if (r < 0.50) return 1.0;
  return 1.5;
}

// 상단 비율(>=6) -> bonus (자기주도 전용 강화)
function bonusSelfInitiation(r) {
  if (r < 0.10) return 0;
  if (r < 0.30) return 1.0;
  if (r < 0.50) return 1.5;
  return 2.0;
}

// 혼합 시그널(일반): median->base + topRatio bonus
function mixedSignal(rawValues) {
  const values = toNums(rawValues);
  if (values.length === 0) return null;

  const m = median(values);
  const base = baseFromMedian(m);
  if (base == null) return null;

  const topRatio = values.filter(v => v >= 6).length / values.length;
  const bonus = bonusFromTopRatio(topRatio);

  return clamp(Math.round(base + bonus), 1, 5);
}

// 지속성: 하위 20% 절사 후 mixedSignal
function persistenceSignal(rawValues) {
  const values = toNums(rawValues);
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.max(1, Math.floor(sorted.length * 0.2));
  const trimmed = sorted.slice(cut);
  return mixedSignal(trimmed);
}

// 자기주도: bonus 강화
function selfInitiationSignal(rawValues) {
  const values = toNums(rawValues);
  if (values.length === 0) return null;

  const m = median(values);
  const base = baseFromMedian(m);
  if (base == null) return null;

  const topRatio = values.filter(v => v >= 6).length / values.length;
  const bonus = bonusSelfInitiation(topRatio);

  return clamp(Math.round(base + bonus), 1, 5);
}

function mean(arr) {
  const xs = (arr || []).filter(v => Number.isFinite(v));
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * ✅ 월간 시그널 생성 wrapper
 * weeklyAggregate.js가 만든 weeklyAggregated.weekly[]를 기반으로
 * 월간 평균/변화요약을 만든다.
 */
function generateSignals({ ageMonth, weeklyAggregated, monthlyTrend }) {
  const weekly = Array.isArray(weeklyAggregated?.weeklySignals)
  ? weeklyAggregated.weeklySignals
  : [];


  // 주차별 signals 시리즈 뽑기 (불연속 OK)
  const series = {
    engagement_level: [],
    persistence_level: [],
    teacher_prompt_level: [],
    self_initiation_level: [],
    verbal_response_level: [],
  };

  for (const w of weekly) {
    const s = w.signals || {};
    for (const k of Object.keys(series)) {
      series[k].push(s[k] ?? null);
    }
  }

  const avg = {};
  for (const [k, arr] of Object.entries(series)) {
    avg[k] = mean(arr.map(v => (v == null ? NaN : Number(v)))) ?? null;
    if (avg[k] != null) avg[k] = Number(avg[k].toFixed(2));
  }

  // highlight/caution: domainTrend + avg를 이용해 간단히 만들기
  // (LLM에 들어갈 “신호 문장”은 generateInputs/llmInputBuilder에서 더 풍부하게 써도 됨)
  const coreDomain = monthlyTrend?.coreDomain || null;
  const up = Array.isArray(monthlyTrend?.topUpDomains) ? monthlyTrend.topUpDomains : [];
  const down = Array.isArray(monthlyTrend?.topDownDomains) ? monthlyTrend.topDownDomains : [];

  const highlight = up.length
    ? `이번 달은 ${up[0]} 영역의 상승 흐름이 두드러졌습니다.`
    : (coreDomain ? `이번 달은 ${coreDomain} 영역이 가장 안정적으로 유지되었습니다.` : null);

  const caution = down.length
    ? `이번 달은 ${down[0]} 영역에서 변동이 관찰됩니다.`
    : null;

  return {
    // 숫자 요약
    avg_signal_levels: avg,

    // 텍스트 요약(LLM 없이도 최소 표시 가능)
    highlight,
    caution,
  };
}

module.exports = {
  generateSignals,
  mixedSignal,
  persistenceSignal,
  selfInitiationSignal,
  _internal: {
    clamp,
    toNums,
    median,
    baseFromMedian,
    bonusFromTopRatio,
    bonusSelfInitiation,
    mean,
  },
};
