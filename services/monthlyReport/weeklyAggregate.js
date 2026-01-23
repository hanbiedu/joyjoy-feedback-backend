// services/monthlyReport/weeklyAggregate.js
// month index.js가 호출하는 형태: aggregateWeekly({ ageMonth, weeklyFeedbacks, itemMetaById? })

const {
  mixedSignal,
  persistenceSignal,
  selfInitiationSignal,
} = require("./signals");

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeJsonParse(maybeJson) {
  if (maybeJson == null) return null;
  if (typeof maybeJson === "object") return maybeJson; // 이미 파싱된 경우
  if (typeof maybeJson !== "string") return null;

  const s = maybeJson.trim();
  if (!s) return null;

  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeItems(itemsLike) {
  const arr = Array.isArray(itemsLike) ? itemsLike : [];
  return arr
    .map((it) => {
      const id = Number(it?.id);
      const v = Number(it?.value);
      if (!Number.isFinite(id) || id <= 0) return null;
      if (!Number.isFinite(v) || v < 1 || v > 8) return null;
      return {
        id,
        value: v,
        domain: it?.domain ? String(it.domain) : null,
      };
    })
    .filter(Boolean);
}

/**
 * @param {{
 *   ageMonth?: number,
 *   weeklyFeedbacks?: Array<{lesson?:string, week?:number, items_json?:string|Array, summary_json?:string|Object}>,
 *   itemMetaById?: Record<number, {domain?:string}>
 * }} payload
 */
function aggregateWeekly(payload) {
  const weeklyFeedbacks = Array.isArray(payload?.weeklyFeedbacks)
    ? payload.weeklyFeedbacks
    : [];

  const itemMetaById = payload?.itemMetaById || null;

  // domainSeries: 도메인별 주차 평균 시계열
  const domainSeries = {
    sensory: [],
    cognition: [],
    language: [],
    motor: [],
    social: [],
  };

  // domainMeans: 도메인별 전체 평균(월간 평균)
  const byDomainAllValues = {
    sensory: [],
    cognition: [],
    language: [],
    motor: [],
    social: [],
  };

  const weeks = [];
  const weeklySignals = [];

  // week 오름차순(없으면 lessonKey의 "-n"을 시도)
  const sorted = [...weeklyFeedbacks].sort((a, b) => {
    const wa = Number(a?.week) || Number(String(a?.lesson || "").split("-")[1]) || 0;
    const wb = Number(b?.week) || Number(String(b?.lesson || "").split("-")[1]) || 0;
    return wa - wb;
  });

  for (const wf of sorted) {
    const week =
      Number(wf?.week) ||
      Number(String(wf?.lesson || "").split("-")[1]) ||
      null;

    const parsedItems = safeJsonParse(wf?.items_json);
    const items = normalizeItems(parsedItems);

    // valuesAll (주차 전체)
    const valuesAll = items.map((x) => x.value);

    // byDomainValues (주차 도메인별)
    const byDomainValues = {};
    for (const it of items) {
      const domain =
        it.domain ||
        (itemMetaById?.[it.id]?.domain ? String(itemMetaById[it.id].domain) : null);

      if (!domain) continue;

      byDomainValues[domain] ??= [];
      byDomainValues[domain].push(it.value);

      if (byDomainAllValues[domain]) byDomainAllValues[domain].push(it.value);
    }

    const engagement = mixedSignal(valuesAll);
    const persistence = persistenceSignal(valuesAll);

    // 교사개입: engagement를 반전해서 1~5로
    const teacherPrompt = engagement == null ? null : clamp(6 - engagement, 1, 5);
    const selfInitiation = selfInitiationSignal(valuesAll);

    const verbal = byDomainValues.language ? mixedSignal(byDomainValues.language) : null;

    weeklySignals.push({
      week,
      signals: {
        engagement_level: engagement,
        persistence_level: persistence,
        teacher_prompt_level: teacherPrompt,
        self_initiation_level: selfInitiation,
        verbal_response_level: verbal,
      },
      byDomainValues,
    });

    weeks.push(week);
  }

  // domainSeries 채우기 (주차별 도메인 평균)
  for (const ws of weeklySignals) {
    for (const domain of Object.keys(domainSeries)) {
      const arr = ws.byDomainValues?.[domain] || [];
      if (!arr.length) {
        domainSeries[domain].push(null);
        continue;
      }
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      domainSeries[domain].push(mean);
    }
  }

  // domainMeans (월간 전체 평균)
  const domainMeans = {};
  for (const domain of Object.keys(byDomainAllValues)) {
    const arr = byDomainAllValues[domain];
    if (!arr.length) continue;
    domainMeans[domain] = arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  // 기존 코드 호환을 위해 signals/byDomainValues도 마지막 주 기준으로 제공(필요시)
  const last = weeklySignals[weeklySignals.length - 1] || null;

  return {
    weeks,
    weeklySignals,
    domainSeries,
    domainMeans,
    // 아래는 과거 코드가 기대할 수도 있어서 유지
    signals: last?.signals || {
      engagement_level: null,
      persistence_level: null,
      teacher_prompt_level: null,
      self_initiation_level: null,
      verbal_response_level: null,
    },
    byDomainValues: last?.byDomainValues || {},
  };
}

module.exports = { aggregateWeekly };
