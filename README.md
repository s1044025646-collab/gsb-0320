# Mastermind 重复颜色反馈与候选推理后端

离线的 Mastermind（珠玑妙算）推理后端：管理**有序颜色表**与**固定槽位数**，维护猜测与黑白反馈历史，
自行实现允许重复颜色的反馈计算、完整候选枚举、历史联合筛选与**单步最坏情况最优**的下一步建议。

- 仅提供本地 HTTP API 与 CLI，没有网页界面，不连接任何外部游戏或在线服务。
- 技术栈：TypeScript + Node.js（内置 `node:sqlite`，无需编译原生模块）。
- 不依赖 Docker、WSL、付费服务或外部在线 API；数据库文件保存在项目内 `data/` 目录。
- 运行环境：Node.js 22 及以上（开发验证使用 Node.js 25；需要内置 `node:sqlite`）。

## 规则与反馈语义

- 颜色以**注册顺序索引**（从 0 开始）表示。展示文字（如“红”）不参与任何排序或比较；
  颜色一致重命名（如“红”→“R”）得到完全相同的候选数量、顺序与统计。
- 隐藏序列允许重复颜色，长度固定为槽位数。
- 黑色：颜色和位置都正确。白色：颜色正确但位置不正确。
- 反馈计算（见 `src/feedback.ts`）：
  1. 先逐位统计黑色数；
  2. 对每一种颜色，取它在猜测与答案中出现次数的较小值，求和得到**总命中数**；
  3. 白色 = 总命中数 − 黑色。

  因此同一个颜色出现只能与答案中的一个出现配对。例如答案 `1122`：
  - 猜测 `1212` → 黑 2、白 2（位置 1、4 为黑，位置 2、3 为白）；
  - 猜测 `1111` → 黑 2、白 0（答案中颜色 1 只出现两次，过量出现不产生白）；
  - 猜测 `2211` → 黑 0、白 4。

## 候选、筛选与确定性

- 新建分析时建立**完整有序候选集合**（颜色数 ^ 槽位数），按注册颜色序做字典序排列（`src/enumerate.ts`）。
- 每条有效记录按反馈过滤候选，只保留同时满足**全部历史**的序列（`src/filter.ts`）。
- 相同规则与历史必然得到相同候选列表与统计；没有随机猜测。
- 追加记录时先在内存中过滤：若过滤后候选为空，返回**不一致结果**（含过滤前后数量）并**拒绝更新**，
  有效历史、版本与候选摘要都保持不变。
- 支持撤销最后一条**有效**记录，候选恢复到此前状态。
- 修改规则需要新建分析；历史导出记录了当时的颜色表与槽位数，不会被后来的规则重新解释。

## 下一步建议：单步最坏情况目标与预算

建议只从**当前候选**中选择猜测（本题不考虑非候选试探与多步最优策略，见 `src/suggest.ts`）：

1. 对每个候选猜测，把所有当前候选答案按反馈分桶；
2. 记录最大桶大小，即采取该猜测后**最坏剩余候选数**；
3. 选择最大桶最小的猜测；平局时候选已按注册颜色序排列，取最靠前的猜测；
4. 输出分桶数量（不同反馈类数）、最坏剩余候选数与分桶明细。

只有一个候选时直接给出该候选，不做比较。

两个**公开预算**（API 查询参数，或环境变量默认值）：

- `guessBudget`：最多评估的候选猜测数，默认 100000；
- `feedbackBudget`：最多执行的反馈比较次数，默认 5000000。

若候选规模导致无法在预算内评估**全部**猜测，接口返回 `status: "budget_exceeded"` 与
`suggestion: null`，**不会**用只评估部分猜测的结果宣称全局最优。预算只影响建议计算，
不改变数据库中保存的候选与历史。

## 规模限制与错误码

默认上限（可用环境变量覆盖，见下文）：

| 配置 | 环境变量 | 默认值 |
| --- | --- | --- |
| 最大颜色数 | `MM_MAX_COLORS` | 10 |
| 最大槽位数 | `MM_MAX_SLOTS` | 6 |
| 完整候选总量 | `MM_MAX_CANDIDATES` | 100000 |
| 单页最大返回条数 | `MM_MAX_PAGE_SIZE` | 500 |
| 默认分页条数 | `MM_DEFAULT_PAGE_SIZE` | 100 |
| 建议猜测预算 | `MM_GUESS_BUDGET` | 100000 |
| 建议比较预算 | `MM_FEEDBACK_BUDGET` | 5000000 |

错误响应统一为 `{"error":{"code","message","details"}}`，主要错误码：

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `COLORS_INVALID` | 颜色表缺失、为空、元素非空字符串或重复、数量超限 |
| 400 | `SLOTS_INVALID` | 槽位不是正整数或超限 |
| 400 | `TOO_MANY_CANDIDATES` | 颜色数^槽位数超过候选总量上限 |
| 400 | `SEQUENCE_NOT_ARRAY` / `SEQUENCE_LENGTH` / `COLOR_INDEX_OUT_OF_RANGE` | 序列非法 |
| 400 | `FEEDBACK_INVALID` | 黑白不是非负整数或之和超过槽位数 |
| 400 | `PAGE_INVALID` / `BUDGET_INVALID` / `BAD_REQUEST` / `INVALID_JSON` | 分页、预算或请求体非法 |
| 404 | `NOT_FOUND` | 分析或接口不存在 |

