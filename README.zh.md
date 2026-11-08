# dsh-skill-audit

**DeepSeek Harness 的技能 / 插件审核台。** 一个面板、两种模式：

1. **DSH 资产**：扫描本机 DSH 技能与插件，逐个打 0-100 分（S/A/B/C/D），列出 pass/warn/fail 与修复建议，可导出 Markdown 报告。
2. **WorkBuddy 包**：审核 WorkBuddy **技能包 / 专家包**（目录或 `.zip`），跑 **25 条门禁**（G01–G19 / E01–E06）+ **质量分 Q**（5 维 22 项）+ **价值分 V**（6 维），自动做 `V_final = min(V_raw, Q + 15)` 校准，并给出**建议价格带**。

`dsh-skill-audit` 是一个 DSH 插件（`dsh.bundle` + 浏览器半边）：左侧栏底部挂 **🛡️ 审核台** 按钮，点开是 React 直接渲染的全屏面板（不用 iframe）。宿主半边负责扫描并提供 JSON 路由。

## 扫描范围

### DSH 模式

| 来源 | 扫什么 |
| --- | --- |
| `~/.dsh/skills/*` | 每个技能目录（`SKILL.md`） |
| `<profile>/node_modules/*` | `package.json` 里声明了 `dsh.bundle` 的已安装插件（含作用域包） |
| `<workspace>/dsh-plugins/*` | 当前工作区里正在开发的插件 |

### WorkBuddy 模式

| 输入 | 识别方式 |
| --- | --- |
| 目录或 `.zip` | 根上有 `SKILL.md` → **技能包**（若 ZIP 套了一层外层目录会自动剥开，并由 G01 判 fail） |
| 目录或 `.zip` | 有 `.codebuddy-plugin/plugin.json` → **专家包**（ZIP 必须有且只有一层顶层目录 = 包名） |

ZIP 是纯 JS 读取：解析中央目录 + `zlib.inflateRawSync`（stored / deflate），不落盘；只有脚本语法检查需要时，才把脚本临时解压到系统临时目录并立即清理。不支持 ZIP64 / 加密包。

## DSH 模式检查项

### 技能（基于 `SKILL.md`）

| 检查项 | 权重 | 检查内容 |
| --- | --- | --- |
| `SKILL.md` | 20 | 存在且内容非空 |
| frontmatter `description` | 20 | 有 YAML frontmatter、description 存在且够长 |
| frontmatter `author` | 10 | 声明了作者 |
| frontmatter `name` | 10 | 与目录名一致 |
| `LICENSE` | 10 | 有许可证文件（或 frontmatter 里声明） |
| 敏感信息 | 20 | 明显密钥 / Token / 私钥（命中值一律打码） |
| 本机路径 / 隐私 | 10 | 硬编码的完整用户主目录路径 |

### 插件（基于 `package.json`）

| 检查项 | 权重 | 检查内容 |
| --- | --- | --- |
| `package.json` | 5 | 可读取、合法、`name` 与目录名一致 |
| `dsh.bundle` | 15 | 已声明，且 `patch` 文件存在 |
| `cordis.patch.yml` row name | 15 | insert 行的 `name` 等于包名 |
| client 模块 id | 10 | `__ModuleLoader__.load({ id })` 等于包名 |
| 宿主 name | 10 | `export const name` / `exports.name` 等于包名 |
| `README` | 5 | 至少有一个 README |
| README 中英 | 5 | `README.md` + `README.zh.md`（或 `README.en.md`） |
| `LICENSE` | 7 | 许可证文件存在 |
| icon | 10 | `icon` 是 512×512 PNG（直接读 PNG 头判断尺寸） |
| `files` 白名单 | 5 | 覆盖 lib / app / assets / README\* / LICENSE / `cordis.patch.yml` |
| 敏感信息 | 10 | 明显密钥 / Token / 私钥（命中值一律打码） |
| 本机路径 / 隐私 | 3 | 硬编码的完整用户主目录路径 |

