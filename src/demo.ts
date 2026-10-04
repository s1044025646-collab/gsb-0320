// 演示：1122 vs 1212 -> 2黑2白；重复颜色过量；两条反馈联合排除候选。
import * as path from "node:path";
import { computeFeedback } from "./core";
import { Store } from "./store";

function main(): void {
  console.log("== 反馈计算 ==");
  console.log("secret 1,1,2,2 vs guess 1,2,1,2 =>", computeFeedback([1, 1, 2, 2], [1, 2, 1, 2]));
  console.log("secret 1,1,2,2 vs guess 1,1,1,1 =>", computeFeedback([1, 1, 2, 2], [1, 1, 1, 1]), "(重复颜色不过量计白)");
  console.log("secret 1,2,3,4 vs guess 1,1,1,1 =>", computeFeedback([1, 2, 3, 4], [1, 1, 1, 1]));

  const dbPath = path.join(process.cwd(), "data", "demo.db");
  try {
    require("node:fs").unlinkSync(dbPath);
  } catch {
    /* 忽略 */
  }
  const store = new Store(dbPath);
  const a = store.createAnalysis({ colorCount: 4, slots: 4 });
  console.log("\n== 新建分析 ==", a.id, "候选数:", a.candidateCount);

  const r1 = store.appendRecord(a.id, [1, 1, 2, 2], { black: 1, white: 1 });
  console.log("记录1 guess 1,1,2,2 反馈(1,1):", r1.before, "->", r1.after);

  const r2 = store.appendRecord(a.id, [3, 3, 4, 4], { black: 0, white: 2 });
  console.log("记录2 guess 3,3,4,4 反馈(0,2):", r2.before, "->", r2.after, "(两条反馈联合排除)");

  console.log("\n== 当前候选（前 10 条）==");
  console.log(store.pageCandidates(a.id, 0, 10).items.map((c) => c.join("")).join(" "));

  console.log("\n== 矛盾反馈被拒绝 ==");
  try {
    store.appendRecord(a.id, [1, 1, 1, 1], { black: 4, white: 0 });
  } catch (e) {
    console.log("拒绝:", (e as Error).message);
  }
  console.log("历史记录数仍为:", store.listRecords(a.id).length);

  console.log("\n== 撤销记录2 ==");
  store.undoLast(a.id);
  console.log("撤销后候选数:", store.getAnalysis(a.id).candidateCount);
  store.close();
}

main();
