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

function buildLLMInput(monthlyInputs) {
  // monthlyInputs: generateMonthlyInputs()가 만든 결과
  // 여기서는 inputs.flow / inputs.teacher_note / inputs.domains 를 "한 번에" 모델에 줄 프롬프트로 합친다.

  const meta = monthlyInputs?.meta || {};
  const childName = meta?.child?.name || meta?.child?.name || "";
  const ym = meta?.ym || "";

  const flow = monthlyInputs?.inputs?.flow || null;
  const teacherNote = monthlyInputs?.inputs?.teacher_note || null;
  const domains = monthlyInputs?.inputs?.domains || {};

  // ✅ 모델에게 "출력 JSON 스키마"를 강하게 요구
  return `
  너는 조이조이 월간 리포트를 생성한다.
  반드시 아래 스키마에 맞는 JSON만 출력한다. JSON 외 텍스트 금지.
  
  [출력 스키마]
  {
    "one_line": "string",
    "flow_summary": "string",
    "change_points": ["string","string"],
    "parent_tone_comment": "string",
    "core_domain": "sensory|cognition|language|motor|social|null",
    "domain_idx_mean_json": { "sensory": number, "cognition": number, "language": number, "motor": number, "social": number }
  }

  [출력 예시]
{
  "one_line": "이번 달은 인지 영역의 성장 흐름이 두드러졌습니다.",
  "flow_summary": "아이는 다양한 탐색 활동을 통해 관찰력과 문제 해결 능력이 점진적으로 향상되었습니다.",
  "change_points": [
    "cognition 영역의 점진적 상승",
    "social 영역의 안정적 유지"
  ],
  "parent_tone_comment": "아이의 흥미와 참여도가 자연스럽게 확장되고 있어 긍정적인 한 달이었습니다.",
  "core_domain": "cognition",
  "domain_idx_mean_json": {
    "sensory": 7,
    "cognition": 6.25,
    "language": null,
    "motor": 6.33,
    "social": 7
  }
}
  
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


// module.exports = {
//   buildMeta,
//   buildConstraints,
//   buildMonthlyFlowInput,
//   buildTeacherNoteInput,
//   buildDomainGrowthInput, 
//   buildLLMInput
// };
module.exports = { buildLLMInput };
