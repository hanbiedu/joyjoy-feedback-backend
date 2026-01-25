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
  너는 ‘아이 발달 평가 보고서’를 작성하지 않는다.
  너는 한 달 동안 진행된 수업을 관찰한 교사로서,
  수업 기록을 부모에게 전달하는 ‘월간 수업 관찰 리포트’를 작성한다.
  
  리포트의 목적은 아이를 평가하거나 조언하는 것이 아니라,
  수업 안에서 실제로 관찰된 참여 방식과 변화 흐름을 차분하고 구체적으로 전달하는 것이다.
  
  반드시 아래 스키마에 맞는 JSON만 출력한다. JSON 외 텍스트 금지.
  
  [출력 스키마]
  {
    "one_line": "string",
    "flow_summary": "string",
    "change_points": ["string","string"],
    "parent_tone_comment": "string",
    "core_domain": "string|null",
    "domain_analysis": [
      { "domain": "string", "summary": "string" }
    ]
  }
  
  [리포트 전체 작성 원칙]
  1) 이 리포트는 ‘발달 상태 평가’가 아니다.
  - “발달”, “능력”, “수준”, “영향”, “필요합니다” 같은 평가·조언 표현 금지
  - 진단/예측/과장 금지
  
  2) 반드시 ‘수업 장면에서 관찰된 사실’만 서술한다.
  - 아이가 무엇을 했는지
  - 어떻게 참여했는지
  - 교사의 안내 → 아이의 선택/이어가기 흐름 변화가 있었는지
  
  3) 모든 문장은 교사가 직접 본 장면을 기록하듯 작성한다.
  - 추상적 요약 금지
  - “~하는 모습이 관찰되었습니다 / ~장면이 늘어났습니다 / ~흐름으로 이어졌습니다” 같은 관찰 문장 사용
  
  4) 언어(language) 영역은 어떤 경우에도 언급/추론/출력 금지
  - 말, 소리, 단어, 표현, 언어 반응 관련 서술 전부 금지
  
  [항목별 작성 가이드]
  ■ one_line
  - 단순 제목 문장 1문장
  - 예: “${childName}의 ${ym} 월간 리포트입니다.”
  
  ■ flow_summary (2~3문장, 객관)
  - 한 달 수업의 흐름을 요약한다.
  - 반드시 아래 중 2가지 이상 포함:
    · 활동 참여 방식의 변화
    · 재료를 다루는 태도의 변화
    · 활동 지속/몰입 흐름
    · 안내 중심 → 선택/이어가기 중심으로의 이동
  - “좋아요/우수/긍정적” 같은 평가어 금지
  
  ■ change_points (정확히 2개)
  - 변화 지점만 간결하게 2개
  - 평가/비교 금지
  - “~장면이 늘어났습니다 / ~흐름이 관찰되었습니다” 형태 권장
  
  ■ parent_tone_comment (정확히 4문장: 해석 + 연결)
  - 구조를 반드시 지킨다:
    1문장: 수업 중 전반적인 참여 모습
    2문장: 반복적으로 관찰된 반응/태도
    3문장: 아이가 편안해 보였던 수업 흐름
    4문장: 다음 수업에서 이어갈 방향(조언 금지, ‘계획/연결’은 허용)
  - “필요합니다/도움이 됩니다” 금지
  - “~이어갈 예정입니다/계획입니다”는 허용
  
  ■ domain_analysis (2 + α, 풍부하게)
  - 기본 2개 도메인을 작성한다.
  - 첫 번째는 반드시 core_domain
  - 두 번째는 보조 도메인 1개(topUp)
  - α 도메인은 core_domain과 보조 도메인 모두에서
  명확한 변화 신호가 동시에 나타날 때만 추가한다.
  그렇지 않으면 절대 추가하지 않는다.

  - 각 summary는 정확히 2문장으로 작성
  - 발달 판정이 아니라 ‘수업 중 관찰된 반응 패턴’으로 쓴다.
    예: “재료를 손으로 확인하는 장면이 반복되었습니다. 잠깐 멈춘 뒤 다시 이어가는 흐름이 관찰되었습니다.”
  
  [근거 사용 방법]
  - domains 입력은 관찰 근거 참고용이다.
  - 수치/레벨을 그대로 쓰지 말고, 수업 장면 언어로 변환한다.


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

