# opencode-deepseek-cache 重构计划

> 版本: v1.0  
> 日期: 2026-06-03  
> 状态: 待审批

---

## 一、项目现状分析

### 1.1 项目概况

| 指标 | 值 |
|------|-----|
| 项目名称 | opencode-deepseek-cache v2.1.7 |
| 功能 | DeepSeek API 缓存优化插件 |
| 代码量 | 8个源文件，约1,600行 |
| 技术栈 | TypeScript + ESM + Vitest + Biome |
| 测试覆盖 | 297个断言，8个测试文件 |
| 运行时依赖 | 零（仅Node.js内置模块） |

### 1.2 架构概览

```
src/
├── index.ts              # 主入口（576行）- 插件初始化 + 所有钩子
├── cache-stats.ts        # 缓存统计（407行）- JSONL持久化 + 报告生成
├── logger.ts             # 日志系统（210行）- 流管理 + 背压处理
├── constants.ts          # 常量定义（132行）- 配置 + 定价
├── file-utils.ts         # 文件工具（108行）- 路径处理 + 文件轮转
├── fingerprint.ts        # 指纹追踪（65行）- SHA-256指纹计算
├── model-filter.ts       # 模型过滤（24行）- DeepSeek端点检测
└── system-transform.ts   # 系统提示归一化（61行）- 动态内容替换
```

### 1.3 核心问题识别

#### 🔴 P0 - 必须重构

| 问题 | 位置 | 影响 |
|------|------|------|
| 事件处理器过大 | `index.ts:242-531` | 圈复杂度35-40，嵌套7-8层 |
| 状态管理混乱 | 散布在多个模块 | 测试隔离困难，状态追踪困难 |
| 职责耦合 | `cache-stats.ts` | 数据持久化、轮转、报告混合 |

#### 🟡 P1 - 建议重构

| 问题 | 位置 | 影响 |
|------|------|------|
| 重复类型守卫 | `cache-stats.ts:126-130` | 代码重复，维护成本高 |
| 错误处理分散 | 各钩子函数 | 模式不一致，难以追踪 |
| 同步文件I/O | `appendFileSync`, `readFileSync` | 阻塞事件循环 |

#### 🟢 P2 - 可选优化

| 问题 | 位置 | 影响 |
|------|------|------|
| LRU驱逐效率 | `index.ts:399-412` | O(n)复杂度 |
| JSONL解析重复 | `cache-stats.ts` | 逻辑冗余 |

---

## 二、重构目标

### 2.1 主要目标

1. **可维护性提升** - 将事件处理器从290行降至50行以下
2. **职责分离** - 每个模块单一职责
3. **测试隔离** - 消除模块级可变状态
4. **代码复用** - 提取公共类型守卫和工具函数

### 2.2 非目标

- 不改变外部API和行为
- 不引入新的运行时依赖
- 不改变JSONL数据格式
- 不改变配置方式

### 2.3 成功标准

| 指标 | 当前值 | 目标值 |
|------|--------|--------|
| 最大函数行数 | 290行 | <50行 |
| 最大圈复杂度 | 40 | <15 |
| 最大嵌套深度 | 8层 | <4层 |
| 模块级可变状态 | 12个 | 0个 |
| 重复代码模式 | 4处 | 0处 |

---

## 三、重构方案

### 3.1 阶段一：核心拆分（1-2周）

#### 3.1.1 拆分事件处理器

**目标**: 将 `index.ts` 中的 `event` 处理器拆分为独立函数

**当前结构**:
```typescript
// index.ts:242-531 (~290行)
event: async ({ event }) => {
  // 1. 事件类型过滤 (5行)
  // 2. 会话消息获取 (30行)
  // 3. Token验证 (20行)
  // 4. Delta计算 (40行)
  // 5. 基线管理 (80行)
  // 6. LRU淘汰 (15行)
  // 7. JSONL持久化 (20行)
  // 8. 重试逻辑 (30行)
  // 9. 错误处理 (50行)
}
```

