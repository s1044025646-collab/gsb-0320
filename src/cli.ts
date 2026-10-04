// CLI：new / feedback / append / undo / candidates / suggest / export
import * as path from "node:path";
import {
  DEFAULT_SUGGEST_BUDGET,
  MAX_PAGE_LIMIT,
  Rules,
  computeFeedback,
  suggestNext,
  validateSequence,
} from "./core";
import { Store } from "./store";

function parseSeq(s: string): number[] {
  return s.split(",").map((x) => {
    const n = Number(x.trim());
    return n;
  });
}

function parseRules(args: Record<string, string>): Rules {
  return { colorCount: Number(args.colors), slots: Number(args.slots) };
}

function parseArgs(argv: string[]): { cmd: string; rest: string[]; flags: Record<string, string> } {
  const [cmd = "help", ...rest] = argv;
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) {
      flags[rest[i].slice(2)] = rest[i + 1] ?? "";
      i++;
    } else {
      positional.push(rest[i]);
    }
  }
  return { cmd, rest: positional, flags };
}

const USAGE = `用法: node dist/src/cli.js <命令> [参数]
  new --colors N --slots M                 新建分析，输出分析 ID
  feedback --colors N --slots M --secret 1,1,2,2 --guess 1,2,1,2
                                           计算一对序列的反馈
  append <id> --guess 1,2,1,2 --black 2 --white 2
                                           追加一条记录（矛盾时拒绝且不修改历史）
  undo <id>                                撤销最后一条有效记录
  candidates <id> [--offset 0] [--limit 100]
  suggest <id> [--budget N]                获取下一步建议
  export <id>                              导出规则与历史
环境变量: DATA_DIR（默认 ./data）
`;

function main(): void {
  const { cmd, rest, flags } = parseArgs(process.argv.slice(2));
  const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  const store = new Store(path.join(dataDir, "mastermind.db"));
  try {
    switch (cmd) {
      case "new": {
        console.log(JSON.stringify(store.createAnalysis(parseRules(flags)), null, 2));
        break;
      }
      case "feedback": {
        const rules = parseRules(flags);
        const secret = parseSeq(flags.secret ?? "");
        const guess = parseSeq(flags.guess ?? "");
        validateSequence(secret, rules, "secret");
        validateSequence(guess, rules, "guess");
        console.log(JSON.stringify(computeFeedback(secret, guess)));
        break;
      }
      case "append": {
        const out = store.appendRecord(rest[0], parseSeq(flags.guess ?? ""), {
          black: Number(flags.black),
          white: Number(flags.white),
        });
        console.log(JSON.stringify(out, null, 2));
        break;
      }
      case "undo": {
        console.log(JSON.stringify(store.undoLast(rest[0]), null, 2));
        break;
      }
      case "candidates": {
        const offset = Number(flags.offset ?? 0);
        const limit = Math.min(Number(flags.limit ?? 100), MAX_PAGE_LIMIT);
        console.log(JSON.stringify(store.pageCandidates(rest[0], offset, limit), null, 2));
        break;
      }
      case "suggest": {
        const budget = flags.budget ? Number(flags.budget) : DEFAULT_SUGGEST_BUDGET;
        console.log(JSON.stringify(suggestNext(store.loadCandidates(rest[0]), budget), null, 2));
        break;
      }
      case "export": {
        console.log(
          JSON.stringify({ ...store.getAnalysis(rest[0]), records: store.listRecords(rest[0]) }, null, 2)
        );
        break;
      }
      default:
        process.stdout.write(USAGE);
    }
  } finally {
    store.close();
  }
}

try {
  main();
} catch (e) {
  const err = e as { code?: string; message?: string };
  console.error(`错误 [${err.code ?? "INTERNAL"}]: ${err.message ?? String(e)}`);
  process.exit(1);
}
