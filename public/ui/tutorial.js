import { tutorialSteps, tutorialQuestions } from '../tutorial.js';
/** Teaching examples only; no live cards or game commands. */
export function tutorialTopicsMarkup(index, esc) {
  return tutorialSteps.map((step,i)=>`<button type="button" data-tutorial-topic="${i}" aria-current="${i===index?'step':'false'}"><span>${i+1}</span>${esc(step.title)}</button>`).join('');
}
export function tutorialPracticeMarkup(index, answer, esc) {
  const question=tutorialQuestions[index];
  const answered=Number.isInteger(answer)&&answer>=0&&answer<question.choices.length;
  return `<section class="tutorial-practice" aria-labelledby="tutorial-practice-title"><span class="eyebrow">QUICK PRACTICE · OPTIONAL</span><h3 id="tutorial-practice-title">${esc(question.prompt)}</h3><div class="button-row">${question.choices.map((choice,i)=>`<button type="button" data-tutorial-answer="${i}" aria-pressed="${answered&&answer===i}">${esc(choice)}</button>`).join('')}</div><p id="tutorial-practice-feedback" role="status">${answered?`${answer===question.correct?'Correct.':'Try another answer.'} ${esc(question.explanation)}`:'Choose an answer to check your understanding.'}</p></section>`;
}