DSH 分数 = 加权通过率（pass=1、warn=0.5、fail=0、skip 不计入）。等级：**S ≥ 90，A ≥ 80，B ≥ 70，C ≥ 60，D < 60**。

## WorkBuddy 模式检查

25 条门禁移植自 `skill-value-auditor/rubric/rubric.v1.json`（rubric v1.0.1）。每条返回 `pass` / `warn` / `fail` / `skip`，带 severity（`blocker` / `major` / `minor`）、可读原因、证据和 rubric 的修复建议。

| ID | 严重度 | 检查项 |
| --- | --- | --- |
| G01 | blocker | 包结构（平铺 ZIP、`SKILL.md` 在根、层级 ≤2、无垃圾文件；专家包顶层目录 = 包名） |
| G02 | blocker | `SKILL.md` frontmatter 必填字段（name/description/version；专家包内嵌技能 name/description） |
| G03 | major | `name` 与包名一致且为 kebab-case |
| G04 | blocker | 展示名规则（≤15 字，仅中英文数字 / `-` / `—`，无括号空格） |
| G05 | blocker | 文档反引号引用的本地文件必须存在（禁止通配符） |
| G06 | blocker | 无硬编码密钥 / 令牌 / 私钥（值打码） |
| G07 | blocker | YAML frontmatter 可解析（含 `': '` 引号陷阱） |
| G08 | blocker | 付费包法律文件：LICENSE-USE / NOTICE / PRIVACY / SECURITY / CHANGELOG + 免责声明 |
| G09 | minor | 图标素材 512×512 PNG ≤ 500 KB |
| G10 | major | 中英双语字段（description_en / display_name_en / examples_en） |
| G11 | blocker | 脚本语法可编译（JS 用 `node --check`，Python 有解释器时用 `ast.parse`） |
| G12 | blocker | 无越权 / 破坏性命令（rm -rf / 注册表 / 浏览器凭据等） |
| G13 | major | 无绝对化违规承诺（保本 / 稳赚 / 零风险 / 包过 / 避税等） |
| G14 | major | 无未完成占位符（TODO / 待补 / TBD 等） |
| G15 | minor | UTF-8 无 BOM |
| G16 | blocker | 无外传用户数据（上传 / webhook 模式） |
| G17 | major | 包体 <3 MB（专家包 <10 MB） |
| G18 | major | author 字段 |
| G19 | blocker | `examples_zh` / `examples_en` 各 ≤3 条（平台解析硬限制） |
| E01 | blocker | `plugin.json` 16 个必填字段齐全且合法 |
| E02 | blocker | avatar 512×512 且 ≤500 KB |
| E03 | blocker | tags=3、quickPrompts=3、defaultInitPrompt 对齐、profession 非空 |
| E04 | major | `displayDescription.zh` 40–50 字 |
| E05 | blocker | `agents/*.md` frontmatter 与 agentName 对应（name/description/displayName/profession/maxTurns，禁止 tools） |
| E06 | blocker | Team 型 `settings.json` / `teamInfo` 一致 |

### 质量分 Q（0–100，五维）

| 维度 | 权重 | 看什么 |
| --- | --- | --- |
| Q1 结构合规与工程健壮性 | 18 | 门禁结果、脚本与静态语法、selfcheck、版本/CHANGELOG/体积/编码 |
| Q2 触发与路由 | 14 | description 对示例问法的覆盖、泛化词、名称可搜性、示例质量 |
| Q3 工作流可执行性 | 24 | 编号步骤与分支、输入采集与降级、输出模板、不确定边界 |
| Q4 知识与内容质量 | 26 | 知识密度、静态一致性、时效与出处、免责、可复用资产 |
| Q5 体验与商业化基础 | 18 | 首用即得、双语上架文案、可导出格式、体积/token 效率 |

22 个细分项按 0–4 级锚点折算到各自满分，**每一项都带证据**（计数、文件、命中词），报告里全部列出。

### 价值分 V（0–100，六维）与定价

