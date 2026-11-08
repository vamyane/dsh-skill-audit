/**
 * WorkBuddy 包审核（技能包 / 专家包 / 团队包）：
 *   门禁 25 条（G01–G19、E01–E06）+ 质量分 Q（5 维 22 项）+ 价值分 V（6 维）
 *   + 定价带建议 + Markdown 报告。
 *
 * 所有评分都是**可解释启发式**：每一项都带 evidence（计数、文件、行号或命中词），
 * 报告里明确标注「静态近似 / 启发式」，不会假装模型判断。规则移植自
 * skill-value-auditor/rubric/rubric.v1.json（rubricVersion 1.0.1）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VERSION } from "./audit.mjs";
import {
  WB_RUBRIC_VERSION,
  isScriptFile,
  listMarkdown,
  listScripts,
  listTextFiles,
  loadPackageView,
  materializeScripts,
  parseYamlFrontmatter,
  readPngInfoBuffer,
  stripVersionSuffix,
  utf8BomLength,
  isUtf8,
} from "./wb-package.mjs";

/* ================================================================== */
/* 一、规则常量（移植自 rubric.v1.json，改这里等于改标准）               */
/* ================================================================== */

export const GATE_DEFS = [
  { id: "G01", title: "包结构与上传规则（平铺/SKILL.md 在根/层级≤2/无垃圾）", severity: "blocker", when: "always", fatal: true, fix: "重新平铺打包：SKILL.md 放 ZIP 根，目录最多两级，去掉 __pycache__/.DS_Store/.pyc" },
  { id: "G02", title: "SKILL.md frontmatter 必填字段（name/description/version，专家包内嵌技能 name/description）", severity: "blocker", when: "always", fix: "补齐 name/description/version/author" },
  { id: "G03", title: "name 与包名一致且为 kebab-case", severity: "major", when: "always", fix: "name 改成与目录/zip 同名的小写连字符形式" },
  { id: "G04", title: "展示名规则（≤15 字，仅中英文数字 - —，无括号空格）", severity: "blocker", when: "always", fix: "改 display_name；去掉括号与空格" },
  { id: "G05", title: "文档引用的本地文件必须真实存在（禁止通配符）", severity: "blocker", when: "always", fix: "把缺失文件打进包，或删掉反引号里的路径引用" },
  { id: "G06", title: "无硬编码密钥/令牌/私钥", severity: "blocker", when: "always", fatal: true, fix: "改为环境变量占位，并说明用户如何配置" },
  { id: "G07", title: "YAML frontmatter 可解析（含 ': ' 引号陷阱）", severity: "blocker", when: "always", fix: "含 ': ' 的值整体加双引号" },
  { id: "G08", title: "付费包法律文件齐全（LICENSE-USE/NOTICE/PRIVACY/SECURITY/CHANGELOG + 免责声明）", severity: "blocker", when: "paid", fix: "补齐 LICENSE-USE/NOTICE/PRIVACY/SECURITY/CHANGELOG + 免责声明" },
  { id: "G09", title: "图标素材规格（512×512 PNG ≤500KB）", severity: "minor", when: "always", fix: "生成 512×512 PNG 图标并单独上传" },
  { id: "G10", title: "中英双语字段齐全", severity: "major", when: "always", fix: "补 description_en（及 display_name_en / examples_en）" },
  { id: "G11", title: "脚本语法可编译（node --check / Python ast.parse，静态近似）", severity: "blocker", when: "hasScripts", fix: "修复脚本语法；确保 selfcheck 可 0 退出" },
  { id: "G12", title: "无越权或破坏性命令（rm -rf / 注册表 / 浏览器凭据）", severity: "blocker", when: "always", fatal: true, fix: "删除危险操作，改为只读或用户确认后执行" },
  { id: "G13", title: "无绝对化违规承诺（保本/稳赚/零风险/包过/避税）", severity: "major", when: "always", fix: "改成有条件表述并补免责" },
  { id: "G14", title: "无未完成占位符（TODO/待补/TBD/占位）", severity: "major", when: "always", fix: "补全或删除占位内容" },
  { id: "G15", title: "文件编码 UTF-8（无 BOM 乱码）", severity: "minor", when: "always", fix: "统一转 UTF-8（无 BOM）" },
  { id: "G16", title: "无外传用户数据（上传/回传第三方域名）", severity: "blocker", when: "always", fatal: true, fix: "移除上传逻辑，声明纯本地处理" },
  { id: "G17", title: "包体 <3MB（专家包 <10MB）", severity: "major", when: "always", fix: "压缩或拆分，去掉无用二进制" },
  { id: "G18", title: "author 字段（官方必填）", severity: "major", when: "always", fix: "在 frontmatter 补 author（专家包 plugin.json 的 author）" },
  { id: "G19", title: "examples_zh / examples_en 各 ≤3 条（平台解析硬限制）", severity: "blocker", when: "always", fix: "裁剪到 3 条以内，保留最有代表性、差异最大的问法" },
  { id: "E01", title: "plugin.json 必填字段齐全且合法", severity: "blocker", when: "expert", fix: "补齐官方 16 个必填字段" },
  { id: "E02", title: "avatar 512×512 且 ≤500KB", severity: "blocker", when: "expert", fix: "重新导出头像" },
  { id: "E03", title: "profession 同类唯一、tags=3、quickPrompts=3、defaultInitPrompt 对齐", severity: "blocker", when: "expert", fix: "按官方规范调整展示字段" },
  { id: "E04", title: "displayDescription 40–50 字", severity: "major", when: "expert", fix: "压缩/扩写到 40–50 字" },
  { id: "E05", title: "agents/*.md frontmatter 与 agentName 对应", severity: "blocker", when: "expert", fix: "补 name/description/displayName/profession/maxTurns，禁止 tools" },
  { id: "E06", title: "Team 型 settings.json/teamInfo 一致", severity: "blocker", when: "expertTeam", fix: "补 settings.json 并让 teamInfo 对齐" },
];

const GATE_BY_ID = Object.fromEntries(GATE_DEFS.map((def) => [def.id, def]));

const Q_DIMENSIONS = [
  { id: "Q1", name: "结构合规与工程健壮性", weight: 18 },
  { id: "Q2", name: "触发与路由", weight: 14 },
  { id: "Q3", name: "工作流可执行性", weight: 24 },
  { id: "Q4", name: "知识与内容质量", weight: 26 },
  { id: "Q5", name: "体验与商业化基础", weight: 18 },
];

const Q_ITEMS = [
  { id: "Q1.1", dim: "Q1", name: "包结构合规", max: 5 },
  { id: "Q1.2", dim: "Q1", name: "脚本可运行性", max: 7 },
  { id: "Q1.3", dim: "Q1", name: "自检与可验证", max: 3 },
  { id: "Q1.4", dim: "Q1", name: "可维护性与体积", max: 3 },
  { id: "Q2.1", dim: "Q2", name: "description 覆盖问法", max: 5 },
  { id: "Q2.2", dim: "Q2", name: "边界与外溢", max: 4 },
  { id: "Q2.3", dim: "Q2", name: "名称与搜索性", max: 3 },
  { id: "Q2.4", dim: "Q2", name: "示例质量", max: 2 },
  { id: "Q3.1", dim: "Q3", name: "步骤化与分支", max: 7 },
  { id: "Q3.2", dim: "Q3", name: "输入采集与降级", max: 6 },
  { id: "Q3.3", dim: "Q3", name: "输出结构与模板", max: 6 },
  { id: "Q3.4", dim: "Q3", name: "边界与不确定处理", max: 5 },
  { id: "Q4.1", dim: "Q4", name: "知识密度", max: 7 },
  { id: "Q4.2", dim: "Q4", name: "准确性与一致性", max: 7 },
  { id: "Q4.3", dim: "Q4", name: "时效与出处", max: 5 },
  { id: "Q4.4", dim: "Q4", name: "风险控制与免责", max: 4 },
  { id: "Q4.5", dim: "Q4", name: "可复用资产", max: 3 },
  { id: "Q5.1", dim: "Q5", name: "首用即得", max: 6 },
  { id: "Q5.2", dim: "Q5", name: "上架文案与双语", max: 4 },
  { id: "Q5.3", dim: "Q5", name: "交付物可导出", max: 4 },
  { id: "Q5.4", dim: "Q5", name: "体积与 token 效率", max: 4 },
];

const V_DIMENSIONS = [
  { id: "V1", name: "需求强度", weight: 25 },
  { id: "V2", name: "交付确定性", weight: 20 },
  { id: "V3", name: "结果价值", weight: 20 },
  { id: "V4", name: "可替代性/壁垒", weight: 15 },
  { id: "V5", name: "复用频次与生命周期", weight: 10 },
  { id: "V6", name: "付费意愿与责任风险", weight: 10 },
];

const PRICE_BANDS = [
  { min: 85, grade: "S", price: "¥49–79 或订阅", note: "强刚需 + 高交付 + 有壁垒" },
  { min: 72, grade: "A", price: "¥29.9", note: "值得单独收费" },
  { min: 60, grade: "B", price: "¥19.9", note: "有明确场景，需补内容/工程" },
  { min: 48, grade: "C", price: "¥9.9（引流）", note: "尝鲜价，先做口碑" },
  { min: 0, grade: "D", price: "免费 / 不上架", note: "需求或交付不成立" },
];

const SUBSCRIPTION_RULE = { minV: 70, minV5: 80, price: "¥9.9–19.9/月" };

const DOMAIN_KEYWORDS = {
  insurance: ["保险", "理赔", "拒赔", "保单", "续保", "保额", "投保", "寿险", "车险"],
  tax: ["税", "个税", "汇算", "增值税", "发票", "抵扣", "税务局", "纳税"],
  legal: ["法律", "法条", "诉讼", "律师", "违法", "法律意见", "判决"],
  contract: ["合同", "协议", "签署", "违约条款", "解除合同"],
  finance: ["财务", "投资", "理财", "估值", "财报", "现金流", "融资", "预算"],
  compliance: ["合规", "监管", "审计", "备案", "资质", "许可", "风控", "等保"],
  bidding: ["招标", "投标", "标书", "中标", "废标", "答疑", "开标"],
  patent: ["专利", "知识产权", "商标", "著作权", "版权"],
  hr: ["招聘", "入职", "离职", "绩效", "薪酬", "社保", "人事", "劳动法", "述职", "晋升"],
  marketing: ["营销", "推广", "获客", "投放", "品牌", "私域", "增长", "转化"],
  productivity: ["效率", "办公", "文档", "职场", "总结", "计划", "复盘", "汇报"],
  content: ["内容", "文案", "写作", "脚本", "视频", "小红书", "公众号"],
  design: ["设计", "配色", "排版", "UI", "海报", "视觉", "图标"],
  coding: ["代码", "开发", "程序", "API", "调试", "架构", "前端", "后端"],
  cad: ["CAD", "图纸", "制图", "工程图", "公差", "solidworks", "建模"],
  research: ["研究", "论文", "文献", "调研", "学术", "投稿"],
};

const DOMAIN_LOSS_BASELINE = {
  insurance: 0.92, tax: 0.9, legal: 0.88, finance: 0.85, compliance: 0.8,
  bidding: 0.78, contract: 0.82, patent: 0.72, hr: 0.6, marketing: 0.55,
  productivity: 0.5, content: 0.45, design: 0.4, coding: 0.55, cad: 0.6,
  research: 0.55, other: 0.5,
};

const DOMAIN_DEMAND_PRIOR = {
  insurance: 0.95, tax: 0.95, legal: 0.9, bidding: 0.88, finance: 0.85,
  compliance: 0.82, patent: 0.72, research: 0.7, cad: 0.68, hr: 0.65,
  marketing: 0.6, coding: 0.6, productivity: 0.55, content: 0.5, music: 0.5,
  design: 0.45, contract: 0.85, other: 0.5,
};

const DOMAIN_FREQ_PRIOR = {
  tax: 0.95, compliance: 0.85, finance: 0.75, hr: 0.75, bidding: 0.7,
  content: 0.7, marketing: 0.6, insurance: 0.6, productivity: 0.6, music: 0.55,
  legal: 0.5, design: 0.5, coding: 0.55, cad: 0.45, patent: 0.4, research: 0.35,
  contract: 0.55, other: 0.5,
};

const PENALTY_DEFS = [
  { id: "P1", title: "文档重复率高", target: "Q", delta: -5, trigger: "duplicateRatio > 0.30" },
  { id: "P2", title: "缺免责声明", target: "Q", delta: -4, trigger: "noDisclaimer && professionalDomain" },
  { id: "P3", title: "绝对化违规承诺", target: "Q", delta: -8, trigger: "absoluteClaims > 0" },
  { id: "P4", title: "与兄弟包功能重叠", target: "V", delta: -6, trigger: "siblingSimilarity > 0.75" },
  { id: "P5", title: "体积冗余", target: "Q", delta: -3, trigger: "sizeBytes > 2MB || textChars > 300000" },
  { id: "P6", title: "存在未完成占位", target: "Q", delta: -4, trigger: "placeholders > 0" },
];

