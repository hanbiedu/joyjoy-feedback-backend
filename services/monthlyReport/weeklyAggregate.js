// services/monthlyReport/weeklyAggregate.js
// ✅ 월간 index.js가 호출하는 형태를 그대로 받는다:
//    aggregateWeekly({ ageMonth, weeklyFeedbacks, itemMetaById? })
//
// ✅ weeklyFeedbacks[].items_json 이 LONGTEXT(string)여도 JSON.parse 해서 처리
// ✅ item에 domain이 있으면 우선 사용, 없으면 itemMetaById로 보완(있을 때만)

const {
  mixedSignal,
  persistenceSignal,
  selfInitiationSignal,
} = require("./signals");

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeJsonParse(v) {
  if (v == null) return null;
  if (typeof v === "object") return v; // already parsed
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function mean(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function normalizeItems(itemsLike) {
  const arr = Array.isArray(itemsLike) ? itemsLike : [];
  return arr
    .map((it) => {
      const id = Number(it?.id);
      const value = Number(it?.value);
      if (!Number.isFinite(id) || id <= 0) return null;
      if (!Number.isFinite(value) || value < 1 || value > 8) return null;
      return {
        id,
        value,
        domain: it?.domain ? String(it.domain).trim() : null,
      };
    })
    .filter(Boolean);
}

function aggregateWeekly(payload) {
  const weeklyFeedbacks = Array.isArray(payload?.weeklyFeedbacks)
    ? payload.weeklyFeedbacks
    : [];

  const itemMetaById = payload?.itemMetaById || null;

  // 월간 누적(평균용)
  const allByDomain = {
    sensory: [],
    cognition: [],
    language: [],
    motor: [],
    social: [],
  };

  // 주차별 시계열(트렌드용)
  const domainSeries = {
    sensory: [],
    cognition: [],
    language: [],
    motor: [],
    social: [],
  };

  const weeklySignals = [];

  // 주차 정렬(week 없으면 lessonKey에서 -n 추출)
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

    // ✅ LONGTEXT(string) -> parse -> array
    const parsed = safeJsonParse(wf?.items_json);
    const items = normalizeItems(parsed);

    const valuesAll = items.map((x) => x.value);

    // 주차 도메인별
    const byDomain = {
      sensory: [],
      cognition: [],
      language: [],
      motor: [],
      social: [],
    };

    for (const it of items) {
      const metaDomain = itemMetaById?.[it.id]?.domain
        ? String(itemMetaById[it.id].domain).trim()
        : null;

      const domain = it.domain || metaDomain;
      if (!domain || !byDomain[domain]) continue;

      byDomain[domain].push(it.value);
      allByDomain[domain].push(it.value);
    }

    // 주차별 domainSeries push (없으면 null)
    for (const d of Object.keys(domainSeries)) {
      domainSeries[d].push(mean(byDomain[d]));
    }

    // signals (주차 전체 기준)
    const engagement = mixedSignal(valuesAll);
    const persistence = persistenceSignal(valuesAll);
    const teacherPrompt = engagement == null ? null : clamp(6 - engagement, 1, 5);
    const selfInitiation = selfInitiationSignal(valuesAll);

    // 언어는 language 도메인만
    const verbal = byDomain.language.length ? mixedSignal(byDomain.language) : null;

    weeklySignals.push({
      week,
      signals: {
        engagement_level: engagement,
        persistence_level: persistence,
        teacher_prompt_level: teacherPrompt,
        self_initiation_level: selfInitiation,
        verbal_response_level: verbal,
      },
      byDomainValues: byDomain,
    });
  }

  // 월간 평균(domainMeans)
  const domainMeans = {};
  for (const d of Object.keys(allByDomain)) {
    const m = mean(allByDomain[d]);
    if (m != null) domainMeans[d] = m;
  }

  const last = weeklySignals[weeklySignals.length - 1] || null;

  return {
    domainSeries,
    domainMeans,
    weeklySignals,
    // 호환용 (기존 코드가 signals만 볼 수도 있어서 유지)
    signals: last?.signals || {
      engagement_level: null,
      persistence_level: null,
      teacher_prompt_level: null,
      self_initiation_level: null,
      verbal_response_level: null,
    },
  };
}

module.exports = { aggregateWeekly };
