#!/usr/bin/env node
/**
 * dsh-skill-audit 命令行入口：不经 DSH，直接跑同一套审计逻辑。
 *
 * 用法：
 *   node tools/scan.mjs                            # 扫描本机（默认工作区 = cwd）
 *   node tools/scan.mjs --workspace .              # 指定工作区（用它的 dsh-plugins/）
 *   node tools/scan.mjs --dsh-home ~/.dsh
 *   node tools/scan.mjs --json                     # 输出完整 JSON
 *   node tools/scan.mjs --asset <目录>             # 只看单个技能/插件目录
 *   node tools/scan.mjs --report <文件.md>         # 同时写 Markdown 报告
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { auditPlugin, auditSkill, localDateTime, renderMarkdown, scanAll } from "../lib/audit.mjs";

const MARK = { pass: "✔", warn: "!", fail: "✘", skip: "-" };

function parseArgs(argv) {
  const options = {
    workspace: process.cwd(),
    dshHome: process.env.DSH_HOME || path.join(os.homedir(), ".dsh"),
    json: false,
    asset: "",
    report: "",
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--quiet") options.quiet = true;
    else if (arg === "--workspace") options.workspace = path.resolve(argv[++i] || ".");
    else if (arg === "--dsh-home") options.dshHome = path.resolve(argv[++i] || "");
    else if (arg === "--asset") options.asset = path.resolve(argv[++i] || "");
    else if (arg === "--report") options.report = path.resolve(argv[++i] || "");
    else if (arg === "--help" || arg === "-h") {
      console.log("用法: node tools/scan.mjs [--workspace <dir>] [--dsh-home <dir>] [--asset <dir>] [--json] [--report <file.md>]");
      process.exit(0);
    }
  }
  return options;
}

function classifySingle(dir) {
  const skillFile = path.join(dir, "SKILL.md");
  if (fs.existsSync(skillFile)) return auditSkill(dir);
  return auditPlugin(dir, "workspace");
}

function printAsset(asset) {
  console.log(`\n${asset.name}  [${asset.type}]  ${asset.score} / ${asset.grade}  (${asset.path})`);
  for (const item of asset.checks) {
    console.log(`  ${MARK[item.status] || "?"} ${item.label}: ${item.detail || "—"}`);
    if (item.hint && item.status !== "pass") console.log(`      建议: ${item.hint}`);
  }
}

const options = parseArgs(process.argv.slice(2));

if (options.asset) {
  const asset = classifySingle(options.asset);
  if (options.json) {
    console.log(JSON.stringify(asset, null, 2));
  } else {
    printAsset(asset);
  }
  process.exit(0);
}

const result = scanAll({ workspace: options.workspace, dshHome: options.dshHome });

if (options.report) {
  fs.mkdirSync(path.dirname(options.report), { recursive: true });
  fs.writeFileSync(options.report, renderMarkdown(result), "utf8");
}

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`dsh-skill-audit v${result.version} · ${localDateTime(new Date(result.generatedAt))}`);
  console.log(`工作区: ${result.workspace}`);
  console.log(`范围: 技能 ${result.summary.skills} / 插件 ${result.summary.plugins - result.summary.workspacePlugins} / 工作区插件 ${result.summary.workspacePlugins}`);
  console.log(`平均分: ${result.summary.average} / 100  (S ${result.summary.grades.S} · A ${result.summary.grades.A} · B ${result.summary.grades.B} · C ${result.summary.grades.C} · D ${result.summary.grades.D})`);
  console.log(`问题: 失败 ${result.summary.failedChecks} · 警告 ${result.summary.warnedChecks}  (耗时 ${result.durationMs} ms)`);
  const rows = result.assets.map((asset) => ({
    name: asset.name,
    type: asset.type,
    scope: asset.scope,
    score: asset.score,
    grade: asset.grade,
    fail: asset.counts.fail,
    warn: asset.counts.warn,
  }));
  console.table(rows);
  if (!options.quiet) {
    const problematic = result.assets.filter((asset) => asset.counts.fail > 0);
    if (problematic.length) {
      console.log(`\n有失败项的资产（${problematic.length}）：`);
      for (const asset of problematic) {
        const fails = asset.checks.filter((item) => item.status === "fail");
        console.log(`- ${asset.name} (${asset.score}/${asset.grade}): ${fails.map((item) => item.label).join("、")}`);
      }
    }
  }
}

if (options.report) {
  console.log(`\n报告已写入: ${options.report}`);
}
