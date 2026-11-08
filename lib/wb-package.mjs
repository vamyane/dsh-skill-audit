/**
 * WorkBuddy 包读取层（纯 Node，无第三方依赖）。
 *
 * 支持两种输入：
 *   - 目录：直接只读扫描（技能包目录 / 专家包目录 / 外层包一层目录也行）
 *   - .zip：自己解析 ZIP 中央目录 + zlib.inflateRawSync（stored / deflate），
 *     不落盘；只有脚本语法检查需要时，才把脚本解压到系统临时目录并立即清理。
 *
 * 同时提供 YAML frontmatter 的「子集解析器」：够解析 SKILL.md / agents/*.md 的
 * 常见写法（标量、块标量、列表、简单嵌套 map），并收集 ': ' 引号陷阱等错误。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

export const WB_RUBRIC_VERSION = "1.0.1";

const MAX_DIR_FILES = 4000;
const MAX_TEXT_BYTES = 1024 * 1024;
const TEXT_EXTS = new Set([
  ".md", ".mdx", ".json", ".jsonc", ".yml", ".yaml", ".txt", ".csv", ".tsv",
  ".js", ".mjs", ".cjs", ".ts", ".py", ".sh", ".ps1", ".html", ".css", ".toml", ".ini",
]);
const SCRIPT_EXTS = new Set([".js", ".mjs", ".cjs", ".py"]);
const JUNK_PATTERNS = ["__pycache__", ".DS_Store", "__MACOSX", ".pyc", "Thumbs.db", ".git/"];

/* ------------------------------------------------------------------ */
/* 通用小工具                                                          */
/* ------------------------------------------------------------------ */

export function normalizeRel(rel) {
  let value = String(rel).replace(/\\/g, "/");
  while (value.startsWith("./")) value = value.slice(2);
  value = value.replace(/\/+/g, "/");
  return value.replace(/^\/+/, "");
}

export function isTextFile(rel) {
  return TEXT_EXTS.has(path.extname(rel).toLowerCase());
}

export function isScriptFile(rel) {
  return SCRIPT_EXTS.has(path.extname(rel).toLowerCase());
}

export function isJunkFile(rel) {
  const value = `/${normalizeRel(rel)}`;
  return JUNK_PATTERNS.some((pattern) => value.includes(pattern));
}

/** 从 ZIP 文件名/目录名里去掉尾部 semver：foo-bar-1.2.3 → foo-bar */
export function stripVersionSuffix(name) {
  return String(name || "").replace(/[-_]v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/i, "");
}

export function readPngInfoBuffer(buffer) {
  if (!buffer || buffer.length < 24) return null;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bytes: buffer.length };
}

export function isUtf8(buffer) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

export function utf8BomLength(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0;
}

/* ------------------------------------------------------------------ */
/* ZIP 读取（central directory + inflateRaw）                          */
/* ------------------------------------------------------------------ */

function decodeZipName(buffer, flags) {
  if (flags & 0x800) return buffer.toString("utf8");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder("gbk").decode(buffer);
    } catch {
      return buffer.toString("latin1");
    }
  }
}

/**
 * 读取 ZIP 到内存：返回 { entries: Map<rel, Buffer>, names: string[], warnings: string[] }
 * 只支持 stored(0) / deflate(8)，不支持 zip64/加密（WorkBuddy 包实际不会用到）。
 */