const PROFESSIONAL_DOMAINS = new Set(["insurance", "tax", "legal", "contract", "finance", "compliance", "bidding", "patent", "hr"]);

const WORD_LISTS = {
  loss: ["拒赔", "罚款", "滞纳金", "违约", "纠纷", "诉讼", "损失", "赔偿", "处罚", "废标", "驳回", "逾期", "返工", "多缴", "少缴", "亏损", "风险", "错过", "失效"],
  event: ["截止", "到期", "汇算", "申报", "续保", "年检", "审计", "评审", "备案", "答辩", "晋升", "离职", "签约", "交付", "窗口期", "截止日"],
  freq: ["每月", "每年", "每周", "每季", "季度", "周期", "定期", "年报", "汇算", "续期", "复检", "复盘", "例行", "年度"],
  decision: ["是否", "要不要", "值不值", "该不该", "选哪个", "怎么选", "对比", "决策", "判断", "评估", "能不能"],
  search: ["怎么", "如何", "多少钱", "有哪些", "是什么", "能不能", "可不可以", "步骤", "模板", "清单", "案例"],
  generic: ["全能", "万能", "任何", "所有", "全部", "一键", "神器", "大师", "全领域", "各行各业", "无所不能", "包你", "随便问"],
  disclaimer: ["免责声明", "免责", "不构成专业意见", "不构成投资建议", "仅供参考", "以官方为准", "以实际为准", "建议咨询", "咨询专业人士", "不承担任何责任"],
  boundary: ["不适用", "不负责", "超出范围", "无法处理", "拒绝", "转介", "待复核", "人工复核", "不涉及", "仅限", "不代表"],
  absolute: ["保本", "稳赚", "零风险", "无风险", "包过", "必过", "百分百", "确保收益", "保证收益", "绝对", "避税", "一定能", "肯定能", "稳过", "万无一失"],
  placeholder: ["TODO", "TBD", "FIXME", "XXX", "占位", "未完成", "fillme"],
  periodic: ["每月", "每年", "每周", "每季", "季度", "周期", "定期", "续", "复检", "例行", "年度", "日历"],
  oneTime: ["一次性", "单次", "首次", "偶尔"],
  template: ["模板", "骨架", "清单", "表格", "输出格式", "报告结构", "交付物", "可复制", "示例", "话术"],
  delivery: ["交付", "验收", "输出", "报告", "生成", "导出", "文件", "结果"],
  formula: ["公式", "计算", "算法", "评分", "折算", "系数", "百分比", "阈值", "测算"],
  citation: ["法条", "标准", "规范", "依据", "来源", "文号", "条款", "政策", "官方", "GB/T", "GB"],
  compliance: ["合规", "监管", "资质", "备案", "许可", "红线", "审计", "风控", "等保", "隐私"],
  input: ["必填", "请提供", "需要你", "请补充", "信息不全", "缺失", "示例", "假设", "先给", "先按", "分批"],
  case: ["案例", "示例", "样例", "场景", "话术", "复盘"],
};

const REF_PREFIXES = [
  "rules/", "_opc_law/", "references/", "scripts/", "samples/", "assets/", "docs/",
  "workbuddy-skills/", "_factory/", "opc-suite/", "avatars/", "agents/", "skills/", "templates/",
];

