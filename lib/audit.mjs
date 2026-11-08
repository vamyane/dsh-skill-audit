/**
 * dsh-skill-audit 核心审计逻辑（宿主半边 / 浏览器面板 / CLI / 测试共用）。
 *
 * 纯 Node 内置模块，无网络、无第三方依赖、只读扫描，绝不修改被扫描的资产。
 * 扫描三处来源：
 *   1. ~/.dsh/skills/<技能>/             —— 技能（SKILL.md + frontmatter）
 *   2. <profile>/node_modules/*           —— 声明了 dsh.bundle 的已安装插件
 *   3. <workspace>/dsh-plugins/*          —— 工作区里正在开发的插件
 *
 * 每个资产跑一组检查项，逐项给出 pass / warn / fail / skip、说明与修复建议，
 * 再按权重折算 0-100 分与 S/A/B/C/D 等级。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 与 package.json 的 version 保持一致（构建自检会比对）。 */
export const VERSION = "0.1.0";

/* ------------------------------------------------------------------ */
/* 评分规则：检查项 id -> 权重（没列出的检查项权重为 0，不参与计分）      */
/* ------------------------------------------------------------------ */

export const SKILL_RUBRIC = {
  "skill-md": 20,
  "skill-description": 20,
  "skill-author": 10,
  "skill-name": 10,
  "skill-license": 10,
  "skill-secrets": 20,
  "skill-privacy": 10,
};

export const PLUGIN_RUBRIC = {
  "pkg-json": 5,
  "bundle-declared": 15,
  "patch-row": 15,
  "client-id": 10,
  "host-name": 10,
  "readme": 5,
  "readme-bilingual": 5,
  "license": 7,
  "icon-512": 10,
  "files-field": 5,
  "secrets": 10,
  "privacy": 3,
};

/** 等级门槛（从高到低匹配）。 */
export const GRADE_BANDS = [
  { grade: "S", min: 90, label: "优秀" },
  { grade: "A", min: 80, label: "良好" },
  { grade: "B", min: 70, label: "可用" },
  { grade: "C", min: 60, label: "待修" },
  { grade: "D", min: 0, label: "不合格" },
];

/* ------------------------------------------------------------------ */
/* 敏感信息 / 本机路径粗扫规则（只报类型与数量，不把命中内容写进报告）    */
/* ------------------------------------------------------------------ */