**目标结构**:
```typescript
// src/event-handler.ts
export class EventHandler {
  constructor(
    private sessionManager: SessionManager,
    private statsManager: StatsManager,
    private persistenceManager: PersistenceManager,
  ) {}

  async handle(event: Event): Promise<void> {
    if (!this.shouldHandle(event)) return
    
    const session = await this.fetchSession(event)
    if (!session) return
    
    const tokens = this.extractTokens(session)
    if (!this.validateTokens(tokens)) return
    
    const delta = this.calculateDelta(session.id, tokens)
    if (this.isZeroDelta(delta)) return
    
    await this.processDelta(session.id, delta)
  }

  private shouldHandle(event: Event): boolean { /* 5行 */ }
  private async fetchSession(event: Event): Promise<Session | null> { /* 20行 */ }
  private extractTokens(session: Session): Tokens { /* 10行 */ }
  private validateTokens(tokens: Tokens): boolean { /* 10行 */ }
  private calculateDelta(sessionId: string, tokens: Tokens): Delta { /* 15行 */ }
  private isZeroDelta(delta: Delta): boolean { /* 3行 */ }
  private async processDelta(sessionId: string, delta: Delta): Promise<void> { /* 20行 */ }
}
```

**提取的类**:

```typescript
// src/session-manager.ts
export class SessionManager {
  private baselines = new Map<string, BaselineEntry>()
  private lastWrite = new Map<string, BaselineEntry>()
  private retryState = new Map<string, RetryState>()

  getBaseline(sessionId: string): BaselineEntry | undefined { /* 3行 */ }
  setBaseline(sessionId: string, entry: BaselineEntry): void { /* 5行 */ }
  sweepExpired(): void { /* 10行 */ }
  evictLRU(): void { /* 15行 */ }
  getRetryState(sessionId: string): RetryState | undefined { /* 3行 */ }
  setRetryState(sessionId: string, state: RetryState): void { /* 3行 */ }
  clearRetryState(sessionId: string): void { /* 3行 */ }
}
```

```typescript
// src/stats-manager.ts
export class StatsManager {
  private stats: CacheStats

  constructor(initialStats: CacheStats) { /* 3行 */ }
  
  recordDelta(delta: Delta): void { /* 15行 */ }
  getStats(): CacheStats { /* 3行 */ }
  getLastMessageStats(): MessageStats | undefined { /* 3行 */ }
  updateHitRate(): void { /* 5行 */ }
}
```

```typescript
// src/persistence-manager.ts
export class PersistenceManager {
  constructor(private jsonlPath: string) { /* 1行 */ }

  async saveBaseline(sessionId: string, entry: BaselineEntry): Promise<void> { /* 10行 */ }
  async saveUsage(delta: Delta, fingerprint: string, modelId: string): Promise<void> { /* 10行 */ }
  async saveFingerprint(fingerprint: string, prefixChanges: number): Promise<void> { /* 8行 */ }
  loadStats(): CacheStats { /* 15行 */ }
  loadBaselines(): Map<string, BaselineEntry> { /* 15行 */ }
  loadLastFingerprint(): { fingerprint: string | null; model: string | null } { /* 10行 */ }
}
```

#### 3.1.2 引入依赖注入

**目标**: 消除模块级可变状态，通过构造函数注入依赖

**当前问题**:
```typescript
// logger.ts
let LOG_DIR = ''           // 模块级可变状态
let LOG_FILE = ''          // 模块级可变状态
let stream = null          // 模块级可变状态
let writeBuffer: string[] = []  // 模块级可变状态
let draining = false       // 模块级可变状态
```

**解决方案**:
```typescript
// src/logger.ts
export class Logger {
  private stream: ReturnType<typeof createWriteStream> | null = null
  private writeBuffer: string[] = []
  private draining = false

  constructor(
    private logDir: string,
    private logFile: string,
    private maxLogSize: number,
  ) {}

  log(message: string, data?: unknown): void { /* 现有逻辑 */ }
  dispose(): void { /* 现有逻辑 */ }
}
```

**注入点**:
```typescript
// index.ts
const logger = new Logger(logDir, logFile, MAX_LOG_SIZE)
const sessionManager = new SessionManager(MAX_SESSION_BASELINES, SESSION_BASELINE_TTL_MS)
const statsManager = new StatsManager(loadStatsFromJsonl(jsonlPath))
const persistenceManager = new PersistenceManager(jsonlPath)
const eventHandler = new EventHandler(sessionManager, statsManager, persistenceManager)
```

### 3.2 阶段二：职责分离（1周）

#### 3.2.1 拆分 cache-stats.ts

