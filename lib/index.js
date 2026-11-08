/**
 * dsh-skill-audit 宿主半边。
 *
 * 两条只读 / 导出路由，挂在 connection 服务的共享 /api 通道上
 * （Host/Origin 栅栏与登录态由 Connection 统一处理，插件自己不做鉴权）：
 *
 *   GET  /api/dsh-skill-audit/scan            返回 JSON 扫描结果
 *   POST /api/dsh-skill-audit/report          扫描 + 导出 Markdown 到
 *                                             <workspace>/outputs/skill-audit-<date>.md
 *
 * 工作区（导出位置 + dsh-plugins 扫描范围）按以下优先级解析：
 *   1. 面板传上来的当前会话 cwd（session.cwd，最准确）
 *   2. DSH_WORKSPACE 环境变量
 *   3. ~/.dsh/skill-audit.config.json 的 workspace 字段
 *   4. 宿主进程 process.cwd()
 * 详细说明见 README。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION, resolveWorkspace, scanAll, writeReport } from "./audit.mjs";

/** 稳定插件名（cordis row 的 name 必须与包名一致）。 */
export const name = "dsh-skill-audit";

/** 需要 connection 服务提供带鉴权的 /api Fetch 路由。 */
export const inject = ["connection"];

export const SCAN_PATH = "/api/dsh-skill-audit/scan";
export const REPORT_PATH = "/api/dsh-skill-audit/report";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function hintOf(request) {
  try {
    const url = new URL(request.url);
    return url.searchParams.get("workspace") || "";
  } catch {
    return "";
  }
}

async function bodyOf(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/**
 * 注册扫描 / 导出路由。
 * @param {import("@deepseek-ai/cordis").Context} ctx - 插件上下文。
 */
export function apply(ctx) {
  ctx.connection.fetch.register({
    path: SCAN_PATH,
    methods: ["GET"],
    fetch: async (request) => {
      try {
        const workspace = resolveWorkspace({ hint: hintOf(request) });
        const result = scanAll({ workspace: workspace.path, workspaceSource: workspace.source });
        return json(200, result);
      } catch (error) {
        return json(500, {
          error: `扫描失败：${String(error && error.message ? error.message : error)}`,
          hint: "检查 ~/.dsh/skills 与 profile node_modules 是否可读；无法定位工作区时可用 ~/.dsh/skill-audit.config.json 指定 workspace。",
          version: VERSION,
          pluginRoot: path.join(HERE, ".."),
        });
      }
    },
  });

  ctx.connection.fetch.register({
    path: REPORT_PATH,
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      try {
        const body = await bodyOf(request);
        const hint = typeof body.workspace === "string" && body.workspace.trim() ? body.workspace : "";
        const workspace = resolveWorkspace({ hint, dshHome: typeof body.dshHome === "string" ? body.dshHome : undefined });
        const result = scanAll({ workspace: workspace.path, workspaceSource: workspace.source });
        const report = writeReport(result, { workspace: workspace.path });
        return json(200, {
          ok: true,
          path: report.path,
          bytes: report.bytes,
          generatedAt: report.generatedAt,
          workspace: workspace.path,
          workspaceSource: workspace.source,
          summary: result.summary,
        });
      } catch (error) {
        return json(500, {
          error: `导出报告失败：${String(error && error.message ? error.message : error)}`,
          hint: "确认工作区可写；也可以在 ~/.dsh/skill-audit.config.json 里把 workspace 指到一个可写目录。",
          version: VERSION,
        });
      }
    },
  });
}
