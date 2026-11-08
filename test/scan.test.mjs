#!/usr/bin/env node
/**
 * 扫描逻辑测试：
 *   - 用临时目录造 2 个技能 + 2 个插件 + 1 个工作区插件，覆盖 pass / warn / fail
 *   - 验证打分、等级、检查项、Markdown 报告、报告落盘、工作区解析优先级
 *   - 敏感信息必须被打码（报告里不能出现真实密钥）
 *
 * 用法：
 *   node test/scan.test.mjs          # 只跑 fixture（离线、可重复）
 *   node test/scan.test.mjs --live   # 额外在「本仓库自身 + 真实技能 ai-brain」上跑一次
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import zlib from "node:zlib";
import {
  auditPlugin,
  auditSkill,
  localDateStamp,
  renderMarkdown,
  resolveWorkspace,
  scanAll,
  writeReport,
} from "../lib/audit.mjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");
const errors = [];
const ok = (name) => console.log(`  ✔ ${name}`);
const fail = (name, detail) => {
  errors.push(name);
  console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
};
const assert = (condition, name, detail) => (condition ? ok(name) : fail(name, detail));

/* ---------------- 生成合法 PNG（不依赖 Pillow） ---------------- */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let crcTableCache = null;
function crcTable() {
  if (crcTableCache === null) {
    crcTableCache = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTableCache[n] = c >>> 0;
    }
  }
  return crcTableCache;
}
function crc32(buffer) {
  const table = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = table[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}
function writePng(file, width, height) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const p = row + 1 + x * 3;
      raw[p] = 12;
      raw[p + 1] = 60;
      raw[p + 2] = 110;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    Buffer.concat([PNG_SIG, pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]),
  );
}

/* ---------------- 造 fixture ---------------- */
const FAKE_SECRET = "sk-abcdefghijk1234567890abcdef";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-skill-audit-test-"));
const home = path.join(tmp, "home");
const workspace = path.join(tmp, "workspace");
const skillsDir = path.join(home, "skills");
const profileDir = path.join(home, "profiles", "desktop");
const nodeModules = path.join(profileDir, "node_modules");
const workspacePlugins = path.join(workspace, "dsh-plugins");

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

// 1) 好技能
const alphaSkill = path.join(skillsDir, "alpha-skill");
write(
  path.join(alphaSkill, "SKILL.md"),
  [
    "---",
    "name: alpha-skill",
    "description: >-",
    "  A well formed fixture skill used by the audit test suite; it explains what it does and when the user should trigger it.",
    "author: Test Author",
    "---",
    "",
    "# Alpha skill",
    "",
    "Fixture body for the audit smoke test.",
    "",
  ].join("\n"),
);
write(path.join(alphaSkill, "LICENSE"), "MIT License\n\nCopyright (c) 2026 Test Author\n");
write(path.join(alphaSkill, "README.md"), "# alpha-skill\n\nFixture skill for tests.\n");

// 2) 坏技能：没有 frontmatter、没有 LICENSE、带假密钥
const brokenSkill = path.join(skillsDir, "broken-skill");
write(
  path.join(brokenSkill, "SKILL.md"),
  ["# Broken skill", "", "This file has no YAML frontmatter and no description.", `OPENAI_KEY = "${FAKE_SECRET}"`, ""].join("\n"),
);

// 3) 好插件（profile 里声明 dsh.bundle）
const goodPlugin = path.join(nodeModules, "fixture-good-plugin");
write(
  path.join(goodPlugin, "package.json"),
  JSON.stringify(
    {
      name: "fixture-good-plugin",
      version: "1.2.3",
      description: "Fixture DSH plugin that passes every audit check.",
      type: "module",
      main: "lib/index.js",
      icon: "assets/icon.png",
      license: "MIT",
      exports: { ".": { default: "./lib/index.js" }, "./client": { default: "./lib/client.js" } },
      dsh: { bundle: { patch: "./cordis.patch.yml" }, client: { platform: "web" } },
      files: ["lib", "assets", "README.md", "README.zh.md", "LICENSE", "cordis.patch.yml"],
    },
    null,
    2,
  ),
);
write(
  path.join(goodPlugin, "cordis.patch.yml"),
  ["# fixture patch", "- insert:", "    - id: fixture-good", "      name: fixture-good-plugin", ""].join("\n"),
);
write(path.join(goodPlugin, "lib", "index.js"), 'export const name = "fixture-good-plugin";\nexport function apply() {}\n');
write(
  path.join(goodPlugin, "lib", "client.js"),
  'window.__ModuleLoader__.load({ id: "fixture-good-plugin", factory: function (require) { return {}; } });\n',
);
write(path.join(goodPlugin, "README.md"), "# fixture-good-plugin\n\nA complete fixture plugin.\n");
write(path.join(goodPlugin, "README.zh.md"), "# fixture-good-plugin\n\n完整的中文说明。\n");
write(path.join(goodPlugin, "LICENSE"), "MIT License\n");
writePng(path.join(goodPlugin, "assets", "icon.png"), 512, 512);

