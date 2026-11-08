# dsh-skill-audit

**DeepSeek Harness 的技能 / 插件审核台。** 扫描本机的技能与插件，逐个资产打 0-100 分（S/A/B/C/D），列出每一项 pass / warn / fail 与修复建议，并可导出 Markdown 报告。

`dsh-skill-audit` 是一个 DSH 插件（`dsh.bundle` + 浏览器半边）：在左侧栏底部挂一个 **🛡️ 审核台** 按钮，点开是 React 直接渲染的全屏面板（**不用 iframe**）。宿主半边负责扫描并提供两个 JSON 路由。

## 扫描范围

| 来源 | 扫什么 |
| --- | --- |
| `~/.dsh/skills/*` | 每个技能目录（`SKILL.md`） |
| `<profile>/node_modules/*` | `package.json` 里声明了 `dsh.bundle` 的已安装插件（含 `@scope/pkg` 作用域包） |
| `<workspace>/dsh-plugins/*` | 当前工作区里正在开发的插件 |

profile 默认取 `DSH_PROFILE_DIR`；没有该变量时扫 `~/.dsh/profiles/*` 下所有 profile。`DSH_HOME` 可覆盖 `~/.dsh`。

## 检查项

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

## 打分规则

- 每项结果：`pass`（拿满分）、`warn`（拿一半）、`fail`（0 分）、`skip`（不计入）。
- 分数 = 加权通过率，0-100；等级：**S ≥ 90，A ≥ 80，B ≥ 70，C ≥ 60，D < 60**。
- 资产按分数从低到高排，每个问题都带具体修复建议。

## 面板用法

1. 安装插件（插件市场安装，或放进 profile 并加上 bundle row）。
2. 点左侧栏底部的 **🛡️ 审核台**。
3. 打开即自动扫描；**↻ 重新扫描** 重跑，点击行展开完整检查明细，筛选 tabs 切换「全部 / 技能 / 插件」。
4. **⬇ 导出报告** 写入 `<workspace>/outputs/skill-audit-<YYYY-MM-DD>.md`。
5. **静态预览** 在新窗口打开构建时内嵌的 `app/panel.html` 预览页（只有示例数据，用来看设计）。

### 宿主路由

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/api/dsh-skill-audit/scan` | GET | 返回 JSON 扫描结果，可带 `?workspace=<绝对路径>` 提示 |
| `/api/dsh-skill-audit/report` | POST | 扫描并写 Markdown 报告，可带 body `{ "workspace": "<绝对路径>" }` |

两条路由挂在宿主 `connection` 服务的共享 `/api` 通道上，登录态与 Host/Origin 校验由 DSH 统一处理。除 `<workspace>/outputs/` 下的报告外，插件不写任何文件。

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
node tools/scan.mjs                          # 扫本机，工作区 = cwd
node tools/scan.mjs --workspace .            # 指定工作区
node tools/scan.mjs --asset ~/.dsh/skills/ai-brain   # 只看单个资产
node tools/scan.mjs --json                    # 输出完整 JSON
node tools/scan.mjs --report report.md        # 同时写 Markdown 报告
```

## 开发

```bash
node build.mjs       # 把 app/panel.html gzip 后内嵌进 lib/client.js
node test/smoke.mjs  # 离线冒烟：内嵌 gzip、槽位注册、组件渲染、宿主路由
node test/scan.test.mjs --live   # fixture + 在本仓库与真实技能 ai-brain 上跑一遍
npm pack --dry-run   # 检查发布文件清单
```

目录结构：

```
lib/index.js            宿主半边（路由、cordis 插件入口）
lib/audit.mjs           纯扫描 / 打分 / Markdown 逻辑（CLI 与测试共用）
lib/client.template.js  浏览器半边模板（React 面板 + 两个槽位）
lib/client.js           build.mjs 生成的产物（不要手改）
app/panel.html          静态预览页，构建时 gzip 内嵌进 client.js
tools/scan.mjs          CLI
tools/make-icon.py      用 Pillow 生成 assets/icon.png
test/                   smoke 与扫描测试
```

## 隐私与安全

- 扫描是**只读**的：不修改被扫描的技能 / 插件，不发起任何网络请求。
- 唯一的写操作是导出到 `<workspace>/outputs/` 的报告。
- 命中敏感信息时只报告「类型 + 数量」，命中值不会进 JSON、也不会进 Markdown 报告。
- 本机路径只报数量，不回显用户名。
- 扫描结果只在本机 DSH 面板内展示。

## 已知限制

- 检查是静态的（正则 / 头部解析），不是完整 YAML / JS 解析器：写法特别的 `cordis.patch.yml` 可能识别不到，压缩过的宿主 bundle 可能解析不出 `name`。
- icon 校验只认 PNG 头；SVG / JPG 图标只会提示「无法按 512×512 校验」。
- 报告文件名按日期生成，同一天导出两次会互相覆盖。
- 不会真的执行 `npm pack`，`files` 白名单只做静态比对。
- 浏览器宿主拿不到 session 列表时，工作区按上面的环境变量 / 配置 / cwd 顺序回退。

## 许可证

MIT，见 [LICENSE](LICENSE)。
