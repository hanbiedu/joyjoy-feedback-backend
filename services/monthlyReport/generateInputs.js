// services/monthlyReport/generateInputs.js

const { aggregateWeekly } = require('./weeklyAggregate');
const { buildTrend } = require('./monthlyTrend');
const {
  buildMeta,
  buildMonthlyFlowInput,
  buildTeacherNoteInput,
  buildDomainGrowthInput
} = require('./llmInputBuilder');

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function buildHistogram(values) {
  const hist = {};
  for (let i = 1; i <= 8; i++) hist[String(i)] = 0;
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 1 && n <= 8) hist[String(n)]++;
  }
  return hist;
}

function buildDomainAggregates(weeklyByDomainValues) {
  // weeklyByDomainValues: [{week_index, byDomainValues:{language:[..], cognition:[..]...}}]
  const out = {}; // domain -> aggregate

  for (const w of weeklyByDomainValues) {
    const wi = w.week_index;
    for (const [domain, vals] of Object.entries(w.byDomainValues || {})) {
      out[domain] ??= { option_value_histogram: buildHistogram([]), week_by_week: [] };
      // 누적 histogram
      const h = out[domain].option_value_histogram;
      for (const v of vals) {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 1 && n <= 8) h[String(n)]++;
      }
      // 주차별
      out[domain].week_by_week.push({ week_index: wi, option_values: vals.map(Number) });
    }
  }

  // week_by_week는 week_index 오름차순 정렬
  for (const domain of Object.keys(out)) {
    out[domain].week_by_week.sort((a, b) => a.week_index - b.week_index);
  }

  return out;
}

/**
 * @param {{
 *   parent_id: string,
 *   ym: string, // "YYYY-MM"
 *   child_name: string,
 *   age_month: number,
 *   // 주간 4주치 레슨 데이터 (DB에서 가져온 items_json 파싱 결과)
 *   weeklyLessons: Array<{
 *     week_index: 1|2|3|4,
 *     lesson_key?: string,
 *     title?: string,
 *     items: Array<{id:number|string, value:number|string}>
 *   }>,
 *   // item meta: item{month}.json 기반으로 id->meta(domain,line1,line2)
 *   itemMetaById: Record<number, {domain:string, line1?:string, line2?:string}>
 * }} args
 */
function generateMonthlyInputs(args) {
  const {
    parent_id, ym, child_name, age_month,
    weeklyLessons, itemMetaById
  } = args;

  const meta = buildMeta({ parent_id, ym, child_name, age_month });

  // 1) 주차별 signals + domain values
  const weekly = (weeklyLessons || [])
    .slice()
    .sort((a, b) => a.week_index - b.week_index)
    .map(l => {
      const agg = aggregateWeekly(l.items || [], itemMetaById);
      return {
        week_index: l.week_index,
        lesson_key: l.lesson_key || null,
        title: l.title || null,
        signals: agg.signals,
        byDomainValues: agg.byDomainValues
      };
    });

  // 2) trend
  const trend = buildTrend(weekly.map(w => ({ week_index: w.week_index, signals: w.signals })));

  // 3) domain aggregates (histogram + week_by_week)
  const domainAggregates = buildDomainAggregates(
    weekly.map(w => ({ week_index: w.week_index, byDomainValues: w.byDomainValues }))
  );

  // 4) lesson mix (일단 최소 스펙: 호출부에서 계산해서 넣는 걸 권장)
  // 여기서는 비워두고, 라우트에서 계산하거나 나중에 확장
  const lessonMix = {
    material_play_count: null,
    observation_activity_count: null,
    other_count: null,
    notes: []
  };

  // 5) objective bullets(객관 bullet) - v1에서는 비워두고, 필요하면 룰로 채움
  const objectiveBullets = [];

  // 6) LLM 입력들 생성
  const flowInput = buildMonthlyFlowInput(meta, lessonMix, trend, objectiveBullets);

  const teacherNoteInput = buildTeacherNoteInput(
    meta,
    {
      strength_like_observations: [],
      support_needed_observations: [],
      response_signals: {
        verbal_response_level: trend.verbal_response_level,
        emotion_regulation_level: null // 지금 signals에 없으면 null 유지(추가 시 확장)
      }
    },
    {
      avoid: ["지연", "문제", "정상/비정상", "평균 대비"],
      recommendations_style: [
        "기대 낮추고 반복 제공",
        "짧은 말·소리·의성어 중심",
        "작은 반응 신호를 강화"
      ],
      closing_commitment: "수업에서는 작은 반응 신호를 강화하며 언어 경험을 안정적으로 확장할 예정"
    }
  );

  // 영역별 입력 (domainAggregates가 있는 도메인만)
  const domainInputs = {};
  for (const [domain, agg] of Object.entries(domainAggregates)) {
    domainInputs[domain] = buildDomainGrowthInput(meta, domain, {
      option_value_histogram: agg.option_value_histogram,
      week_by_week: agg.week_by_week,
      observed_keywords: [], // v1: 추후 line2에서 키워드 추출 넣기
      boundaries: {
        must_be_observation_first: true,
        allow_interpretation: "light_context_only"
      }
    });
  }

  // core_domain(월간 핵심영역) + domain_idx_mean_json(평균) 계산 (요청했던 6-1 합의 반영)
  // 여기서는 "도메인별 평균 signal(engagement 기반)"의 단순 버전 예시.
  // 실제로는 domain별 option 평균/중앙값을 계산하도록 확장 가능.
  const domainMeans = {};
  for (const [domain, agg] of Object.entries(domainAggregates)) {
    // option값(1~8) 평균을 1~8로 계산 -> 1~5로 간단 리스케일(대략)
    const all = [];
    for (const ww of agg.week_by_week) all.push(...ww.option_values);
    if (all.length) {
      const avg = all.reduce((a, b) => a + b, 0) / all.length;
      const scaled = clamp(Math.round((avg / 8) * 5), 1, 5);
      domainMeans[domain] = Number((scaled).toFixed(1));
    }
  }
  // core_domain: 가장 높은 mean 도메인(동점이면 첫번째)
  let coreDomain = null;
  let best = -1;
  for (const [d, m] of Object.entries(domainMeans)) {
    if (m > best) { best = m; coreDomain = d; }
  }

  return {
    meta,
    weekly,
    trend,
    domainAggregates,
    inputs: {
      flow: flowInput,
      teacher_note: teacherNoteInput,
      domains: domainInputs
    },
    computed: {
      core_domain: coreDomain,
      domain_idx_mean_json: domainMeans
    }
  };
}

module.exports = { generateMonthlyInputs };