**当前职责**:
1. JSONL读写 (`forEachJsonlRecord`, `appendUsageToJsonl`, `saveBaselineToJsonl`)
2. 文件轮转 (`checkJsonlRotation`)
3. 数据加载 (`loadStatsFromJsonl`, `loadBaselinesFromJsonl`, `getLastFingerprintFromJsonl`)
4. 报告生成 (`getCacheReport`)
5. 类型定义 (`CacheStats`, `UsageRecord`, `BaselineRecord`)

**目标结构**:
```
src/
├── jsonl/
│   ├── reader.ts          # JSONL读取
│   ├── writer.ts          # JSONL写入
│   ├── types.ts           # JSONL类型定义
│   └── index.ts           # 统一导出
├── stats/
│   ├── loader.ts          # 统计数据加载
│   ├── calculator.ts      # 统计计算
│   ├── report.ts          # 报告生成
│   └── index.ts           # 统一导出
└── cache-stats.ts         # 保留向后兼容的导出
```

#### 3.2.2 提取公共类型守卫

**当前重复代码**:
```typescript
// cache-stats.ts:126-130 (重复4次)
const hit = typeof r.hit === 'number' && Number.isFinite(r.hit) ? Math.max(0, r.hit) : 0
const miss = typeof r.miss === 'number' && Number.isFinite(r.miss) ? Math.max(0, r.miss) : 0
const write = typeof r.write === 'number' && Number.isFinite(r.write) ? Math.max(0, r.write) : 0
const output = typeof r.output === 'number' && Number.isFinite(r.output) ? Math.max(0, r.output) : 0
```

**提取为**:
```typescript
// src/utils/type-guards.ts
export function parseNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

export function parseOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function isValidRecord(record: unknown): record is UsageRecord {
  if (typeof record !== 'object' || record === null) return false
  const r = record as Record<string, unknown>
  return (
    typeof r.t === 'number' &&
    Number.isFinite(r.t) &&
    typeof r.hit === 'number' &&
    Number.isFinite(r.hit) &&
    typeof r.miss === 'number' &&
    Number.isFinite(r.miss)
  )
}
```

### 3.3 阶段三：性能优化（可选，1周）

#### 3.3.1 异步文件I/O

**当前问题**:
```typescript
// cache-stats.ts
appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`, 'utf-8')  // 阻塞

// logger.ts
const content = readFileSync(file, 'utf-8')  // 阻塞
```

**解决方案**:
```typescript
// 使用 fs/promises
import { appendFile, readFile } from 'node:fs/promises'