注意：数字范围合法的反馈仍可能与规则/历史矛盾；该情况以 HTTP 200 返回
`accepted:false`、`beforeCount`、`afterCount:0` 与中文原因，且不落库。

## 快速开始（Windows / PowerShell）

```powershell
npm install
npm run build      # 编译到 dist/
npm test           # 编译测试到 dist-test/ 并运行 node:test
npm run demo       # 离线演示：1122 vs 1212、过量重复、联合排除、矛盾拒绝、撤销
npm start          # 启动 HTTP API；默认由系统选择空闲端口
```

启动后会打印监听地址，并把实际端口写入 `data/server.port`。
指定端口与数据目录：

```powershell
$env:MM_PORT="3210"; $env:MM_DATA_DIR="$PWD\data"; npm start
```

不设置 `MM_PORT`（或设为 0）时自动选择空闲端口。

## HTTP API

所有响应包裹在 `{"data": ...}` 中（错误时为 `{"error": ...}`）。

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/health` | 健康检查 |
| `POST /api/analyses` | 新建分析，body：`{"colors":["红","绿"],"slots":3}` |
| `GET /api/analyses` | 列出分析摘要 |
| `GET /api/analyses/:id` | 获取规则、版本与候选摘要 |
| `POST /api/feedback` | 离线计算一对序列反馈，body 含 `colors,slots,guess,answer`（规则可选） |
| `POST /api/analyses/:id/records` | 追加记录，body：`{"guess":[1,2],"black":1,"white":1}` 或 `{"guess":[1,2],"feedback":{...}}` |
| `POST /api/analyses/:id/undo` | 撤销最后一条有效记录 |
| `GET /api/analyses/:id/candidates?offset=0&limit=100` | 分页查询当前候选（索引与标签） |
| `GET /api/analyses/:id/suggestion?guessBudget=&feedbackBudget=` | 获取下一步建议与分桶明细 |
| `GET /api/analyses/:id/history` | 导出完整有效历史 |

PowerShell 调用示例：

```powershell
$port = Get-Content data\server.port
$base = "http://127.0.0.1:$port"
Invoke-RestMethod -Method Post "$base/api/analyses" -ContentType 'application/json' `
  -Body '{"colors":["A","B","C"],"slots":2}'
Invoke-RestMethod -Method Post "$base/api/feedback" -ContentType 'application/json' `
  -Body '{"colors":["A","B","C"],"slots":2,"guess":[0,1],"answer":[1,0]}'
```

## CLI

```powershell
node dist/server/cli.js create "红,绿,蓝,黄" 4
node dist/server/cli.js list
node dist/server/cli.js feedback "红,绿,蓝,黄" 4 1,2,1,2 1,1,2,2
node dist/server/cli.js append 1 1,2,1,2 2,2
node dist/server/cli.js candidates 1 0 10
node dist/server/cli.js suggest 1
node dist/server/cli.js undo 1
node dist/server/cli.js history 1
node dist/server/cli.js show 1
```

序列统一以逗号分隔的**颜色索引**表示；反馈参数为 `黑,白`。`--db <路径>` 可指定其他 SQLite 文件。

## 持久化与原子性

- SQLite 表：`analyses`（规则、版本、总量/剩余候选摘要）、`records`（有效记录）、`meta`（schema 版本）。
- 追加与撤销都在单个 `BEGIN IMMEDIATE ... COMMIT` 事务中完成：记录与候选摘要同时成功或同时回滚，
  不会留下只更新历史或只更新候选的状态。
- 版本号在每次接受追加或撤销后递增；矛盾拒绝不改变版本。
- 重启加载分析时，按持久化的有效历史从完整集合**一次性重算候选**，并与保存的摘要核对；
  因此重启后继续追加与同一历史从头分析的结果完全一致。

## 测试

- `test/feedback.test.ts`：用**独立的一对一显式配对枚举**参考实现，对 3 色 3 槽全部 729 对
  猜测/答案逐案核对主算法；并覆盖全对、全错、全部同色、只有白色、过量重复。
- `test/reasoning.test.ts`：穷举核对历史筛选（增量与全量重算一致）、两条反馈联合排除、
  建议分桶与独立枚举的全局最优一致、平局与预算行为。
- `test/store.test.ts`：矛盾拒绝后旧状态不变、撤销再追加、重启一致性、颜色重命名不变量、
  错误码与候选上限。
- `test/api.test.ts`：HTTP 全流程与参数校验。

## 目录结构

```
src/
  feedback.ts   重复颜色反馈与参数校验
  enumerate.ts  完整候选枚举与编解码
  filter.ts     历史筛选
  suggest.ts    分桶、minimax 建议与公开预算
  rules.ts      规则校验
  store.ts      SQLite 持久化与原子追加/撤销
  app.ts        服务编排（分页、建议、历史导出）
  server/       HTTP 服务、CLI、演示
test/           node:test 测试
scripts/        冒烟脚本
data/           运行时生成（SQLite、端口文件）
```
