// services/monthlyReport/llmInputBuilder.js
// 월간 리포트 생성용 "입력 JSON"을 표준 스키마로 만들어주는 빌더

function buildMeta({ parent_id, ym, child_name, age_month }) {
  // optional: age_band/option_range는 로그/디버깅용
  const band =
    age_month <= 17 ? '12-17' :
      age_month <= 23 ? '18-23' : '24+';

  const option_range =
    band === '12-17' ? [1, 2, 3, 4] :
      band === '18-23' ? [3, 4, 5, 6] : [5, 6, 7, 8];

  return {
    parent_id,
    ym, // "YYYY-MM"
    child: { name: child_name, age_month: Number(age_month) || null },
    locale: "ko-KR",
    timezone: "Asia/Seoul",
    age_band: band,
    option_range
  };
}

function buildConstraints() {
  return {
    no_new_facts: true,
    no_medical_diagnosis: true,
    no_comparisons_to_other_children: true,
    style: {
      tone: "professional_neutral",
      // 출력 길이 제한은 모델/프롬프트에서도 다시 걸어줘야 안정적
      max_sentences: {
        monthly_flow: 3,
        teacher_note: 6,
        domain: 4
      }
    }
  };
}

function buildMonthlyFlowInput(meta, lessonMix, trend, objectiveBullets = []) {
  return {
    schema_version: "monthly_report_input_v1",
    task: "generate_monthly_flow_summary",
    meta,
    constraints: buildConstraints(),
    input: {
      month_profile: {
        lesson_mix: lessonMix,
        trend,
        objective_bullets: objectiveBullets
      }
    }
  };
}

function buildTeacherNoteInput(meta, anchors, guidancePolicy) {
  return {
    schema_version: "monthly_report_input_v1",
    task: "generate_teacher_note",
    meta,
    constraints: buildConstraints(),
    input: {
      anchors,        // 관찰 근거(문장/포인트)
      guidance_policy: guidancePolicy // 금지어/권장 스타일/마무리 문구
    }
  };
}

function buildDomainGrowthInput(meta, domain, domainAggregate) {
  return {
    schema_version: "monthly_report_input_v1",
    task: "generate_domain_growth_point",
    meta,
    constraints: buildConstraints(),
    input: {
      domain,
      domain_aggregate: domainAggregate
    }
  };
}

// llmInputBuilder.js

function buildLLMInput(monthlyInputs) {
  const meta = monthlyInputs?.meta || {};
  const childName = meta?.child?.name || "";
  const ym = meta?.ym || "";

  const flow = monthlyInputs?.inputs?.flow || null;
  const teacherNote = monthlyInputs?.inputs?.teacher_note || null;
  const domains = monthlyInputs?.inputs?.domains || {};

  return `
너는 조이조이 월간 리포트를 생성한다.
반드시 아래 스키마에 맞는 JSON만 출력한다. JSON 외 텍스트 금지.

[출력 스키마]
{
  "one_line": "string",
  "flow_summary": "string",
  "change_points": ["string","string"],
  "parent_tone_comment": "string",
  "core_domain": "string|null",
  "domain_analysis": [
    {
      "domain": "string",
      "summary": "string"
    }
  ]
}


[작성 규칙]
- 언어(language) 영역 언급/추론/출력 금지
- 비교 금지(다른 아이/평균 대비 등)
- 진단 금지(지연/문제/장애 등)
- flow_summary: 2~3문장, 객관 문장 위주
- parent_tone_comment: 4문장(해석+연결), 따뜻하지만 과장 없이


- domain_analysis 규칙:
  * 반드시 2개 도메인을 출력한다.
  * 첫 번째는 core_domain.
  * 두 번째는 보조 도메인(topUp) 1개.
  * α 도메인은 조건이 명확할 때만 1개 추가(최대 3개).
  * 각 summary는 2문장 이내, 관찰/추세/신호에 근거해 작성.

[도메인 선택 힌트]
- core_domain: ${monthlyInputs?.monthlyTrend?.coreDomain || null}
- domain_means: ${JSON.stringify(monthlyInputs?.weeklyAggregated?.domainMeans || {}, null, 2)}
- domain_trend: ${JSON.stringify(monthlyInputs?.monthlyTrend || {}, null, 2)}


[메타]
- ym: ${ym}
- child_name: ${childName}

[입력(월간 flow)]
${JSON.stringify(flow, null, 2)}

[입력(teacher note)]
${JSON.stringify(teacherNote, null, 2)}

[입력(domains)]
${JSON.stringify(domains, null, 2)}
  `.trim();
}

module.exports = { buildLLMInput };

