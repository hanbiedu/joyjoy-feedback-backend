// services/monthlyReport/weeklyAggregate.js

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
  if (typeof v === "object") return v;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
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

  // ✅ 언어 완전 삭제: 4도메인만
  const allByDomain = { sensory: [], cognition: [], motor: [], social: [] };
  const domainSeries = { sensory: [], cognition: [], motor: [], social: [] };

  const weeklySignals = [];

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

    const parsed = safeJsonParse(wf?.items_json);
    const items = normalizeItems(parsed);

    const valuesAll = items.map((x) => x.value);

    // ✅ 언어 완전 삭제
    const byDomain = { sensory: [], cognition: [], motor: [], social: [] };

    for (const it of items) {
      const metaDomain = itemMetaById?.[it.id]?.domain
        ? String(itemMetaById[it.id].domain).trim()
        : null;

      const domain = it.domain || metaDomain;
      if (!domain || !byDomain[domain]) continue;

      byDomain[domain].push(it.value);
      allByDomain[domain].push(it.value);
    }

    for (const d of Object.keys(domainSeries)) {
      domainSeries[d].push(mean(byDomain[d]));
    }

    // signals (주차 전체 기준)
    const engagement = mixedSignal(valuesAll);
    const persistence = persistenceSignal(valuesAll);
    const teacherPrompt = engagement == null ? null : clamp(6 - engagement, 1, 5);
    const selfInitiation = selfInitiationSignal(valuesAll);

    weeklySignals.push({
      week,
      signals: {
        engagement_level: engagement,
        persistence_level: persistence,
        teacher_prompt_level: teacherPrompt,
        self_initiation_level: selfInitiation,
      },
      byDomainValues: byDomain,
    });
  }

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
    signals: last?.signals || {
      engagement_level: null,
      persistence_level: null,
      teacher_prompt_level: null,
      self_initiation_level: null,
    },
  };
}

module.exports = { aggregateWeekly };
