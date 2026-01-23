// services/monthlyReport/weeklyAggregate.js
// 한 주차 lesson의 items_json -> signals 5종 + domain별 값 분리
// ✅ items_json이 LONGTEXT(string)여도 JSON.parse 해서 처리
// ✅ item 자체에 domain이 있으면 우선 사용, 없으면 itemMetaById로 보완

const {
  mixedSignal,
  persistenceSignal,
  selfInitiationSignal
} = require("./signals");

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * LONGTEXT JSON 문자열 / 배열 / 객체 모두 받아서 "배열"로 정규화
 * @param {any} v
 * @returns {Array|null}
 */
function parseItemsMaybe(v) {
  if (v == null) return null;

  // 이미 배열이면 그대로
  if (Array.isArray(v)) return v;

  // 문자열이면 JSON.parse 시도
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  // 그 외(객체 등)는 지원 안 함
  return null;
}

/**
 * @param {Array<{id:number|string,value:number|string,domain?:string}> | string} itemsOrJson
 * @param {Object<number, {domain:string, line1?:string, line2?:string}>} itemMetaById
 * @returns {{
 *   signals: {
 *     engagement_level: number|null,
 *     persistence_level: number|null,
 *     teacher_prompt_level: number|null,
 *     self_initiation_level: number|null,
 *     verbal_response_level: number|null
 *   },
 *   byDomainValues: Record<string, number[]>
 * }}
 */
function aggregateWeekly(itemsOrJson, itemMetaById) {
  const safeItems = parseItemsMaybe(itemsOrJson) || [];

  // 1) 전체 값(신호용)
  const valuesAll = safeItems
    .map((i) => Number(i?.value))
    .filter((v) => Number.isFinite(v) && v >= 1 && v <= 8);

  // 2) 도메인별 값(평균/언어신호용)
  const byDomainValues = {};
  for (const it of safeItems) {
    const id = Number(it?.id);
    const meta = Number.isFinite(id) ? itemMetaById?.[id] : null;

    // ✅ item에 domain이 있으면 우선, 없으면 meta.domain
    const domainRaw = it?.domain ?? meta?.domain ?? null;
    const domain = typeof domainRaw === "string" ? domainRaw.trim() : null;
    if (!domain) continue;

    const v = Number(it?.value);
    if (!Number.isFinite(v) || v < 1 || v > 8) continue;

    byDomainValues[domain] ??= [];
    byDomainValues[domain].push(v);
  }

  const engagement = mixedSignal(valuesAll);
  const persistence = persistenceSignal(valuesAll);

  // 직관: 교사개입은 낮을수록 좋게(개입↓) 보이도록 반전
  const teacherPrompt = engagement == null ? null : clamp(6 - engagement, 1, 5);

  const selfInitiation = selfInitiationSignal(valuesAll);

  // 언어는 language 도메인만 (없으면 null)
  const verbal = byDomainValues.language ? mixedSignal(byDomainValues.language) : null;

  return {
    signals: {
      engagement_level: engagement,
      persistence_level: persistence,
      teacher_prompt_level: teacherPrompt,
      self_initiation_level: selfInitiation,
      verbal_response_level: verbal,
    },
    byDomainValues,
  };
}

module.exports = { aggregateWeekly };
