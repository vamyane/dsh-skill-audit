/**
 * dsh-skill-audit 浏览器半边（模板）。
 * build.mjs 会把 app/panel.html gzip+base64 后塞进 PANEL_GZIP_B64（静态预览页）。
 *
 * 面板用 React 直接渲染（不用 iframe），两个模式：
 *   - DSH 资产：GET /api/dsh-skill-audit/scan / POST /report
 *   - WorkBuddy 包：POST /api/dsh-skill-audit/wb-scan / wb-report（目录或 .zip 路径）
 *
 * 两个槽位：
 *  - sidebar.footer.action：左侧栏底部的「🛡️ 审核台」按钮
 *  - shell.overlay：全屏面板
 */
window.__ModuleLoader__.load({
  id: "dsh-skill-audit",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");

    var PANEL_GZIP_B64 = "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";

    var NS = "dsh-skill-audit";
    var SCAN_PATH = "/api/dsh-skill-audit/scan";
    var REPORT_PATH = "/api/dsh-skill-audit/report";
    var WB_SCAN_PATH = "/api/dsh-skill-audit/wb-scan";
    var WB_REPORT_PATH = "/api/dsh-skill-audit/wb-report";

    var STATUS_ICON = { pass: "✅", warn: "⚠️", fail: "❌", skip: "➖" };
    var STATUS_LABEL = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "SKIP" };
    var GRADE_COLOR = { S: "#f5c542", A: "#34d399", B: "#38bdf8", C: "#fbbf24", D: "#f87171" };
    var SEVERITY_COLOR = { blocker: "#f87171", major: "#fbbf24", minor: "#94a3b8" };
    var SEVERITY_LABEL = { blocker: "blocker", major: "major", minor: "minor" };
    var TYPE_LABEL_KEY = { skill: "panel.type.skill", plugin: "panel.type.plugin" };
    var SCOPE_LABEL_KEY = {
      skills: "panel.scope.skills",
      profile: "panel.scope.profile",
      workspace: "panel.scope.workspace",
    };

    /* ---------------- 文案 ---------------- */
    var MESSAGES = {
      zh: {
        "app.name": "审核台",
        "toggle.title": "扫描 DSH 技能/插件，或审核 WorkBuddy 技能包/专家包（门禁 + Q/V + 定价）",
        "panel.title": "🛡️ 技能 / 插件审核台",
        "panel.hint": "DSH 资产只读扫描；WorkBuddy 包做 25 条门禁 + 质量分 Q + 价值分 V + 定价建议",
        "panel.close": "关闭",
        "mode.dsh": "DSH 资产",
        "mode.wb": "WorkBuddy 包",
        "mode.dshHint": "扫描 ~/.dsh/skills、已安装插件与工作区 dsh-plugins",
        "mode.wbHint": "审核 WorkBuddy 技能包 / 专家包（支持目录与 .zip）",
        "panel.refresh": "重新扫描",
        "panel.export": "导出报告",
        "panel.exporting": "导出中…",
        "panel.preview": "静态预览",
        "panel.previewFailed": "静态预览页解压失败",
        "panel.loading": "正在扫描本机 DSH 技能与插件…",
        "panel.error": "扫描失败",
        "panel.retry": "重试",
        "panel.empty": "这个筛选条件下没有资产",
        "panel.filter.all": "全部",
        "panel.filter.skill": "技能",
        "panel.filter.plugin": "插件",
        "panel.col.name": "名称",
        "panel.col.type": "类型",
        "panel.col.scope": "来源",
        "panel.col.score": "分数",
        "panel.col.grade": "等级",
        "panel.col.issues": "问题",
        "panel.type.skill": "技能",
        "panel.type.plugin": "插件",
        "panel.scope.skills": "~/.dsh/skills",
        "panel.scope.profile": "profile",
        "panel.scope.workspace": "工作区",
        "panel.summary.total": "资产总数",
        "panel.summary.average": "平均分",
        "panel.summary.grades": "等级分布",
        "panel.summary.issues": "待修问题",
        "panel.summary.workspace": "工作区",
        "panel.summary.generated": "生成于",
        "panel.summary.duration": "耗时",
        "panel.exportOk": "报告已写入",
        "panel.exportFailed": "导出失败",
        "panel.expand": "展开检查明细",
        "panel.collapse": "收起",
        "panel.checks": "检查明细",
        "panel.legend": "✅ pass · ⚠️ warn（半分）· ❌ fail（0 分）· ➖ skip（不计分）· S≥90 / A≥80 / B≥70 / C≥60 / D<60",
        "wb.title": "WorkBuddy 包审核",
        "wb.pathPlaceholder": "WorkBuddy 包目录或 .zip 的绝对路径，例：E:\\技能资产库\\上架包\\xxx.zip",
        "wb.scan": "扫描包",
        "wb.scanning": "扫描中…",
        "wb.export": "导出报告",
        "wb.exporting": "导出中…",
        "wb.idle": "输入一个 WorkBuddy 技能包 / 专家包路径（目录或 .zip），点「扫描包」开始审核。",
        "wb.loading": "正在读取并审核 WorkBuddy 包…",
        "wb.error": "扫描失败",
        "wb.retry": "重试",
        "wb.gate": "门禁 Gate（25 条）",
        "wb.blocker": "blocker",
        "wb.major": "major",
        "wb.minor": "minor",
        "wb.verdict": "门禁结论",
        "wb.q": "质量分 Q",
        "wb.v": "价值分 V",
        "wb.vRaw": "V 原始分",
        "wb.price": "建议价格",
        "wb.subscription": "订阅建议",
        "wb.domain": "领域",
        "wb.size": "包体",
        "wb.files": "文件数",
        "wb.paid": "付费包（已检查法律文件）",
        "wb.free": "免费包（法律文件不强制）",
        "wb.kind.skill": "技能包",
        "wb.kind.expert": "专家包",
        "wb.col.id": "ID",
        "wb.col.severity": "严重度",
        "wb.col.status": "状态",
        "wb.col.title": "检查项",
        "wb.evidence": "证据",
        "wb.fix": "修复建议",
        "wb.detail": "说明",
        "wb.qualityDims": "质量分维度",
        "wb.valueDims": "价值分维度",
        "wb.penalties": "惩罚项",
        "wb.notes": "口径与限制",
        "wb.exportOk": "WorkBuddy 报告已写入",
        "wb.exportFailed": "报告导出失败",
        "wb.expand": "展开",
        "wb.collapse": "收起",
        "wb.noIssues": "没有 fail / warn 项",
        "wb.pending": "扫描完成后在这里显示门禁表、Q/V 分数和定价建议",
        "wb.hint": "启发式静态评分：门禁确定性检查，Q/V 基于词频/结构启发式，报告内含每条依据；不假装模型判断。",
      },
      en: {
        "app.name": "Audit",
        "toggle.title": "Scan DSH skills/plugins, or audit WorkBuddy skill/expert packages (gate + Q/V + pricing)",
        "panel.title": "🛡️ Skill / Plugin Audit",
        "panel.hint": "Read-only DSH scan; WorkBuddy packages get 25 gate checks + quality Q + value V + pricing",
        "panel.close": "Close",
        "mode.dsh": "DSH assets",
        "mode.wb": "WorkBuddy",
        "mode.dshHint": "Scan ~/.dsh/skills, installed plugins and workspace dsh-plugins",
        "mode.wbHint": "Audit WorkBuddy skill / expert packages (directory or .zip)",
        "panel.refresh": "Rescan",
        "panel.export": "Export report",
        "panel.exporting": "Exporting…",
        "panel.preview": "Static preview",
        "panel.previewFailed": "Could not decode the static preview page",
        "panel.loading": "Scanning local DSH skills and plugins…",
        "panel.error": "Scan failed",
        "panel.retry": "Retry",
        "panel.empty": "No assets under this filter",
        "panel.filter.all": "All",
        "panel.filter.skill": "Skills",
        "panel.filter.plugin": "Plugins",
        "panel.col.name": "Name",
        "panel.col.type": "Type",
        "panel.col.scope": "Source",
        "panel.col.score": "Score",
        "panel.col.grade": "Grade",
        "panel.col.issues": "Issues",
        "panel.type.skill": "skill",
        "panel.type.plugin": "plugin",
        "panel.scope.skills": "~/.dsh/skills",
        "panel.scope.profile": "profile",
        "panel.scope.workspace": "workspace",
        "panel.summary.total": "Assets",
        "panel.summary.average": "Average",
        "panel.summary.grades": "Grades",
        "panel.summary.issues": "Open issues",
        "panel.summary.workspace": "Workspace",
        "panel.summary.generated": "Generated",
        "panel.summary.duration": "Took",
        "panel.exportOk": "Report written to",
        "panel.exportFailed": "Export failed",
        "panel.expand": "Expand checks",
        "panel.collapse": "Collapse",
        "panel.checks": "Checks",
        "panel.legend": "✅ pass · ⚠️ warn (half) · ❌ fail (0) · ➖ skip (not scored) · S≥90 / A≥80 / B≥70 / C≥60 / D<60",
        "wb.title": "WorkBuddy package audit",
        "wb.pathPlaceholder": "Absolute path to a WorkBuddy package directory or .zip, e.g. E:\\skills\\release\\xxx.zip",
        "wb.scan": "Scan package",
        "wb.scanning": "Scanning…",
        "wb.export": "Export report",
        "wb.exporting": "Exporting…",
        "wb.idle": "Enter a WorkBuddy skill / expert package path (directory or .zip), then click Scan package.",
        "wb.loading": "Reading and auditing the WorkBuddy package…",
        "wb.error": "Scan failed",
        "wb.retry": "Retry",
        "wb.gate": "Gate (25 checks)",
        "wb.blocker": "blocker",
        "wb.major": "major",
        "wb.minor": "minor",
        "wb.verdict": "Gate verdict",
        "wb.q": "Quality Q",
        "wb.v": "Value V",
        "wb.vRaw": "V raw",
        "wb.price": "Suggested price",
        "wb.subscription": "Subscription",
        "wb.domain": "Domain",
        "wb.size": "Size",
        "wb.files": "Files",
        "wb.paid": "paid package (legal files checked)",
        "wb.free": "free package",
        "wb.kind.skill": "Skill package",
        "wb.kind.expert": "Expert package",
        "wb.col.id": "ID",
        "wb.col.severity": "Severity",
        "wb.col.status": "Status",
        "wb.col.title": "Check",
        "wb.evidence": "Evidence",
        "wb.fix": "Fix",
        "wb.detail": "Detail",
        "wb.qualityDims": "Quality dimensions",
        "wb.valueDims": "Value dimensions",
        "wb.penalties": "Penalties",
        "wb.notes": "Notes & limitations",
        "wb.exportOk": "WorkBuddy report written to",
        "wb.exportFailed": "Report export failed",
        "wb.expand": "Expand",
        "wb.collapse": "Collapse",
        "wb.noIssues": "No fail / warn items",
        "wb.pending": "Gate table, Q/V scores and pricing appear here after a scan",
        "wb.hint": "Heuristic static scoring: gate checks are deterministic, Q/V are word/structure heuristics; the report shows every piece of evidence. No pretend model judgement.",
      },
    };

    function translateFactory(locale) {
      if (locale !== undefined && locale !== null && typeof locale.bind === "function") {
        try {
          return locale.bind(NS);
        } catch (error) {
          /* fallback below */
        }
      }
      var fallback = MESSAGES.zh;
      return function (key) {
        return Object.prototype.hasOwnProperty.call(fallback, key) ? fallback[key] : key;
      };
    }

    /* ---------------- 页面上下文里的会话 cwd（决定导出到哪个工作区） ---------------- */
    function detectSessionCwd(ctx) {
      try {
        var sessions = typeof ctx.get === "function" ? ctx.get("sessions") : undefined;
        var snapshot = sessions && sessions.list && typeof sessions.list.getSnapshot === "function"
          ? sessions.list.getSnapshot()
          : undefined;
        var byId = (snapshot && snapshot.byId) || {};
        var ids = Object.keys(byId);
        var fallback = "";
        for (var i = 0; i < ids.length; i++) {
          var session = byId[ids[i]];
          if (!session || typeof session.cwd !== "string" || !session.cwd) continue;
          if (session.retainedBy && session.retainedBy.mainView > 0) return session.cwd;
          if (!fallback) fallback = session.cwd;
        }
        return fallback;
      } catch (error) {
        return "";
      }
    }

    function safeCwd(getCwd) {
      try {
        var value = typeof getCwd === "function" ? getCwd() : "";
        return typeof value === "string" ? value.trim() : "";
      } catch (error) {
        return "";
      }
    }

    /* ---------------- 静态预览页（app/panel.html，构建时 gzip 内嵌） ---------------- */
    function decodeGzip(b64) {
      return new Promise(function (resolve, reject) {
        try {
          var bin = atob(b64);
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          if (typeof DecompressionStream === "undefined") {
            reject(new Error("当前浏览器不支持 DecompressionStream"));
            return;
          }
          var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
          new Response(stream).text().then(resolve, reject);
        } catch (error) {
          reject(error);
        }
      });
    }

    var panelHtmlPromise = null;
    function loadPanelHtml() {
      if (panelHtmlPromise !== null) return panelHtmlPromise;
      panelHtmlPromise = decodeGzip(PANEL_GZIP_B64).catch(function (error) {
        panelHtmlPromise = null;
        throw error;
      });
      return panelHtmlPromise;
    }

    function openStaticPreview() {
      return loadPanelHtml().then(function (html) {
        var blob = new Blob([html], { type: "text/html;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener");
        window.setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 60000);
        return true;
      });
    }

    /* ---------------- API（页面上下文 fetch，天然带登录态） ---------------- */
    function messageOf(error) {
      return String(error && error.message ? error.message : error);
    }

    function postJson(url, body) {
      return fetch(url, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {}),
      }).then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok) throw new Error((payload && payload.error) || "HTTP " + response.status);
          return payload;
        });
      });
    }

    function requestDshScan(getCwd) {
      var cwd = safeCwd(getCwd);
      var url = SCAN_PATH + (cwd ? "?workspace=" + encodeURIComponent(cwd) : "");
      return fetch(url, { cache: "no-store", credentials: "same-origin" }).then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok) throw new Error((payload && payload.error) || "HTTP " + response.status);
          return payload;
        });
      });
    }

    function requestDshReport(getCwd) {
      var cwd = safeCwd(getCwd);
      return postJson(REPORT_PATH, cwd ? { workspace: cwd } : {});
    }

    function requestWbScan(path) {
      return postJson(WB_SCAN_PATH, { path: path });
    }

    function requestWbReport(path, getCwd) {
      var cwd = safeCwd(getCwd);
      return postJson(WB_REPORT_PATH, cwd ? { path: path, workspace: cwd } : { path: path });
    }

    /* ---------------- 开合 / 模式状态 ---------------- */
    var store = { open: false };
    var listeners = new Set();
    var getOpen = function () { return store.open; };
    var subscribe = function (callback) {
      listeners.add(callback);
      return function () { listeners.delete(callback); };
    };
    var setOpen = function (value) {
      if (store.open !== value) {
        store.open = value;
        listeners.forEach(function (callback) { callback(); });
      }
    };
    var useOpen = function () { return react.useSyncExternalStore(subscribe, getOpen); };

    var modeStore = { mode: "dsh" };
    var modeListeners = new Set();
    var getMode = function () { return modeStore.mode; };
    var subscribeMode = function (callback) {
      modeListeners.add(callback);
      return function () { modeListeners.delete(callback); };
    };
    var setMode = function (value) {
      if (modeStore.mode !== value) {
        modeStore.mode = value;
        modeListeners.forEach(function (callback) { callback(); });
      }
    };
    var useMode = function () { return react.useSyncExternalStore(subscribeMode, getMode); };

    /* ---------------- 渲染小工具 ---------------- */
    function h(type) {
      var props = arguments.length > 1 ? arguments[1] : null;
      var children = [];
      for (var i = 2; i < arguments.length; i++) children.push(arguments[i]);
      return react.createElement.apply(react, [type, props].concat(children));
    }

    function gradeStyle(grade) {
      return { color: GRADE_COLOR[grade] || "#e6e9f2", fontWeight: 700 };
    }

    function typeBadgeStyle(type) {
      if (type === "skill") return { color: "#a5b4fc", border: "1px solid #3730a3", background: "rgba(99,102,241,.12)" };
      return { color: "#93c5fd", border: "1px solid #1d4ed8", background: "rgba(59,130,246,.12)" };
    }

    function issueText(asset) {
      return h(
        "span",
        null,
        h("span", { style: { color: "#f87171" } }, "❌ " + asset.counts.fail),
        h("span", { style: { color: "#64748b" } }, " · "),
        h("span", { style: { color: "#fbbf24" } }, "⚠️ " + asset.counts.warn)
      );
    }

    function buttonStyle(background, border, color) {
      return {
        background: background, border: "1px solid " + border, borderRadius: "8px",
        color: color, fontSize: "12.5px", cursor: "pointer", padding: "5px 10px",
      };
    }

    var cellStyle = { padding: "9px 12px", verticalAlign: "top", textAlign: "left" };
    var headStyle = { padding: "8px 12px", textAlign: "left", fontWeight: 500 };

    function summaryCard(label, value, tone) {
      return h(
        "div",
        { style: { background: "#101a2e", border: "1px solid #223049", borderRadius: "12px", padding: "10px 13px" } },
        h("div", { style: { color: "#8b93a7", fontSize: "12px" } }, label),
        h("div", { style: { fontSize: "17px", fontWeight: 650, marginTop: "2px", color: tone || "#e6e9f2" } }, value)
      );
    }

    function chip(label, color) {
      return h("span", {
        style: {
          display: "inline-block", padding: "1px 8px", borderRadius: "999px",
          fontSize: "11px", border: "1px solid " + (color || "#334155"), color: color || "#94a3b8",
          marginRight: "6px",
        },
      }, label);
    }

    /* ---------------- DSH 资产视图 ---------------- */
    function checkList(t, asset) {
      var rank = { fail: 0, warn: 1, pass: 2, skip: 3 };
      var checks = asset.checks.slice().sort(function (left, right) {
        return (rank[left.status] || 9) - (rank[right.status] || 9);
      });
      return h(
        "ul",
        { style: { margin: 0, padding: "10px 16px 14px 34px", background: "#091222", listStyle: "none" } },
        checks.map(function (item) {
          return h(
            "li",
            { key: item.id, style: { margin: "6px 0", position: "relative" } },
            h("span", { style: { position: "absolute", left: "-22px" } }, STATUS_ICON[item.status] || "•"),
            h("strong", { style: { color: item.status === "pass" ? "#cbd5e1" : "#e6e9f2" } }, item.label),
            h("span", { style: { color: "#94a3b8" } }, "：" + (item.detail || "—")),
            item.hint && (item.status === "fail" || item.status === "warn")
              ? h("div", { style: { color: "#8b93a7", fontSize: "12px", marginTop: "2px" } }, "建议：" + item.hint)
              : null
          );
        })
      );
    }

    function DshView(props) {
      var t = props.t;
      var state = props.state;
      var patch = props.patch;
      var view = state;
      var data = view.dshData;
      var summary = data ? data.summary : null;
      var assets = data ? data.assets : [];
      var filtered = assets.filter(function (asset) {
        return view.dshFilter === "all" || asset.type === view.dshFilter;
      });

      var filterTabs = ["all", "skill", "plugin"].map(function (key) {
        var active = view.dshFilter === key;
        var count = key === "all" ? assets.length : assets.filter(function (asset) { return asset.type === key; }).length;
        return h(
          "button",
          {
            key: key,
            onClick: function () { patch({ dshFilter: key }); },
            style: {
              cursor: "pointer", borderRadius: "999px", padding: "4px 12px", fontSize: "12.5px",
              color: active ? "#0b1220" : "#b8c4da", background: active ? "#7dd3fc" : "transparent",
              border: "1px solid " + (active ? "#7dd3fc" : "#2e3d59"),
            },
          },
          t("panel.filter." + key) + " " + count
        );
      });

      var rows = [];
      filtered.forEach(function (asset) {
        var expanded = view.dshExpanded === asset.id;
        rows.push(
          h(
            "tr",
            {
              key: asset.id,
              onClick: function () { patch({ dshExpanded: expanded ? "" : asset.id }); },
              style: { cursor: "pointer", borderBottom: "1px solid #1e293b", background: expanded ? "#0a1424" : "transparent" },
            },
            h("td", { style: cellStyle },
              h("div", { style: { fontWeight: 600 } }, asset.name),
              h("div", { style: { color: "#8b93a7", fontSize: "11.5px", wordBreak: "break-all" } }, asset.path)),
            h("td", { style: cellStyle },
              h("span", { style: Object.assign({ display: "inline-block", padding: "1px 8px", borderRadius: "999px", fontSize: "11.5px" }, typeBadgeStyle(asset.type)) }, t(TYPE_LABEL_KEY[asset.type] || "panel.col.type"))),
            h("td", { style: Object.assign({}, cellStyle, { color: "#8b93a7", fontSize: "12px" }) }, t(SCOPE_LABEL_KEY[asset.scope] || "panel.scope.workspace")),
            h("td", { style: Object.assign({}, cellStyle, { fontVariantNumeric: "tabular-nums", fontWeight: 600 }) }, String(asset.score)),
            h("td", { style: cellStyle }, h("span", { style: gradeStyle(asset.grade) }, asset.grade)),
            h("td", { style: cellStyle }, issueText(asset)),
            h("td", { style: Object.assign({}, cellStyle, { color: "#8b93a7", fontSize: "12px" }) }, expanded ? "▾ " + t("panel.collapse") : "▸ " + t("panel.expand"))
          )
        );
        if (expanded) {
          rows.push(
            h("tr", { key: asset.id + ":detail" },
              h("td", { colSpan: 7, style: { padding: 0, borderBottom: "1px solid #1e293b" } }, checkList(t, asset)))
          );
        }
      });

      var summaryCards = h(
        "div",
        { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px", margin: "14px 16px" } },
        summaryCard(t("panel.summary.total"), String(summary.total)),
        summaryCard(t("panel.summary.average"), summary.average + " / 100"),
        summaryCard(t("panel.summary.grades"), "S " + summary.grades.S + " · A " + summary.grades.A + " · B " + summary.grades.B + " · C " + summary.grades.C + " · D " + summary.grades.D),
        summaryCard(t("panel.summary.issues"), "❌ " + summary.failedChecks + " · ⚠️ " + summary.warnedChecks)
      );

      var exportLine = null;
      if (view.dshExportInfo) {
        exportLine = h("div", { style: { color: "#34d399", fontSize: "12.5px", margin: "0 16px 10px" } },
          t("panel.exportOk") + "：" + view.dshExportInfo.path);
      } else if (view.dshExportError) {
        exportLine = h("div", { style: { color: "#f87171", fontSize: "12.5px", margin: "0 16px 10px" } },
          t("panel.exportFailed") + "：" + view.dshExportError);
      }

      return h(
        "div",
        { style: { flex: "1", overflow: "auto", minHeight: 0 } },
        summaryCards,
        h(
          "div",
          { style: { display: "flex", gap: "8px", alignItems: "center", margin: "0 16px 12px", flexWrap: "wrap" } },
          filterTabs,
          h("span", { style: { color: "#64748b", fontSize: "12px", marginLeft: "auto" } },
            t("panel.summary.workspace") + "：" + data.workspace + " · " + t("panel.summary.generated") + " " +
            new Date(data.generatedAt).toLocaleTimeString() + " · " + data.durationMs + " ms")
        ),
        exportLine,
        h(
          "div",
          { style: { margin: "0 16px", border: "1px solid #1e293b", borderRadius: "12px", overflow: "hidden" } },
          h(
            "table",
            { style: { width: "100%", borderCollapse: "collapse", fontSize: "13px" } },
            h("thead", null,
              h("tr", { style: { background: "#0d1526", color: "#8b93a7", fontSize: "12px" } },
                h("th", { style: headStyle }, t("panel.col.name")),
                h("th", { style: headStyle }, t("panel.col.type")),
                h("th", { style: headStyle }, t("panel.col.scope")),
                h("th", { style: headStyle }, t("panel.col.score")),
                h("th", { style: headStyle }, t("panel.col.grade")),
                h("th", { style: headStyle }, t("panel.col.issues")),
                h("th", { style: headStyle }, ""))),
            h("tbody", null, rows)
          )
        ),
        filtered.length === 0
          ? h("div", { style: { color: "#8b93a7", fontSize: "13px", textAlign: "center", padding: "24px" } }, t("panel.empty"))
          : null,
        h("div", { style: { color: "#64748b", fontSize: "11.5px", margin: "12px 16px 16px" } }, t("panel.legend"))
      );
    }

    /* ---------------- WorkBuddy 包视图 ---------------- */
    function severityRows(t, patch, state, checks) {
      var groups = ["blocker", "major", "minor"];
      var nodes = [];
      groups.forEach(function (severity) {
        var items = checks.filter(function (check) { return check.severity === severity; });
        var failed = items.filter(function (check) { return check.status === "fail" || check.status === "warn"; });
        var shown = severity === "blocker" || severity === "major" ? items : items;
        nodes.push(
          h("div", { key: severity, style: { marginTop: "12px" } },
            h("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", fontWeight: 600, color: SEVERITY_COLOR[severity] } },
              h("span", null, severity.toUpperCase()),
              h("span", { style: { color: "#64748b", fontWeight: 400, fontSize: "12px" } },
                "共 " + items.length + " 条 · fail/warn " + failed.length)
            ),
            h("div", { style: { border: "1px solid #1e293b", borderRadius: "10px", overflow: "hidden" } },
              shown.map(function (check) {
                var expanded = state.wbExpandedGate === check.id;
                var isIssue = check.status === "fail" || check.status === "warn";
                return h("div", { key: check.id, style: { borderBottom: "1px solid #1a2436", background: isIssue ? "rgba(248,113,113,.03)" : "transparent" } },
                  h("div", {
                    onClick: function () { patch({ wbExpandedGate: expanded ? "" : check.id }); },
                    style: { display: "flex", gap: "10px", alignItems: "flex-start", padding: "7px 12px", cursor: "pointer", fontSize: "12.5px" },
                  },
                    h("span", { style: { width: "78px", flex: "none", color: "#94a3b8", fontVariantNumeric: "tabular-nums" } }, check.id),
                    h("span", { style: { width: "62px", flex: "none", color: isIssue ? "#e6e9f2" : "#64748b" } }, STATUS_ICON[check.status] + " " + STATUS_LABEL[check.status]),
                    h("span", { style: { flex: 1, color: isIssue ? "#e2e8f0" : "#8b93a7" } }, check.title),
                    h("span", { style: { color: "#64748b", fontSize: "11px", flex: "none" } }, expanded ? "▾" : "▸")
                  ),
                  expanded
                    ? h("div", { style: { padding: "0 12px 10px 12px", color: "#94a3b8", fontSize: "12px", lineHeight: 1.6 } },
                        h("div", null, t("wb.detail") + "：" + check.detail),
                        isIssue ? h("div", { style: { marginTop: "3px", color: "#fbbf24" } }, t("wb.fix") + "：" + check.fix) : null,
                        check.evidence && check.evidence.length
                          ? h("div", { style: { marginTop: "3px" } }, t("wb.evidence") + "：" + check.evidence.slice(0, 5).join("；"))
                          : null
                      )
                    : null
                );
              })
            )
          )
        );
      });
      return nodes;
    }

    function WbView(props) {
      var t = props.t;
      var state = props.state;
      var patch = props.patch;
      var result = state.wbResult;

      var titleRow = h(
        "div",
        { style: { display: "flex", alignItems: "baseline", gap: "10px", margin: "14px 16px 0" } },
        h("span", { style: { fontWeight: 600, fontSize: "14px" } }, t("wb.title")),
        h("span", { style: { color: "#64748b", fontSize: "12px" } }, t("wb.hint"))
      );

      var inputRow = h(
        "div",
        { style: { display: "flex", gap: "8px", alignItems: "center", margin: "10px 16px 6px", flexWrap: "wrap" } },
        h("input", {
          value: state.wbPath,
          placeholder: t("wb.pathPlaceholder"),
          onChange: function (event) { patch({ wbPath: event.target.value }); },
          onKeyDown: function (event) { if (event.key === "Enter") props.onScan(); },
          style: {
            flex: "1 1 420px", minWidth: "240px", background: "#0d1526", color: "#e6e9f2",
            border: "1px solid #2e3d59", borderRadius: "8px", padding: "7px 10px", fontSize: "12.5px",
            outline: "none", fontFamily: "inherit",
          },
        }),
        h("button", { onClick: props.onScan, style: buttonStyle("#123a63", "#1d5f9c", "#d7ecff") },
          state.wbStatus === "loading" ? t("wb.scanning") : "🔍 " + t("wb.scan")),
        h("button", { onClick: props.onExport, style: buttonStyle("transparent", "#2e3d59", "#b8c4da") },
          state.wbExporting ? t("wb.exporting") : "⬇ " + t("wb.export"))
      );

      var hintLine = h("div", { style: { color: "#64748b", fontSize: "11.5px", margin: "0 16px 10px" } }, t("wb.hint"));

      var body;
      if (state.wbStatus === "loading") {
        body = h("div", { style: { padding: "28px", textAlign: "center", color: "#8b93a7", fontSize: "13px" } }, t("wb.loading"));
      } else if (state.wbStatus === "error") {
        body = h("div", { style: { padding: "24px", textAlign: "center", color: "#f87171", fontSize: "13px" } },
          h("div", null, t("wb.error") + "：" + state.wbError),
          h("button", { onClick: props.onScan, style: Object.assign(buttonStyle("#123a63", "#1d5f9c", "#d7ecff"), { marginTop: "10px" }) }, t("wb.retry")));
      } else if (!result) {
        body = h("div", { style: { padding: "30px 24px", textAlign: "center", color: "#8b93a7", fontSize: "13px", lineHeight: 1.8 } },
          h("div", { style: { fontSize: "28px", marginBottom: "8px" } }, "🛡️"),
          h("div", null, t("wb.idle")),
          h("div", { style: { color: "#64748b", fontSize: "12px", marginTop: "6px" } }, t("wb.pending")));
      } else {
        var input = result.input;
        var gate = result.gate;
        var quality = result.quality;
        var value = result.value;
        var priceText = value.priceBand ? value.priceBand.price : "不上架";
        var summaryCards = h(
          "div",
          { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px", margin: "0 16px 12px" } },
          summaryCard(t("wb.verdict"), gate.pass ? "✅ " + gate.verdict : "❌ " + gate.verdict, gate.pass ? "#34d399" : "#f87171"),
          summaryCard(t("wb.q"), quality.score + " / 100", "#38bdf8"),
          summaryCard(t("wb.v"), value.final + " / 100", GRADE_COLOR[value.grade] || "#e6e9f2"),
          summaryCard(t("wb.price"), priceText, value.priceBand ? "#34d399" : "#f87171"),
          summaryCard(t("wb.gate"), "❌ " + gate.blockerCount + " · ⚠️ " + gate.majorCount + " · ⚠️ " + gate.minorCount),
          summaryCard(t("wb.domain"), input.domain)
        );

        var metaLine = h(
          "div",
          { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", margin: "0 16px 10px", fontSize: "12px", color: "#94a3b8" } },
          h("span", { style: { fontWeight: 600, color: "#e6e9f2" } }, input.name),
          chip(t(input.kind === "expert" ? "wb.kind.expert" : "wb.kind.skill")),
          input.version ? chip("v" + input.version) : null,
          chip(t("wb.size") + " " + (input.sizeBytes / 1024).toFixed(1) + " KB"),
          chip(t("wb.files") + " " + input.fileCount),
          chip(input.paid ? t("wb.paid") : t("wb.free"), input.paid ? "#fbbf24" : "#64748b"),
          chip("V_raw " + value.raw),
          value.subscription ? chip(t("wb.subscription") + " " + value.subscription.price, "#34d399") : null,
          h("span", { style: { flex: 1 } }),
          h("span", { style: { color: "#64748b", fontSize: "11.5px", wordBreak: "break-all" } }, input.path)
        );

        var exportLine = null;
        if (state.wbExportInfo) {
          exportLine = h("div", { style: { color: "#34d399", fontSize: "12.5px", margin: "0 16px 8px" } },
            t("wb.exportOk") + "：" + state.wbExportInfo.path);
        } else if (state.wbExportError) {
          exportLine = h("div", { style: { color: "#f87171", fontSize: "12.5px", margin: "0 16px 8px" } },
            t("wb.exportFailed") + "：" + state.wbExportError);
        }

        var qRows = quality.dimensions.map(function (dim) {
          return h("tr", { key: dim.id, style: { borderBottom: "1px solid #1a2436" } },
            h("td", { style: cellStyle }, dim.id + " " + dim.name),
            h("td", { style: Object.assign({}, cellStyle, { fontVariantNumeric: "tabular-nums" }) }, dim.score + " / " + dim.max),
            h("td", { style: Object.assign({}, cellStyle, { color: "#8b93a7", fontSize: "12px" }) },
              dim.items.map(function (item) { return item.id + ":" + item.score; }).join(" · "))
          );
        });

        var vRows = value.dimensions.map(function (dim) {
          return h("tr", { key: dim.id, style: { borderBottom: "1px solid #1a2436" } },
            h("td", { style: cellStyle }, dim.id + " " + dim.name),
            h("td", { style: Object.assign({}, cellStyle, { fontVariantNumeric: "tabular-nums" }) }, String(dim.score)),
            h("td", { style: Object.assign({}, cellStyle, { color: "#8b93a7", fontSize: "12px" }) }, dim.evidence.join("；"))
          );
        });

        var penalties = quality.penalties.filter(function (penalty) { return !penalty.skipped; });

        body = h(
          "div",
          { style: { flex: "1", overflow: "auto", minHeight: 0, paddingBottom: "16px" } },
          summaryCards,
          metaLine,
          exportLine,
          h("div", { style: { margin: "0 16px" } },
            h("div", { style: { fontWeight: 600, margin: "6px 0" } }, t("wb.gate")),
            severityRows(t, patch, state, gate.checks)
          ),
          h("div", { style: { display: "flex", gap: "12px", flexWrap: "wrap", margin: "14px 16px 0" } },
            h("div", { style: { flex: "1 1 380px", border: "1px solid #1e293b", borderRadius: "12px", overflow: "hidden" } },
              h("div", { style: { padding: "8px 12px", background: "#0d1526", fontWeight: 600, fontSize: "13px" } }, t("wb.qualityDims")),
              h("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: "12.5px" } },
                h("tbody", null, qRows))),
            h("div", { style: { flex: "1 1 380px", border: "1px solid #1e293b", borderRadius: "12px", overflow: "hidden" } },
              h("div", { style: { padding: "8px 12px", background: "#0d1526", fontWeight: 600, fontSize: "13px" } }, t("wb.valueDims")),
              h("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: "12.5px" } },
                h("tbody", null, vRows)))
          ),
          penalties.length
            ? h("div", { style: { margin: "12px 16px 0", color: "#fbbf24", fontSize: "12.5px" } },
                t("wb.penalties") + "：" + penalties.map(function (penalty) { return penalty.id + " " + penalty.title + " " + penalty.delta; }).join("、"))
            : null,
          h("div", { style: { margin: "12px 16px 0", color: "#64748b", fontSize: "11.5px", lineHeight: 1.7 } },
            h("div", { style: { fontWeight: 600, color: "#8b93a7", marginBottom: "2px" } }, t("wb.notes")),
            result.notes.map(function (note) { return h("div", { key: note }, "· " + note); }),
            h("div", null, "· " + result.confidence.note))
        );
      }

      return h("div", { style: { flex: "1", display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" } }, titleRow, inputRow, hintLine, body);
    }

    /* ---------------- 全屏面板（React 直接渲染） ---------------- */
    function SkillAuditPanel(props) {
      var t = props.t;
      var getCwd = props.cwd;
      var open = useOpen();
      var mode = useMode();
      var stateHook = react.useState({
        dshStatus: "idle",
        dshData: null,
        dshError: "",
        dshExporting: false,
        dshExportInfo: null,
        dshExportError: "",
        dshFilter: "all",
        dshExpanded: "",
        wbPath: "",
        wbStatus: "idle",
        wbResult: null,
        wbError: "",
        wbExporting: false,
        wbExportInfo: null,
        wbExportError: "",
        wbExpandedGate: "",
        previewError: "",
      });
      var view = stateHook[0];
      var setView = stateHook[1];

      var patch = function (partial) {
        setView(function (previous) {
          var next = {};
          var key;
          for (key in previous) next[key] = previous[key];
          for (key in partial) next[key] = partial[key];
          return next;
        });
      };

      var loadDsh = function () {
        patch({ dshStatus: "loading", dshError: "", dshExportError: "", dshExportInfo: null });
        requestDshScan(getCwd).then(
          function (data) {
            patch({ dshStatus: "ready", dshData: data, dshExpanded: "" });
          },
          function (error) {
            patch({ dshStatus: "error", dshError: messageOf(error) });
          }
        );
      };

      var scanWb = function () {
        var target = String(view.wbPath || "").trim();
        if (!target) {
          patch({ wbStatus: "error", wbError: t("wb.pathPlaceholder") });
          return;
        }
        patch({ wbStatus: "loading", wbError: "", wbExportError: "", wbExportInfo: null });
        requestWbScan(target).then(
          function (result) {
            patch({ wbStatus: "ready", wbResult: result, wbExpandedGate: "" });
          },
          function (error) {
            patch({ wbStatus: "error", wbError: messageOf(error) });
          }
        );
      };

      var exportDsh = function () {
        patch({ dshExporting: true, dshExportError: "" });
        requestDshReport(getCwd).then(
          function (info) { patch({ dshExporting: false, dshExportInfo: info }); },
          function (error) { patch({ dshExporting: false, dshExportError: messageOf(error) }); }
        );
      };

      var exportWb = function () {
        var target = String(view.wbPath || "").trim();
        if (!target) {
          patch({ wbExportError: t("wb.pathPlaceholder") });
          return;
        }
        patch({ wbExporting: true, wbExportError: "" });
        requestWbReport(target, getCwd).then(
          function (info) { patch({ wbExporting: false, wbExportInfo: info }); },
          function (error) { patch({ wbExporting: false, wbExportError: messageOf(error) }); }
        );
      };

      var onPreview = function () {
        patch({ previewError: "" });
        openStaticPreview().catch(function (error) {
          patch({ previewError: messageOf(error) });
        });
      };

      react.useEffect(function () {
        if (!open) return undefined;
        if (mode === "dsh" && view.dshStatus === "idle") loadDsh();
        return undefined;
      }, [open, mode]);

      react.useEffect(function () {
        if (!open) return undefined;
        var onKey = function (event) {
          if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        return function () { document.removeEventListener("keydown", onKey); };
      }, [open]);

      if (!open) return null;

      var modeTabs = ["dsh", "wb"].map(function (key) {
        var active = mode === key;
        return h("button", {
          key: key,
          onClick: function () { setMode(key); },
          style: {
            cursor: "pointer", borderRadius: "8px", padding: "5px 12px", fontSize: "12.5px",
            color: active ? "#0b1220" : "#b8c4da",
            background: active ? "#7dd3fc" : "transparent",
            border: "1px solid " + (active ? "#7dd3fc" : "#2e3d59"),
          },
        }, t("mode." + key));
      });

      var headerButtons = [];
      if (mode === "dsh") {
        headerButtons.push(h("button", { key: "rescan", onClick: loadDsh, style: buttonStyle("#123a63", "#1d5f9c", "#d7ecff") }, "↻ " + t("panel.refresh")));
        headerButtons.push(h("button", { key: "export", onClick: exportDsh, style: buttonStyle("transparent", "#2e3d59", "#b8c4da") },
          view.dshExporting ? t("panel.exporting") : "⬇ " + t("panel.export")));
      } else {
        headerButtons.push(h("button", { key: "wbscan", onClick: scanWb, style: buttonStyle("#123a63", "#1d5f9c", "#d7ecff") },
          view.wbStatus === "loading" ? t("wb.scanning") : "🔍 " + t("wb.scan")));
        headerButtons.push(h("button", { key: "wbexport", onClick: exportWb, style: buttonStyle("transparent", "#2e3d59", "#b8c4da") },
          view.wbExporting ? t("wb.exporting") : "⬇ " + t("wb.export")));
      }
      headerButtons.push(h("button", { key: "preview", onClick: onPreview, style: buttonStyle("transparent", "#2e3d59", "#b8c4da") }, "🖼 " + t("panel.preview")));
      headerButtons.push(h("button", { key: "close", onClick: function () { setOpen(false); }, title: t("panel.close"), style: buttonStyle("transparent", "transparent", "#8f8a97") }, "✕"));

      var header = h(
        "div",
        {
          style: {
            display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px",
            background: "#0f172a", borderBottom: "1px solid #1e293b", flex: "none", flexWrap: "wrap",
          },
        },
        h("span", { style: { fontSize: "15px", fontWeight: 600, color: "#e6e9f2" } }, t("panel.title")),
        h("span", { style: { display: "flex", gap: "6px" } }, modeTabs),
        h("span", { style: { fontSize: "12px", color: "#8b93a7", flex: "1 1 220px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
          mode === "dsh" ? t("mode.dshHint") : t("mode.wbHint")),
        headerButtons
      );

      var body;
      if (view.previewError) {
        body = h("div", { style: { padding: "10px 16px", color: "#f87171", fontSize: "12.5px" } }, t("panel.previewFailed") + "：" + view.previewError);
      } else if (mode === "dsh") {
        if (view.dshStatus === "error") {
          body = h("div", { style: { flex: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", color: "#f87171", fontSize: "13px", padding: "0 24px", textAlign: "center" } },
            h("div", null, t("panel.error") + "：" + view.dshError),
            h("button", { onClick: loadDsh, style: buttonStyle("#123a63", "#1d5f9c", "#d7ecff") }, t("panel.retry")));
        } else if (view.dshStatus !== "ready" || !view.dshData) {
          body = h("div", { style: { flex: "1", display: "flex", alignItems: "center", justifyContent: "center", color: "#8b93a7", fontSize: "13px", padding: "0 24px", textAlign: "center" } }, t("panel.loading"));
        } else {
          body = h(DshView, { t: t, state: view, patch: patch });
        }
      } else {
        body = h(WbView, { t: t, state: view, patch: patch, onScan: scanWb, onExport: exportWb });
      }

      return h(
        "div",
        {
          role: "dialog",
          "aria-label": t("panel.title"),
          onClick: function (event) { if (event.target === event.currentTarget) setOpen(false); },
          style: { position: "fixed", inset: "0", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(8,11,20,.62)" },
        },
        h(
          "div",
          {
            style: {
              width: "min(1400px, 96vw)", height: "90vh", background: "#0b1220",
              borderRadius: "16px", display: "flex", flexDirection: "column",
              overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,.55)",
              border: "1px solid #1e293b", color: "#e6e9f2",
            },
          },
          header,
          body
        )
      );
    }

    /* ---------------- 左侧栏底部按钮 ---------------- */
    function SkillAuditToggle(props) {
      var t = props.t;
      var open = useOpen();
      var showLabel = props.wide !== false;
      return h(
        "button",
        {
          onClick: function () { setOpen(!open); },
          title: t("toggle.title"),
          style: {
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            gap: "6px", cursor: "pointer", border: "1px solid #2e384b",
            borderRadius: "999px", background: open ? "#0e7490" : "transparent",
            color: open ? "#fff" : "#b8b2a6", padding: "6px 10px", fontSize: "13px",
            maxWidth: "100%", overflow: "hidden",
          },
        },
        h("span", { style: { fontSize: "15px", lineHeight: 1 } }, "🛡️"),
        showLabel
          ? h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t("app.name"))
          : null
      );
    }

    /* ---------------- 插件入口 ---------------- */
    function apply(ctx) {
      var slots = ctx.get("slots");
      if (slots === undefined || slots === null) return;
      var locale = ctx.get("locale");
      var t = translateFactory(locale);

      if (locale !== undefined && locale !== null && typeof locale.register === "function") {
        ctx.effect(function () {
          return locale.register(NS, { zh: MESSAGES.zh, en: MESSAGES.en });
        }, "dsh-skill-audit: locale dictionaries");
      }

      var cwd = function () { return detectSessionCwd(ctx); };

      slots.inject("shell.overlay", function () {
        return slots.register(
          { name: "shell.overlay", id: NS + ".panel", order: 25, locale: NS },
          function (props) {
            return h(SkillAuditPanel, { t: (props && props.t) || t, cwd: cwd });
          }
        );
      });

      slots.inject("sidebar.footer.action", function () {
        return slots.register(
          { name: "sidebar.footer.action", id: NS + ".toggle", order: 15, label: function () { return t("app.name"); }, locale: NS },
          function (props) {
            return h(SkillAuditToggle, { t: (props && props.t) || t, wide: props && props.wide });
          }
        );
      });
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale", "sessions"];
    exports.__test = { setOpen: setOpen, setMode: setMode, detectSessionCwd: detectSessionCwd, NS: NS };
    return module.exports;
  },
});