| 维度 | 权重 | 依据 |
| --- | --- | --- |
| V1 需求强度 | 25 | 领域需求先验 + 损失/事件/频率/决策/搜索句式词密度 |
| V2 交付确定性 | 20 | 表格、脚本、模板、验收标准 |
| V3 结果价值 | 20 | 领域损失基线 + 金额/罚款/理赔词 |
| V4 可替代性/壁垒 | 15 | 知识体量、表格、脚本、公式、合规钩子，泛化词反向扣分 |
| V5 复用频次与生命周期 | 10 | 领域频次先验 + 周期词 vs 一次性词 |
| V6 付费意愿与责任风险 | 10 | 领域、免责声明、合规信号 |

**校准：`V_final = min(V_raw, Q + 15)`** —— 交付不行的包，需求再真也不值钱。
**定价带**（按 `V_final`）：S ≥ 85 → ¥49–79 或订阅；A ≥ 72 → ¥29.9；B ≥ 60 → ¥19.9；C ≥ 48 → ¥9.9；其余免费 / 不上架。V5 ≥ 80 且 V ≥ 70 时追加建议按月订阅（¥9.9–19.9/月）。门禁有 blocker 时 `V_final = 0` 且不给定价。

**惩罚项** P1–P6 跨维度扣分并单列：长行重复率 >30%、专业领域缺免责、绝对化承诺、兄弟包相似度（需批量语料，报告标注未触发）、体积/文本过大、占位符。

## 面板用法

1. 安装插件（插件市场，或放进 profile 并加上 bundle row）。
2. 点左侧栏底部的 **🛡️ 审核台**。
3. **DSH 资产** 标签：打开即扫描，**↻ 重新扫描**，点击行展开检查明细，筛选 tabs，**⬇ 导出报告** → `<workspace>/outputs/skill-audit-<YYYY-MM-DD>.md`。
4. **WorkBuddy 包** 标签：粘贴包目录或 `.zip` 的绝对路径，点 **🔍 扫描包**；面板显示按严重度分组的门禁表、Q 五维、V 六维、惩罚项与价格带。**⬇ 导出报告** → `<workspace>/outputs/wb-audit-<包名>-<YYYY-MM-DD>.md`。
5. **静态预览** 在新窗口打开构建时内嵌的 `app/panel.html` 预览页（只有示例数据，看设计用）。