const SECRET_RULES = [
  { id: "openai-key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { id: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { id: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { id: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { id: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/ },
  { id: "assigned-secret", re: /\b(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|password|passwd)\b\s*[:=]\s*["'][^"'\s]{12,}["']/i },
];

const DANGER_RULES = [
  { label: "rm -rf 根目录", re: /\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+\/(?:\s|$|\*)/i },
  { label: "格式化磁盘", re: /\bformat\s+[a-z]:/i },
  { label: "改注册表", re: /\breg\s+(?:delete|add)\s+/i },
  { label: "关机/重启命令", re: /\b(?:shutdown|reboot)\b/i },
  { label: "bcdedit 启动项", re: /\bbcdedit\b/i },
  { label: "net user 加账号", re: /\bnet\s+user\s+\S+\s+(?:\S+\s+)?\/add/i },
  { label: "takeown 提权", re: /\btakeown\s+\//i },
  { label: "diskpart 分区", re: /\bdiskpart\b/i },
  { label: "递归删用户目录", re: /(?:rm\s+-rf|Remove-Item[^\n]*-Recurse)[^\n]*(?:C:\\Users|\\Users\\|\/home\/)/i },
  { label: "del /f /s /q", re: /\bdel\s+\/[fsq]/i },
  { label: "读取浏览器凭据", re: /\b(?:Login Data|Cookies\.sqlite|key3\.db|key4\.db|Web Data)\b/i },
  { label: "chmod 777 /", re: /chmod\s+777\s+\//i },
  { label: "curl 管道执行", re: /\bcurl\b[^|\n]*\|\s*(?:ba)?sh\b/i },
];

const EXFIL_RULES = [
  { label: "代码上传到外部（含文件/数据字段）", re: /\b(?:requests\.post|requests\.put|urllib\.request\.urlopen|http\.client|axios\.(?:post|put)|fetch)\s*\([^\n]{0,200}?(?:files\s*=|multipart|upload|data\s*=|json\s*=)/i, needsUrl: true },
  { label: "已知外传服务域名", re: /(?:pastebin\.com|transfer\.sh|requestbin|webhook\.site|ngrok\.io|discord\.com\/api\/webhooks|open\.feishu\.cn\/open-apis\/bot\/v2\/hook)/i, needsUrl: false },
];

const CATEGORY_IDS = new Set([
  "01-ProductDesign", "02-Engineering", "03-GameSpatial", "04-DataAI",
  "05-MarketingGrowth", "06-ContentCreative", "07-SalesCommerce",
  "08-FinanceInvestment", "09-OperationsHR", "10-ProjectQuality",
  "11-SecurityCompliance", "12-IndustryConsultant",
]);

const KEBAB = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const DISPLAY_NAME_OK = /^[A-Za-z0-9\u4e00-\u9fff\-—]+$/;

const EXPERT_REQUIRED_FIELDS = [
  "name", "version", "description", "expertType", "agentName", "agents", "skills",
  "displayName", "profession", "displayDescription", "avatar", "categoryId", "plugin",
  "tags", "defaultInitPrompt", "quickPrompts",
];

/* ================================================================== */
/* 二、基础工具                                                        */
/* ================================================================== */

let spawnCounter = 0;

/**
 * 用临时文件接 stdout/stderr 的 spawn（沙箱里匿名管道会 EPERM，但文件 stdio 可用）。
 * 返回 { status, error, text }。
 */
function spawnCapture(command, args, timeoutMs) {
  spawnCounter += 1;
  const outFile = path.join(os.tmpdir(), `dsh-sa-spawn-${process.pid}-${spawnCounter}.log`);
  let fd = -1;
  try {
    fd = fs.openSync(outFile, "w");
  } catch {
    fd = -1;
  }
  let result;
  try {
    result = spawnSync(command, args, {
      stdio: fd >= 0 ? ["ignore", fd, fd] : "ignore",
      timeout: timeoutMs,
      windowsHide: true,
    });
  } finally {
    if (fd >= 0) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
  let text = "";
  try {
    text = fs.readFileSync(outFile, "utf8");
  } catch {
    text = "";
  }
  try {
    fs.unlinkSync(outFile);
  } catch {
    /* ignore */
  }
  return { status: result.status, error: result.error, text };
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round1 = (value) => Math.round(value * 10) / 10;

function countWords(text, words) {
  const detail = [];
  let count = 0;
  for (const word of words) {
    let hits = 0;
    let from = 0;
    for (;;) {
      const index = text.indexOf(word, from);
      if (index < 0) break;
      hits += 1;
      from = index + word.length;
    }
    if (hits > 0) {
      count += hits;
      detail.push(`${word}×${hits}`);
    }
  }
  return { count, detail };
}

/** 绝对化承诺：跳过「不承诺保本」「禁止保证收益」这类否定/免责/反例/审计语境。 */
function findAbsoluteClaims(text) {
  const hits = [];
  for (const word of WORD_LISTS.absolute) {
    let from = 0;
    for (;;) {
      const index = text.indexOf(word, from);
      if (index < 0) break;
      from = index + word.length;
      const currentStart = text.lastIndexOf("\n", index) + 1;
      let currentEnd = text.indexOf("\n", index);
      if (currentEnd < 0) currentEnd = text.length;
      const parts = [];
      // 往前最多取 15 行（覆盖「## 常见违规点 / 词表」标题 + 空行 + 多条列表项）
      let cursor = currentStart;
      const beforeParts = [];
      for (let i = 0; i < 15 && cursor > 0; i++) {
        const end = cursor > 0 ? cursor - 1 : 0;
        const start = text.lastIndexOf("\n", end - 1) + 1;
        beforeParts.unshift(text.slice(start, end));
        cursor = start;
      }
      parts.push(...beforeParts);
      parts.push(text.slice(currentStart, currentEnd));
      // 往后最多取 3 行
      let cursorNext = currentEnd < text.length ? currentEnd + 1 : -1;
      for (let i = 0; i < 3 && cursorNext >= 0 && cursorNext < text.length; i++) {
        const end = text.indexOf("\n", cursorNext);
        parts.push(text.slice(cursorNext, end < 0 ? text.length : end));
        cursorNext = end < 0 ? -1 : end + 1;
      }
      const context = parts.join("\n");
      // 合规/审计类文档会「讨论」违规词（常见违规点、词表、反例、广告法引用），不算承诺
      if (/不承诺|禁止|不得|杜绝|避免|严禁|红线|违规|反面|不要|不谈|话术|常见|承诺词|绝对化|广告法|反例|错误|禁用|词表|清单|审查|扫描/.test(context)) continue;
      const line = text.slice(currentStart, currentEnd);
      const before = text.slice(Math.max(0, index - 14), index);
      if (/[不无勿免禁]|避免|禁止/.test(before)) continue;
      hits.push({ word, snippet: line.trim().slice(0, 80) });
    }
  }
  return hits;
}

function countPlaceholders(text) {
  const hits = [];
  for (const word of WORD_LISTS.placeholder) {
    const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const matches = text.match(re);
    if (matches) hits.push(`${word}×${matches.length}`);
  }
  // 「待补」只有在明显占位语境才计数（很多技能把「待补」当补数据标记，是设计而非未完成）
  const gapMarkers = text.match(/(?:^|\n)\s*(?:[-*]\s*)?(?:待补|补全|TBD)\s*[:：]/gm);
  if (gapMarkers) hits.push(`待补占位×${gapMarkers.length}`);
  return hits;
}

function textStats(text) {
  const tables = (text.match(/^\s*\|?\s*:?-{3,}:?\s*\|/gm) || []).length;
  const codeFences = Math.floor(((text.match(/^```/gm) || []).length) / 2);
  const headings = (text.match(/^#{1,6}\s+/gm) || []).length;
  const numberedSteps = (text.match(/^\s*(?:\d+[.、)]|步骤\s*\d+|第[一二三四五六七八九十\d]+步)/gm) || []).length;
  const listItems = (text.match(/^\s*[-*+]\s+/gm) || []).length;
  return { tables, codeFences, headings, numberedSteps, listItems };
}

function cjkTokens(text) {
  const tokens = new Set();
  const runs = String(text).match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i++) tokens.add(run.slice(i, i + 2));
  }
  const ascii = String(text).toLowerCase().match(/[a-z]{3,}/g) || [];
  for (const word of ascii) tokens.add(word);
  return tokens;
}

function coverageRatio(examples, description) {
  const descTokens = cjkTokens(description);
  let total = 0;
  let covered = 0;
  for (const example of examples) {
    for (const token of cjkTokens(example)) {
      total += 1;
      if (descTokens.has(token)) covered += 1;
    }
  }
  return total === 0 ? 0 : covered / total;
}

function uniqueCharsRatio(values) {
  const firsts = new Set();
  for (const value of values) {
    const chars = String(value).replace(/\s+/g, "");
    if (chars) firsts.add(chars.slice(0, 2));
  }
  return values.length === 0 ? 0 : firsts.size / values.length;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\r?\n|\s*[;；|]\s*/)
      .map((item) => item.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
  }
  return [];
}

function asText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(asText).join(" ");
  if (typeof value === "object") return Object.values(value).map(asText).join(" ");
  return String(value);
}

function levelScore(max, level) {
  return round1((max * clamp(level, 0, 4)) / 4);
}

function detectDomain(text) {
  const counts = [];
  for (const [domain, words] of Object.entries(DOMAIN_KEYWORDS)) {
    const found = countWords(text, words);
    if (found.count > 0) counts.push({ domain, count: found.count, words: found.detail });
  }
  counts.sort((left, right) => right.count - left.count || left.domain.localeCompare(right.domain));
  if (counts.length === 0) return { domain: "other", evidence: ["未命中领域关键词，按 other 处理"] };
  const top = counts[0];
  return {
    domain: top.domain,
    evidence: [`领域关键词命中：${top.domain}（${top.words.join("、")}）`],
  };
}

function duplicateLineRatio(docs) {
  const counts = new Map();
  let total = 0;
  for (const doc of docs) {
    for (const line of doc.text.split(/\r?\n/)) {
      const value = line.trim();
      if (value.length < 30) continue;
      if (value.startsWith("#") || value.startsWith("|")) continue;
      total += 1;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  if (total === 0) return 0;
  let duplicated = 0;
  for (const [value, count] of counts) {
    if (count > 1) duplicated += count - 1;
  }
  return duplicated / total;
}

function findPython() {
  const candidates = [process.env.PYTHON, process.env.PYTHON_EXE, "python", "python3", "E:\\python313\\python.exe"].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnCapture(candidate, ["-c", "import ast; print('ok')"], 5000);
    if (!result.error && result.status === 0) return candidate;
  }
  return "";
}

/* ================================================================== */
/* 三、分析上下文                                                      */
/* ================================================================== */

function buildContext(view, options = {}) {
  const markdownFiles = listMarkdown(view);
  const docs = markdownFiles.map((rel) => {
    const text = view.readText(rel);
    return { rel, text, fm: parseYamlFrontmatter(text) };
  });
  const textFiles = [];
  for (const rel of listTextFiles(view)) {
    if (rel.endsWith(".py") || rel.endsWith(".js") || rel.endsWith(".mjs") || rel.endsWith(".cjs")) continue;
    const text = view.readText(rel);
    if (text) textFiles.push({ rel, text });
  }
  const authorityText = docs.map((doc) => doc.text).join("\n");
  const fullText = authorityText + "\n" + textFiles.map((file) => file.text).join("\n");
  const packageName = stripVersionSuffix(view.topDir || view.name);
  const skillDocs = view.kind === "skill"
    ? docs.filter((doc) => doc.rel === "SKILL.md")
    : docs.filter((doc) => /^skills\/[^/]+\/SKILL\.md$/.test(doc.rel));
  const pluginJsonFile = ".codebuddy-plugin/plugin.json";
  let pluginJson = null;
  if (view.has(pluginJsonFile)) {
    const raw = view.readText(pluginJsonFile);
    try {
      pluginJson = { ok: true, data: JSON.parse(raw), error: "" };
    } catch (error) {
      pluginJson = { ok: false, data: null, error: String(error && error.message ? error.message : error) };
    }
  }
  const rootFm = skillDocs.length && skillDocs[0].rel === "SKILL.md" ? skillDocs[0].fm : null;
  const isPaid = detectPaid(view, rootFm, pluginJson, docs, options);
  const domain = detectDomain(`${view.name}\n${asText(rootFm && rootFm.description)}\n${asText(rootFm && rootFm.description_zh)}\n${authorityText.slice(0, 6000)}`);
  const scriptFiles = listScripts(view);
  const stats = textStats(authorityText);
  const knowledgeChars = docs.reduce((sum, doc) => sum + doc.text.length, 0) +
    textFiles.filter((file) => /\.(?:json|csv|txt|md)$/i.test(file.rel)).reduce((sum, file) => sum + file.text.length, 0);
  const sourcePath = path.resolve(view.inputPath);
  return {
    view,
    options,
    docs,
    textFiles,
    authorityText,
    fullText,
    skillDocs,
    rootFm,
    pluginJson,
    packageName,
    isPaid,
    domain,
    scriptFiles,
    stats,
    knowledgeChars,
    detectEvidence: [],
    inputPath: sourcePath,
  };
}

function detectPaid(view, rootFm, pluginJson, docs, options) {
  if (options.paid === true) return true;
  if (options.paid === false) return false;
  const legalNames = ["license-use.md", "notice.md", "privacy.md", "security.md", "changelog.md"];
  if (view.files.some((rel) => legalNames.includes(path.basename(rel).toLowerCase()))) return true;
  if (rootFm && (rootFm.price !== undefined || rootFm.paid === true || String(rootFm.paid) === "true")) return true;
  if (pluginJson && pluginJson.ok && pluginJson.data && (pluginJson.data.price !== undefined || pluginJson.data.paid === true)) return true;
  const text = docs.map((doc) => doc.text).join("\n");
  return /定价|售价|价格|付费|购买|订阅/.test(text) && /¥\s*\d|￥\s*\d|元\/月|元\/年/.test(text);
}

/* ================================================================== */
/* 四、门禁检查                                                        */
/* ================================================================== */

function gateResult(id, status, detail, evidence = []) {
  const def = GATE_BY_ID[id];
  return {
    id,
    title: def.title,
    severity: def.severity,
    when: def.when,
    fatal: Boolean(def.fatal),
    status,
    detail,
    fix: def.fix,
    evidence,
  };
}

function issueStatus(severity) {
  return severity === "blocker" ? "fail" : "warn";
}

function evaluateGates(ctx) {
  const checks = [];
  const add = (...args) => checks.push(gateResult(...args));

  addG01(ctx, add);
  addG02(ctx, add);
  addG03(ctx, add);
  addG04(ctx, add);
  addG05(ctx, add);
  addG06(ctx, add);
  addG07(ctx, add);
  addG08(ctx, add);
  addG09(ctx, add);
  addG10(ctx, add);
  addG11(ctx, add);
  addG12(ctx, add);
  addG13(ctx, add);
  addG14(ctx, add);
  addG15(ctx, add);
  addG16(ctx, add);
  addG17(ctx, add);
  addG18(ctx, add);
  addG19(ctx, add);
  if (ctx.view.kind === "expert") {
    addE01(ctx, add);
    addE02(ctx, add);
    addE03(ctx, add);
    addE04(ctx, add);
    addE05(ctx, add);
    addE06(ctx, add);
  } else {
    for (const id of ["E01", "E02", "E03", "E04", "E05", "E06"]) {
      add(id, "skip", "技能包不适用（专家包专属检查）", []);
    }
  }
  const blockerCount = checks.filter((check) => check.status === "fail" && check.severity === "blocker").length;
  const majorCount = checks.filter((check) => check.status === "warn" && check.severity === "major").length;
  const minorCount = checks.filter((check) => check.status === "warn" && check.severity === "minor").length;
  return {
    checks,
    blockerCount,
    majorCount,
    minorCount,
    pass: blockerCount === 0,
    verdict: blockerCount === 0 ? "可上架（blocker 已清零）" : `先修 ${blockerCount} 个 blocker 再上架`,
    fatalIds: checks.filter((check) => check.status === "fail" && check.fatal).map((check) => check.id),
  };
}

function addG01(ctx, add) {
  const view = ctx.view;
  if (view.kind === "skill") {
    const issues = [];
    if (view.source === "zip" && view.topDirStripped) issues.push(`ZIP 有顶层目录「${view.topDir}」，SKILL.md 不在 ZIP 根`);
    if (!view.has("SKILL.md")) issues.push("SKILL.md 不在包根");
    const tooDeep = view.files.filter((rel) => rel.split("/").length - 1 > 2);
    if (tooDeep.length) issues.push(`存在三级以上目录（${tooDeep.slice(0, 3).join("、")}），平台要求最多两级`);
    if (view.junkFiles.length) issues.push(`含垃圾文件：${view.junkFiles.slice(0, 5).join("、")}`);
    if (issues.length) add("G01", issueStatus("blocker"), issues.join("；"), issues);
    else add("G01", "pass", "平铺结构：SKILL.md 在根、层级≤2、无垃圾文件", [`文件数 ${view.fileCount}`]);
  } else {
    const issues = [];
    if (view.source === "zip") {
      if (!view.topDir) issues.push("专家包 ZIP 缺少顶层目录（要求顶层目录 = 包名）");
      else if (view.topDir !== ctx.packageName) issues.push(`专家包 ZIP 顶层目录「${view.topDir}」≠ 包名「${ctx.packageName}」`);
    }
    if (view.junkFiles.length) issues.push(`含垃圾文件：${view.junkFiles.slice(0, 5).join("、")}`);
    if (issues.length) add("G01", issueStatus("blocker"), issues.join("；"), issues);
    else add("G01", "pass", "专家包结构正确（顶层目录 = 包名，无垃圾文件）", [`文件数 ${view.fileCount}`]);
  }
}

function addG02(ctx, add) {
  if (ctx.view.kind === "skill") {
    const fm = ctx.rootFm;
    if (!fm || !fm.hasFrontmatter) {
      add("G02", "fail", "SKILL.md 缺少 YAML frontmatter", ["SKILL.md"]);
      return;
    }
    if (!fm.ok) {
      add("G02", "fail", `frontmatter 无法解析：${fm.reason}`, fm.errors.slice(0, 3));
      return;
    }
    const missing = ["name", "description", "version"].filter((key) => !asText(fm.data[key]).trim());
    if (missing.length) add("G02", "fail", `frontmatter 缺必填字段：${missing.join("、")}`, missing.map((key) => `缺 ${key}`));
    else add("G02", "pass", "frontmatter 必填字段齐全（name/description/version）", ["SKILL.md"]);
    return;
  }
  if (ctx.skillDocs.length === 0) {
    add("G02", "fail", "专家包 skills/ 下没有内嵌技能（缺 SKILL.md）", ["skills/"]);
    return;
  }
  const issues = [];
  for (const doc of ctx.skillDocs) {
    if (!doc.fm || !doc.fm.hasFrontmatter) issues.push(`${doc.rel} 缺 frontmatter`);
    else if (!doc.fm.ok) issues.push(`${doc.rel} frontmatter 无法解析`);
    else {
      const missing = ["name", "description"].filter((key) => !asText(doc.fm.data[key]).trim());
      if (missing.length) issues.push(`${doc.rel} 缺 ${missing.join("/")}`);
    }
  }
  if (issues.length) add("G02", issueStatus("blocker"), issues.slice(0, 5).join("；"), issues);
  else add("G02", "pass", `专家包内嵌技能 frontmatter 齐全（${ctx.skillDocs.length} 个）`, ctx.skillDocs.map((doc) => doc.rel));
}

function addG03(ctx, add) {
  if (ctx.view.kind !== "skill") {
    add("G03", "skip", "专家包 name 由 E01 校验", []);
    return;
  }
  if (!ctx.rootFm || !ctx.rootFm.ok) {
    add("G03", "skip", "没有可用的 skill frontmatter，跳过", []);
    return;
  }
  const name = asText(ctx.rootFm.data.name).trim();
  const issues = [];
  if (!name) issues.push("frontmatter 缺 name");
  else {
    if (!KEBAB.test(name)) issues.push(`name「${name}」不是 kebab-case（小写连字符）`);
    if (name !== ctx.packageName) issues.push(`name「${name}」≠ 包名「${ctx.packageName}」`);
  }
  if (issues.length) add("G03", issueStatus("major"), issues.join("；"), issues);
  else add("G03", "pass", `name 与包名一致且为 kebab-case（${name}）`, []);
}

function addG04(ctx, add) {
  if (ctx.view.kind !== "skill") {
    add("G04", "skip", "专家包展示名由 E01 校验（displayName.zh）", []);
    return;
  }
  if (!ctx.rootFm || !ctx.rootFm.ok) {
    add("G04", "skip", "没有可用 frontmatter，跳过", []);
    return;
  }
  const display = asText(ctx.rootFm.data.display_name || ctx.rootFm.data.display_name_zh).trim();
  if (!display) {
    add("G04", "skip", "未提供 display_name（由 G10 检查双语字段）", []);
    return;
  }
  const issues = [];
  if (display.length > 15) issues.push(`展示名 ${display.length} 字（上限 15）`);
  if (!DISPLAY_NAME_OK.test(display)) issues.push("展示名含括号/空格/特殊字符");
  if (issues.length) add("G04", issueStatus("blocker"), `${issues.join("；")}：${display}`, issues);
  else add("G04", "pass", `展示名合规（${display}，${display.length} 字）`, []);
}

function addG05(ctx, add) {
  const view = ctx.view;
  const targets = ctx.docs.filter((doc) => {
    if (ctx.view.kind === "skill") return doc.rel === "SKILL.md" || /^references\/.*\.md$/i.test(doc.rel) || /^rules\/.*\.md$/i.test(doc.rel);
    return /^agents\/.*\.md$/i.test(doc.rel) || /^rules\/.*\.md$/i.test(doc.rel) || /^skills\/[^/]+\/SKILL\.md$/.test(doc.rel) || /^skills\/[^/]+\/references\/.*\.md$/i.test(doc.rel);
  });
  const tokenRe = /`([^`\n]+?\.(?:md|json|txt|csv|py|html|ics|docx|xlsx|yaml|yml|ps1|sh))`/g;
  const missing = [];
  const wildcards = [];
  let checked = 0;
  for (const doc of targets) {
    const docDir = doc.rel.includes("/") ? doc.rel.slice(0, doc.rel.lastIndexOf("/")) : "";
    const skillMatch = doc.rel.match(/^(skills\/[^/]+)\//);
    const skillRoot = skillMatch ? skillMatch[1] : "";
    tokenRe.lastIndex = 0;
    let match;
    while ((match = tokenRe.exec(doc.text)) !== null) {
      const token = match[1].trim();
      if (!token || token.includes(" ") || token.startsWith("http") || token.includes("<") || token.includes(">")) continue;
      const startsKnown = REF_PREFIXES.some((prefix) => token.startsWith(prefix)) || token.startsWith("./");
      if (!token.includes("/") && !startsKnown) continue;
      if (!startsKnown && !token.includes("/")) continue;
      if (token.startsWith("/")) continue; // 绝对路径不是包内资源
      checked += 1;
      if (token.includes("*")) {
        wildcards.push(`${doc.rel}: ${token}`);
        continue;
      }
      const clean = token.replace(/^\.\//, "");
      const candidates = [clean];
      if (docDir) candidates.push(`${docDir}/${clean}`);
      if (skillRoot) candidates.push(`${skillRoot}/${clean}`);
      if (!candidates.some((candidate) => view.has(candidate))) {
        missing.push(`${doc.rel} → ${token}`);
      }
    }
  }
  const issues = [...wildcards, ...missing];
  if (issues.length) {
    add("G05", issueStatus("blocker"), `引用文件缺失/通配符 ${issues.length} 处：${issues.slice(0, 5).join("；")}`, issues.slice(0, 12));
  } else {
    add("G05", "pass", `文档引用的本地文件都存在（检查 ${checked} 处）`, [`检查 ${targets.length} 个文档`]);
  }
}

function addG06(ctx, add) {
  const hits = [];
  const files = ctx.textFiles.slice(0, 160);
  for (const file of files) {
    for (const rule of SECRET_RULES) {
      if (rule.re.test(file.text)) hits.push(`${file.rel}（${rule.id}）`);
    }
  }
  if (hits.length) add("G06", "fail", `疑似硬编码密钥/令牌 ${hits.length} 处（值已打码）：${hits.slice(0, 5).join("、")}`, hits.slice(0, 12));
  else add("G06", "pass", `扫描 ${files.length} 个文本文件，未发现硬编码密钥/令牌`, []);
}

function addG07(ctx, add) {
  const issues = [];
  for (const doc of ctx.docs) {
    if (!doc.fm || !doc.fm.hasFrontmatter) continue;
    if (!doc.fm.ok) {
      issues.push(`${doc.rel}: ${doc.fm.errors.slice(0, 2).join("；")}`);
    }
  }
  if (issues.length) add("G07", issueStatus("blocker"), `YAML frontmatter 解析错误 ${issues.length} 处：${issues.slice(0, 4).join("；")}`, issues.slice(0, 10));
  else {
    const checked = ctx.docs.filter((doc) => doc.fm && doc.fm.hasFrontmatter).length;
    add("G07", "pass", `${checked} 个 frontmatter 均可解析（含 ': ' 引号陷阱检查）`, []);
  }
}

function addG08(ctx, add) {
  if (!ctx.isPaid) {
    add("G08", "skip", "未检测到付费标记（可用 --paid 强制检查）；免费包不强制法律文件", []);
    return;
  }
  const legal = ["license-use.md", "notice.md", "privacy.md", "security.md", "changelog.md"];
  const present = new Set(ctx.view.files.map((rel) => path.basename(rel).toLowerCase()));
  const missing = legal.filter((name) => !present.has(name));
  const hasDisclaimer = WORD_LISTS.disclaimer.some((word) => ctx.authorityText.includes(word));
  if (!hasDisclaimer) missing.push("免责声明（正文中未找到）");
  if (missing.length) add("G08", issueStatus("blocker"), `付费包法律文件缺失：${missing.join("、")}`, missing);
  else add("G08", "pass", `付费包法律文件齐全（5 个文件 + 免责声明），付费判定依据：${ctx.isPaid ? "包内法律文件/价格字段" : "手动 --paid"}`, []);
}

function findIconCandidates(view) {
  const pngs = view.files.filter((rel) => /\.png$/i.test(rel));
  const preferred = pngs.filter((rel) => /(?:^|\/)(?:icon|logo|avatar)s?\.png$/i.test(rel) || /(?:^|\/)(?:icon|logo)s?[^/]*\.png$/i.test(rel));
  return (preferred.length ? preferred : pngs).sort();
}

function addG09(ctx, add) {
  if (ctx.view.kind !== "skill") {
    add("G09", "skip", "专家包图标由 E02（avatar）校验", []);
    return;
  }
  const candidates = findIconCandidates(ctx.view);
  if (candidates.length === 0) {
    add("G09", "warn", "包内未找到 PNG 图标（技能图标要在发布页单独上传，包内只是素材）", []);
    return;
  }
  const rel = candidates[0];
  const info = readPngInfoBuffer(ctx.view.readBytes(rel) || Buffer.alloc(0));
  if (!info) {
    add("G09", "warn", `${rel} 不是合法 PNG`, [rel]);
    return;
  }
  const issues = [];
  if (info.width !== 512 || info.height !== 512) issues.push(`尺寸 ${info.width}×${info.height}（要求 512×512）`);
  if (info.bytes > 500 * 1024) issues.push(`体积 ${(info.bytes / 1024).toFixed(1)} KB（上限 500 KB）`);
  if (issues.length) add("G09", issueStatus("minor"), `${rel}：${issues.join("；")}`, issues);
  else add("G09", "pass", `图标规格合规（${rel}，512×512，${(info.bytes / 1024).toFixed(1)} KB）`, [rel]);
}

function addG10(ctx, add) {
  if (ctx.view.kind !== "skill") {
    add("G10", "skip", "专家包双语字段由 E01 校验", []);
    return;
  }
  if (!ctx.rootFm || !ctx.rootFm.ok) {
    add("G10", "skip", "没有可用 frontmatter，跳过", []);
    return;
  }
  const data = ctx.rootFm.data;
  const missing = [];
  if (!asText(data.description_en).trim()) missing.push("description_en");
  if (!asText(data.display_name_en).trim()) missing.push("display_name_en");
  if (toArray(data.examples_en).length === 0) missing.push("examples_en");
  if (missing.length) add("G10", issueStatus("major"), `中英双语字段缺失：${missing.join("、")}`, missing);
  else add("G10", "pass", "中英双语字段齐全（description_en / display_name_en / examples_en）", []);
}

function addG11(ctx, add) {
  const scripts = ctx.scriptFiles;
  if (scripts.length === 0) {
    add("G11", "skip", "包内没有脚本（纯文档包），跳过语法检查", []);
    return;
  }
  if (ctx.options && ctx.options.skipScripts) {
    add("G11", "skip", `已按 --skip-scripts 跳过脚本语法检查（包内 ${scripts.length} 个脚本）`, []);
    return;
  }
  const jsScripts = scripts.filter((rel) => /\.(?:js|mjs|cjs)$/i.test(rel));
  const pyScripts = scripts.filter((rel) => /\.py$/i.test(rel));
  const failures = [];
  const notes = [];
  let checked = 0;
  const materialized = materializeScripts(ctx.view);
  try {
    for (const rel of jsScripts.slice(0, 80)) {
      const file = path.join(materialized.dir, rel);
      if (!fs.existsSync(file)) continue;
      const result = spawnCapture(process.execPath, ["--check", file], 5000);
      checked += 1;
      if (result.error) {
        notes.push(`${rel}: node --check 无法执行（${result.error.code || result.error.message}）`);
      } else if (result.status !== 0) {
        const message = String(result.text || "").split("\n").filter((line) => line.trim()).slice(0, 2).join(" ");
        failures.push(`${rel}: ${message || `node --check 退出码 ${result.status}`}`);
      }
    }
    if (pyScripts.length) {
      const python = findPython();
      if (!python) {
        notes.push(`未找到可用的 Python 解释器，跳过 ${pyScripts.length} 个 .py 的 ast 语法校验`);
      } else {
        const files = pyScripts.slice(0, 60).map((rel) => path.join(materialized.dir, rel)).filter((file) => fs.existsSync(file));
        const code = [
          "import ast, sys",
          "failed = []",
          "for path in sys.argv[1:]:",
          "    try:",
          "        ast.parse(open(path, encoding='utf-8').read(), path)",
          "    except Exception as exc:",
          "        failed.append(path + ': ' + str(exc)[:160])",
          "print('\\n'.join(failed))",
          "sys.exit(1 if failed else 0)",
        ].join("\n");
        const result = spawnCapture(python, ["-c", code, ...files], 20000);
        checked += files.length;
        if (result.error) notes.push(`Python ast 校验无法执行（${result.error.code || result.error.message}）`);
        else if (result.status !== 0) {
          for (const line of String(result.text || "").split("\n").filter(Boolean).slice(0, 8)) {
            failures.push(line.trim());
          }
        }
      }
    }
  } finally {
    materialized.cleanup();
  }
  const selfcheck = ctx.view.files.filter((rel) => /selfcheck/i.test(rel));
  const selfcheckNote = selfcheck.length ? `发现 selfcheck：${selfcheck[0]}（未执行，仅静态检查）` : "未发现 selfcheck 脚本";
  if (failures.length) {
    add("G11", "fail", `脚本语法错误 ${failures.length} 处：${failures.slice(0, 3).join("；")}`, [...failures.slice(0, 8), selfcheckNote]);
  } else if (notes.length) {
    add("G11", "warn", `脚本语法检查不完整（静态近似）：${notes.slice(0, 2).join("；")}`, [...notes, selfcheckNote]);
  } else {
    add("G11", "pass", `脚本语法检查通过（${checked} 个文件：node --check / Python ast.parse）；${selfcheckNote}`, [selfcheckNote]);
  }
}

function addG12(ctx, add) {
  const hits = [];
  for (const file of ctx.textFiles.slice(0, 200)) {
    for (const rule of DANGER_RULES) {
      if (rule.re.test(file.text)) hits.push(`${file.rel}（${rule.label}）`);
    }
  }
  if (hits.length) add("G12", "fail", `发现危险/越权命令 ${hits.length} 处：${hits.slice(0, 5).join("；")}`, hits.slice(0, 10));
  else add("G12", "pass", "未发现危险/越权命令（rm -rf / 注册表 / 浏览器凭据等）", []);
}

function addG13(ctx, add) {
  const claims = findAbsoluteClaims(ctx.authorityText);
  if (claims.length) {
    add("G13", issueStatus("major"), `绝对化违规承诺 ${claims.length} 处：${claims.slice(0, 5).map((hit) => `${hit.word}「${hit.snippet}」`).join("；")}`, claims.slice(0, 10).map((hit) => hit.snippet));
  } else {
    add("G13", "pass", "未发现绝对化违规承诺（保本/稳赚/零风险/包过/避税等）", []);
  }
}

function addG14(ctx, add) {
  const hits = countPlaceholders(ctx.authorityText);
  if (hits.length) add("G14", issueStatus("major"), `发现未完成占位 ${hits.length} 类：${hits.slice(0, 6).join("、")}`, hits);
  else add("G14", "pass", "未发现未完成占位符", []);
}

function addG15(ctx, add) {
  const bom = [];
  const invalid = [];
  const files = ctx.textFiles.slice(0, 200);
  for (const file of files) {
    const bytes = ctx.view.readBytes(file.rel) || Buffer.alloc(0);
    if (utf8BomLength(bytes) > 0) bom.push(file.rel);
    else if (!isUtf8(bytes)) invalid.push(file.rel);
  }
  const issues = [...bom.map((rel) => `${rel}（BOM）`), ...invalid.map((rel) => `${rel}（非 UTF-8）`)];
  if (issues.length) add("G15", issueStatus("minor"), `编码问题 ${issues.length} 处：${issues.slice(0, 5).join("；")}`, issues.slice(0, 10));
  else add("G15", "pass", `扫描 ${files.length} 个文本文件，均为 UTF-8 无 BOM`, []);
}

function addG16(ctx, add) {
  const hits = [];
  for (const file of ctx.textFiles.slice(0, 200)) {
    for (const rule of EXFIL_RULES) {
      if (!rule.re.test(file.text)) continue;
      if (rule.needsUrl && !/https?:\/\//i.test(file.text)) continue;
      hits.push(`${file.rel}（${rule.label}）`);
    }
  }
  if (hits.length) add("G16", "fail", `发现疑似外传用户数据的代码 ${hits.length} 处：${hits.slice(0, 5).join("；")}`, hits.slice(0, 10));
  else add("G16", "pass", "未发现上传/回传用户数据的代码", []);
}

function addG17(ctx, add) {
  const limit = ctx.view.kind === "expert" ? 10 * 1024 * 1024 : 3 * 1024 * 1024;
  const bytes = ctx.view.totalBytes;
  if (bytes > limit) {
    add("G17", issueStatus("major"), `包体 ${(bytes / 1024 / 1024).toFixed(2)} MB，超过上限 ${(limit / 1024 / 1024).toFixed(0)} MB`, [`${bytes} bytes`]);
  } else {
    add("G17", "pass", `包体 ${(bytes / 1024).toFixed(1)} KB，在 ${(limit / 1024 / 1024).toFixed(0)} MB 以内`, [`${bytes} bytes`]);
  }
}

function addG18(ctx, add) {
  if (ctx.view.kind === "skill") {
    const author = asText(ctx.rootFm && ctx.rootFm.ok ? ctx.rootFm.data.author : "").trim();
    if (!author) add("G18", issueStatus("major"), "SKILL.md frontmatter 缺 author（官方必填）", ["SKILL.md"]);
    else add("G18", "pass", `frontmatter author：${author}`, []);
    return;
  }
  const author = ctx.pluginJson && ctx.pluginJson.ok ? ctx.pluginJson.data.author : undefined;
  const authorText = typeof author === "object" && author ? asText(author.name) : asText(author);
  if (!authorText.trim()) add("G18", issueStatus("major"), "plugin.json 缺 author（官方必填）", [".codebuddy-plugin/plugin.json"]);
  else add("G18", "pass", `plugin.json author：${authorText}`, []);
}

function addG19(ctx, add) {
  const issues = [];
  const details = [];
  const checkDoc = (doc) => {
    if (!doc.fm || !doc.fm.ok) return;
    for (const key of ["examples_zh", "examples_en"]) {
      if (doc.fm.data[key] === undefined) continue;
      const count = toArray(doc.fm.data[key]).length;
      details.push(`${doc.rel} ${key}=${count}`);
      if (count > 3) issues.push(`${doc.rel} ${key} 有 ${count} 条（上限 3）`);
    }
  };
  if (ctx.view.kind === "skill") {
    if (ctx.rootFm) checkDoc({ rel: "SKILL.md", fm: ctx.rootFm });
  } else {
    for (const doc of ctx.skillDocs) checkDoc(doc);
  }
  if (issues.length) add("G19", "fail", `examples 超过平台上限：${issues.join("；")}`, details);
  else add("G19", "pass", details.length ? `examples 数量合规（${details.join("、")}）` : "未声明 examples（≤3 条要求不触发）", details);
}

function addE01(ctx, add) {
  const pj = ctx.pluginJson;
  if (!pj || !pj.ok) {
    add("E01", "fail", `plugin.json ${pj ? `解析失败：${pj.error}` : "不存在"}`, [".codebuddy-plugin/plugin.json"]);
    return;
  }
  const data = pj.data;
  const issues = [];
  const missing = EXPERT_REQUIRED_FIELDS.filter((key) => data[key] === undefined || data[key] === null || asText(data[key]).trim() === "" || (Array.isArray(data[key]) && data[key].length === 0));
  if (missing.length) issues.push(`缺字段/空：${missing.join("、")}`);
  const name = asText(data.name).trim();
  if (name && !KEBAB.test(name)) issues.push(`name「${name}」不是 kebab-case`);
  if (name && name !== ctx.packageName) issues.push(`name「${name}」≠ 包名「${ctx.packageName}」`);
  if (data.plugin !== undefined && asText(data.plugin).trim() !== name) issues.push("plugin ≠ name");
  if (data.version !== undefined && !SEMVER.test(String(data.version))) issues.push(`version 非 semver：${data.version}`);
  const description = asText(data.description);
  if (description && /[\u4e00-\u9fff]/.test(description)) issues.push("plugin.description 必须英文一句话（含中文）");
  if (description && description.split(".").filter((part) => part.trim()).length > 2) issues.push("plugin.description 建议英文一句话");
  const display = data.displayName && typeof data.displayName === "object" ? data.displayName : {};
  for (const lang of ["zh", "en"]) {
    if (!asText(display[lang]).trim()) issues.push(`displayName.${lang} 为空`);
  }
  const displayZh = asText(display.zh).trim();
  if (displayZh.length > 15) issues.push(`displayName.zh ${displayZh.length} 字（上限 15）`);
  if (displayZh && !DISPLAY_NAME_OK.test(displayZh)) issues.push("displayName.zh 含特殊字符/空格");
  const profession = data.profession && typeof data.profession === "object" ? data.profession : {};
  if (!asText(profession.zh).trim()) issues.push("profession.zh 为空");
  const dd = data.displayDescription && typeof data.displayDescription === "object" ? data.displayDescription : {};
  if (!asText(dd.zh).trim()) issues.push("displayDescription.zh 为空");
  if (!asText(dd.en).trim()) issues.push("displayDescription.en 为空");
  if (!CATEGORY_IDS.has(String(data.categoryId || ""))) issues.push(`categoryId 非法：${data.categoryId}`);
  const avatar = asText(data.avatar).replace(/^\.\//, "");
  if (avatar && !ctx.view.has(avatar)) issues.push(`avatar 不存在：${avatar}`);
  if (Array.isArray(data.agents) && data.agents.length === 0) issues.push("agents 为空");
  if (Array.isArray(data.skills) && data.skills.length === 0) issues.push("skills 为空");
  const init = data.defaultInitPrompt && typeof data.defaultInitPrompt === "object" ? data.defaultInitPrompt : {};
  const quick = Array.isArray(data.quickPrompts) ? data.quickPrompts : [];
  const firstQuick = quick[0] && typeof quick[0] === "object" ? quick[0].zh : asText(quick[0]);
  if (asText(init.zh) && asText(init.zh) !== asText(firstQuick)) issues.push("defaultInitPrompt.zh ≠ quickPrompts[0].zh");
  if (issues.length) add("E01", "fail", `plugin.json 字段问题 ${issues.length} 处：${issues.slice(0, 6).join("；")}`, issues.slice(0, 12));
  else add("E01", "pass", "plugin.json 16 个必填字段齐全且合法", [`${name}@${data.version}`]);
}

function addE02(ctx, add) {
  if (!ctx.pluginJson || !ctx.pluginJson.ok) {
    add("E02", "skip", "plugin.json 不可用，跳过", []);
    return;
  }
  const avatar = asText(ctx.pluginJson.data.avatar).replace(/^\.\//, "");
  if (!avatar) {
    add("E02", "fail", "plugin.json 缺 avatar 路径", []);
    return;
  }
  if (!ctx.view.has(avatar)) {
    add("E02", "fail", `avatar 不存在：${avatar}`, [avatar]);
    return;
  }
  const bytes = ctx.view.readBytes(avatar) || Buffer.alloc(0);
  const info = readPngInfoBuffer(bytes);
  if (!info) {
    add("E02", "fail", `${avatar} 不是合法 PNG`, [avatar]);
    return;
  }
  const issues = [];
  if (info.width !== 512 || info.height !== 512) issues.push(`尺寸 ${info.width}×${info.height}`);
  if (info.bytes > 500 * 1024) issues.push(`体积 ${(info.bytes / 1024).toFixed(1)} KB > 500 KB`);
  if (issues.length) add("E02", "fail", `avatar 不合规：${issues.join("；")}`, issues);
  else add("E02", "pass", `avatar 合规（${avatar}，512×512，${(info.bytes / 1024).toFixed(1)} KB）`, [avatar]);
}

function addE03(ctx, add) {
  if (!ctx.pluginJson || !ctx.pluginJson.ok) {
    add("E03", "skip", "plugin.json 不可用，跳过", []);
    return;
  }
  const data = ctx.pluginJson.data;
  const issues = [];
  const profession = data.profession && typeof data.profession === "object" ? data.profession : {};
  if (!asText(profession.zh).trim()) issues.push("profession.zh 为空");
  const tags = Array.isArray(data.tags) ? data.tags : [];
  if (tags.length !== 3) issues.push(`tags 必须 3 个，当前 ${tags.length}`);
  const quick = Array.isArray(data.quickPrompts) ? data.quickPrompts : [];
  if (quick.length !== 3) issues.push(`quickPrompts 必须 3 个，当前 ${quick.length}`);
  const init = data.defaultInitPrompt && typeof data.defaultInitPrompt === "object" ? data.defaultInitPrompt : {};
  const firstQuick = quick[0] && typeof quick[0] === "object" ? quick[0].zh : asText(quick[0]);
  if (asText(init.zh) && asText(init.zh) !== asText(firstQuick)) issues.push("defaultInitPrompt.zh ≠ quickPrompts[0].zh");
  const notes = ["profession 同类唯一需批量扫描比对，单包扫描只做非空检查"];
  if (issues.length) add("E03", "fail", issues.join("；"), [...issues, ...notes]);
  else add("E03", "pass", "profession 非空、tags=3、quickPrompts=3、defaultInitPrompt 对齐", notes);
}

function addE04(ctx, add) {
  if (!ctx.pluginJson || !ctx.pluginJson.ok) {
    add("E04", "skip", "plugin.json 不可用，跳过", []);
    return;
  }
  const dd = ctx.pluginJson.data.displayDescription && typeof ctx.pluginJson.data.displayDescription === "object"
    ? ctx.pluginJson.data.displayDescription
    : {};
  const zh = asText(dd.zh);
  if (!zh) {
    add("E04", "skip", "displayDescription.zh 为空（E01 已判 fail）", []);
    return;
  }
  if (zh.length < 40 || zh.length > 50) {
    add("E04", issueStatus("major"), `displayDescription.zh ${zh.length} 字，要求 40–50 字`, [`${zh.length} chars`]);
  } else {
    add("E04", "pass", `displayDescription.zh ${zh.length} 字，在 40–50 区间`, [`${zh.length} chars`]);
  }
}

function addE05(ctx, add) {
  if (!ctx.pluginJson || !ctx.pluginJson.ok) {
    add("E05", "skip", "plugin.json 不可用，跳过", []);
    return;
  }
  const data = ctx.pluginJson.data;
  const issues = [];
  const agents = Array.isArray(data.agents) ? data.agents.map((item) => asText(item).replace(/^\.\//, "")) : [];
  const agentName = asText(data.agentName).trim();
  if (agents.length === 0) issues.push("agents 为空");
  if (agentName && !agents.some((rel) => path.basename(rel, ".md") === agentName)) issues.push(`agentName「${agentName}」没有对应的 agents/*.md`);
  for (const rel of agents) {
    if (!ctx.view.has(rel)) {
      issues.push(`agents 路径不存在：${rel}`);
      continue;
    }
    const text = ctx.view.readText(rel);
    const fm = parseYamlFrontmatter(text);
    if (!fm.hasFrontmatter || !fm.ok) {
      issues.push(`${rel}：frontmatter 缺失或不可解析`);
      continue;
    }
    for (const key of ["name", "description", "displayName", "profession", "maxTurns"]) {
      if (fm.data[key] === undefined || asText(fm.data[key]).trim() === "") issues.push(`${rel}: frontmatter 缺 ${key}`);
    }
    if (asText(fm.data.name) !== path.basename(rel, ".md")) issues.push(`${rel}: frontmatter name ≠ 文件名`);
    if (fm.data.tools !== undefined) issues.push(`${rel}: 禁止 tools 字段`);
  }
  const skills = Array.isArray(data.skills) ? data.skills : [];
  for (const skill of skills) {
    const rel = `${asText(skill).replace(/^\.\//, "")}/SKILL.md`;
    if (!ctx.view.has(rel)) issues.push(`skills 路径缺 SKILL.md：${rel}`);
  }
  if (issues.length) add("E05", "fail", `agents 检查 ${issues.length} 处问题：${issues.slice(0, 6).join("；")}`, issues.slice(0, 12));
  else add("E05", "pass", `agents frontmatter 与 agentName 对应（${agents.length} 个）`, agents);
}

function addE06(ctx, add) {
  if (!ctx.pluginJson || !ctx.pluginJson.ok) {
    add("E06", "skip", "plugin.json 不可用，跳过", []);
    return;
  }
  const data = ctx.pluginJson.data;
  if (asText(data.expertType) !== "team") {
    add("E06", "skip", `expertType=${asText(data.expertType) || "未声明"}，非 Team 型`, []);
    return;
  }
  const issues = [];
  const agentName = asText(data.agentName).trim();
  const teamInfo = data.teamInfo && typeof data.teamInfo === "object" ? data.teamInfo : {};
  if (asText(teamInfo.leadAgent).trim() !== agentName) issues.push("teamInfo.leadAgent ≠ agentName");
  const members = Array.isArray(teamInfo.memberAgents) ? teamInfo.memberAgents.map(asText) : [];
  if (members.includes(agentName)) issues.push("teamInfo.memberAgents 不应包含主理人");
  if (!ctx.view.has("settings.json")) issues.push("Team 型缺 settings.json");
  else {
    try {
      const settings = JSON.parse(ctx.view.readText("settings.json"));
      if (asText(settings.agent) !== agentName) issues.push("settings.json agent ≠ agentName");
    } catch {
      issues.push("settings.json 解析失败");
    }
  }
  const list = Array.isArray(data.members) ? data.members : [];
  if (list.length && !list.some((member) => asText(member.role) === "lead")) issues.push("members 缺 role=lead");
  if (asText(data.profession) !== asText(data.displayName)) {
    const pz = data.profession && typeof data.profession === "object" ? asText(data.profession.zh) : asText(data.profession);
    const dz = data.displayName && typeof data.displayName === "object" ? asText(data.displayName.zh) : asText(data.displayName);
    if (pz !== dz) issues.push("Team 型 profession.zh 必须等于 displayName.zh");
  }
  if (issues.length) add("E06", "fail", `Team 一致性 ${issues.length} 处问题：${issues.slice(0, 5).join("；")}`, issues);
  else add("E06", "pass", "Team 型 settings.json / teamInfo 一致", []);
}

/* ================================================================== */
/* 五、质量分 Q                                                        */
/* ================================================================== */

function makeItem(item, level, evidence, method = "auto", confidence = 0.9) {
  return {
    id: item.id,
    dim: item.dim,
    name: item.name,
    max: item.max,
    level: clamp(Math.round(level), 0, 4),
    score: levelScore(item.max, level),
    method,
    confidence,
    evidence,
  };
}

function scoreQuality(ctx, gate) {
  const items = [];
  const data = ctx.rootFm && ctx.rootFm.ok ? ctx.rootFm.data : {};
  const plugin = ctx.pluginJson && ctx.pluginJson.ok ? ctx.pluginJson.data : {};
  const stats = ctx.stats;
  const text = ctx.authorityText;
  const pluginDescription = plugin.displayDescription && typeof plugin.displayDescription === "object" ? plugin.displayDescription : {};
  const pluginQuick = Array.isArray(plugin.quickPrompts) ? plugin.quickPrompts : [];
  const quickZh = pluginQuick.map((item) => (item && typeof item === "object" ? asText(item.zh) : asText(item))).filter(Boolean);
  const quickEn = pluginQuick.map((item) => (item && typeof item === "object" ? asText(item.en) : asText(item))).filter(Boolean);
  const examplesZh = toArray(data.examples_zh).length ? toArray(data.examples_zh).map(asText) : quickZh;
  const examplesEn = toArray(data.examples_en).length ? toArray(data.examples_en).map(asText) : quickEn;
  const descriptionText = [
    asText(data.description),
    asText(data.description_zh),
    asText(data.description_en),
    asText(plugin.description),
    asText(pluginDescription.zh),
    asText(pluginDescription.en),
  ].filter(Boolean).join("\n");

  /* Q1.1 包结构合规 */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q1.1");
    let level = 4;
    if (gate.blockerCount > 0) level = 1;
    else if (gate.majorCount === 0) level = 4;
    else if (gate.majorCount <= 2) level = 3;
    else if (gate.majorCount <= 5) level = 2;
    else level = 2;
    items.push(makeItem(item, level, [`blocker=${gate.blockerCount}`, `major=${gate.majorCount}`, `minor=${gate.minorCount}`]));
  }

  /* Q1.2 脚本可运行性（静态近似） */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q1.2");
    const scripts = ctx.scriptFiles;
    const gate11 = gate.checks.find((check) => check.id === "G11");
    if (scripts.length === 0) {
      items.push(makeItem(item, 0, ["包内没有可运行脚本（rubric 锚点：无脚本能力）"], "auto", 0.9));
    } else if (gate11 && gate11.status === "fail") {
      items.push(makeItem(item, 1, ["脚本存在语法错误（见 G11）"], "auto", 0.85));
    } else {
      const hasDemo = scripts.some((rel) => /--demo/.test(ctx.view.readText(rel)));
      const level = hasDemo ? 3 : 2;
      items.push(makeItem(item, level, [
        `脚本 ${scripts.length} 个（${scripts.slice(0, 3).join("、")}）`,
        "已做静态语法检查；未实际执行 demo / 无参 / 两次一致性（T1 沙箱执行未做）",
        hasDemo ? "脚本文本含 --demo 参数" : "未见 --demo 参数",
      ], "auto", 0.6));
    }
  }

  /* Q1.3 自检与可验证 */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q1.3");
    const selfcheck = ctx.view.files.filter((rel) => /selfcheck/i.test(rel));
    if (selfcheck.length === 0) {
      items.push(makeItem(item, ctx.scriptFiles.length ? 2 : 0, [ctx.scriptFiles.length ? "有脚本但没有 selfcheck" : "无脚本、无自检"], "auto", 0.85));
    } else {
      const mentionsJson = /json/i.test(ctx.view.readText(selfcheck[0]));
      items.push(makeItem(item, mentionsJson ? 4 : 3, [
        `selfcheck：${selfcheck[0]}`,
        mentionsJson ? "脚本文本提及 JSON 输出" : "未看到 JSON 输出说明",
        "未实际执行 selfcheck（静态近似）",
      ], "auto", 0.7));
    }
  }

  /* Q1.4 可维护性与体积 */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q1.4");
    const signals = [];
    const version = asText(data.version || plugin.version);
    if (version) signals.push(`版本 ${version}`);
    if (ctx.view.has("CHANGELOG.md")) signals.push("有 CHANGELOG");
    const sizeLimit = ctx.view.kind === "expert" ? 3 * 1024 * 1024 : 1024 * 1024;
    if (ctx.view.totalBytes <= sizeLimit) signals.push(`体积 ${(ctx.view.totalBytes / 1024).toFixed(0)} KB`);
    const gate15 = gate.checks.find((check) => check.id === "G15");
    if (gate15 && gate15.status === "pass") signals.push("编码 UTF-8 无 BOM");
    items.push(makeItem(item, signals.length, signals, "auto", 0.85));
  }

  /* Q2.1 description 覆盖问法 */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q2.1");
    const examples = [...examplesZh, ...examplesEn];
    if (!descriptionText) {
      items.push(makeItem(item, 0, ["没有 description"], "auto", 0.9));
    } else if (examples.length === 0) {
      items.push(makeItem(item, 1, ["没有 examples 可做覆盖率计算，按锚点下限计"], "auto", 0.5));
    } else {
      const ratio = coverageRatio(examples, descriptionText);
      const level = ratio >= 0.8 ? 4 : ratio >= 0.6 ? 3 : ratio >= 0.4 ? 2 : 1;
      items.push(makeItem(item, level, [`示例问法覆盖 ${(ratio * 100).toFixed(0)}%（${examples.length} 条示例 vs description 词项）`], "auto", 0.65));
    }
  }

  /* Q2.2 边界与外溢 */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q2.2");
    const scopeText = [
      asText(data.name || plugin.name),
      asText(data.display_name || data.display_name_zh),
      asText(plugin.displayName && plugin.displayName.zh),
      asText(data.description),
      asText(data.description_zh),
      asText(plugin.displayDescription && plugin.displayDescription.zh),
    ].filter(Boolean).join(" ");
    const generic = countWords(scopeText, WORD_LISTS.generic);
    const boundary = countWords(text, WORD_LISTS.boundary);
    const issues = [];
    if (generic.count > 0) issues.push(`泛化词 ${generic.count} 处（${generic.detail.slice(0, 5).join("、")}）`);
    if (boundary.count === 0) issues.push("正文没有边界/不适用说明");
    let level = 4;
    if (generic.count === 0 && boundary.count >= 2) level = 4;
    else if (generic.count <= 2) level = 3;
    else if (generic.count <= 5) level = 2;
    else level = 1;
    items.push(makeItem(item, level, [...issues, "单包扫描未做兄弟包相似度（需批量语料）"], "auto", 0.6));
  }

  /* Q2.3 名称与搜索性（启发式） */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q2.3");
    const display = asText(data.display_name || data.display_name_zh || (data.displayName && data.displayName.zh) || plugin.displayName && plugin.displayName.zh);
    const name = asText(data.name || plugin.name);
    const phraseWords = ["怎么", "如何", "计算", "检查", "模板", "清单", "步骤", "方案", "报告", "攻略", "诊断", "自查", "对比", "生成", "写", "改写", "规划"];
    const matched = phraseWords.filter((word) => display.includes(word));
    const signals = [];
    if (display) signals.push(`展示名「${display}」`);
    if (name && KEBAB.test(name)) signals.push("name 是 kebab-case");
    if (matched.length) signals.push(`含用户问法词：${matched.join("、")}`);
    else if (display) signals.push("展示名是名词短语（未含问法动词）");
    const level = matched.length > 0 && display ? 4 : display ? 3 : name ? 2 : 1;
    items.push(makeItem(item, level, [...signals, "启发式判断：名称是否像用户原话只有人工/模型能最终确认"], "heuristic", 0.65));
  }

  /* Q2.4 示例质量 */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q2.4");
    const zh = examplesZh;
    const en = examplesEn;
    const total = zh.length + en.length;
    let level = 0;
    if (zh.length === 3 && en.length === 3) level = uniqueCharsRatio([...zh, ...en]) >= 0.8 ? 4 : 3;
    else if (zh.length === 3 || en.length === 3 || (zh.length === 2 && en.length === 2)) level = 3;
    else if (total > 0) level = 2;
    items.push(makeItem(item, level, [`examples_zh=${zh.length} 条`, `examples_en=${en.length} 条`, `平台上限 3 条；去重后首词多样性 ${(uniqueCharsRatio([...zh, ...en]) * 100).toFixed(0)}%`], "auto", 0.9));
  }

  /* Q3.1 步骤化与分支 */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q3.1");
    const branch = countWords(text, ["如果", "若", "当", "否则", "分支", "情况", "场景", "判断"]);
    const steps = stats.numberedSteps;
    let level = 0;
    if (steps >= 4 && branch.count >= 3 && stats.tables >= 1) level = 4;
    else if (steps >= 4 && branch.count >= 1) level = 3;
    else if (steps >= 2) level = 2;
    else if (stats.listItems >= 3) level = 1;
    items.push(makeItem(item, level, [`编号步骤 ${steps} 处`, `条件词 ${branch.count} 处`, `表格 ${stats.tables} 个`, `列表项 ${stats.listItems} 个`], "auto", 0.8));
  }

  /* Q3.2 输入采集与降级 */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q3.2");
    const found = countWords(text, WORD_LISTS.input);
    const noInfo = /信息不全|信息缺失|缺失信息|不完整/.test(text);
    const fallback = /先给|先按|示例假设|假设版|默认示例|缺失时/.test(text);
    const batch = /分批|逐步|一次只问|最多.*问题|不超过.*问/.test(text);
    let level = 0;
    if (noInfo && fallback) level = 4;
    else if (batch && fallback) level = 3;
    else if (found.count > 0) level = 2;
    else if (/请提供|必填/.test(text)) level = 1;
    items.push(makeItem(item, level, [`输入采集词命中 ${found.count} 处（${found.detail.slice(0, 6).join("、") || "无"}）`, `信息不全处理：${noInfo ? "有" : "无"}`, `降级先交付：${fallback ? "有" : "无"}`, `分批询问：${batch ? "有" : "无"}`], "auto", 0.7));
  }

  /* Q3.3 输出结构与模板 */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q3.3");
    const templates = countWords(text, WORD_LISTS.template);
    const hasSkeleton = /报告骨架|输出结构|输出格式|结构如下|模板如下|如下结构/.test(text);
    const hasCodeBlock = stats.codeFences > 0;
    let level = 0;
    if (hasSkeleton && stats.tables >= 1 && (hasCodeBlock || templates.count >= 2)) level = 4;
    else if (hasSkeleton || stats.tables >= 2) level = 3;
    else if (stats.tables >= 1 || templates.count > 0) level = 2;
    else if (/报告|输出/.test(text)) level = 1;
    items.push(makeItem(item, level, [`表格 ${stats.tables} 个`, `代码块 ${stats.codeFences} 段`, `模板/骨架词 ${templates.count} 处`, `结构化输出说明：${hasSkeleton ? "有" : "无"}`], "auto", 0.75));
  }

  /* Q3.4 边界与不确定处理 */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q3.4");
    const disclaimer = countWords(text, WORD_LISTS.disclaimer);
    const boundary = countWords(text, WORD_LISTS.boundary);
    const claims = findAbsoluteClaims(text);
    let level = 0;
    if (claims.length > 0) level = 0;
    else if (disclaimer.count > 0 && boundary.count > 0) level = 4;
    else if (disclaimer.count > 0) level = 3;
    else if (boundary.count > 0) level = 2;
    else level = 1;
    items.push(makeItem(item, level, [`免责词 ${disclaimer.count} 处`, `边界词 ${boundary.count} 处`, `绝对化承诺 ${claims.length} 处`], "auto", 0.8));
  }

  /* Q4.1 知识密度 */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q4.1");
    const cases = countWords(text, WORD_LISTS.case).count;
    const formulas = countWords(text, WORD_LISTS.formula).count;
    const chars = ctx.knowledgeChars;
    let level = 0;
    if (chars >= 30000 || (cases >= 10 && stats.tables >= 15)) level = 4;
    else if (chars >= 15000) level = 3;
    else if (chars >= 8000) level = 2;
    else if (chars > 0) level = 1;
    items.push(makeItem(item, level, [`知识文本 ${chars} 字`, `表格 ${stats.tables} 个`, `案例/示例词 ${cases} 处`, `公式/计算词 ${formulas} 处`], "auto", 0.85));
  }

  /* Q4.2 准确性与一致性（静态一致性，非领域审计） */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q4.2");
    const gate05 = gate.checks.find((check) => check.id === "G05");
    const gate07 = gate.checks.find((check) => check.id === "G07");
    const gate03 = gate.checks.find((check) => check.id === "G03");
    const citations = countWords(text, WORD_LISTS.citation).count;
    const issues = [];
    if (gate05 && gate05.status !== "pass" && gate05.status !== "skip") issues.push("存在缺失/通配符引用（G05）");
    if (gate07 && gate07.status === "fail") issues.push("frontmatter 解析错误（G07）");
    if (gate03 && gate03.status !== "pass" && gate03.status !== "skip") issues.push("name 与包名不一致（G03）");
    let level;
    if (issues.length >= 2) level = 1;
    else if (issues.length === 1) level = 2;
    else if (citations >= 3) level = 3;
    else level = 2;
    items.push(makeItem(item, level, [
      `静态一致性：${issues.length ? issues.join("；") : "无问题"}`,
      `引用/法条/来源词 ${citations} 处`,
      "未做领域法条级审计（需人工或领域模型复核），按规则最高记 3/4 级",
    ], "auto+static", 0.5));
  }

  /* Q4.3 时效与出处 */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q4.3");
    const dates = (text.match(/20\d{2}\s*[-年./]\s*\d{1,2}/g) || []).length;
    const sources = countWords(text, WORD_LISTS.citation).count;
    const urls = (text.match(/https?:\/\//g) || []).length;
    let level = 1;
    if (dates >= 2 && sources >= 3) level = 4;
    else if (dates >= 1 || sources >= 1) level = 3;
    else if (urls > 0) level = 2;
    items.push(makeItem(item, level, [`日期 ${dates} 处`, `来源/法条词 ${sources} 处`, `URL ${urls} 个`], "auto", 0.7));
  }

  /* Q4.4 风险控制与免责 */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q4.4");
    const disclaimer = countWords(text, WORD_LISTS.disclaimer);
    const compliance = countWords(text, WORD_LISTS.compliance);
    let level = 0;
    if (disclaimer.count >= 2 && compliance.count >= 1) level = 4;
    else if (disclaimer.count >= 1) level = 3;
    else if (compliance.count >= 1) level = 2;
    else level = 1;
    items.push(makeItem(item, level, [`免责词 ${disclaimer.count} 处`, `合规/风险词 ${compliance.count} 处`], "auto", 0.75));
  }

  /* Q4.5 可复用资产 */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q4.5");
    const hasTemplates = ctx.view.files.some((rel) => /(?:^|\/)templates?\//i.test(rel));
    const hasSamples = ctx.view.files.some((rel) => /(?:^|\/)samples?\//i.test(rel));
    const templates = countWords(text, WORD_LISTS.template).count;
    const scripts = ctx.scriptFiles.length;
    const signals = [hasTemplates && "templates/", hasSamples && "samples/", scripts > 0 && `脚本 ${scripts} 个`, templates > 0 && `模板词 ${templates} 处`].filter(Boolean);
    const level = signals.length >= 3 ? 4 : signals.length === 2 ? 3 : signals.length === 1 ? 2 : 0;
    items.push(makeItem(item, level, signals.length ? signals : ["未发现可复用资产"], "auto", 0.8));
  }

  /* Q5.1 首用即得 */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q5.1");
    const examples = examplesZh.length + examplesEn.length;
    const templates = stats.tables >= 2 || /模板|骨架|输出格式/.test(text);
    const defaultPath = /示例假设|先给|默认|先用示例|missing.*default/i.test(text);
    let level = 0;
    if (examples >= 2 && templates && defaultPath) level = 4;
    else if (examples >= 2 && templates) level = 3;
    else if (examples >= 1 || templates) level = 2;
    else if (/请提供|请描述/.test(text)) level = 1;
    items.push(makeItem(item, level, [`examples ${examples} 条`, `模板/骨架：${templates ? "有" : "无"}`, `信息不全先交付：${defaultPath ? "有" : "无"}`, "未实际执行 T4 行为测试"], "auto", 0.6));
  }

  /* Q5.2 上架文案与双语 */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q5.2");
    const signals = [];
    if (asText(data.description_en).trim() || asText(pluginDescription.en).trim()) signals.push("description_en");
    if (asText(data.display_name_en).trim() || asText(plugin.displayName && plugin.displayName.en).trim()) signals.push("display_name_en");
    if (examplesEn.length) signals.push("examples_en");
    if (ctx.view.files.some((rel) => /^readme(?:\.zh)?\.md$/i.test(rel))) signals.push("README");
    const level = signals.length >= 4 ? 4 : signals.length === 3 ? 3 : signals.length === 2 ? 2 : signals.length === 1 ? 1 : 0;
    items.push(makeItem(item, level, signals.length ? signals : ["未发现双语上架文案"], "auto", 0.85));
  }

  /* Q5.3 交付物可导出 */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q5.3");
    const extHits = { md: 0, csv: 0, json: 0, docx: 0, xlsx: 0, html: 0, pdf: 0 };
    for (const file of ctx.textFiles.slice(0, 200)) {
      for (const ext of Object.keys(extHits)) {
        const re = new RegExp(`\\.${ext}\\b`, "gi");
        const matches = file.text.match(re);
        if (matches) extHits[ext] += matches.length;
      }
    }
    const formats = Object.entries(extHits).filter(([, count]) => count > 0).map(([ext]) => ext);
    let level = 0;
    if (formats.length >= 3) level = 4;
    else if (formats.length >= 1) level = 3;
    else if (stats.tables >= 1) level = 2;
    else if (/输出|报告/.test(text)) level = 1;
    items.push(makeItem(item, level, [`可导出格式命中：${formats.join("、") || "无"}`, `表格 ${stats.tables} 个`], "auto", 0.7));
  }

  /* Q5.4 体积与 token 效率 */
  {
    const item = Q_ITEMS.find((entry) => entry.id === "Q5.4");
    const bytes = ctx.view.totalBytes;
    const split = ctx.docs.length > 1 || ctx.view.files.some((rel) => /^(?:references|rules|docs)\//i.test(rel));
    let level = 0;
    if (bytes <= 400 * 1024 && ctx.knowledgeChars <= 120000 && split) level = 4;
    else if (bytes <= 1024 * 1024) level = 3;
    else if (bytes <= 2 * 1024 * 1024) level = 2;
    else if (bytes <= (ctx.view.kind === "expert" ? 10 : 3) * 1024 * 1024) level = 1;
    items.push(makeItem(item, level, [`包体 ${(bytes / 1024).toFixed(0)} KB`, `知识文本 ${ctx.knowledgeChars} 字`, `按需拆分（references/rules/docs）：${split ? "有" : "无"}`], "auto", 0.8));
  }

  /* 惩罚项 */
  const penalties = [];
  const duplicateRatio = duplicateLineRatio(ctx.docs);
  if (duplicateRatio > 0.3) {
    penalties.push({ ...PENALTY_DEFS[0], evidence: [`长行重复率 ${(duplicateRatio * 100).toFixed(0)}%`] });
  }
  const disclaimerWords = countWords(ctx.authorityText, WORD_LISTS.disclaimer);
  if (disclaimerWords.count === 0 && PROFESSIONAL_DOMAINS.has(ctx.domain.domain)) {
    penalties.push({ ...PENALTY_DEFS[1], evidence: [`专业领域 ${ctx.domain.domain} 且没有免责声明`] });
  }
  const claims = findAbsoluteClaims(ctx.authorityText);
  if (claims.length > 0) penalties.push({ ...PENALTY_DEFS[2], evidence: claims.slice(0, 5).map((hit) => hit.word) });
  penalties.push({ ...PENALTY_DEFS[3], evidence: ["单包扫描无兄弟包语料，P4 未触发（需批量扫描才能算相似度）"] , skipped: true });
  if (ctx.view.totalBytes > 2 * 1024 * 1024 || ctx.knowledgeChars > 300000) {
    penalties.push({ ...PENALTY_DEFS[4], evidence: [`体积 ${(ctx.view.totalBytes / 1024 / 1024).toFixed(2)} MB，知识文本 ${ctx.knowledgeChars} 字`] });
  }
  const placeholders = countPlaceholders(ctx.authorityText);
  if (placeholders.length > 0) penalties.push({ ...PENALTY_DEFS[5], evidence: placeholders });

  const dimensions = Q_DIMENSIONS.map((dim) => {
    const dimItems = items.filter((item) => item.dim === dim.id);
    return {
      ...dim,
      max: dim.weight,
      score: round1(dimItems.reduce((sum, item) => sum + item.score, 0)),
      items: dimItems,
    };
  });
  const raw = round1(dimensions.reduce((sum, dim) => sum + dim.score, 0));
  const appliedPenalties = penalties.filter((penalty) => !penalty.skipped);
  const delta = appliedPenalties.reduce((sum, penalty) => sum + penalty.delta, 0);
  const score = clamp(round1(raw + delta), 0, 100);
  return { score, raw, delta, dimensions, items, penalties, duplicateRatio };
}

/* ================================================================== */
/* 六、价值分 V                                                        */
/* ================================================================== */

function computeValue(ctx, quality, gate) {
  const text = ctx.authorityText;
  const domain = ctx.domain.domain;
  const demandPrior = DOMAIN_DEMAND_PRIOR[domain] !== undefined ? DOMAIN_DEMAND_PRIOR[domain] : 0.5;
  const lossBaseline = DOMAIN_LOSS_BASELINE[domain] !== undefined ? DOMAIN_LOSS_BASELINE[domain] : 0.5;
  const freqPrior = DOMAIN_FREQ_PRIOR[domain] !== undefined ? DOMAIN_FREQ_PRIOR[domain] : 0.5;
  const per1000 = (count) => count / Math.max(1, text.length / 1000);
  const signalScore = (count) => clamp(Math.round(per1000(count) * 12), 0, 100);

  const loss = countWords(text, WORD_LISTS.loss);
  const event = countWords(text, WORD_LISTS.event);
  const freq = countWords(text, WORD_LISTS.freq);
  const decision = countWords(text, WORD_LISTS.decision);
  const search = countWords(text, WORD_LISTS.search);
  const moneyWords = countWords(text, ["元", "万元", "罚款", "赔偿", "费用", "成本", "金额", "保费", "工资", "报价", "预算"]);
  const periodic = countWords(text, WORD_LISTS.periodic);
  const oneTime = countWords(text, WORD_LISTS.oneTime);
  const generic = countWords(text, WORD_LISTS.generic);
  const disclaimer = countWords(text, WORD_LISTS.disclaimer);
  const compliance = countWords(text, WORD_LISTS.compliance);

  const v1Score = clamp(Math.round(0.6 * demandPrior * 100 + 0.4 * signalScore(loss.count + event.count + freq.count + decision.count + search.count)), 0, 100);
  const v1 = {
    id: "V1", name: "需求强度", weight: 25, score: v1Score,
    evidence: [
      `领域：${domain}（需求先验 ${(demandPrior * 100).toFixed(0)}）`,
      `损失词 ${loss.count}、事件词 ${event.count}、频率词 ${freq.count}、决策词 ${decision.count}、搜索句式 ${search.count}（每千字信号密度换算）`,
    ],
  };

  const v2Score = clamp(Math.round(15 + ctx.stats.tables * 5 + ctx.scriptFiles.length * 5 + countWords(text, WORD_LISTS.template).count * 1.5), 0, 95);
  const v2 = {
    id: "V2", name: "交付确定性", weight: 20, score: v2Score,
    evidence: [`表格 ${ctx.stats.tables} 个（×5）`, `脚本 ${ctx.scriptFiles.length} 个（×5）`, `模板/清单词 ${countWords(text, WORD_LISTS.template).count} 处（×1.5）`, "基础分 15"],
  };

  const moneyScore = signalScore(moneyWords.count * 2);
  const v3Score = clamp(Math.round(0.7 * lossBaseline * 100 + 0.3 * moneyScore), 0, 100);
  const v3 = {
    id: "V3", name: "结果价值", weight: 20, score: v3Score,
    evidence: [`领域损失基线 ${(lossBaseline * 100).toFixed(0)}（${domain}）`, `金额/罚款/理赔词 ${moneyWords.count} 处（密度分 ${moneyScore}）`],
  };

  const moatRaw = clamp(
    15 + Math.min(30, ctx.knowledgeChars / 800) + ctx.stats.tables * 1.5 + ctx.scriptFiles.length * 4 +
    countWords(text, WORD_LISTS.formula).count * 1 + compliance.count * 2 - generic.count * 4,
    0, 95,
  );
  const v4 = {
    id: "V4", name: "可替代性/壁垒", weight: 15, score: Math.round(moatRaw),
    evidence: [`知识文本 ${ctx.knowledgeChars} 字（30k 封顶 30 分）`, `表格 ${ctx.stats.tables}×1.5、脚本 ${ctx.scriptFiles.length}×4、公式词 ${countWords(text, WORD_LISTS.formula).count}×1、合规钩子 ${compliance.count}×2`, `泛化词 ${generic.count} 反向扣 ${generic.count * 4} 分`],
  };

  const periodicScore = clamp(periodic.count * 8 - oneTime.count * 12, 0, 100);
  const v5Score = clamp(Math.round(0.7 * freqPrior * 100 + 0.3 * periodicScore), 0, 100);
  const v5 = {
    id: "V5", name: "复用频次与生命周期", weight: 10, score: v5Score,
    evidence: [`领域频次先验 ${(freqPrior * 100).toFixed(0)}（${domain}）`, `周期词 ${periodic.count}、一次性词 ${oneTime.count}`],
  };

  let v6Score = 50;
  if (disclaimer.count > 0) v6Score += 10;
  else if (PROFESSIONAL_DOMAINS.has(domain)) v6Score -= 12;
  if (["insurance", "tax", "legal", "compliance", "finance", "bidding", "contract", "patent"].includes(domain)) v6Score += 12;
  else if (["hr", "marketing", "productivity", "cad", "coding"].includes(domain)) v6Score += 2;
  if (compliance.count > 0) v6Score += 4;
  v6Score = clamp(v6Score, 20, 95);
  const v6 = {
    id: "V6", name: "付费意愿与责任风险", weight: 10, score: v6Score,
    evidence: [`基础分 50`, `免责词 ${disclaimer.count > 0 ? "有（+10）" : `无（${PROFESSIONAL_DOMAINS.has(domain) ? "-12 专业领域高风险" : "0"}）`}`, `领域付费意愿（${domain}）`, `合规词 ${compliance.count} 处`],
  };

  const dimensions = [v1, v2, v3, v4, v5, v6];
  const rawValue = round1(dimensions.reduce((sum, dim) => sum + (dim.score * dim.weight) / 100, 0));
  const blocked = gate.blockerCount > 0;
  const cap = round1(quality.score + 15);
  const finalValue = blocked ? 0 : Math.min(rawValue, cap);
  const capped = !blocked && finalValue < rawValue;
  const band = blocked ? null : PRICE_BANDS.find((entry) => finalValue >= entry.min) || PRICE_BANDS[PRICE_BANDS.length - 1];
  const subscription = !blocked && v5Score >= SUBSCRIPTION_RULE.minV5 && finalValue >= SUBSCRIPTION_RULE.minV
    ? { price: SUBSCRIPTION_RULE.price, reason: `V5=${v5Score}≥${SUBSCRIPTION_RULE.minV5} 且 V=${finalValue}≥${SUBSCRIPTION_RULE.minV}` }
    : null;
  return {
    raw: rawValue,
    final: finalValue,
    cap,
    capped,
    blocked,
    dimensions,
    grade: blocked ? "—" : band ? band.grade : "D",
    priceBand: band,
    subscription,
    note: blocked
      ? "门禁有 blocker：按 rubric 规则 V 记 0、不给定价建议，先修合规"
      : capped
        ? `V 被质量分强制校准：V_raw=${rawValue}，Q+15=${cap}，V_final=${finalValue}`
        : "V 未被质量分截断",
  };
}

/* ================================================================== */
/* 七、主入口                                                          */
/* ================================================================== */

const STATUS_LABEL = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "SKIP" };

export function scanWorkBuddyPackages(inputPath, options = {}) {
  const startedAt = Date.now();
  const view = loadPackageView(inputPath);
  const ctx = buildContext(view, options);
  const gate = evaluateGates(ctx);
  const quality = scoreQuality(ctx, gate);
  const value = computeValue(ctx, quality, gate);
  const pluginVersion = ctx.pluginJson && ctx.pluginJson.ok && ctx.pluginJson.data ? ctx.pluginJson.data.version : "";
  const result = {
    tool: "dsh-skill-audit",
    version: VERSION,
    mode: "workbuddy",
    rubricVersion: WB_RUBRIC_VERSION,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    input: {
      path: ctx.inputPath,
      source: view.source,
      kind: view.kind,
      profileLabel: view.kind === "skill" ? "WorkBuddy 技能包" : "WorkBuddy 专家包",
      name: ctx.packageName,
      version: view.kind === "skill" ? asText(ctx.rootFm && ctx.rootFm.ok ? ctx.rootFm.data.version : "") : asText(pluginVersion),
      sizeBytes: view.totalBytes,
      fileCount: view.fileCount,
      topDir: view.topDir,
      strippedTopDir: view.topDirStripped,
      autoDescended: view.autoDescended,
      paid: ctx.isPaid,
      domain: ctx.domain.domain,
      domainEvidence: ctx.domain.evidence,
      textChars: ctx.knowledgeChars,
    },
    gate,
    quality,
    value,
    confidence: {
      gate: "确定性静态检查 0.9",
      quality: "启发式/计数 0.6–0.9（未做沙箱执行与领域审计）",
      value: "领域先验 + 词频启发式 0.5–0.7",
      note: "所有分数都是可复现的静态启发式，不是模型判断；报告内每条都有依据。",
    },
    notes: [
      "T0 静态门禁/结构全自动；T1 脚本执行未做（只做 node --check / Python ast 静态语法）；T3 兄弟包相似度需批量语料；T4 行为测试需把 Agent 输出贴回。",
      "免费包不强制法律文件；付费判定依据包内法律文件/价格字段，可用 --paid 强制。",
    ],
  };
  return result;
}

/* ================================================================== */
/* 八、Markdown 报告                                                   */
/* ================================================================== */

function fmtBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function localDateStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function localDateTime(date = new Date()) {
  return `${localDateStamp(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function renderWorkbuddyMarkdown(result) {
  const lines = [];
  const input = result.input;
  const gate = result.gate;
  const quality = result.quality;
  const value = result.value;
  lines.push(`# WorkBuddy 包审核报告 · ${input.name}`);
  lines.push("");
  lines.push(`> dsh-skill-audit v${result.version} · rubric v${result.rubricVersion} · 生成于 ${localDateTime(new Date(result.generatedAt))}`);
  lines.push("");
  lines.push(`- 输入：\`${input.path}\`（${input.source === "zip" ? "ZIP" : "目录"}）`);
  lines.push(`- 识别：${input.profileLabel} · 版本 ${input.version || "未声明"} · ${fmtBytes(input.sizeBytes)} · ${input.fileCount} 个文件`);
  lines.push(`- 领域（自动识别）：${input.domain}（${input.domainEvidence.join("；")}）`);
  lines.push(`- 付费检测：${input.paid ? "是（检查法律文件）" : "否（免费包）"}`);
  lines.push(`- 门禁结论：**${gate.verdict}**（blocker ${gate.blockerCount} / major ${gate.majorCount} / minor ${gate.minorCount}）`);
  lines.push(`- 质量分 Q：**${quality.score} / 100**（原始 ${quality.raw}，惩罚 ${quality.delta}）`);
  lines.push(`- 价值分 V：**${value.final} / 100**（原始 ${value.raw}，${value.note}）`);
  lines.push(`- 建议价格：${value.priceBand ? `**${value.priceBand.price}**（${value.priceBand.grade} 级：${value.priceBand.note}）` : "**不上架**（先修 blocker）"}`);
  if (value.subscription) lines.push(`- 订阅建议：${value.subscription.price}（${value.subscription.reason}）`);
  lines.push("");

  lines.push("## 一、门禁 Gate（25 条）");
  lines.push("");
  lines.push("| ID | 严重度 | 状态 | 检查项 | 说明 |");
  lines.push("|---|--------|------|--------|------|");
  const severityRank = { blocker: 0, major: 1, minor: 2 };
  const ordered = gate.checks.slice().sort((left, right) => {
    const bySeverity = severityRank[left.severity] - severityRank[right.severity];
    if (bySeverity !== 0) return bySeverity;
    const statusRank = { fail: 0, warn: 1, pass: 2, skip: 3 };
    return statusRank[left.status] - statusRank[right.status];
  });
  for (const check of ordered) {
    lines.push(`| ${check.id} | ${check.severity} | ${STATUS_LABEL[check.status]} | ${check.title} | ${check.detail.replace(/\|/g, "/")} |`);
  }
  lines.push("");
  const failed = gate.checks.filter((check) => check.status === "fail" || check.status === "warn");
  if (failed.length) {
    lines.push("### 待修项与修复建议");
    lines.push("");
    for (const check of failed) {
      lines.push(`- **${check.id} ${check.title}**（${check.severity} / ${STATUS_LABEL[check.status]}）：${check.detail}`);
      lines.push(`  - 修复：${check.fix}`);
      if (check.evidence.length) lines.push(`  - 证据：${check.evidence.slice(0, 4).join("；")}`);
    }
    lines.push("");
  }

  lines.push("## 二、质量分 Q（0–100，五维）");
  lines.push("");
  lines.push("| 维度 | 权重 | 得分 |");
  lines.push("|------|------|------|");
  for (const dim of quality.dimensions) {
    lines.push(`| ${dim.id} ${dim.name} | ${dim.weight} | ${dim.score} / ${dim.max} |`);
  }
  lines.push(`| **合计** | **100** | **${quality.score}**（原始 ${quality.raw}，惩罚 ${quality.delta}） |`);
  lines.push("");
  for (const dim of quality.dimensions) {
    lines.push(`### ${dim.id} ${dim.name}（${dim.score} / ${dim.max}）`);
    lines.push("");
    for (const item of dim.items) {
      lines.push(`- **${item.id} ${item.name}**：${item.score} / ${item.max}（等级 ${item.level}/4，method=${item.method}，confidence=${item.confidence}）`);
      lines.push(`  - 依据：${item.evidence.join("；")}`);
    }
    lines.push("");
  }
  lines.push("### 惩罚项");
  lines.push("");
  if (quality.penalties.length === 0) lines.push("无");
  for (const penalty of quality.penalties) {
    if (penalty.skipped) {
      lines.push(`- ${penalty.id} ${penalty.title}：未触发（${penalty.evidence.join("；")}）`);
    } else {
      lines.push(`- ${penalty.id} ${penalty.title}：${penalty.delta} 分（${penalty.trigger}）— ${penalty.evidence.join("；")}`);
    }
  }
  lines.push("");

  lines.push("## 三、价值分 V（0–100，六维）");
  lines.push("");
  lines.push("| 维度 | 权重 | 得分 | 依据 |");
  lines.push("|------|------|------|------|");
  for (const dim of value.dimensions) {
    lines.push(`| ${dim.id} ${dim.name} | ${dim.weight} | ${dim.score} | ${dim.evidence.join("；").replace(/\|/g, "/")} |`);
  }
  lines.push("");
  lines.push(`- V_raw = ${value.raw}`);
  lines.push(`- 校准规则：V_final = min(V_raw, Q + 15) = min(${value.raw}, ${quality.score} + 15 = ${value.cap})`);
  lines.push(`- **V_final = ${value.final}**；等级 ${value.grade}；${value.priceBand ? `建议价格 ${value.priceBand.price}` : "门禁 blocker，暂不定价"}`);
  lines.push("");

  lines.push("## 四、口径与限制");
  lines.push("");
  for (const note of result.notes) lines.push(`- ${note}`);
  lines.push(`- 置信度：门禁 ${result.confidence.gate}；质量分 ${result.confidence.quality}；价值分 ${result.confidence.value}`);
  lines.push(`- ${result.confidence.note}`);
  lines.push("");
  return lines.join("\n");
}

export function writeWorkbuddyReport(result, options = {}) {
  const workspace = options.workspace || process.cwd();
  const dir = path.join(workspace, "outputs");
  const date = options.date || localDateStamp();
  const safeName = String(result.input.name || "package").replace(/[^\w.-]+/g, "-");
  const file = path.join(dir, `wb-audit-${safeName}-${date}.md`);
  fs.mkdirSync(dir, { recursive: true });
  const markdown = renderWorkbuddyMarkdown(result);
  fs.writeFileSync(file, markdown, "utf8");
  return { ok: true, path: file, bytes: Buffer.byteLength(markdown), generatedAt: result.generatedAt };
}

/** 给面板/CLI 用的紧凑摘要。 */
export function workbuddySummary(result) {
  return {
    name: result.input.name,
    kind: result.input.kind,
    profileLabel: result.input.profileLabel,
    version: result.input.version,
    domain: result.input.domain,
    blockers: result.gate.blockerCount,
    majors: result.gate.majorCount,
    minors: result.gate.minorCount,
    verdict: result.gate.verdict,
    q: result.quality.score,
    vRaw: result.value.raw,
    v: result.value.final,
    grade: result.value.grade,
    price: result.value.priceBand ? result.value.priceBand.price : "不上架",
    subscription: result.value.subscription ? result.value.subscription.price : "",
  };
}
