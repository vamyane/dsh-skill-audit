#!/usr/bin/env node
/**
 * dsh-skill-audit 命令行入口：不经 DSH，直接跑同一套审计逻辑。
 *
 * 用法：
 *   node tools/scan.mjs                            # 扫描 DSH 资产（默认工作区 = cwd）
 *   node tools/scan.mjs --workspace .              # 指定工作区（用它的 dsh-plugins/）
 *   node tools/scan.mjs --dsh-home ~/.dsh
 *   node tools/scan.mjs --json                     # 输出完整 JSON
 *   node tools/scan.mjs --asset <目录>             # 只看单个 DSH 技能/插件目录
 *   node tools/scan.mjs --report <文件.md>         # 同时写 DSH Markdown 报告
 *
 *   node tools/scan.mjs --wb <目录|.zip>           # WorkBuddy 技能包/专家包：门禁 + Q/V + 建议价格
 *   node tools/scan.mjs --wb <路径> --json         # WorkBuddy 结构化结果
 *   node tools/scan.mjs --wb <路径> --paid         # 强制按付费包检查法律文件
 *   node tools/scan.mjs --wb <路径> --skip-scripts # 跳过脚本语法静态检查（更快）
 *   node tools/scan.mjs --wb <路径> --report <文件.md>   # 导出 WorkBuddy 报告
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { auditPlugin, auditSkill, localDateTime, renderMarkdown, scanAll } from "../lib/audit.mjs";
import {
  GATE_DEFS,
  renderWorkbuddyMarkdown,
  scanWorkBuddyPackages,
  workbuddySummary,
} from "../lib/wb-audit.mjs";

const MARK = { pass: "✔", warn: "!", fail: "✘", skip: "-" };
const GATE_MARK = { pass: " P ", warn: " W ", fail: " F ", skip: " - " };

function parseArgs(argv) {
  const options = {
    workspace: process.cwd(),
    dshHome: process.env.DSH_HOME || path.join(os.homedir(), ".dsh"),
    json: false,
    asset: "",
    report: "",
    quiet: false,
    wb: "",
    paid: undefined,
    skipScripts: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--quiet") options.quiet = true;
    else if (arg === "--paid") options.paid = true;
    else if (arg === "--free") options.paid = false;
    else if (arg === "--skip-scripts") options.skipScripts = true;
    else if (arg === "--workspace") options.workspace = path.resolve(argv[++i] || ".");
    else if (arg === "--dsh-home") options.dshHome = path.resolve(argv[++i] || "");
    else if (arg === "--asset") options.asset = path.resolve(argv[++i] || "");
    else if (arg === "--wb") options.wb = path.resolve(argv[++i] || "");
    else if (arg === "--report") options.report = path.resolve(argv[++i] || "");
    else if (arg === "--help" || arg === "-h") {
      console.log("用法: node tools/scan.mjs [--wb <目录|zip>] [--workspace <dir>] [--dsh-home <dir>] [--asset <dir>] [--report <file.md>] [--json] [--paid|--free] [--skip-scripts]");
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

/* ---------------- WorkBuddy 输出 ---------------- */

function printWbGate(result) {
  const severityRank = { blocker: 0, major: 1, minor: 2 };
  const statusRank = { fail: 0, warn: 1, pass: 2, skip: 3 };
  const checks = result.gate.checks.slice().sort((left, right) => {
    const a = severityRank[left.severity] - severityRank[right.severity];
    return a !== 0 ? a : statusRank[left.status] - statusRank[right.status];
  });
  console.log(`\n门禁 Gate（25 条）：blocker ${result.gate.blockerCount} · major ${result.gate.majorCount} · minor ${result.gate.minorCount} → ${result.gate.verdict}`);
  console.log(`${"ID".padEnd(5)}${"严重度".padEnd(9)}${"状态".padEnd(6)}检查项`);
  console.log("-".repeat(96));
  for (const check of checks) {
    const line = `${check.id.padEnd(5)}${check.severity.padEnd(9)}${(GATE_MARK[check.status] || " ? ").padEnd(6)}${check.title}`;
    console.log(line);
    if (check.status === "fail" || check.status === "warn") {
      console.log(`      └ ${check.detail}`);
      if (check.evidence.length) console.log(`        证据：${check.evidence.slice(0, 3).join("；")}`);
      console.log(`        修复：${check.fix}`);
    }
  }
}

function printWbScore(result) {
  const summary = workbuddySummary(result);
  console.log("\n质量分 Q：");
  for (const dim of result.quality.dimensions) {
    console.log(`  ${dim.id} ${dim.name.padEnd(14)} ${String(dim.score).padStart(5)} / ${dim.max}`);
  }
  console.log(`  合计 ${result.quality.score} / 100（原始 ${result.quality.raw}，惩罚 ${result.quality.delta}）`);
  if (result.quality.penalties.length) {
    console.log("  惩罚项：" + result.quality.penalties.map((penalty) => `${penalty.id}${penalty.skipped ? "(未触发)" : penalty.delta}`).join("、"));
  }
  console.log("\n价值分 V：");
  for (const dim of result.value.dimensions) {
    console.log(`  ${dim.id} ${dim.name.padEnd(14)} ${String(dim.score).padStart(5)} / 100`);
  }
  console.log(`  V_raw=${result.value.raw} → V_final=${result.value.final}（${result.value.note}）`);
  console.log(`  等级 ${summary.grade} · 建议价格 ${summary.price}${summary.subscription ? ` · 可考虑订阅 ${summary.subscription}` : ""}`);
}

/* ---------------- 主流程 ---------------- */

const options = parseArgs(process.argv.slice(2));

if (options.wb) {
  let result;
  try {
    result = scanWorkBuddyPackages(options.wb, {
      paid: options.paid,
      skipScripts: options.skipScripts,
    });
  } catch (error) {
    console.error(`扫描失败：${String(error && error.message ? error.message : error)}`);
    process.exit(2);
  }
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`dsh-skill-audit v${result.version} · WorkBuddy 模式 · rubric v${result.rubricVersion}`);
    console.log(`输入：${result.input.path}（${result.input.source === "zip" ? "ZIP" : "目录"}）`);
    console.log(`识别：${result.input.profileLabel} · ${result.input.name}${result.input.version ? `@${result.input.version}` : ""} · ${(result.input.sizeBytes / 1024).toFixed(1)} KB · ${result.input.fileCount} 个文件`);
    console.log(`领域：${result.input.domain}（${result.input.domainEvidence.join("；")}） · 付费检测：${result.input.paid ? "是" : "否"}`);
    printWbGate(result);
    printWbScore(result);
    console.log(`\n结论：${result.gate.pass ? "✅ 门禁通过（可以上架）" : "❌ 先修 blocker 再上架"}（耗时 ${result.durationMs} ms）`);
  }
  if (options.report) {
    fs.mkdirSync(path.dirname(options.report), { recursive: true });
    fs.writeFileSync(options.report, renderWorkbuddyMarkdown(result), "utf8");
    console.log(`\n报告已写入：${options.report}`);
  }
  process.exit(result.gate.blockerCount > 0 ? 1 : 0);
}

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
  console.log(`dsh-skill-audit v${result.version} · DSH 资产模式 · ${localDateTime(new Date(result.generatedAt))}`);
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

console.log(`\n可用检查项：${GATE_DEFS.length} 条 WorkBuddy 门禁（G01–G19 / E01–E06），--wb <路径> 触发`);
