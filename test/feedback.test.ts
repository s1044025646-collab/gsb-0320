import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFeedback } from '../src/feedback';

/**
 * 独立参考实现：显式一对一颜色配对枚举。
 * 先移除所有同位置（黑色），再对剩余出现做贪心一一匹配得到白色，
 * 完全不依赖“每色取较小值求和”的算法路径。
 */
function referenceFeedback(guess: number[], answer: number[]): { black: number; white: number } {
  const guessLeft: number[] = [];
  const answerLeft: number[] = [];
  let black = 0;
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === answer[i]) black++;
    else {
      guessLeft.push(guess[i]);
      answerLeft.push(answer[i]);
    }
  }
  let white = 0;
  const used = new Array<boolean>(answerLeft.length).fill(false);
  for (const g of guessLeft) {
    const j = answerLeft.findIndex((a, index) => !used[index] && a === g);
    if (j >= 0) {
      used[j] = true;
      white++;
    }
  }
  return { black, white };
}

test('演示案例 1122 对 1212 得到黑2白2', () => {
  assert.deepEqual(computeFeedback([1, 2, 1, 2], [1, 1, 2, 2], 4), { black: 2, white: 2 });
});

test('全对为黑满，全错为零', () => {
  assert.deepEqual(computeFeedback([1, 1, 2, 2], [1, 1, 2, 2], 4), { black: 4, white: 0 });
  assert.deepEqual(computeFeedback([3, 3, 3, 3], [1, 1, 2, 2], 4), { black: 0, white: 0 });
});

test('全部同色答案与过量重复猜测不产生过量白', () => {
  assert.deepEqual(computeFeedback([0, 0, 0, 0], [0, 0, 0, 0], 4), { black: 4, white: 0 });
  assert.deepEqual(computeFeedback([1, 1, 1, 1], [1, 1, 2, 2], 4), { black: 2, white: 0 });
  assert.deepEqual(computeFeedback([2, 2, 2, 2], [1, 1, 2, 2], 4), { black: 2, white: 0 });
});

test('只有白色：颜色全在但位置全错', () => {
  assert.deepEqual(computeFeedback([2, 2, 1, 1], [1, 1, 2, 2], 4), { black: 0, white: 4 });
});

test('黑+白不超过每色最小出现次数', () => {
  assert.deepEqual(computeFeedback([0, 0, 1, 2], [0, 1, 0, 0], 3), { black: 1, white: 2 });
});

test('小规则下与独立一对一配对实现逐案一致（含重复颜色）', () => {
  const colorCount = 3;
  const slots = 3;
  const total = colorCount ** slots;
  let checked = 0;
  for (let g = 0; g < total; g++) {
    const guess = digits(g, colorCount, slots);
    for (let a = 0; a < total; a++) {
      const answer = digits(a, colorCount, slots);
      assert.deepEqual(computeFeedback(guess, answer, colorCount), referenceFeedback(guess, answer));
      checked++;
    }
  }
  assert.equal(checked, total * total);
});

function digits(value: number, base: number, slots: number): number[] {
  const result: number[] = [];
  let rest = value;
  for (let i = 0; i < slots; i++) {
    result.unshift(rest % base);
    rest = Math.floor(rest / base);
  }
  return result;
}