export function readZipBuffer(buffer, label = "zip") {
  const entries = new Map();
  const names = [];
  const warnings = [];
  if (buffer.length < 22) throw new Error(`${label}: 文件太小，不是有效的 ZIP`);
  let eocd = -1;
  const minScan = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= minScan; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${label}: 找不到 ZIP End of Central Directory`);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || totalEntries === 0xffff) {
    throw new Error(`${label}: 暂不支持 ZIP64（文件过大或条目过多）`);
  }
  let pointer = cdOffset;
  for (let index = 0; index < totalEntries; index++) {
    if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== 0x02014b50) {
      throw new Error(`${label}: ZIP 中央目录损坏（第 ${index + 1} 个条目）`);
    }
    const flags = buffer.readUInt16LE(pointer + 8);
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const uncompressedSize = buffer.readUInt32LE(pointer + 24);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const nameBuffer = buffer.subarray(pointer + 46, pointer + 46 + nameLength);
    const rawName = decodeZipName(nameBuffer, flags);
    const rel = normalizeRel(rawName);
    pointer += 46 + nameLength + extraLength + commentLength;
    if (!rel || rawName.endsWith("/")) continue; // 目录条目
    if (localOffset === 0xffffffff) {
      throw new Error(`${label}: 暂不支持 ZIP64 条目（${rel}）`);
    }
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`${label}: ZIP 本地头损坏（${rel}）`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) {
      data = Buffer.from(compressed);
    } else if (method === 8) {
      try {
        data = zlib.inflateRawSync(compressed);
      } catch (error) {
        throw new Error(`${label}: 解压 ${rel} 失败（${error && error.message ? error.message : error}）`);
      }
    } else {
      throw new Error(`${label}: 不支持的压缩方法 ${method}（${rel}）`);
    }
    if (!data) data = Buffer.alloc(0);
    if (uncompressedSize && data.length !== uncompressedSize) {
      warnings.push(`${rel}: 解压后长度 ${data.length} 与声明 ${uncompressedSize} 不一致`);
    }
    entries.set(rel, data);
    names.push(rel);
  }
  return { entries, names, warnings };
}

/* ------------------------------------------------------------------ */
/* YAML frontmatter 子集解析                                           */
/* ------------------------------------------------------------------ */

function unquoteScalar(value) {
  const text = String(value).trim();
  if (
    (text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
    (text.startsWith("'") && text.endsWith("'") && text.length >= 2)
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function parseInlineArray(value) {
  const text = String(value).trim();
  if (!text.startsWith("[") || !text.endsWith("]")) return null;
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

/**
 * 解析 markdown 的 YAML frontmatter。
 * @returns {{ok: boolean, reason: string, errors: string[], quoteTraps: Array<{key:string,line:number,value:string}>, data: object, raw: string, endLine: number}}
 */
export function parseYamlFrontmatter(text) {
  const empty = { ok: false, reason: "缺少 YAML frontmatter", errors: [], quoteTraps: [], data: {}, raw: "", endLine: -1, hasFrontmatter: false };
  if (typeof text !== "string") return empty;
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== "---") return empty;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) {
    return { ...empty, hasFrontmatter: true, reason: "frontmatter 没有闭合的 ---", errors: ["frontmatter 没有闭合的 ---"] };
  }
  const raw = lines.slice(1, end).join("\n");
  const data = {};
  const errors = [];
  const quoteTraps = [];
  const seenKeys = new Set();
  let index = 1;
  while (index < end) {
    const line = lines[index];
    if (line.trim() === "" || line.trim().startsWith("#")) {
      index += 1;
      continue;
    }
    if (indentOf(line) > 0) {
      // 没有归属的缩进行：说明上一级结构坏了
      errors.push(`第 ${index + 1} 行出现无归属缩进（YAML 结构错误）`);
      index += 1;
      continue;
    }
    if (line.includes("\t")) {
      errors.push(`第 ${index + 1} 行含制表符（YAML 缩进只能用空格）`);
    }
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!match) {
      errors.push(`第 ${index + 1} 行不是合法 YAML 键值对：${line.trim().slice(0, 60)}`);
      index += 1;
      continue;
    }
    const key = match[1];
    const inlineValue = match[2].trim();
    if (seenKeys.has(key)) errors.push(`frontmatter 字段重复：${key}`);
    seenKeys.add(key);
    let consumed = index + 1;
    let value;
    if (inlineValue === "" || /^[>|][+-]?$/.test(inlineValue)) {
      // 找第一行非空续行，判断是块列表 / 嵌套 map / 块标量
      let probe = consumed;
      while (probe < end && lines[probe].trim() === "") probe += 1;
      const firstNonBlank = probe < end ? lines[probe] : "";
      const firstIndent = firstNonBlank ? indentOf(firstNonBlank) : 0;
      const listAtKeyIndent = firstNonBlank.trim().startsWith("- ") || firstNonBlank.trim() === "-";
      if (firstNonBlank && (firstIndent > indentOf(line) || (listAtKeyIndent && firstIndent >= indentOf(line)))) {
        const blockLines = [];
        const keyIndent = indentOf(line);
        const firstTrimmed = firstNonBlank.trim();
        const mode = listAtKeyIndent ? "list" : firstTrimmed.includes(":") ? "map" : "scalar";
        const blockIndent = listAtKeyIndent ? firstIndent : keyIndent + 1;
        while (consumed < end) {
          const next = lines[consumed];
          if (next.trim() === "") {
            blockLines.push("");
            consumed += 1;
            continue;
          }
          const nextIndent = indentOf(next);
          const nextText = next.trim();
          if (mode === "list") {
            const isListItem = nextText.startsWith("- ") || nextText === "-";
            if (nextIndent < blockIndent) break;
            if (nextIndent === blockIndent && !isListItem) break; // 同级下一条 key，列表结束
            blockLines.push(next);
            consumed += 1;
            continue;
          }
          if (nextIndent < blockIndent) break;
          blockLines.push(next);
          consumed += 1;
        }
        const first = (blockLines.find((item) => item.trim() !== "") || "").trimStart();
        if (first.startsWith("- ") || first === "-") {
          // 块列表（支持列表项与 key 同缩进的合法 YAML 写法）
          const list = [];
          for (const item of blockLines) {
            const text = item.trim();
            if (!text) continue;
            if (text.startsWith("- ")) {
              const itemText = text.slice(2).trim();
              const nestedMatch = itemText.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
              if (nestedMatch) {
                list.push({ [nestedMatch[1]]: unquoteScalar(nestedMatch[2]) });
              } else {
                list.push(unquoteScalar(itemText));
              }
            } else if (text === "-") {
              list.push("");
            }
          }
          value = list;
        } else if (first.includes(":")) {
          // 简单嵌套 map
          const nested = {};
          for (const item of blockLines) {
            const nestedMatch = item.trim().match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
            if (nestedMatch) nested[nestedMatch[1]] = unquoteScalar(nestedMatch[2]);
          }
          value = nested;
        } else {
          value = blockLines
            .map((item) => item.trim())
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        }
      } else {
        value = "";
      }
    } else if (/^[>|][+-]?$/.test(inlineValue)) {
      value = "";
    } else if (inlineValue.startsWith("[")) {
      const parsed = parseInlineArray(inlineValue);
      value = parsed === null ? unquoteScalar(inlineValue) : parsed;
    } else if (inlineValue.startsWith("{")) {
      try {
        value = JSON.parse(inlineValue);
      } catch {
        value = unquoteScalar(inlineValue);
      }
    } else {
      const quoted = inlineValue.startsWith('"') || inlineValue.startsWith("'");
      if (!quoted && /: /.test(inlineValue)) {
        quoteTraps.push({ key, line: index + 1, value: inlineValue.slice(0, 80) });
        errors.push(`frontmatter ${key} 的值含 ': ' 但没加引号（YAML 解析会失败），第 ${index + 1} 行`);
      }
      value = unquoteScalar(inlineValue);
    }
    data[key] = value;
    index = consumed;
  }
  return {
    ok: errors.length === 0,
    reason: errors.length ? errors[0] : "",
    errors,
    quoteTraps,
    data,
    raw,
    endLine: end,
    hasFrontmatter: true,
  };
}

/* ------------------------------------------------------------------ */
/* 包视图：目录 / ZIP 统一接口                                          */
/* ------------------------------------------------------------------ */

function walkDir(root, relStart = "", collected = { files: [], totalBytes: 0 }, depth = 0) {
  if (collected.files.length > MAX_DIR_FILES) return collected;
  let entries = [];
  try {
    entries = fs.readdirSync(path.join(root, relStart), { withFileTypes: true });
  } catch {
    return collected;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && !entry.name.startsWith(".codebuddy-plugin")) continue;
    const rel = normalizeRel(relStart ? `${relStart}/${entry.name}` : entry.name);
    const abs = path.join(root, rel);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      if (rel.split("/").length > 8) continue;
      walkDir(root, rel, collected, depth + 1);
    } else if (stat.isFile()) {
      collected.files.push(rel);
      collected.totalBytes += stat.size;
      if (collected.files.length > MAX_DIR_FILES) throw new Error(`文件数量超过 ${MAX_DIR_FILES}，疑似不是技能/专家包`);
    }
  }
  return collected;
}

function detectSingleChildDir(root) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return "";
  }
  const dirs = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
  if (dirs.length !== 1) return "";
  const child = path.join(root, dirs[0].name);
  if (fs.existsSync(path.join(child, "SKILL.md")) || fs.existsSync(path.join(child, ".codebuddy-plugin", "plugin.json"))) {
    return dirs[0].name;
  }
  return "";
}

function createDirView(inputPath) {
  let root = inputPath;
  let autoDescended = false;
  const hasSkill = () => fs.existsSync(path.join(root, "SKILL.md"));
  const hasExpert = () => fs.existsSync(path.join(root, ".codebuddy-plugin", "plugin.json"));
  if (!hasSkill() && !hasExpert()) {
    const child = detectSingleChildDir(root);
    if (!child) {
      throw new Error("未识别为 WorkBuddy 包：目录根没有 SKILL.md，也没有 .codebuddy-plugin/plugin.json");
    }
    root = path.join(root, child);
    autoDescended = true;
  }
  const collected = walkDir(root);
  const files = collected.files.sort();
  const kind = hasExpert() ? "expert" : "skill";
  const textCache = new Map();
  const readBytes = (rel) => {
    const clean = normalizeRel(rel);
    try {
      return fs.readFileSync(path.join(root, clean));
    } catch {
      return null;
    }
  };
  return {
    kind,
    source: "dir",
    inputPath,
    rootDir: root,
    topDir: "",
    topDirStripped: false,
    autoDescended,
    name: path.basename(root),
    totalBytes: collected.totalBytes,
    fileCount: files.length,
    files,
    junkFiles: files.filter(isJunkFile),
    has: (rel) => files.includes(normalizeRel(rel)),
    readBytes,
    readText: (rel) => {
      const clean = normalizeRel(rel);
      if (textCache.has(clean)) return textCache.get(clean);
      const bytes = readBytes(clean);
      const text = bytes === null ? "" : bytes.subarray(0, MAX_TEXT_BYTES).toString("utf8");
      textCache.set(clean, text);
      return text;
    },
  };
}

function createZipView(inputPath) {
  const stat = fs.statSync(inputPath);
  const buffer = fs.readFileSync(inputPath);
  const zip = readZipBuffer(buffer, path.basename(inputPath));
  const rawNames = zip.names.slice().sort();
  const topLevels = new Set();
  for (const rel of rawNames) topLevels.add(rel.split("/")[0]);
  const singleTop = topLevels.size === 1 ? [...topLevels][0] : "";
  const hasRawSkill = rawNames.includes("SKILL.md");
  const hasRawExpert = rawNames.includes(".codebuddy-plugin/plugin.json");
  let topDir = "";
  if (singleTop && !hasRawSkill && !hasRawExpert) topDir = singleTop;
  const strip = (rel) => (topDir && (rel === topDir || rel.startsWith(`${topDir}/`)) ? rel.slice(topDir.length + 1) : rel);
  const files = rawNames.map((rel) => (topDir ? strip(rel) : rel)).filter(Boolean).sort();
  const entries = new Map();
  for (const [rel, data] of zip.entries) entries.set(topDir ? strip(rel) : rel, data);
  const textCache = new Map();
  const base = topDir || stripVersionSuffix(path.basename(inputPath, path.extname(inputPath)));
  const kind = files.includes(".codebuddy-plugin/plugin.json") ? "expert" : files.includes("SKILL.md") ? "skill" : "";
  if (!kind) throw new Error("未识别为 WorkBuddy 包：ZIP 根既没有 SKILL.md，也没有 .codebuddy-plugin/plugin.json");
  const readBytes = (rel) => entries.get(normalizeRel(rel)) || null;
  return {
    kind,
    source: "zip",
    inputPath,
    rootDir: "",
    topDir,
    topDirStripped: Boolean(topDir),
    autoDescended: false,
    name: base,
    zipName: path.basename(inputPath),
    archiveBytes: stat.size,
    totalBytes: stat.size,
    fileCount: files.length,
    files,
    junkFiles: files.filter(isJunkFile),
    has: (rel) => entries.has(normalizeRel(rel)),
    readBytes,
    readText: (rel) => {
      const clean = normalizeRel(rel);
      if (textCache.has(clean)) return textCache.get(clean);
      const bytes = entries.get(clean);
      const text = bytes === undefined ? "" : bytes.subarray(0, MAX_TEXT_BYTES).toString("utf8");
      textCache.set(clean, text);
      return text;
    },
  };
}

/**
 * 载入一个 WorkBuddy 包（目录或 .zip）。
 * @param {string} inputPath
 */
export function loadPackageView(inputPath) {
  const resolved = path.resolve(inputPath);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`路径不存在：${resolved}`);
  }
  if (stat.isDirectory()) return createDirView(resolved);
  if (stat.isFile() && /\.zip$/i.test(resolved)) return createZipView(resolved);
  throw new Error(`只支持目录或 .zip：${resolved}`);
}

/**
 * 需要跑脚本语法检查时，把脚本解压/复制到系统临时目录。
 * @returns {{dir: string, cleanup: () => void}}
 */
export function materializeScripts(view) {
  if (view.source === "dir") return { dir: view.rootDir, cleanup: () => {} };
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-skill-audit-wb-"));
  const cleanup = () => {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };
  try {
    for (const rel of view.files) {
      if (!isScriptFile(rel)) continue;
      const safe = rel
        .split("/")
        .filter((segment) => segment && segment !== "." && segment !== "..")
        .join("/");
      if (!safe) continue;
      const target = path.join(tempRoot, safe);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const bytes = view.readBytes(rel);
      if (bytes) fs.writeFileSync(target, bytes);
    }
  } catch (error) {
    cleanup();
    throw error;
  }
  return { dir: tempRoot, cleanup };
}

export function listScripts(view) {
  return view.files.filter(isScriptFile).sort();
}

export function listMarkdown(view) {
  return view.files.filter((rel) => /\.md$/i.test(rel)).sort();
}

export function listTextFiles(view) {
  return view.files.filter(isTextFile).sort();
}
