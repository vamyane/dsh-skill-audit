#!/usr/bin/env node
/**
 * 构建 dsh-skill-audit 的浏览器半边：
 *   app/panel.html  gzip 后内嵌进 lib/client.js（静态预览页；面板本身用 React 直接渲染）
 *   lib/client.template.js -> lib/client.js（模板 + 内嵌数据）
 *
 * 用法：node build.mjs
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import zlib from "node:zlib";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const panelPath = path.join(here, "app", "panel.html");
const templatePath = path.join(here, "lib", "client.template.js");
const outPath = path.join(here, "lib", "client.js");

const PLACEHOLDER = "var PANEL_GZIP_B64 = __PANEL_GZIP_B64__;";
const PANEL_MARKERS = ["data-dsh-skill-audit-panel", "dsh-skill-audit", "<style"];

const panelHtml = fs.readFileSync(panelPath, "utf8");
const template = fs.readFileSync(templatePath, "utf8");

if (!template.includes(PLACEHOLDER)) {
  console.error("模板里找不到占位符：" + PLACEHOLDER);
  process.exit(1);
}
for (const marker of PANEL_MARKERS) {
  if (!panelHtml.includes(marker)) {
    console.error(`app/panel.html 缺少标记：${marker}`);
    process.exit(1);
  }
}

const panelB64 = zlib.gzipSync(Buffer.from(panelHtml, "utf8"), { level: 9 }).toString("base64");
const out = template.replace(PLACEHOLDER, "var PANEL_GZIP_B64 = " + JSON.stringify(panelB64) + ";");
fs.writeFileSync(outPath, out);

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
console.log(`panel.html      ${kb(Buffer.byteLength(panelHtml))}`);
console.log(`panel gzip b64  ${kb(panelB64.length)}`);
console.log(`client.js       ${kb(Buffer.byteLength(out))}  -> ${outPath}`);
