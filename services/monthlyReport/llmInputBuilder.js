// services/monthlyReport/llmInputBuilder.js
// 월간 리포트 생성용 "입력 JSON"을 표준 스키마로 만들어주는 빌더

function buildMeta({ parent_id, ym, child_name, age_month }) {
    // optional: age_band/option_range는 로그/디버깅용
    const band =
      age_month <= 17 ? '12-17' :
      age_month <= 23 ? '18-23' : '24+';
  
    const option_range =
      band === '12-17' ? [1,2,3,4] :
      band === '18-23' ? [3,4,5,6] : [5,6,7,8];
  
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
  
  module.exports = {
    buildMeta,
    buildConstraints,
    buildMonthlyFlowInput,
    buildTeacherNoteInput,
    buildDomainGrowthInput
  };
  