# Mastermind 重复颜色反馈与候选推理后端

TypeScript + Node.js + SQLite（`node:sqlite`，无原生依赖、无外部服务）实现的 Mastermind 推理后端，仅提供 HTTP API 与 CLI，不含网页。Windows 本地直接运行。

## 功能

- 有序颜色表：颜色用 `1..colorCount` 表示，固定按注册顺序排序，展示文字不参与排序
- 固定槽位数的有序颜色序列，隐藏序列允许重复颜色
- 重复颜色反馈：先算黑色（颜色与位置都对），再按每种颜色两边出现次数的较小值求总命中，白色 = 总命中 − 黑色；同一出现只配对一次，不会过量计白
- 完整有序候选集合：按规则枚举全部序列，逐条反馈过滤，保留同时符合全部历史的序列
- 矛盾检测：新反馈使候选为空时返回 `INCONSISTENT`（含过滤前后数量），拒绝更新历史，不放宽旧条件
- 撤销最后一条有效记录并恢复此前候选（重放剩余历史重建）
- 下一步建议：仅从当前候选中选猜测，按反馈分桶，最小化最大桶（单步最坏情况最优），平局取注册颜色序最靠前者；输出分桶数量与最坏剩余候选数
- SQLite 持久化规则、有效记录、版本号与候选摘要；追加/撤销在事务中原子完成；重启后继续追加与一次性分析结果一致

## 要求

- Node.js ≥ 22.5（使用内置 `node:sqlite`；开发环境为 Node 25）
- 仅开发依赖 TypeScript，运行时零依赖

## 命令

```powershell
npm install      # 安装开发依赖（typescript）
npm run build    # 编译到 dist/
npm test         # 构建并运行全部测试
npm start        # 启动 HTTP API（默认自动选择空闲端口）
npm run demo     # 运行演示脚本
npm run cli -- <命令>   # 运行 CLI
```

环境变量：`PORT`（指定端口，缺省自动选空闲端口）、`DATA_DIR`（数据目录，默认 `./data`，数据库文件 `mastermind.db`）。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/analyses` | 新建分析，body `{"rules":{"colorCount":4,"slots":4}}` |
| POST | `/feedback` | 计算一对序列的反馈，body `{"rules":{...},"secret":[...],"guess":[...]}` |
| POST | `/analyses/:id/records` | 追加记录，body `{"guess":[...],"feedback":{"black":1,"white":1}}` |
| POST | `/analyses/:id/undo` | 撤销最后一条有效记录 |
| GET | `/analyses/:id/candidates?offset=0&limit=100` | 分页候选查询（limit 上限 500） |
| GET | `/analyses/:id/suggestion?budget=2000000` | 下一步建议 |
| GET | `/analyses/:id/export` | 导出规则与完整历史 |
| GET | `/analyses/:id` | 分析信息与历史 |

错误统一为 `{"error":{"code","message"}}`，错误码：`INVALID_RULES`、`RULES_TOO_LARGE`、`INVALID_SEQUENCE`、`INVALID_FEEDBACK`、`INCONSISTENT`、`NO_CANDIDATES`、`NOTHING_TO_UNDO`、`NOT_FOUND`、`BAD_JSON`。

## CLI

```powershell
node dist/src/cli.js new --colors 4 --slots 4
node dist/src/cli.js feedback --colors 4 --slots 4 --secret 1,1,2,2 --guess 1,2,1,2
node dist/src/cli.js append <id> --guess 1,1,2,2 --black 1 --white 1
node dist/src/cli.js undo <id>
node dist/src/cli.js candidates <id> --offset 0 --limit 100
node dist/src/cli.js suggest <id> --budget 2000000
node dist/src/cli.js export <id>
```

## 建议策略与预算

建议目标是**单步最坏情况最优**：对每个候选猜测，把当前所有可能答案按反馈分桶，取最大桶最小的猜测；平局按候选枚举序（注册颜色序）取最靠前。只做单步，不做非候选试探或多步最优。

预算为反馈比较次数（候选数²），默认 2,000,000，可通过 `budget` 参数调整。超限时返回 `computed:false` 与原因，**不会**用部分评估冒充全局最优。预算只影响当次查询，不修改已保存的候选集。

## 限制

- 颜色数 2..10，槽位数 1..8，完整候选总量 ≤ 200,000，分页单次 ≤ 500 条
- 规则在新建分析时固定，之后不可修改；修改规则需新建分析，历史不会被新规则重新解释
- `node:sqlite` 在部分 Node 版本会打印 ExperimentalWarning，不影响功能
- 演示脚本 `npm run demo`：1122 vs 1212 得 2 黑 2 白、重复颜色过量计白演示、两条反馈联合排除候选、矛盾拒绝与撤销
