import { join } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import { AppService, serializeAnalysis } from '../app';
import { loadLimits } from '../limits';
import { Store } from '../store';
import { computeFeedback } from '../feedback';

function line(title: string): void {
  console.log('\n' + '='.repeat(64));
  console.log(title);
  console.log('='.repeat(64));
}

function showFeedback(name: string, guess: number[], answer: number[], colorCount: number): void {
  const f = computeFeedback(guess, answer, colorCount);
  console.log(
    `  ${name}: 猜测 ${guess.join('')} 对 答案 ${answer.join('')} => 黑 ${f.black}，白 ${f.white}`,
  );
}

function main(): void {
  const limits = loadLimits();
  const dataDir = process.env.MM_DATA_DIR ?? join(process.cwd(), 'data');
  const dbPath = join(dataDir, 'demo.sqlite');
  if (existsSync(dbPath)) unlinkSync(dbPath);
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
  }

  line('一、纯反馈计算（颜色索引 0..3，重复颜色）');
  const answer = [1, 1, 2, 2];
  showFeedback('标准答案演示', [1, 2, 1, 2], answer, 4);
  console.log('    期望：黑 2 白 2（位置 1、4 为黑；位置 2、3 为白）');

  showFeedback('重复颜色过多', [0, 0, 0, 0], answer, 4);
  console.log('    期望：黑 0 白 0（答案中没有颜色 0）');
  showFeedback('过量同色配对', [1, 1, 1, 1], answer, 4);
  console.log('    期望：黑 2 白 0（答案里颜色 1 只出现两次，过量的两个不产生白）');
  showFeedback('全错', [3, 3, 3, 3], answer, 4);
  showFeedback('只有白色', [2, 2, 1, 1], answer, 4);
  showFeedback('全对', [1, 1, 2, 2], answer, 4);

  line('二、持久化分析：新建 / 追加 / 两条反馈联合排除');
  const store = new Store(dbPath, limits.maxCandidates);
  const service = new AppService(store, limits);
  const analysis = service.createAnalysis({ colors: ['红', '绿', '蓝', '黄'], slots: 4 });
  console.log('  新建分析：', serializeAnalysis(analysis));
  console.log(`  完整候选总量 ${analysis.totalCandidates}（4^4=256）`);

  const first = service.appendFeedback(analysis.id, { guess: [1, 2, 1, 2], black: 2, white: 2 });
  console.log('  记录1 猜测 1212 -> 黑2白2：', first.outcome);
  const afterFirst = service.getAnalysis(analysis.id);
  console.log(`  剩余候选：${afterFirst.remainingCandidates}`);

  const second = service.appendFeedback(analysis.id, { guess: [1, 1, 2, 2], black: 4, white: 0 });
  console.log('  记录2 猜测 1122 -> 黑4白0：', second.outcome);
  const afterSecond = service.getAnalysis(analysis.id);
  console.log(`  剩余候选：${afterSecond.remainingCandidates}`);

  const page = service.pageCandidates(analysis.id, { offset: 0, limit: 10 });
  console.log('  候选首页：', page.items.map((item) => item.labels.join('')));

  line('三、单步最坏情况建议（minimax 分桶）');
  const small = service.createAnalysis({ colors: ['A', 'B'], slots: 2 });
  const suggestion0 = service.suggestion(small.id, {});
  console.log('  4 个候选时建议：', JSON.stringify(suggestion0.suggestion));
  console.log('  分桶明细：', JSON.stringify(suggestion0.bucketSizes));
  const uniqueSuggestion = service.suggestion(analysis.id, {});
  console.log('  单候选时直接给出：', JSON.stringify(uniqueSuggestion.suggestion));

  line('四、矛盾反馈被拒绝，撤销后恢复');
  const conflict = service.appendFeedback(analysis.id, { guess: [0, 0, 0, 0], black: 1, white: 0 });
  console.log('  对已确定 1122 追加“0000 => 黑1”：', conflict.outcome);
  console.log('  拒绝后状态不变：', serializeAnalysis(service.getAnalysis(analysis.id)));
  const undo = service.undo(analysis.id);
  console.log('  撤销记录2：', undo.outcome);
  console.log('  恢复为记录1后的候选数：', service.getAnalysis(analysis.id).remainingCandidates);
  const reappend = service.appendFeedback(analysis.id, { guess: [1, 1, 2, 2], black: 4, white: 0 });
  console.log('  重新追加记录2：', reappend.outcome);

  line('五、导出历史');
  console.log(JSON.stringify(service.exportHistory(analysis.id), null, 2));

  store.close();
  console.log(`\n演示数据库保存在：${dbPath}`);
}

main();