// 4) 坏插件：row name / client id 不一致、缺 LICENSE、icon 尺寸不对、README 与 files 缺失
const badPlugin = path.join(nodeModules, "fixture-bad-plugin");
write(
  path.join(badPlugin, "package.json"),
  JSON.stringify(
    {
      name: "fixture-bad-plugin",
      version: "0.1.0",
      main: "lib/index.js",
      icon: "assets/icon.png",
      license: "MIT",
      exports: { "./client": { default: "./lib/client.js" } },
      dsh: { bundle: { patch: "./cordis.patch.yml" }, client: { platform: "web" } },
    },
    null,
    2,
  ),
);
write(
  path.join(badPlugin, "cordis.patch.yml"),
  ["- insert:", "    - id: fixture-bad", "      name: some-other-plugin", ""].join("\n"),
);
write(path.join(badPlugin, "lib", "index.js"), 'export const name = "fixture-bad-plugin";\nexport function apply() {}\n');
write(
  path.join(badPlugin, "lib", "client.js"),
  'window.__ModuleLoader__.load({ id: "wrong-client-id", factory: function (require) { return {}; } });\n',
);
writePng(path.join(badPlugin, "assets", "icon.png"), 256, 256);

// 5) 工作区插件（复制好插件，改个名字）
const wsPlugin = path.join(workspacePlugins, "fixture-workspace-plugin");
fs.cpSync(goodPlugin, wsPlugin, { recursive: true });
const wsPkg = JSON.parse(fs.readFileSync(path.join(wsPlugin, "package.json"), "utf8"));
wsPkg.name = "fixture-workspace-plugin";
write(path.join(wsPlugin, "package.json"), JSON.stringify(wsPkg, null, 2));
write(
  path.join(wsPlugin, "cordis.patch.yml"),
  ["- insert:", "    - id: fixture-ws", "      name: fixture-workspace-plugin", ""].join("\n"),
);
write(path.join(wsPlugin, "lib", "index.js"), 'export const name = "fixture-workspace-plugin";\nexport function apply() {}\n');
write(
  path.join(wsPlugin, "lib", "client.js"),
  'window.__ModuleLoader__.load({ id: "fixture-workspace-plugin", factory: function (require) { return {}; } });\n',
);

/* ---------------- 跑扫描 ---------------- */
console.log("dsh-skill-audit scan tests");
console.log(`fixture: ${tmp}`);

const result = scanAll({
  workspace,
  dshHome: home,
  profiles: [profileDir],
  workspaceSource: "test",
});
const byId = Object.fromEntries(result.assets.map((asset) => [asset.id, asset]));

const alpha = byId["skill:alpha-skill"];
assert(alpha !== undefined, "发现 alpha-skill 技能");
assert(alpha && alpha.score === 100 && alpha.grade === "S", "alpha-skill 满分 S", alpha && `${alpha.score}/${alpha.grade}`);
const alphaCheck = (id) => (alpha ? alpha.checks.find((item) => item.id === id) : undefined);
assert(alphaCheck("skill-md") && alphaCheck("skill-md").status === "pass", "alpha-skill SKILL.md pass");
assert(alphaCheck("skill-description") && alphaCheck("skill-description").status === "pass", "alpha-skill description pass");
assert(alphaCheck("skill-author") && alphaCheck("skill-author").status === "pass", "alpha-skill author pass");
assert(alphaCheck("skill-license") && alphaCheck("skill-license").status === "pass", "alpha-skill LICENSE pass");

