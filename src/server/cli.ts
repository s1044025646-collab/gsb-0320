import { join } from 'node:path';
import { AppService, serializeAnalysis } from '../app';
import { loadLimits } from '../limits';
import { Store } from '../store';
import { AppError } from '../errors';

interface CliOptions {
  db: string;
  args: string[];
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  let db = join(process.env.MM_DATA_DIR ?? join(process.cwd(), 'data'), 'mastermind.sqlite');
  const dbIndex = args.findIndex((arg) => arg === '--db');
  if (dbIndex >= 0) {
    db = args[dbIndex + 1];
    args.splice(dbIndex, 2);
  }
  return { db, args };
}

function parseNumberList(raw: string): number[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const value = Number(part);
      if (!Number.isInteger(value)) {
        throw new AppError('BAD_REQUEST', `"${part}" 不是整数`);
      }
      return value;
    });
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function main(): void {
  const { db, args } = parseArgs(process.argv.slice(2));
  const command = args[0];
  const limits = loadLimits();
  const store = new Store(db, limits.maxCandidates);
  const service = new AppService(store, limits);
  try {
    switch (command) {
      case 'create': {
        const colors = args[1].split(',').map((s) => s.trim());
        const slots = Number(args[2]);
        printJson(serializeAnalysis(service.createAnalysis({ colors, slots })));
        break;
      }
      case 'list':
        printJson({ analyses: service.listAnalyses() });
        break;
      case 'show':
        printJson(serializeAnalysis(service.getAnalysis(Number(args[1]))));
        break;
      case 'feedback': {
        const result = service.feedbackForPair({
          colors: args[1].split(',').map((s) => s.trim()),
          slots: Number(args[2]),
          guess: parseNumberList(args[3]),
          answer: parseNumberList(args[4]),
        });
        printJson({
          guess: result.guess,
          answer: result.answer,
          black: result.feedback.black,
          white: result.feedback.white,
        });
        break;
      }
      case 'append': {
        const id = Number(args[1]);
        const guess = parseNumberList(args[2]);
        const [black, white] = args[3].split(',').map((s) => Number(s.trim()));
        const { outcome } = service.appendFeedback(id, { guess, black, white });
        printJson({ outcome, analysis: serializeAnalysis(service.getAnalysis(id)) });
        break;
      }
      case 'undo':
        {
          const { outcome } = service.undo(Number(args[1]));
          printJson({ outcome, analysis: serializeAnalysis(service.getAnalysis(Number(args[1]))) });
        }
        break;
      case 'candidates':
        printJson(
          service.pageCandidates(Number(args[1]), {
            offset: args[2],
            limit: args[3],
          }),
        );
        break;
      case 'suggest':
        printJson(
          service.suggestion(Number(args[1]), {
            guessBudget: args[2],
            feedbackBudget: args[3],
          }),
        );
        break;
      case 'history':
        printJson(service.exportHistory(Number(args[1])));
        break;
      default:
        usage();
        process.exitCode = 1;
    }
  } finally {
    store.close();
  }
}

function usage(): void {
  console.log(`用法:
  cli create "<颜色1,颜色2,...>" <槽位数>
  cli list
  cli show <分析ID>
  cli feedback "<颜色1,颜色2,...>" <槽位数> <猜测索引如0,1,2,3> <答案索引>
  cli append <分析ID> <猜测索引> <黑,白>
  cli undo <分析ID>
  cli candidates <分析ID> [offset] [limit]
  cli suggest <分析ID> [guessBudget] [feedbackBudget]
  cli history <分析ID>

全局选项:
  --db <sqlite路径>   指定数据库文件（默认 ./data/mastermind.sqlite）`);
}

try {
  main();
} catch (err) {
  if (err instanceof AppError) {
    console.error(JSON.stringify({ error: { code: err.code, message: err.message, details: err.details ?? null } }, null, 2));
  } else {
    console.error(err);
  }
  process.exit(1);
}