const SECRET_RULES = [
  { id: "openai-key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { id: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { id: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { id: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/ },
  { id: "assigned-secret", re: /\b(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|password)\b\s*[:=]\s*["'][^"'\s]{12,}["']/i },
];

const PRIVACY_RULES = [
  { id: "windows-home", re: /[A-Za-z]:\\Users\\[^\\/\s"'<>]+/g },
  { id: "mac-home", re: /\/Users\/[^\/\s"'<>]+/g },
  { id: "linux-home", re: /\/home\/[^\/\s"'<>]+/g },
];

const TEXT_EXTS = new Set([
  ".md", ".mdx", ".json", ".yml", ".yaml", ".js", ".mjs", ".cjs", ".ts",
  ".py", ".sh", ".ps1", ".txt", ".html", ".css", ".toml",
]);

const READ_LIMIT = 256 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* ------------------------------------------------------------------ */
/* 文件系统小工具                                                      */
/* ------------------------------------------------------------------ */

function safeStat(target) {
  try {
    return fs.statSync(target);
  } catch {
    return undefined;
  }
}

function isFile(target) {
  const stat = safeStat(target);
  return stat !== undefined && stat.isFile();
}

function isDir(target) {
  const stat = safeStat(target);
  return stat !== undefined && stat.isDirectory();
}

function readText(file, limit = READ_LIMIT) {
  const stat = safeStat(file);
  if (stat === undefined || !stat.isFile()) return "";
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const size = Math.min(stat.size, limit);
    if (size <= 0) return "";
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const read = fs.readSync(fd, buffer, offset, size - offset, offset);
      if (!read) break;
      offset += read;
    }
    return buffer.toString("utf8", 0, offset);
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function readJson(file) {
  const text = readText(file, 4 * 1024 * 1024);
  if (!text) return { ok: false, error: "文件不存在或为空" };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

function listSubdirs(dir, { includeHidden = false } = {}) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const result = [];
  for (const entry of entries) {
    if (!includeHidden && entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (isDir(full)) result.push(full);
  }
  result.sort((a, b) => a.localeCompare(b));
  return result;
}

function realKey(dir) {
  try {
    const real = fs.realpathSync(dir);
    return process.platform === "win32" ? real.toLowerCase() : real;
  } catch {
    return path.resolve(dir);
  }
}

function fmtBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function relOf(root, file) {
  try {
    return path.relative(root, file).replace(/\\/g, "/") || ".";
  } catch {
    return file;
  }
}

/* ------------------------------------------------------------------ */
/* 解析：frontmatter / cordis.patch.yml / PNG 头 / 模块声明              */
/* ------------------------------------------------------------------ */

export function parseFrontmatter(text) {
  if (typeof text !== "string") return null;
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/);
  if (lines.length < 3 || lines[0].trim() !== "---") return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const data = {};
  let i = 1;
  while (i < end) {
    const match = lines[i].match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) {
      i++;
      continue;
    }
    const key = match[1];
    let value = match[2].trim();
    // YAML 块标量：description: >- / | 后面接缩进的续行
    if (!value || /^[>|][+-]?$/.test(value)) {
      const parts = [];
      let j = i + 1;
      while (j < end) {
        const next = lines[j];
        if (next.trim() === "") {
          parts.push("");
          j++;
          continue;
        }
        const indent = next.length - next.trimStart().length;
        if (indent === 0) break;
        parts.push(next.trim());
        j++;
      }
      value = parts.join(" ").replace(/\s+/g, " ").trim();
      i = j;
    } else {
      i++;
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).trim();
    }
    data[key] = value;
  }
  return data;
}

/**
 * 极简 cordis.patch.yml 解析：只关心 insert 下的 row（id / name）。
 * 不引入 yaml 依赖，够用且对注释、缩进、短横线写法宽容。
 */
export function parsePatchRows(text) {
  const rows = [];
  if (typeof text !== "string") return rows;
  const lines = text.split(/\r?\n/);
  let inInsert = false;
  let insertIndent = 0;
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (/^-?\s*insert\s*:\s*$/.test(trimmed)) {
      inInsert = true;
      insertIndent = indent;
      current = null;
      continue;
    }
    if (inInsert && indent <= insertIndent && !trimmed.startsWith("-")) {
      // 回到顶层 key，insert 段结束
      inInsert = false;
      current = null;
      continue;
    }
    if (!inInsert) continue;
    const idMatch = trimmed.match(/^-\s*id\s*:\s*(.+)$/);
    if (idMatch) {
      current = { id: idMatch[1].trim().replace(/^["']|["']$/g, ""), name: "" };
      rows.push(current);
      continue;
    }
    const nameMatch = trimmed.match(/^name\s*:\s*(.+)$/);
    if (nameMatch && current !== null && !current.name) {
      current.name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return rows;
}

/** 读 PNG 头拿宽高；不是 PNG 返回 null。 */
export function readPngInfo(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const header = Buffer.alloc(26);
    const read = fs.readSync(fd, header, 0, header.length, 0);
    if (read < 24) return null;
    if (!header.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
    return {
      width: header.readUInt32BE(16),
      height: header.readUInt32BE(20),
      bytes: stat.size,
    };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/** 浏览器半边的模块 id：window.__ModuleLoader__.load({ id: "..." }) */
export function readClientModuleId(text) {
  if (typeof text !== "string" || !text) return "";
  const match = text.match(
    /__ModuleLoader__\s*\.load\(\s*\{[\s\S]{0,800}?\bid\s*:\s*["'`]([^"'`]+)["'`]/,
  );
  return match ? match[1] : "";
}

/** 宿主半边的 name 声明（ESM export / CommonJS exports 都认）。 */
export function readHostModuleName(text) {
  if (typeof text !== "string" || !text) return "";
  const patterns = [
    /export\s+(?:const|let|var)\s+name\s*=\s*["'`]([^"'`]+)["'`]/,
    /exports\.name\s*=\s*["'`]([^"'`]+)["'`]/,
    /module\.exports\.name\s*=\s*["'`]([^"'`]+)["'`]/,
    /(?:^|\n)(?:const|let|var)\s+name\s*=\s*["'`]([^"'`]+)["'`]/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return "";
}

/* ------------------------------------------------------------------ */
/* 检查项 / 打分                                                       */
/* ------------------------------------------------------------------ */

function check(status, id, label, detail, hint) {
  return { id, label, status, detail: detail || "", hint: hint || "" };
}

export function gradeOf(score) {
  for (const band of GRADE_BANDS) {
    if (score >= band.min) return band.grade;
  }
  return "D";
}

export function scoreOf(checks, rubric) {
  let weightTotal = 0;
  let gained = 0;
  for (const item of checks) {
    const weight = rubric[item.id] || 0;
    if (!weight || item.status === "skip") continue;
    weightTotal += weight;
    if (item.status === "pass") gained += weight;
    else if (item.status === "warn") gained += weight * 0.5;
  }
  if (!weightTotal) return 0;
  return Math.max(0, Math.min(100, Math.round((gained / weightTotal) * 100)));
}

function finishAsset(base) {
  const counts = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const item of base.checks) counts[item.status] = (counts[item.status] || 0) + 1;
  const score = scoreOf(base.checks, base.rubric);
  return {
    ...base,
    score,
    grade: gradeOf(score),
    counts,
    problems: base.checks.filter((item) => item.status === "fail" || item.status === "warn"),
  };
}

/* ------------------------------------------------------------------ */
/* 敏感信息扫描                                                        */
/* ------------------------------------------------------------------ */

function scanSecretHits(files) {
  const hits = [];
  const seen = new Set();
  for (const item of files) {
    if (!item.text) continue;
    for (const rule of SECRET_RULES) {
      if (seen.has(rule.id)) continue;
      if (rule.re.test(item.text)) {
        seen.add(rule.id);
        hits.push({ type: rule.id, file: item.file });
      }
    }
  }
  return hits;
}

function countPrivacyHits(files) {
  let count = 0;
  for (const item of files) {
    if (!item.text) continue;
    for (const rule of PRIVACY_RULES) {
      const matches = item.text.match(new RegExp(rule.re.source, "g"));
      if (matches) count += matches.length;
    }
  }
  return count;
}

/** 收集目录顶层的文本文件（不递归，最多 maxFiles 个），用于粗扫。 */
function collectTopLevelText(dir, maxFiles = 16) {
  const files = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (!isFile(full)) continue;
    if (!TEXT_EXTS.has(path.extname(entry.name).toLowerCase())) continue;
    files.push({ file: full, text: readText(full) });
    if (files.length >= maxFiles) break;
  }
  return files;
}

function secretsCheck(files, id, label) {
  const hits = scanSecretHits(files);
  if (hits.length === 0) {
    return check("pass", id, label, "未发现明显密钥 / Token 模式", "");
  }
  return check(
    "fail",
    id,
    label,
    `疑似敏感信息 ${hits.length} 类（值已打码）：${hits.map((hit) => hit.type).join("、")}`,
    "删除或改成占位符（如 sk-*** / 从环境变量读取），确认没有把真实密钥打进包或文档。",
  );
}

function privacyCheck(files, id, label) {
  const count = countPrivacyHits(files);
  if (count === 0) {
    return check("pass", id, label, "未发现本机绝对路径（用户名等隐私信息）", "");
  }
  return check(
    "warn",
    id,
    label,
    `发现 ${count} 处本机绝对路径（用户名已隐藏）`,
    "发布前把本机路径改成 ~ 或相对路径；发给他人 / 公开仓库时避免泄漏用户名与目录结构。",
  );
}

/* ------------------------------------------------------------------ */
/* 技能审计                                                            */
/* ------------------------------------------------------------------ */

export function auditSkill(dir) {
  const dirName = path.basename(dir);
  const skillFile = path.join(dir, "SKILL.md");
  const skillText = isFile(skillFile) ? readText(skillFile) : "";
  const hasSkillMd = skillText.trim().length > 0;
  const frontmatter = hasSkillMd ? parseFrontmatter(skillText) : null;
  const checks = [];

  checks.push(
    check(
      hasSkillMd ? "pass" : "fail",
      "skill-md",
      "SKILL.md",
      hasSkillMd
        ? `已找到 SKILL.md（${fmtBytes(Buffer.byteLength(skillText))}）`
        : "缺少 SKILL.md，DSH 不会把这个目录识别为技能",
      "在技能目录根新增 SKILL.md，并写 YAML frontmatter（至少 name / description）。",
    ),
  );

  if (!hasSkillMd) {
    checks.push(check("skip", "skill-description", "frontmatter description", "没有 SKILL.md，跳过", "先补 SKILL.md。"));
  } else if (frontmatter === null) {
    checks.push(
      check(
        "fail",
        "skill-description",
        "frontmatter description",
        "SKILL.md 缺少 YAML frontmatter（文件开头没有 --- 包裹的块）",
        "在 SKILL.md 开头加 --- 块，写 name、description、author；description 写清「做什么 + 什么时候触发」。",
      ),
    );
  } else {
    const description = frontmatter.description || "";
    if (!description) {
      checks.push(
        check("fail", "skill-description", "frontmatter description", "frontmatter 里没有 description", "补 description，并写清触发场景与关键词。"),
      );
    } else if (description.length < 20) {
      checks.push(
        check("warn", "skill-description", "frontmatter description", `description 只有 ${description.length} 字，触发面太窄`, "补到 40 字以上，包含「做什么 + 用户会怎么问」。"),
      );
    } else {
      checks.push(check("pass", "skill-description", "frontmatter description", `description ${description.length} 字`, ""));
    }
  }

  if (!hasSkillMd) {
    checks.push(check("skip", "skill-author", "frontmatter author", "没有 SKILL.md，跳过", "先补 SKILL.md。"));
  } else if (frontmatter === null) {
    checks.push(check("skip", "skill-author", "frontmatter author", "frontmatter 不可用，跳过", "先修 frontmatter。"));
  } else if (!frontmatter.author) {
    checks.push(
      check("warn", "skill-author", "frontmatter author", "frontmatter 缺 author", "补 author 字段（开源可写 GitHub 用户名 / 组织名）。"),
    );
  } else {
    checks.push(check("pass", "skill-author", "frontmatter author", `author: ${frontmatter.author}`, ""));
  }

  if (!hasSkillMd || frontmatter === null) {
    checks.push(check("skip", "skill-name", "frontmatter name", "没有可用 frontmatter，跳过", "先补 SKILL.md / frontmatter。"));
  } else if (!frontmatter.name) {
    checks.push(check("warn", "skill-name", "frontmatter name", "frontmatter 缺 name", `补 name: ${dirName}（与目录名一致，便于定位）。`));
  } else if (frontmatter.name !== dirName) {
    checks.push(
      check("warn", "skill-name", "frontmatter name", `name「${frontmatter.name}」与目录名「${dirName}」不一致`, "把目录名与 frontmatter.name 统一，避免引用时对不上。"),
    );
  } else {
    checks.push(check("pass", "skill-name", "frontmatter name", `name 与目录名一致（${dirName}）`, ""));
  }

  const licenseFile = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"].map((name) => path.join(dir, name)).find(isFile);
  if (licenseFile) {
    checks.push(check("pass", "skill-license", "LICENSE", `已找到 ${path.basename(licenseFile)}`, ""));
  } else {
    const fmLicense = frontmatter !== null && (frontmatter.license || frontmatter.licence);
    checks.push(
      check(
        "warn",
        "skill-license",
        "LICENSE",
        fmLicense ? `仅 frontmatter 声明 ${fmLicense}，缺 LICENSE 文件` : "缺少 LICENSE 文件",
        "加 LICENSE（开源常用 MIT / Apache-2.0），并在 SKILL.md 或 README 里注明许可。",
      ),
    );
  }

  const scanFiles = collectTopLevelText(dir);
  checks.push(secretsCheck(scanFiles, "skill-secrets", "敏感信息"));
  checks.push(privacyCheck(scanFiles, "skill-privacy", "本机路径 / 隐私"));

  const issueCount = checks.filter((item) => item.status === "fail" || item.status === "warn").length;
  return finishAsset({
    id: `skill:${dirName}`,
    name: dirName,
    type: "skill",
    scope: "skills",
    path: dir,
    version: "",
    rubric: SKILL_RUBRIC,
    checks,
    issueCount,
  });
}

/* ------------------------------------------------------------------ */
/* 插件审计                                                            */
/* ------------------------------------------------------------------ */

function packageDirNameMatches(pkgName, dirName) {
  if (!pkgName) return false;
  if (pkgName === dirName) return true;
  const last = pkgName.split("/").pop();
  return last === dirName;
}

function resolvePackageFile(pkgRoot, rel) {
  if (typeof rel !== "string" || !rel.trim()) return "";
  return path.resolve(pkgRoot, rel.trim());
}

function exportTarget(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    if (typeof entry.default === "string") return entry.default;
    for (const key of ["import", "require", "node"]) {
      if (typeof entry[key] === "string") return entry[key];
    }
  }
  return "";
}

function resolveMainFile(pkgRoot, pkg) {
  const candidates = [];
  const exportsRoot = pkg && pkg.exports;
  if (exportsRoot && typeof exportsRoot === "object") {
    const target = exportTarget(exportsRoot["."]);
    if (target) candidates.push(target);
    else if (typeof exportsRoot["."] === "string") candidates.push(exportsRoot["."]);
  }
  if (pkg && typeof pkg.main === "string") candidates.push(pkg.main);
  if (pkg && typeof pkg.module === "string") candidates.push(pkg.module);
  candidates.push("lib/index.js", "index.js", "entry.js");
  for (const candidate of candidates) {
    const full = path.resolve(pkgRoot, candidate);
    if (isFile(full)) return full;
  }
  return "";
}

function resolveClientFile(pkgRoot, pkg) {
  const candidates = [];
  const exportsRoot = pkg && pkg.exports;
  if (exportsRoot && typeof exportsRoot === "object" && exportsRoot["./client"] !== undefined) {
    const target = exportTarget(exportsRoot["./client"]);
    if (target) candidates.push(target);
  }
  if (pkg && pkg.dsh && pkg.dsh.client && typeof pkg.dsh.client.entry === "string") {
    candidates.push(pkg.dsh.client.entry);
  }
  candidates.push("lib/client.js", "client.js", "lib/client.mjs");
  for (const candidate of candidates) {
    const full = path.resolve(pkgRoot, candidate);
    if (isFile(full)) return full;
  }
  return "";
}

function mainSegment(mainFile, pkgRoot) {
  const rel = relOf(pkgRoot, mainFile);
  const first = rel.split("/")[0];
  return first === "." ? "" : first;
}

function filesIncludes(files, token) {
  if (!Array.isArray(files)) return false;
  const needle = String(token).replace(/\\/g, "/").toLowerCase();
  if (!needle) return false;
  return files.some((entry) => {
    const value = String(entry).replace(/\\/g, "/").toLowerCase();
    return value === needle || value.startsWith(`${needle}/`) || value.startsWith(needle);
  });
}

function readmeFiles(pkgRoot) {
  let names = [];
  try {
    names = fs.readdirSync(pkgRoot);
  } catch {
    return [];
  }
  return names.filter((name) => /^readme(?:\.[a-z0-9-]+)?\.md$/i.test(name)).sort();
}

export function auditPlugin(dir, scope = "profile") {
  const dirName = path.basename(dir);
  const pkgRead = readJson(path.join(dir, "package.json"));
  const pkg = pkgRead.ok ? pkgRead.data : null;
  const pkgName = pkg && typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : dirName;
  const version = pkg && typeof pkg.version === "string" ? pkg.version : "";
  const checks = [];

  /* 1. package.json */
  if (!pkgRead.ok) {
    checks.push(
      check("fail", "pkg-json", "package.json", `无法读取 / 解析 package.json：${pkgRead.error}`, "补 package.json（name/version/main/license），并确保是合法 JSON。"),
    );
  } else if (!packageDirNameMatches(pkgName, dirName)) {
    checks.push(
      check("warn", "pkg-json", "package.json", `name「${pkgName}」与目录名「${dirName}」不一致`, "发布前把目录名与 package.json name 统一。"),
    );
  } else {
    checks.push(check("pass", "pkg-json", "package.json", `${pkgName}@${version || "0.0.0"}`, ""));
  }

  /* 2. dsh.bundle 声明 + patch 文件是否存在 */
  const bundle = pkg && pkg.dsh && typeof pkg.dsh === "object" ? pkg.dsh.bundle : undefined;
  let patchFile = "";
  if (!bundle || typeof bundle !== "object") {
    checks.push(
      check("fail", "bundle-declared", "dsh.bundle", "package.json 没有声明 dsh.bundle", '加 "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }，DSH 才会把它当插件 bundle 挂载。'),
    );
  } else if (typeof bundle.patch !== "string" || !bundle.patch.trim()) {
    checks.push(check("warn", "bundle-declared", "dsh.bundle", "dsh.bundle 存在但没有 patch 路径", '补 "patch": "./cordis.patch.yml"。'));
  } else {
    patchFile = resolvePackageFile(dir, bundle.patch);
    if (!isFile(patchFile)) {
      checks.push(
        check("fail", "bundle-declared", "dsh.bundle", `dsh.bundle.patch 指向的 ${bundle.patch} 不存在`, "补 cordis.patch.yml，或修正 patch 路径。"),
      );
      patchFile = "";
    } else {
      checks.push(check("pass", "bundle-declared", "dsh.bundle", `patch: ${bundle.patch}`, ""));
    }
  }

  /* 3. cordis.patch.yml 的 row name 必须等于包名 */
  if (!pkgRead.ok || !bundle || typeof bundle !== "object") {
    checks.push(check("skip", "patch-row", "cordis.patch.yml row name", "没有可用 dsh.bundle，跳过", "先修 dsh.bundle。"));
  } else if (!patchFile) {
    checks.push(check("skip", "patch-row", "cordis.patch.yml row name", "patch 文件不存在，跳过", "先补 cordis.patch.yml。"));
  } else {
    const rows = parsePatchRows(readText(patchFile));
    const rowNames = rows.map((row) => row.name || `(id:${row.id || "?"})`);
    if (rows.length === 0) {
      checks.push(
        check("fail", "patch-row", "cordis.patch.yml row name", "没有解析到 insert 下的 row", "补 - insert: 后跟 - id / name 的 row，name 必须等于包名。"),
      );
    } else if (rows.some((row) => row.name === pkgName)) {
      checks.push(check("pass", "patch-row", "cordis.patch.yml row name", `row name 与包名一致（${pkgName}）`, ""));
    } else {
      checks.push(
        check("fail", "patch-row", "cordis.patch.yml row name", `row name「${rowNames.join("、")}」≠ 包名「${pkgName}」`, "把 row 的 name 改成与 package.json name 完全一致，否则挂载会按名字找不到插件。"),
      );
    }
  }

  /* 4. 浏览器半边模块 id 必须等于包名 */
  const clientDecl = pkg && pkg.dsh && typeof pkg.dsh === "object" ? pkg.dsh.client : undefined;
  if (!clientDecl) {
    checks.push(check("skip", "client-id", "client 模块 id", "未声明 dsh.client（无浏览器半边），跳过", ""));
  } else {
    const clientFile = resolveClientFile(dir, pkg);
    if (!clientFile) {
      checks.push(
        check("fail", "client-id", "client 模块 id", "声明了 dsh.client 但找不到 client 入口（lib/client.js 等）", "构建浏览器半边到 lib/client.js，并在 exports 里暴露 ./client。"),
      );
    } else {
      const moduleId = readClientModuleId(readText(clientFile));
      if (!moduleId) {
        checks.push(
          check("fail", "client-id", "client 模块 id", "client 文件里找不到 __ModuleLoader__.load({ id })", "按 DSH 客户端模块格式注册：window.__ModuleLoader__.load({ id: 包名, factory })。"),
        );
      } else if (moduleId !== pkgName) {
        checks.push(
          check("fail", "client-id", "client 模块 id", `client id「${moduleId}」≠ 包名「${pkgName}」`, "把 __ModuleLoader__.load 的 id 改成与包名一致。"),
        );
      } else {
        checks.push(check("pass", "client-id", "client 模块 id", `client id 与包名一致（${moduleId}）`, ""));
      }
    }
  }

  /* 5. 宿主半边 name 必须等于包名 */
  const mainFile = resolveMainFile(dir, pkg);
  if (!mainFile) {
    checks.push(
      check("warn", "host-name", "宿主 name", "找不到宿主入口（main / exports / lib/index.js）", "补 main 入口；纯 patch bundle 可忽略此项。"),
    );
  } else {
    const hostName = readHostModuleName(readText(mainFile));
    if (!hostName) {
      checks.push(
        check("warn", "host-name", "宿主 name", `静态解析不到 name（${relOf(dir, mainFile)}）`, "在宿主入口里写 export const name = \"包名\"；纯 preset bundle 可忽略。"),
      );
    } else if (hostName !== pkgName) {
      checks.push(
        check("fail", "host-name", "宿主 name", `host name「${hostName}」≠ 包名「${pkgName}」`, "把宿主入口的 name 改成与包名一致，避免运行时标识混乱。"),
      );
    } else {
      checks.push(check("pass", "host-name", "宿主 name", `host name 与包名一致（${hostName}）`, ""));
    }
  }

  /* 6/7. README 与双语 README */
  const readmes = readmeFiles(dir);
  if (readmes.length === 0) {
    checks.push(check("warn", "readme", "README", "缺少 README", "补 README.md，写清安装、用法、配置与已知限制。"));
  } else {
    checks.push(check("pass", "readme", "README", `已找到 ${readmes.join("、")}`, ""));
  }
  const hasZh = readmes.some((name) => /^readme\.zh(?:-[a-z]+)?\.md$/i.test(name));
  const hasEn = readmes.some((name) => /^readme\.en(?:-[a-z]+)?\.md$/i.test(name));
  const hasBase = readmes.some((name) => /^readme\.md$/i.test(name));
  if ((hasBase && (hasZh || hasEn)) || (hasZh && hasEn)) {
    checks.push(check("pass", "readme-bilingual", "README 中英", `中英双语：${readmes.join("、")}`, ""));
  } else {
    checks.push(
      check("warn", "readme-bilingual", "README 中英", readmes.length ? "只有单语 README（或缺少 README.md 主文件）" : "没有 README", "补第二语言：README.md + README.zh.md（或 README.en.md）。"),
    );
  }

  /* 8. LICENSE */
  const licenseFile = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"].map((name) => path.join(dir, name)).find(isFile);
  const pkgLicense = pkg && typeof pkg.license === "string" ? pkg.license : "";
  if (licenseFile) {
    checks.push(check("pass", "license", "LICENSE", `已找到 ${path.basename(licenseFile)}`, ""));
  } else if (pkgLicense) {
    checks.push(
      check("fail", "license", "LICENSE", `package.json 声明 ${pkgLicense} 但缺 LICENSE 文件`, "把许可证正文加到 LICENSE 文件（npm 包与仓库都需要）。"),
    );
  } else {
    checks.push(check("fail", "license", "LICENSE", "缺少 LICENSE 文件与 license 字段", "加 LICENSE（如 MIT）并给 package.json 补 license 字段。"));
  }

  /* 9. icon 512x512 */
  const iconRel = pkg && typeof pkg.icon === "string" ? pkg.icon : "";
  if (!iconRel) {
    checks.push(check("warn", "icon-512", "icon 512×512", "package.json 未声明 icon", '加 "icon": "assets/icon.png"（512×512 PNG），面板/市场才有图。'));
  } else {
    const iconFile = resolvePackageFile(dir, iconRel);
    if (!isFile(iconFile)) {
      checks.push(check("fail", "icon-512", "icon 512×512", `icon 指向的 ${iconRel} 不存在`, "补图标文件，或修正 icon 路径。"));
    } else if (path.extname(iconFile).toLowerCase() !== ".png") {
      checks.push(check("warn", "icon-512", "icon 512×512", `${iconRel} 不是 PNG，无法按 512×512 校验`, "优先用 512×512 PNG（≤500 KB），小尺寸下也要清晰。"));
    } else {
      const png = readPngInfo(iconFile);
      if (!png) {
        checks.push(check("fail", "icon-512", "icon 512×512", `${iconRel} 不是合法 PNG`, "重新导出为 512×512 PNG。"));
      } else if (png.width !== 512 || png.height !== 512) {
        checks.push(
          check("warn", "icon-512", "icon 512×512", `${iconRel} 实际 ${png.width}×${png.height}（要求 512×512）`, "按 512×512 重新导出；DONE 列表与市场对尺寸有要求。"),
        );
      } else {
        const sizeNote = png.bytes > 500 * 1024 ? `，但体积 ${fmtBytes(png.bytes)} 超过 500 KB` : `（${fmtBytes(png.bytes)}）`;
        checks.push(
          check(
            png.bytes > 500 * 1024 ? "warn" : "pass",
            "icon-512",
            "icon 512×512",
            `512×512 PNG${sizeNote}`,
            png.bytes > 500 * 1024 ? "压缩到 500 KB 以内。" : "",
          ),
        );
      }
    }
  }

  /* 10. files 白名单是否覆盖必要文件 */
  if (!pkg || !Array.isArray(pkg.files) || pkg.files.length === 0) {
    checks.push(
      check("warn", "files-field", "files 白名单", "package.json 缺少 files 字段（npm 会把全部目录打进包）", "加 files 白名单：lib、app、assets、README*、LICENSE、cordis.patch.yml。"),
    );
  } else {
    const required = [];
    if (mainFile) required.push(mainSegment(mainFile, dir));
    required.push("cordis.patch.yml", "README", "LICENSE");
    if (iconRel) required.push(iconRel.replace(/\\/g, "/").split("/")[0]);
    if (isDir(path.join(dir, "app"))) required.push("app");
    const missing = [...new Set(required.filter((token) => token && !filesIncludes(pkg.files, token)))];
    if (missing.length) {
      checks.push(
        check("warn", "files-field", "files 白名单", `files 未包含：${missing.join("、")}`, "把缺少的目录/文件补进 files，npm 打包后运行时才不会缺文件。"),
      );
    } else {
      checks.push(check("pass", "files-field", "files 白名单", `已覆盖 ${[...new Set(required)].filter(Boolean).join("、")}`, ""));
    }
  }

  /* 11/12. 敏感信息与本机路径粗扫 */
  const scanFiles = [];
  const pkgText = readText(path.join(dir, "package.json"), 512 * 1024);
  if (pkgText) scanFiles.push({ file: path.join(dir, "package.json"), text: pkgText });
  for (const name of readmes.slice(0, 2)) {
    const file = path.join(dir, name);
    scanFiles.push({ file, text: readText(file) });
  }
  if (patchFile) scanFiles.push({ file: patchFile, text: readText(patchFile) });
  if (mainFile) scanFiles.push({ file: mainFile, text: readText(mainFile) });
  checks.push(secretsCheck(scanFiles, "secrets", "敏感信息"));
  checks.push(privacyCheck(scanFiles, "privacy", "本机路径 / 隐私"));

  const issueCount = checks.filter((item) => item.status === "fail" || item.status === "warn").length;
  return finishAsset({
    id: `${scope === "workspace" ? "workspace-plugin" : "plugin"}:${pkgName}`,
    name: pkgName,
    type: "plugin",
    scope,
    path: dir,
    version,
    rubric: PLUGIN_RUBRIC,
    checks,
    issueCount,
  });
}

/* ------------------------------------------------------------------ */
/* 扫描三处来源                                                        */
/* ------------------------------------------------------------------ */

export function findBundlePackageDirs(nodeModulesDir) {
  const result = [];
  let entries = [];
  try {
    entries = fs.readdirSync(nodeModulesDir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(nodeModulesDir, entry.name);
    if (!isDir(full)) continue;
    if (entry.name.startsWith("@")) {
      result.push(...findBundlePackageDirs(full));
      continue;
    }
    const pkgRead = readJson(path.join(full, "package.json"));
    if (!pkgRead.ok || !pkgRead.data || typeof pkgRead.data !== "object") continue;
    const dsh = pkgRead.data.dsh;
    if (dsh && typeof dsh === "object" && dsh.bundle) result.push(full);
  }
  return result;
}

function resolveProfileDirs({ dshHome, profiles, env }) {
  if (Array.isArray(profiles) && profiles.length) {
    return profiles.map((item) => path.resolve(item));
  }
  const envProfile = env && typeof env.DSH_PROFILE_DIR === "string" ? env.DSH_PROFILE_DIR.trim() : "";
  if (envProfile) return [path.resolve(envProfile)];
  return listSubdirs(path.join(dshHome, "profiles"));
}

function summarize(assets) {
  const grades = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  let failed = 0;
  let warned = 0;
  let sum = 0;
  for (const asset of assets) {
    grades[asset.grade] = (grades[asset.grade] || 0) + 1;
    failed += asset.counts.fail;
    warned += asset.counts.warn;
    sum += asset.score;
  }
  return {
    total: assets.length,
    skills: assets.filter((asset) => asset.type === "skill").length,
    plugins: assets.filter((asset) => asset.type === "plugin").length,
    workspacePlugins: assets.filter((asset) => asset.scope === "workspace").length,
    average: assets.length ? Math.round((sum / assets.length) * 10) / 10 : 0,
    grades,
    failedChecks: failed,
    warnedChecks: warned,
  };
}

/**
 * 扫描全部资产。
 * @param {object} [options]
 * @param {string} [options.workspace] - 工作区根（用它的 dsh-plugins/）
 * @param {string} [options.dshHome] - DSH_HOME，默认 env 或 ~/.dsh
 * @param {string[]} [options.profiles] - profile 目录列表，默认 env DSH_PROFILE_DIR 或全部 profiles
 * @param {object} [options.env] - 环境变量对象（测试注入）
 * @param {string} [options.workspaceSource] - workspace 来源（client/env/config/cwd），仅透传展示
 * @returns {object} 扫描结果
 */
export function scanAll(options = {}) {
  const startedAt = Date.now();
  const env = options.env || process.env;
  const dshHome = path.resolve(options.dshHome || env.DSH_HOME || path.join(os.homedir(), ".dsh"));
  const workspace = path.resolve(options.workspace || process.cwd());
  const skillsDir = path.join(dshHome, "skills");
  const profileDirs = resolveProfileDirs({ dshHome, profiles: options.profiles, env });
  const workspacePluginsDir = path.join(workspace, "dsh-plugins");

  const assets = [];
  const seen = new Map();
  const push = (asset) => {
    const key = `${asset.type}:${realKey(asset.path)}`;
    if (seen.has(key)) return;
    seen.set(key, true);
    assets.push(asset);
  };

  const skillDirs = listSubdirs(skillsDir);
  for (const dir of skillDirs) push(auditSkill(dir));

  const profileReport = [];
  for (const profileDir of profileDirs) {
    const nodeModulesDir = path.join(profileDir, "node_modules");
    const pkgDirs = findBundlePackageDirs(nodeModulesDir);
    for (const pkgDir of pkgDirs) push(auditPlugin(pkgDir, "profile"));
    profileReport.push({ dir: profileDir, pluginCount: pkgDirs.length });
  }

  const workspacePluginDirs = listSubdirs(workspacePluginsDir).filter(
    (dir) => path.basename(dir) !== "node_modules",
  );
  for (const dir of workspacePluginDirs) push(auditPlugin(dir, "workspace"));

  const sorted = assets.sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score;
    return left.name.localeCompare(right.name);
  });

  return {
    tool: "dsh-skill-audit",
    version: VERSION,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    workspace,
    workspaceSource: options.workspaceSource || "cwd",
    dshHome,
    roots: {
      skillsDir,
      skillCount: skillDirs.length,
      profiles: profileReport,
      workspacePluginsDir,
      workspacePluginCount: workspacePluginDirs.length,
    },
    summary: summarize(sorted),
    assets: sorted,
  };
}

/* ------------------------------------------------------------------ */
/* 工作区解析                                                          */
/* ------------------------------------------------------------------ */

export function readAuditConfig(dshHome) {
  const pkgConfig = path.join(dshHome, "skill-audit.config.json");
  const read = readJson(pkgConfig);
  return read.ok && read.data && typeof read.data === "object" ? read.data : {};
}

export function normalizeWorkspaceDir(candidate) {
  if (typeof candidate !== "string" || !candidate.trim()) return "";
  let resolved;
  try {
    resolved = path.resolve(candidate.trim());
  } catch {
    return "";
  }
  if (path.parse(resolved).root === resolved) return "";
  return isDir(resolved) ? resolved : "";
}

/**
 * 决定报告导出到哪个工作区。优先级：
 *   client（面板拿到的当前会话 cwd） > env.DSH_WORKSPACE > ~/.dsh/skill-audit.config.json > cwd
 */
export function resolveWorkspace(options = {}) {
  const env = options.env || process.env;
  const dshHome = path.resolve(options.dshHome || env.DSH_HOME || path.join(os.homedir(), ".dsh"));
  const config = readAuditConfig(dshHome);
  const candidates = [
    ["client", normalizeWorkspaceDir(options.hint)],
    ["env", normalizeWorkspaceDir(env.DSH_WORKSPACE)],
    ["config", normalizeWorkspaceDir(config.workspace)],
    ["cwd", normalizeWorkspaceDir(options.cwd || process.cwd())],
  ];
  for (const [source, value] of candidates) {
    if (value) return { path: value, source };
  }
  return { path: path.resolve(options.cwd || process.cwd()), source: "fallback" };
}

/* ------------------------------------------------------------------ */
/* Markdown 报告                                                       */
/* ------------------------------------------------------------------ */

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function localDateStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function localDateTime(date = new Date()) {
  return `${localDateStamp(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

const STATUS_ICON = { pass: "✅", warn: "⚠️", fail: "❌", skip: "➖" };
const TYPE_LABEL = { skill: "技能", plugin: "插件" };

export function renderMarkdown(result) {
  const lines = [];
  const summary = result.summary;
  const generated = localDateTime(new Date(result.generatedAt));
  const gradeParts = Object.entries(summary.grades)
    .map(([grade, count]) => `${grade} ${count}`)
    .join(" / ");

  lines.push("# DSH 技能 / 插件审核报告");
  lines.push("");
  lines.push(`> 由 dsh-skill-audit v${result.version} 生成 · ${generated}`);
  lines.push("");
  lines.push(`- 工作区：\`${result.workspace}\`（来源：${result.workspaceSource}）`);
  lines.push(`- 扫描范围：技能 ${summary.skills} · 已安装插件 ${summary.plugins} · 工作区插件 ${summary.workspacePlugins}`);
  lines.push(`- 综合评分：**${summary.average} / 100**（${gradeParts}）`);
  lines.push(`- 问题统计：❌ ${summary.failedChecks} 项失败 · ⚠️ ${summary.warnedChecks} 项警告`);
  lines.push("");

  lines.push("## 一、资产总览");
  lines.push("");
  lines.push("| # | 名称 | 类型 | 来源 | 版本 | 分数 | 等级 | ❌ | ⚠️ |");
  lines.push("|---|------|------|------|------|------|------|----|----|");
  result.assets.forEach((asset, index) => {
    const scope = asset.scope === "workspace" ? "工作区" : asset.scope === "skills" ? "~/.dsh/skills" : "profile";
    lines.push(
      `| ${index + 1} | ${asset.name} | ${TYPE_LABEL[asset.type] || asset.type} | ${scope} | ${asset.version || "-"} | ${asset.score} | ${asset.grade} | ${asset.counts.fail} | ${asset.counts.warn} |`,
    );
  });
  lines.push("");

  const problemAssets = result.assets.filter((asset) => asset.problems.length > 0);
  lines.push("## 二、问题与修复建议");
  lines.push("");
  if (problemAssets.length === 0) {
    lines.push("全部资产通过检查，没有需要修复的问题。🎉");
    lines.push("");
  } else {
    for (const asset of problemAssets) {
      lines.push(`### ${asset.name} · ${TYPE_LABEL[asset.type] || asset.type} · ${asset.score} / ${asset.grade}`);
      lines.push("");
      lines.push(`- 路径：\`${asset.path}\``);
      lines.push(`- 通过 ${asset.counts.pass} 项 · 警告 ${asset.counts.warn} 项 · 失败 ${asset.counts.fail} 项`);
      lines.push("");
      const ordered = [...asset.checks].sort((left, right) => {
        const rank = { fail: 0, warn: 1, pass: 2, skip: 3 };
        return (rank[left.status] || 9) - (rank[right.status] || 9);
      });
      for (const item of ordered) {
        if (item.status === "pass" || item.status === "skip") continue;
        lines.push(`- ${STATUS_ICON[item.status]} **${item.label}**：${item.detail}`);
        if (item.hint) lines.push(`  - 建议：${item.hint}`);
      }
      lines.push("");
    }
  }

  lines.push("## 三、全部检查明细");
  lines.push("");
  for (const asset of result.assets) {
    lines.push(`### ${asset.name}（${asset.score} / ${asset.grade}）`);
    lines.push("");
    for (const item of asset.checks) {
      lines.push(`- ${STATUS_ICON[item.status]} ${item.label}：${item.detail || "—"}`);
    }
    lines.push("");
  }

  lines.push("## 附录：检查项与权重");
  lines.push("");
  lines.push("| 类型 | 检查项 | 权重 |");
  lines.push("|------|--------|------|");
  for (const [id, weight] of Object.entries(SKILL_RUBRIC)) lines.push(`| 技能 | ${id} | ${weight} |`);
  for (const [id, weight] of Object.entries(PLUGIN_RUBRIC)) lines.push(`| 插件 | ${id} | ${weight} |`);
  lines.push("");
  lines.push(`> 计分：pass = 1，warn = 0.5，fail = 0，skip 不计入；S ≥ 90，A ≥ 80，B ≥ 70，C ≥ 60，其余 D。`);
  lines.push("");

  return lines.join("\n");
}

/**
 * 把 Markdown 报告写到 <workspace>/outputs/skill-audit-<date>.md。
 * @param {object} result - scanAll 的结果
 * @param {object} [options]
 * @param {string} [options.workspace] - 目标工作区（默认用 result.workspace）
 * @param {string} [options.date] - 覆盖日期戳（测试用）
 * @returns {{ok: boolean, path: string, bytes: number, generatedAt: string}}
 */
export function writeReport(result, options = {}) {
  const date = options.date || localDateStamp();
  const workspace = normalizeWorkspaceDir(options.workspace) || normalizeWorkspaceDir(result.workspace) || process.cwd();
  const dir = path.join(workspace, "outputs");
  const file = path.join(dir, `skill-audit-${date}.md`);
  fs.mkdirSync(dir, { recursive: true });
  const markdown = renderMarkdown(result);
  fs.writeFileSync(file, markdown, "utf8");
  return { ok: true, path: file, bytes: Buffer.byteLength(markdown), generatedAt: result.generatedAt };
}
