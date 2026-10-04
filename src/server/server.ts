import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHttpApp, listenOnFreePort } from './http';
import { AppService } from '../app';
import { loadLimits } from '../limits';
import { Store } from '../store';

async function main(): Promise<void> {
  const limits = loadLimits();
  const dataDir = process.env.MM_DATA_DIR ?? join(process.cwd(), 'data');
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, 'mastermind.sqlite');
  const store = new Store(dbPath, limits.maxCandidates);
  const service = new AppService(store, limits);
  const server = createHttpApp(service);

  const preferredPort = process.env.MM_PORT ? Number(process.env.MM_PORT) : undefined;
  const port = await listenOnFreePort(server, preferredPort);
  writeFileSync(join(dataDir, 'server.port'), String(port), 'utf8');

  console.log('Mastermind 推理后端已启动');
  console.log(`  监听地址: http://127.0.0.1:${port}`);
  console.log(`  数据目录: ${dataDir}`);
  console.log(`  候选上限: ${limits.maxCandidates}（颜色<=${limits.maxColors}，槽位<=${limits.maxSlots}）`);
  console.log('  默认端口 0 表示由系统选择空闲端口；可用环境变量 MM_PORT 指定。');

  const shutdown = (): void => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error('启动失败：', err);
  process.exit(1);
});