export async function appendUsageToJsonl(...): Promise<void> {
  await appendFile(jsonlPath, `${JSON.stringify(record)}\n`, 'utf-8')
}
```

**注意**: 需要将所有调用者改为 `async`，影响范围较大。

#### 3.3.2 LRU缓存优化

**当前问题**:
```typescript
// index.ts:399-412
while (sessionBaselines.size > MAX_SESSION_BASELINES) {
  let oldestSession: string | null = null
  let oldestAccess = Infinity
  for (const [sid, entry] of sessionBaselines) {
    if (entry.lastAccess < oldestAccess) {
      oldestAccess = entry.lastAccess
      oldestSession = sid
    }
  }
  if (!oldestSession) break
  sessionBaselines.delete(oldestSession)
}
```

**解决方案**: 使用现成的 LRU 缓存库（违反零依赖原则）或实现简单的双向链表

**建议**: 保持当前实现，因为：
1. `MAX_SESSION_BASELINES` 默认1000，O(n)扫描开销可接受
2. 保持零依赖哲学
3. 真实场景中很少触发淘汰

---

## 四、详细实施计划

### 4.1 阶段一：核心拆分

#### Week 1: 提取 EventHandler

| 任务 | 文件 | 行数 | 依赖 |
|------|------|------|------|
| T1.1 | 创建 `src/event-handler.ts` | ~150行 | 无 |
| T1.2 | 创建 `src/session-manager.ts` | ~80行 | 无 |
| T1.3 | 创建 `src/stats-manager.ts` | ~60行 | 无 |
| T1.4 | 创建 `src/persistence-manager.ts` | ~100行 | 无 |
| T1.5 | 重构 `index.ts` 使用新类 | ~200行 | T1.1-T1.4 |
| T1.6 | 更新测试 | ~100行 | T1.5 |

**验证**:
- [ ] 所有现有测试通过
- [ ] TypeScript类型检查通过
- [ ] Biome代码风格检查通过
- [ ] 手动测试 `/cache-stats` 命令

#### Week 2: 引入依赖注入

| 任务 | 文件 | 行数 | 依赖 |
|------|------|------|------|
| T2.1 | 重构 `logger.ts` 为类 | ~150行 | 无 |
| T2.2 | 重构 `fingerprint.ts` 为类 | ~50行 | 无 |
| T2.3 | 更新 `index.ts` 使用依赖注入 | ~100行 | T2.1, T2.2 |
| T2.4 | 更新测试以使用依赖注入 | ~80行 | T2.3 |

**验证**:
- [ ] 所有现有测试通过
- [ ] TypeScript类型检查通过
- [ ] 测试隔离性验证（无模块级状态泄漏）

### 4.2 阶段二：职责分离

#### Week 3: 拆分 cache-stats.ts

| 任务 | 文件 | 行数 | 依赖 |
|------|------|------|------|
| T3.1 | 创建 `src/jsonl/types.ts` | ~50行 | 无 |
| T3.2 | 创建 `src/jsonl/reader.ts` | ~80行 | T3.1 |
| T3.3 | 创建 `src/jsonl/writer.ts` | ~60行 | T3.1 |
| T3.4 | 创建 `src/stats/loader.ts` | ~80行 | T3.2 |
| T3.5 | 创建 `src/stats/report.ts` | ~100行 | T3.4 |
| T3.6 | 更新 `cache-stats.ts` 为薄包装层 | ~30行 | T3.1-T3.5 |
| T3.7 | 提取公共类型守卫 | ~30行 | 无 |
| T3.8 | 更新测试 | ~60行 | T3.6 |

**验证**:
- [ ] 所有现有测试通过
- [ ] 向后兼容性验证（`cache-stats.ts` 导出不变）

### 4.3 阶段三：性能优化（可选）

#### Week 4: 异步I/O

| 任务 | 文件 | 行数 | 依赖 |
|------|------|------|------|
| T4.1 | 将 `cache-stats.ts` 改为异步 | ~200行 | 无 |
| T4.2 | 将 `logger.ts` 改为异步 | ~150行 | 无 |
| T4.3 | 更新所有调用者为异步 | ~100行 | T4.1, T4.2 |
| T4.4 | 更新测试为异步 | ~80行 | T4.3 |

**验证**:
- [ ] 所有现有测试通过
- [ ] 性能基准测试（高并发场景）

---

## 五、文件变更清单

### 5.1 新增文件

| 文件 | 用途 | 预估行数 |
|------|------|----------|
| `src/event-handler.ts` | 事件处理器 | ~150 |
| `src/session-manager.ts` | 会话状态管理 | ~80 |
| `src/stats-manager.ts` | 统计数据管理 | ~60 |
| `src/persistence-manager.ts` | JSONL持久化管理 | ~100 |
| `src/jsonl/types.ts` | JSONL类型定义 | ~50 |
| `src/jsonl/reader.ts` | JSONL读取 | ~80 |
| `src/jsonl/writer.ts` | JSONL写入 | ~60 |
| `src/jsonl/index.ts` | JSONL统一导出 | ~20 |
| `src/stats/loader.ts` | 统计数据加载 | ~80 |
| `src/stats/report.ts` | 报告生成 | ~100 |
| `src/stats/index.ts` | 统计统一导出 | ~20 |
| `src/utils/type-guards.ts` | 公共类型守卫 | ~30 |

**总计**: ~830行新增代码

### 5.2 修改文件

| 文件 | 变更类型 | 预估变更 |
|------|----------|----------|
| `src/index.ts` | 大幅重构 | -300行, +50行 |
| `src/cache-stats.ts` | 重构为薄包装层 | -350行, +30行 |
| `src/logger.ts` | 重构为类 | -100行, +80行 |
| `src/fingerprint.ts` | 重构为类 | -30行, +30行 |

**总计**: ~780行删除, ~190行修改

### 5.3 删除文件

无（保持向后兼容）

---

## 六、风险评估与缓解

### 6.1 风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 重构引入回归 | 中 | 高 | 先补充测试覆盖，再重构 |
| 状态管理迁移困难 | 低 | 中 | 渐进式迁移，保持向后兼容 |
| 性能退化 | 低 | 中 | 性能基准测试，回滚计划 |
| 测试覆盖不足 | 中 | 高 | 先补充测试，再重构 |

### 6.2 回滚计划

1. **Git分支策略**: 每个阶段一个独立分支
2. **功能标志**: 通过环境变量控制新旧实现切换
3. **渐进式发布**: 先在测试环境验证，再发布生产

---

## 七、测试策略

### 7.1 测试覆盖目标

| 模块 | 当前覆盖 | 目标覆盖 |
|------|----------|----------|
| index.ts | 部分 | 90%+ |
| event-handler.ts | 新增 | 95%+ |
| session-manager.ts | 新增 | 95%+ |
| stats-manager.ts | 新增 | 95%+ |
| persistence-manager.ts | 新增 | 90%+ |

### 7.2 测试类型

1. **单元测试**: 每个类独立测试
2. **集成测试**: 类之间交互测试
3. **端到端测试**: 完整事件处理流程测试

### 7.3 测试示例

```typescript
// src/session-manager.test.ts
describe('SessionManager', () => {
  let manager: SessionManager

  beforeEach(() => {
    manager = new SessionManager(1000, 86400000)
  })

  describe('baseline management', () => {
    it('should set and get baseline', () => {
      manager.setBaseline('session-1', {
        input: 100,
        cacheRead: 50,
        cacheWrite: 10,
        output: 200,
        lastAccess: Date.now(),
      })

      const baseline = manager.getBaseline('session-1')
      expect(baseline).toBeDefined()
      expect(baseline?.input).toBe(100)
    })

    it('should sweep expired baselines', () => {
      const expiredTime = Date.now() - 86400001 // 24h + 1ms
      manager.setBaseline('session-1', {
        input: 100,
        cacheRead: 50,
        cacheWrite: 10,
        output: 200,
        lastAccess: expiredTime,
      })

      manager.sweepExpired()

      const baseline = manager.getBaseline('session-1')
      expect(baseline).toBeUndefined()
    })

    it('should evict LRU when over capacity', () => {
      // Fill to capacity
      for (let i = 0; i < 1000; i++) {
        manager.setBaseline(`session-${i}`, {
          input: 100,
          cacheRead: 50,
          cacheWrite: 10,
          output: 200,
          lastAccess: Date.now() - i * 1000, // Older sessions have lower timestamp
        })
      }

      // Add one more to trigger eviction
      manager.setBaseline('session-new', {
        input: 100,
        cacheRead: 50,
        cacheWrite: 10,
        output: 200,
        lastAccess: Date.now(),
      })

      // Oldest session should be evicted
      expect(manager.getBaseline('session-999')).toBeUndefined()
      expect(manager.getBaseline('session-new')).toBeDefined()
    })
  })
})
```

---

## 八、文档更新

### 8.1 需要更新的文档

1. **README.md** - 更新架构说明
2. **REFACTORING_PLAN.md** - 本文件
3. **CHANGELOG.md** - 记录重构变更
4. **JSDoc注释** - 更新函数/类文档

### 8.2 新增文档

1. **ARCHITECTURE.md** - 架构设计文档
2. **CONTRIBUTING.md** - 贡献指南
3. **TESTING.md** - 测试指南

---

## 九、时间表

### 9.1 甘特图

```
Week 1: [████████████████████████████████████████] 事件处理器拆分
Week 2: [████████████████████████████████████████] 依赖注入
Week 3: [████████████████████████████████████████] 职责分离
Week 4: [████████████████████████████████████████] 性能优化（可选）
```

### 9.2 里程碑

| 里程碑 | 日期 | 交付物 |
|--------|------|--------|
| M1: 事件处理器拆分完成 | Week 1 | event-handler.ts + 测试 |
| M2: 依赖注入完成 | Week 2 | 所有类重构 + 测试 |
| M3: 职责分离完成 | Week 3 | jsonl/ + stats/ 模块 |
| M4: 性能优化完成 | Week 4 | 异步I/O（可选） |

---

## 十、验收标准

### 10.1 代码质量

- [ ] 所有测试通过（297+断言）
- [ ] TypeScript类型检查通过（无 `any`）
- [ ] Biome代码风格检查通过
- [ ] 无模块级可变状态
- [ ] 最大函数行数 <50行
- [ ] 最大圈复杂度 <15

### 10.2 功能完整性

- [ ] `/cache-stats` 命令正常工作
- [ ] 缓存命中率统计正确
- [ ] JSONL持久化正常
- [ ] 跨终端缓存池化正常
- [ ] 系统提示归一化正常

### 10.3 性能指标

- [ ] 事件处理延迟 <10ms（P99）
- [ ] 内存使用无显著增长
- [ ] 文件I/O无阻塞（如果实施异步）

---

## 附录A：当前代码问题详细分析

### A.1 index.ts 事件处理器分析

**圈复杂度分解**:

| 行号 | 条件 | 复杂度贡献 |
|------|------|------------|
| 245 | `event.type !== 'session.idle'` | +1 |
| 251 | `!event.properties \|\| typeof event.properties !== 'object'` | +2 |
| 257 | `!sessionID` | +1 |
| 261 | `retryState && Date.now() < retryState.nextRetryAt` | +2 |
| 266 | `try/catch` | +2 |
| 291 | `response.error \|\| !response.data` | +2 |
| 292 | `!Array.isArray(response.data)` | +1 |
| 298 | `!lastAssistant?.info?.tokens` | +2 |
| 310-318 | 8个 `!Number.isFinite` / `< 0` 条件 | +8 |
| 334 | `cacheRead === undefined` | +1 |
| 358-364 | `for` 循环 + TTL 检查 | +2 |
| 366-371 | `for` 循环 + 孤立检查 | +2 |
| 376-382 | 4个 `!==` 条件 | +4 |
| 399 | `while` 循环 | +1 |
| 403-408 | `for` 循环 + 最旧检查 | +2 |
| 409 | `!oldestSession` | +1 |
| 415 | `!isApplicableDeepSeek` | +1 |
| 434 | 4个 `< 0` 条件 | +4 |
| 451 | 4个 `=== 0` 条件 | +4 |
| 475 | `!stats.firstRequestTime` | +1 |
| 513 | `count > MAX_EVENT_RETRIES` | +1 |
| 514 | `count === MAX_EVENT_RETRIES + 1` | +1 |

**总计**: ~35-40 决策点

### A.2 状态变量清单

| 变量 | 模块 | 类型 | 问题 |
|------|------|------|------|
| `sessionBaselines` | index.ts | `Map<string, BaselineEntry>` | 测试隔离困难 |
| `lastBaselineWrite` | index.ts | `Map<string, BaselineEntry>` | 测试隔离困难 |
| `sessionRetryState` | index.ts | `Map<string, RetryState>` | 测试隔离困难 |
| `pluginDisposed` | index.ts | `boolean` | 全局状态 |
| `cachedModelId` | index.ts | `string \| null` | 全局状态 |
| `LOG_DIR` | logger.ts | `string` | 模块级可变状态 |
| `LOG_FILE` | logger.ts | `string` | 模块级可变状态 |
| `stream` | logger.ts | `WriteStream \| null` | 模块级可变状态 |
| `writeBuffer` | logger.ts | `string[]` | 模块级可变状态 |
| `draining` | logger.ts | `boolean` | 模块级可变状态 |
| `statSkipCounters` | file-utils.ts | `Map<string, number>` | 模块级可变状态 |

**总计**: 11个模块级可变状态

### A.3 重复代码模式

**模式1: 类型守卫** (出现4次)
```typescript
typeof r.hit === 'number' && Number.isFinite(r.hit) ? Math.max(0, r.hit) : 0
```

**模式2: 目录创建** (出现3次)
```typescript
const dir = dirname(jsonlPath)
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true })
}
```

**模式3: 错误日志** (出现8次)
```typescript
log('ERROR in xxx', { error: String(err) })
```

---

## 附录B：参考资源

### B.1 设计模式

1. **依赖注入**: 控制反转，消除全局状态
2. **单一职责原则**: 每个类/模块只有一个职责
3. **开闭原则**: 对扩展开放，对修改关闭
4. **命令模式**: 将事件处理器封装为命令对象

### B.2 TypeScript最佳实践

1. **严格类型**: 避免 `any`，使用 `unknown` + 类型守卫
2. **不可变数据**: 使用 `readonly` 和 `as const`
3. **依赖注入**: 通过构造函数注入依赖
4. **接口隔离**: 定义小而专注的接口

### B.3 测试最佳实践

1. **AAA模式**: Arrange-Act-Assert
2. **测试隔离**: 每个测试独立，无共享状态
3. **边界测试**: 测试边界条件和错误情况
4. **集成测试**: 测试类之间交互

---

*文档结束*