const broken = byId["skill:broken-skill"];
assert(broken !== undefined, "发现 broken-skill 技能");
assert(broken && broken.grade === "D" && broken.score < 60, "broken-skill 低分 D", broken && `${broken.score}/${broken.grade}`);
const brokenCheck = (id) => (broken ? broken.checks.find((item) => item.id === id) : undefined);
assert(
  brokenCheck("skill-description") && brokenCheck("skill-description").status === "fail",
  "broken-skill 缺少 frontmatter description 判 fail",
);
assert(brokenCheck("skill-secrets") && brokenCheck("skill-secrets").status === "fail", "broken-skill 假密钥判 fail");
assert(
  brokenCheck("skill-secrets") && /值已打码/.test(brokenCheck("skill-secrets").detail),
  "敏感信息 detail 已打码",
);

const good = byId["plugin:fixture-good-plugin"];
assert(good !== undefined, "发现 fixture-good-plugin 插件");
assert(good && good.score === 100 && good.grade === "S", "fixture-good-plugin 满分 S", good && `${good.score}/${good.grade}`);
const goodCheck = (id) => (good ? good.checks.find((item) => item.id === id) : undefined);
assert(goodCheck("bundle-declared") && goodCheck("bundle-declared").status === "pass", "dsh.bundle 声明 pass");
assert(goodCheck("patch-row") && goodCheck("patch-row").status === "pass", "cordis.patch.yml row name pass");
assert(goodCheck("client-id") && goodCheck("client-id").status === "pass", "client 模块 id pass");
assert(goodCheck("host-name") && goodCheck("host-name").status === "pass", "宿主 name pass");
assert(goodCheck("icon-512") && goodCheck("icon-512").status === "pass", "icon 512x512 pass");
assert(goodCheck("files-field") && goodCheck("files-field").status === "pass", "files 白名单 pass");
assert(goodCheck("readme-bilingual") && goodCheck("readme-bilingual").status === "pass", "README 中英 pass");

const bad = byId["plugin:fixture-bad-plugin"];
assert(bad !== undefined, "发现 fixture-bad-plugin 插件");
assert(bad && bad.score < 70 && bad.counts.fail >= 3, "fixture-bad-plugin 低分且 fail ≥ 3", bad && `${bad.score}/${bad.grade}`);
const badCheck = (id) => (bad ? bad.checks.find((item) => item.id === id) : undefined);
assert(badCheck("patch-row") && badCheck("patch-row").status === "fail", "row name 不一致判 fail");
assert(badCheck("client-id") && badCheck("client-id").status === "fail", "client id 不一致判 fail");
assert(badCheck("license") && badCheck("license").status === "fail", "缺 LICENSE 判 fail");
assert(badCheck("icon-512") && badCheck("icon-512").status === "warn", "icon 非 512 判 warn");
assert(badCheck("files-field") && badCheck("files-field").status === "warn", "缺 files 判 warn");

const ws = byId["workspace-plugin:fixture-workspace-plugin"];
assert(ws !== undefined, "发现工作区插件 fixture-workspace-plugin");
assert(ws && ws.scope === "workspace", "工作区插件 scope 正确");
assert(ws && ws.score === 100 && ws.grade === "S", "工作区插件满分 S", ws && `${ws.score}/${ws.grade}`);

/* ---------------- 汇总 / 报告 ---------------- */
assert(result.summary.total === 5, "共扫描到 5 个资产", String(result.summary.total));
const gradeSum = Object.values(result.summary.grades).reduce((sum, value) => sum + value, 0);
assert(gradeSum === result.summary.total, "等级分布合计等于资产数");
assert(result.summary.average >= 0 && result.summary.average <= 100, "平均分在 0-100");
assert(result.assets.every((asset) => asset.score >= 0 && asset.score <= 100), "所有分数在 0-100");
assert(result.assets.every((asset) => ["S", "A", "B", "C", "D"].includes(asset.grade)), "所有等级合法");

const markdown = renderMarkdown(result);
assert(markdown.includes("# DSH 技能 / 插件审核报告"), "Markdown 报告有标题");
assert(markdown.includes("## 一、资产总览"), "Markdown 报告有资产总览");
assert(markdown.includes("## 二、问题与修复建议"), "Markdown 报告有问题清单");
assert(markdown.includes("fixture-bad-plugin"), "Markdown 报告包含坏插件");
assert(markdown.includes("检查项与权重"), "Markdown 报告有检查项附录");
assert(!markdown.includes(FAKE_SECRET), "Markdown 报告不含真实密钥");
assert(!markdown.includes(FAKE_SECRET.slice(0, 12)), "Markdown 报告不含密钥片段");