### 宿主路由

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/api/dsh-skill-audit/scan` | GET | DSH 扫描 JSON，可带 `?workspace=<绝对路径>` |
| `/api/dsh-skill-audit/report` | POST | DSH 扫描 + Markdown 报告，可带 `{ "workspace": "<绝对路径>" }` |
| `/api/dsh-skill-audit/wb-scan` | POST | WorkBuddy 包扫描，body `{ "path": "<绝对路径>", "paid"?: true/false, "skipScripts"?: true }` |
| `/api/dsh-skill-audit/wb-report` | POST | WorkBuddy 扫描 + Markdown 报告，body `{ "path": "...", "workspace"?: "..." }` |

路由挂在宿主 `connection` 服务的共享 `/api` 通道上，登录态与 Host/Origin 校验由 DSH 统一处理。WorkBuddy 扫描只读，唯一的写操作是导出到 `<workspace>/outputs/` 的报告（以及脚本语法检查时临时解压的脚本副本，用完即删）。

### 导出到哪个工作区？

报告写入位置 = `<workspace>/outputs/`，`<workspace>/dsh-plugins/*` 也从同一个工作区扫。按以下顺序取第一个有效候选：

1. 面板上报的当前会话工作目录（最准确）；
2. `DSH_WORKSPACE` 环境变量；
3. `~/.dsh/skill-audit.config.json` 的 `workspace` 字段；
4. 宿主进程 `process.cwd()`。

```json
// ~/.dsh/skill-audit.config.json
{ "workspace": "C:/path/to/your/workspace" }
```

只接受「已存在、不是磁盘根目录」的绝对路径；其余情况自动回退。

## 命令行

同一套审计逻辑可以脱离 DSH 直接跑：

```bash
# DSH 资产
node tools/scan.mjs                          # 扫本机，工作区 = cwd
node tools/scan.mjs --workspace .            # 指定工作区
node tools/scan.mjs --asset ~/.dsh/skills/ai-brain   # 只看单个 DSH 资产
node tools/scan.mjs --json                   # 输出完整 JSON
node tools/scan.mjs --report report.md       # 同时写 Markdown 报告

# WorkBuddy 包
node tools/scan.mjs --wb E:/技能资产库/上架包/my-skill-1.0.0.zip
node tools/scan.mjs --wb E:/workspace/my-expert --json
node tools/scan.mjs --wb <路径> --paid       # 强制按付费包检查法律文件
node tools/scan.mjs --wb <路径> --skip-scripts   # 跳过脚本语法静态检查（更快）
node tools/scan.mjs --wb <路径> --report wb-report.md
```

`--wb` 在有 blocker 时退出码为 `1`，否则 `0`（方便接 CI）。

## 开发

```bash
node build.mjs          # 把 app/panel.html gzip 后内嵌进 lib/client.js
node test/smoke.mjs     # 离线冒烟：内嵌 gzip、槽位、两种模式面板、宿主路由
node test/scan.test.mjs # DSH 模式 fixture + 路由集成
node test/wb.test.mjs   # WorkBuddy fixture（好/坏技能与专家包、目录 + zip）+ Q/V + 路由
npm test                # 三组全跑
npm pack --dry-run      # 检查发布文件清单
```

目录结构：

```
lib/index.js            宿主半边（4 条路由、cordis 插件入口）
lib/audit.mjs           DSH 扫描 / 打分 / Markdown 逻辑
lib/wb-package.mjs      WorkBuddy 包读取（ZIP 中央目录、目录视图、YAML 子集解析）
lib/wb-audit.mjs        WorkBuddy 门禁 + Q/V + 定价 + Markdown 报告
lib/client.template.js  浏览器半边模板（React 面板、两个槽位、两种模式）
lib/client.js           build.mjs 生成的产物（不要手改）
app/panel.html          静态预览页，构建时 gzip 内嵌进 client.js
tools/scan.mjs          CLI（DSH + WorkBuddy）
tools/make-icon.py      用 Pillow 生成 assets/icon.png
test/                   smoke + DSH 扫描测试 + WorkBuddy 测试
```

## 隐私与安全

- 扫描是**只读**的：不修改被扫描的技能 / 插件 / 包，不发起任何网络请求。
- 唯一的写操作是导出到 `<workspace>/outputs/` 的报告（以及脚本语法检查时临时解压的脚本副本，用完即删）。
- 命中敏感信息时只报告「类型 + 数量」，命中值不会进 JSON、也不会进 Markdown 报告。
- 本机路径只报数量，不回显用户名。
- 扫描结果只在本机 DSH 面板内展示。

## 已知限制

- WorkBuddy 评分是**启发式静态近似**，不是模型判断也不是人工审核：门禁是确定性检查，Q/V 用词频与结构启发式。报告里每个分数都带证据、可复核，但 Q/V 只作参考。
- YAML 是小型子集解析器（标量、块标量、列表、简单嵌套 map）——写法特别的 YAML 可能被拒或读不全。
- G11 只做静态语法检查（`node --check`、Python `ast.parse`），**不执行脚本**，所以 `--demo` / selfcheck 退出码 / T1 沙箱执行都没有验证。
- T3 兄弟包相似度与 T4 行为评分未自动化（需要批量语料与真实 Agent 输出）；P4 报告标注「未触发」。
- DSH 模式 icon 只认 PNG 头；SVG/JPG 图标只给 warn。
- 报告文件名按日期生成，同一天导出两次会互相覆盖。
- WorkBuddy ZIP 支持 stored/deflate，不支持 ZIP64/加密；包必须能被 DSH 宿主进程读到（绝对路径）。
- 付费判定是启发式（法律文件 / 价格字段 / `--paid`），没有法律文件又不带价格信息的付费包可能漏判。
- 浏览器宿主拿不到 session 列表时，工作区按环境变量 / 配置 / cwd 顺序回退。

## 许可证

MIT，见 [LICENSE](LICENSE)。
