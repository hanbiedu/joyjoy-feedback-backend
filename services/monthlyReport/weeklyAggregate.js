// services/monthlyReport/weeklyAggregate.js
// 한 주차 lesson의 items_json -> signals 5종 + domain별 값 분리

const {
    mixedSignal,
    persistenceSignal,
    selfInitiationSignal
  } = require('./signals');
  
  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }
  
  /**
   * @param {Array<{id:number|string,value:number|string}>} items
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
  function aggregateWeekly(items, itemMetaById) {
    const safeItems = Array.isArray(items) ? items : [];
    const valuesAll = safeItems
      .map(i => Number(i.value))
      .filter(v => Number.isFinite(v) && v >= 1 && v <= 8);
  
    const byDomainValues = {};
    for (const it of safeItems) {
      const id = Number(it.id);
      const meta = itemMetaById?.[id];
      if (!meta?.domain) continue;
  
      const v = Number(it.value);
      if (!Number.isFinite(v) || v < 1 || v > 8) continue;
  
      byDomainValues[meta.domain] ??= [];
      byDomainValues[meta.domain].push(v);
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
        verbal_response_level: verbal
      },
      byDomainValues
    };
  }
  
  module.exports = { aggregateWeekly };
  