const report = writeReport(result, { workspace, date: "2026-01-02" });
assert(report.ok === true, "writeReport 返回 ok");
assert(report.path === path.join(workspace, "outputs", "skill-audit-2026-01-02.md"), "报告路径为 outputs/skill-audit-<date>.md");
assert(fs.existsSync(report.path), "报告文件已落盘");
assert(fs.readFileSync(report.path, "utf8").includes("fixture-good-plugin"), "落盘报告内容包含资产");
assert(localDateStamp().length === 10, "日期戳格式 YYYY-MM-DD");

/* ---------------- 工作区解析优先级 ---------------- */
const configHome = path.join(tmp, "config-home");
write(
  path.join(configHome, "skill-audit.config.json"),
  JSON.stringify({ workspace: path.join(tmp, "from-config") }, null, 2),
);
fs.mkdirSync(path.join(tmp, "from-config"), { recursive: true });
fs.mkdirSync(path.join(tmp, "from-env"), { recursive: true });
fs.mkdirSync(path.join(tmp, "from-client"), { recursive: true });

const resolvedClient = resolveWorkspace({
  dshHome: configHome,
  hint: path.join(tmp, "from-client"),
  env: { DSH_WORKSPACE: path.join(tmp, "from-env") },
  cwd: tmp,
});
assert(resolvedClient.source === "client" && resolvedClient.path === path.join(tmp, "from-client"), "工作区优先级：client > env > config");
const resolvedEnv = resolveWorkspace({
  dshHome: configHome,
  env: { DSH_WORKSPACE: path.join(tmp, "from-env") },
  cwd: tmp,
});
assert(resolvedEnv.source === "env" && resolvedEnv.path === path.join(tmp, "from-env"), "工作区优先级：env > config");
const resolvedConfig = resolveWorkspace({ dshHome: configHome, env: {}, cwd: tmp });
assert(resolvedConfig.source === "config" && resolvedConfig.path === path.join(tmp, "from-config"), "工作区优先级：config");
const resolvedBad = resolveWorkspace({ dshHome: configHome, hint: path.join(tmp, "nope"), env: {}, cwd: tmp });
assert(resolvedBad.source === "config" && resolvedBad.path === path.join(tmp, "from-config"), "无效 hint 自动回退");
const resolvedRoot = resolveWorkspace({ dshHome: configHome, hint: path.parse(tmp).root, env: {}, cwd: tmp });
assert(resolvedRoot.path !== path.parse(tmp).root, "拒绝把文件系统根目录当工作区");

/* ---------------- 单资产审计 API ---------------- */
const singleSkill = auditSkill(alphaSkill);
assert(singleSkill.type === "skill" && singleSkill.id === "skill:alpha-skill", "auditSkill 单资产 API");
const singlePlugin = auditPlugin(goodPlugin, "workspace");
assert(singlePlugin.id === "workspace-plugin:fixture-good-plugin", "auditPlugin 单资产 API（workspace 前缀）");

