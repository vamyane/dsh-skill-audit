#!/usr/bin/env node
/**
 * 离线冒烟：桩件加载 lib/client.js，验证
 *   - app/panel.html 的 gzip 数据能解开（构建产物完整性）
 *   - __ModuleLoader__.load 的 id 正确、且没有用 iframe
 *   - 两个槽位注册成功、组件可渲染（面板直接 React 渲染，不是 iframe）
 *   - 面板两种模式（DSH 资产 / WorkBuddy 包）都能渲染出关键入口
 *   - 宿主半边可导入、能注册 4 条 /api/dsh-skill-audit/* 路由
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import zlib from "node:zlib";
import { VERSION } from "../lib/audit.mjs";
import { WB_RUBRIC_VERSION } from "../lib/wb-package.mjs";
import { GATE_DEFS } from "../lib/wb-audit.mjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const clientPath = path.join(root, "lib", "client.js");
const code = fs.readFileSync(clientPath, "utf8");
const errors = [];
const ok = (name) => console.log(`  ✔ ${name}`);
const fail = (name, detail) => {
  errors.push(name);
  console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log(`client.js ${(code.length / 1024 / 1024).toFixed(2)} MB`);

function grab(placeholderName) {
  const match = code.match(new RegExp(`var ${placeholderName} = "([^"]+)";`));
  return match ? match[1] : "";
}

// --- 0. 版本 / rubric 一致性 ---
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (pkg.name === "dsh-skill-audit" && pkg.version === VERSION) ok(`package.json 版本与 VERSION 一致（${pkg.version}）`);
else fail("版本一致性", `${pkg.name}@${pkg.version} vs ${VERSION}`);
if (WB_RUBRIC_VERSION === "1.0.1") ok("WorkBuddy rubric 版本 1.0.1");
else fail("rubric 版本", WB_RUBRIC_VERSION);
if (GATE_DEFS.length === 25) ok(`WorkBuddy 门禁 25 条（G01–G19 / E01–E06）`);
else fail("门禁数量", String(GATE_DEFS.length));

// --- 1. panel.html 内嵌数据 ---
const panelB64 = grab("PANEL_GZIP_B64");
if (!panelB64) {
  fail("panel gzip 数据", "找不到 PANEL_GZIP_B64");
} else {
  try {
    const html = zlib.gunzipSync(Buffer.from(panelB64, "base64")).toString("utf8");
    const required = ["data-dsh-skill-audit-panel", "dsh-skill-audit", "<style"];
    const missing = required.filter((marker) => !html.includes(marker));
    if (missing.length === 0) ok(`panel.html 完整（${(html.length / 1024).toFixed(1)} KB，静态预览页）`);
    else fail("panel.html 内容", `缺少 ${missing.join("、")}`);
  } catch (error) {
    fail("panel.html 解压", error.message);
  }
}

// --- 2. 客户端不使用 iframe ---
if (code.includes('"iframe"') || code.includes("'iframe'") || code.includes('createElement("iframe')) {
  fail("面板未使用 iframe", "client.js 里出现 iframe 引用");
} else {
  ok("面板未使用 iframe（React 直接渲染）");
}

// --- 3. 模块加载与槽位注册 ---
let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load(info) {
      captured = info;
    },
  },
};

function flatten(node, out) {
  if (node === null || node === undefined || node === false) return out;
  if (Array.isArray(node)) {
    for (const item of node) flatten(item, out);
    return out;
  }
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (typeof node === "object" && "type" in node) {
    if (typeof node.type === "function") return flatten(node.type(node.props || {}), out);
    const props = node.props || {};
    for (const key of Object.keys(props)) {
      if (typeof props[key] === "string") out.push(props[key]);
    }
    flatten(node.children, out);
  }
  return out;
}

const reactStub = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children };
  },
  useState(initial) {
    return [initial, () => {}];
  },
  useEffect() {},
  useSyncExternalStore(_sub, getSnapshot) {
    return getSnapshot();
  },
};
const requireStub = (id) => {
  if (id === "react") return reactStub;
  throw new Error(`unexpected require: ${id}`);
};
const documentStub = { addEventListener() {}, removeEventListener() {} };
const runner = new Function("window", "require", "Blob", "URL", "document", code);
runner(
  globalThis.window,
  requireStub,
  class Blob {},
  { createObjectURL: () => "blob:test", revokeObjectURL() {} },
  documentStub,
);

if (captured === null) fail("__ModuleLoader__.load 被调用");
else ok("__ModuleLoader__.load 被调用");
if (captured !== null && captured.id === "dsh-skill-audit") ok("客户端模块 id 正确（dsh-skill-audit）");
else fail("客户端模块 id", captured && captured.id);

let mod = null;
try {
  mod = captured.factory(requireStub);
  if (typeof mod.apply === "function" && Array.isArray(mod.inject)) ok("factory 返回 apply/inject");
  else fail("factory 返回值");
} catch (error) {
  fail("factory 执行", error.message);
}

const registered = [];
const slots = {
  inject(_name, factory) {
    factory();
  },
  register(options, component) {
    registered.push({ options, component });
  },
};
const locale = {
  register() {
    return () => {};
  },
  bind() {
    return (key) => key;
  },
};
const ctx = {
  get(name) {
    if (name === "slots") return slots;
    if (name === "locale") return locale;
    return undefined;
  },
  effect(fn) {
    const disposer = fn();
    return () => {
      if (typeof disposer === "function") disposer();
    };
  },
};
try {
  mod.apply(ctx);
  const names = registered.map((item) => item.options.name).sort();
  if (JSON.stringify(names) === JSON.stringify(["shell.overlay", "sidebar.footer.action"])) {
    ok("注册 shell.overlay + sidebar.footer.action");
  } else {
    fail("槽位注册", JSON.stringify(names));
  }
  for (const item of registered) {
    try {
      item.component({ t: (key) => key, wide: true, cwd: () => "" });
      ok(`组件可渲染：${item.options.id}`);
    } catch (error) {
      fail(`组件渲染：${item.options.id}`, error.message);
    }
  }

  const panelRegistration = registered.find((item) => item.options.name === "shell.overlay");
  if (panelRegistration && mod.__test && typeof mod.__test.setOpen === "function") {
    mod.__test.setOpen(true);
    try {
      const tree = panelRegistration.component({ t: (key) => key, wide: true, cwd: () => "" });
      const texts = flatten(tree, []).join(" | ");
      if (texts.includes("panel.title") && texts.includes("panel.loading")) {
        ok("DSH 模式面板渲染（标题 + 加载态）");
      } else {
        fail("DSH 模式面板渲染", texts.slice(0, 200));
      }
      if (texts.includes("panel.refresh") && texts.includes("panel.export")) {
        ok("DSH 模式有「重新扫描 / 导出报告」按钮");
      } else {
        fail("DSH 模式按钮", texts.slice(0, 200));
      }
      if (texts.includes("mode.dsh") && texts.includes("mode.wb")) {
        ok("面板有「DSH 资产 / WorkBuddy 包」模式切换");
      } else {
        fail("模式切换", texts.slice(0, 240));
      }

      // 切到 WorkBuddy 模式再渲染一次
      if (typeof mod.__test.setMode === "function") {
        mod.__test.setMode("wb");
        const wbTree = panelRegistration.component({ t: (key) => key, wide: true, cwd: () => "" });
        const wbTexts = flatten(wbTree, []).join(" | ");
        if (wbTexts.includes("wb.title") && wbTexts.includes("wb.idle") && wbTexts.includes("wb.scan")) {
          ok("WorkBuddy 模式面板渲染（标题 + 路径输入 + 扫描按钮）");
        } else {
          fail("WorkBuddy 模式面板渲染", wbTexts.slice(0, 240));
        }
        if (wbTexts.includes("wb.export") && wbTexts.includes("wb.pathPlaceholder")) {
          ok("WorkBuddy 模式有「导出报告 / 路径输入」");
        } else {
          fail("WorkBuddy 模式按钮", wbTexts.slice(0, 240));
        }
        mod.__test.setMode("dsh");
      } else {
        fail("WorkBuddy 模式渲染", "缺少 __test.setMode 测试钩子");
      }
    } catch (error) {
      fail("打开态面板渲染", error.message);
    } finally {
      mod.__test.setOpen(false);
    }
  } else {
    fail("打开态面板渲染", "缺少 __test.setOpen 测试钩子");
  }
} catch (error) {
  fail("apply 执行", error.message);
}

// --- 4. 宿主半边 ---
try {
  const host = await import(url.pathToFileURL(path.join(root, "lib", "index.js")));
  if (host.name === "dsh-skill-audit") ok("宿主 name 正确（dsh-skill-audit）");
  else fail("宿主 name", host.name);
  if (Array.isArray(host.inject) && host.inject.includes("connection")) ok('宿主 inject 包含 "connection"');
  else fail("宿主 inject", JSON.stringify(host.inject));

  const routes = [];
  const fakeCtx = {
    connection: {
      fetch: {
        register(route) {
          routes.push(route);
          return () => {};
        },
      },
    },
  };
  host.apply(fakeCtx);
  const paths = routes.map((route) => route.path).sort();
  const expected = [
    "/api/dsh-skill-audit/report",
    "/api/dsh-skill-audit/scan",
    "/api/dsh-skill-audit/wb-report",
    "/api/dsh-skill-audit/wb-scan",
  ];
  if (JSON.stringify(paths) === JSON.stringify(expected)) ok("宿主注册 4 条路由（DSH scan/report + WorkBuddy wb-scan/wb-report）");
  else fail("宿主路由", JSON.stringify(paths));
  for (const routePath of ["/api/dsh-skill-audit/report", "/api/dsh-skill-audit/wb-scan", "/api/dsh-skill-audit/wb-report"]) {
    const route = routes.find((item) => item.path === routePath);
    if (route && route.methods && route.methods.includes("POST") && typeof route.fetch === "function") {
      ok(`${routePath} 为 POST 且带 fetch handler`);
    } else {
      fail(`${routePath} 路由定义`);
    }
  }
} catch (error) {
  fail("宿主半边导入", error.message);
}

// --- 5. 打包文件清单一致性 ---
const requiredFiles = [
  "lib/index.js", "lib/client.js", "lib/audit.mjs", "lib/wb-package.mjs", "lib/wb-audit.mjs",
  "app/panel.html", "assets/icon.png", "README.md", "README.zh.md", "LICENSE", "cordis.patch.yml",
];
const missingFiles = requiredFiles.filter((item) => !(pkg.files || []).includes(item));
if (missingFiles.length === 0) ok("package.json files 覆盖必要文件");
else fail("package.json files", `缺少 ${missingFiles.join("、")}`);

console.log("");
if (errors.length) {
  console.log(`FAILED: ${errors.join("; ")}`);
  process.exit(1);
}
console.log("SMOKE OK");
