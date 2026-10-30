'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {generateBlogReview, validateReviewInput, buildSystemPrompt, TONES} = require('../services/monthlyReport/blogReviewGenerator');

const legacyInput = {
  age: '24~36개월',
  lesson: '자연·생태놀이',
  reaction: '새로운 재료에 호기심을 보였어요',
  opinion: '여러 가지 교구와 활동이 인상적이었어요',
  length: 'medium',
  topic: '봄꽃 놀이',
  moment: '아이가 꽃잎을 손으로 만져 보며 색을 살펴봤어요.'
};

test('legacy inputs remain valid and default to natural tone', () => {
  const clean = validateReviewInput(legacyInput);
  assert.equal(clean.tone, 'natural');
  for (const field of ['age', 'lesson', 'reaction', 'opinion', 'length', 'topic', 'moment']) {
    assert.equal(clean[field], legacyInput[field]);
  }
});

test('rejects unsupported tone values with HTTP 422 status', () => {
  assert.throws(() => validateReviewInput({...legacyInput, tone: 'cheerful'}), error => error.status === 422);
});

const toneExpectations = {
  bright: ['친근하고 발랄한', '~습니다, ~했습니다 형태를 쓰지 않는다', '이모지는 1~3개'],
  natural: ['자연스럽고 담백한', '~습니다, ~했습니다 형태는 쓰지 않고', '최소화한다'],
  formal: ['차분하고 정중한', '~습니다, ~했습니다를 중심으로', '이모지와 감탄사는 사용하지 않는다'],
  informative: ['해요체 중심의 정보형 구성', '실제 경험과 그 이유를 논리적으로 설명', '꼭 필요한 경우에만 제한적으로 허용']
};

for (const tone of TONES) {
  test(`${tone} tone is included in the system prompt sent to the model`, async () => {
    let request;
    const client = {responses: {create: async value => {
      request = value;
      return {output_text: JSON.stringify({title: '조이조이 봄꽃 놀이 후기', body: '아이가 꽃잎을 만져 보며 색을 살펴봤어요. #조이조이오감놀이'})};
    }}};
    const result = await generateBlogReview({...legacyInput, tone}, {client});
    const systemPrompt = request.input.find(item => item.role === 'system').content[0].text;
    assert.deepEqual(Object.keys(result).sort(), ['body', 'mode', 'title']);
    assert.equal(result.mode, 'ai');
    assert.ok(systemPrompt.includes(`말투 설정(${tone})`));
    for (const phrase of toneExpectations[tone]) assert.ok(systemPrompt.includes(phrase), `${tone}: ${phrase}`);
    assert.equal(result.body.includes('#'), false, 'HTML adds hashtags separately');
    assert.equal(/경제적\s*대가|소정의\s*상품|협찬|상품권|제공받/u.test(result.body), false, 'HTML adds disclosure separately');
  });
}

test('all eight survey answers are sent to the model', async () => {
  let request;
  const input = {...legacyInput, tone: 'informative'};
  const client = {responses: {create: async value => {
    request = value;
    return {output_text: JSON.stringify({title: '조이조이 방문 수업 후기', body: '아이가 꽃잎을 살펴봤어요.'})};
  }}};
  await generateBlogReview(input, {client});
  const userContent = request.input.find(item => item.role === 'user').content[0].text;
  assert.deepEqual(JSON.parse(userContent), validateReviewInput(input));
  assert.equal(Object.keys(JSON.parse(userContent)).length, 8);
});

test('prompt leaves disclosure and the required hashtag to the HTML layer', () => {
  const prompt = buildSystemPrompt('natural');
  assert.match(prompt, /화면이 고지와 해시태그를 별도로 추가/u);
  assert.match(prompt, /입력에 없는 수업 내용, 교구, 감정, 기간, 발달 효과, 교사 행동, 부모 반응을 지어내지 마라/u);
});