/* ---------------- 宿主路由集成（用 fixture 环境变量跑真实 handler） ---------------- */
{
  const { apply: mountHost } = await import(url.pathToFileURL(path.join(repoRoot, "lib", "index.js")).href);
  const routes = [];
  mountHost({
    connection: {
      fetch: {
        register(route) {
          routes.push(route);
        },
      },
    },
  });
  const scanRoute = routes.find((route) => route.path === "/api/dsh-skill-audit/scan");
  const reportRoute = routes.find((route) => route.path === "/api/dsh-skill-audit/report");
  assert(scanRoute !== undefined && reportRoute !== undefined, "宿主注册 scan / report 路由（集成）");

  const savedEnv = {
    DSH_HOME: process.env.DSH_HOME,
    DSH_PROFILE_DIR: process.env.DSH_PROFILE_DIR,
    DSH_WORKSPACE: process.env.DSH_WORKSPACE,
  };
  try {
    process.env.DSH_HOME = home;
    process.env.DSH_PROFILE_DIR = profileDir;
    process.env.DSH_WORKSPACE = workspace;

    const scanResponse = await scanRoute.fetch(new Request("http://127.0.0.1/api/dsh-skill-audit/scan"));
    const scanPayload = await scanResponse.json();
    assert(scanResponse.status === 200, "GET /scan 返回 200", String(scanResponse.status));
    assert(scanPayload.workspace === workspace && scanPayload.workspaceSource === "env", "GET /scan 工作区来自 env");
    assert(
      Array.isArray(scanPayload.assets) && scanPayload.assets.some((asset) => asset.name === "fixture-good-plugin"),
      "GET /scan 返回 fixture 资产",
    );

    const reportResponse = await reportRoute.fetch(
      new Request("http://127.0.0.1/api/dsh-skill-audit/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    const reportPayload = await reportResponse.json();
    assert(reportResponse.status === 200 && reportPayload.ok === true, "POST /report 返回 ok", String(reportResponse.status));
    assert(
      typeof reportPayload.path === "string" && reportPayload.path.startsWith(path.join(workspace, "outputs")),
      "POST /report 写入 workspace/outputs",
      reportPayload.path,
    );
    assert(fs.existsSync(reportPayload.path), "POST /report 报告文件已生成");
    assert(reportPayload.summary && reportPayload.summary.total === 5, "POST /report 返回汇总");

    const hintResponse = await scanRoute.fetch(
      new Request(`http://127.0.0.1/api/dsh-skill-audit/scan?workspace=${encodeURIComponent(workspace)}`),
    );
    const hintPayload = await hintResponse.json();
    assert(hintPayload.workspaceSource === "client" && hintPayload.workspace === workspace, "GET /scan 接受 workspace 提示");
  } finally {
    for (const key of Object.keys(savedEnv)) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
}

/* ---------------- --live：本仓库自身 + 真实技能 ---------------- */
if (process.argv.includes("--live")) {
  console.log("\n--live: 在本仓库自身与真实技能上跑一遍扫描");
  const projectRoot = path.join(here, "..", "..", "..");
  const live = scanAll({ workspace: projectRoot });
  console.log(`  扫描：技能 ${live.summary.skills} · 插件 ${live.summary.plugins} · 工作区插件 ${live.summary.workspacePlugins}`);
  console.log(`  平均分 ${live.summary.average} / 100（耗时 ${live.durationMs} ms）`);

  const self = live.assets.find((asset) => asset.scope === "workspace" && asset.name === "dsh-skill-audit");
  assert(self !== undefined, "live: 工作区里找到 dsh-skill-audit 自身");
  if (self) {
    console.log(`  dsh-skill-audit: ${self.score} / ${self.grade}（❌ ${self.counts.fail} · ⚠️ ${self.counts.warn}）`);
    assert(self.score >= 90 && (self.grade === "S" || self.grade === "A"), "live: 自身评分 ≥ 90 且 S/A", `${self.score}/${self.grade}`);
    for (const id of ["bundle-declared", "patch-row", "client-id", "host-name", "license", "icon-512", "files-field", "readme-bilingual"]) {
      const item = self.checks.find((checkItem) => checkItem.id === id);
      assert(item && item.status === "pass", `live: 自身检查项 pass — ${id}`, item && item.status);
    }
  }

  const realSkill = live.assets.find((asset) => asset.type === "skill" && asset.name === "ai-brain");
  assert(realSkill !== undefined, "live: 找到真实技能 ai-brain");
  if (realSkill) {
    console.log(`  ai-brain: ${realSkill.score} / ${realSkill.grade}（❌ ${realSkill.counts.fail} · ⚠️ ${realSkill.counts.warn}）`);
    const md = realSkill.checks.find((item) => item.id === "skill-md");
    const description = realSkill.checks.find((item) => item.id === "skill-description");
    assert(md && md.status === "pass", "live: ai-brain SKILL.md pass");
    assert(description && description.status === "pass", "live: ai-brain description pass");
    console.log(`  ai-brain 警告项：${realSkill.problems.map((item) => `${item.label}(${item.status})`).join("、") || "无"}`);
  }
}

/* ---------------- 收尾 ---------------- */
console.log("");
if (errors.length) {
  console.log(`FAILED (${errors.length}): ${errors.join("; ")}`);
  process.exit(1);
}
console.log("SCAN TESTS OK");
