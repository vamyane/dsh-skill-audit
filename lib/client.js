/**
 * dsh-skill-audit 浏览器半边（模板）。
 * build.mjs 会把 app/panel.html gzip+base64 后塞进 PANEL_GZIP_B64：
 *   - 面板本身用 React 直接渲染（不用 iframe），数据在页面上下文里 fetch
 *     GET /api/dsh-skill-audit/scan，导出报告 POST /api/dsh-skill-audit/report；
 *   - app/panel.html 是「静态预览页」，只在点「静态预览」时解压成 Blob URL
 *     新窗口打开（构建产物的一处自检，也方便离线看设计）。
 *
 * 两个槽位：
 *  - sidebar.footer.action：左侧栏底部的「🛡️ 审核台」按钮
 *  - shell.overlay：点开后盖在整页上的全屏面板（表格 / 展开问题 / 重新扫描 / 导出报告）
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

    var STATUS_ICON = { pass: "✅", warn: "⚠️", fail: "❌", skip: "➖" };
    var GRADE_COLOR = { S: "#f5c542", A: "#34d399", B: "#38bdf8", C: "#fbbf24", D: "#f87171" };
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
        "toggle.title": "扫描 ~/.dsh/skills、已安装插件与工作区 dsh-plugins，给出分数和修复建议",
        "panel.title": "🛡️ 技能 / 插件审核台",
        "panel.hint": "在本机只读扫描技能与插件，逐项列出问题，可导出 Markdown 报告",
        "panel.close": "关闭",
        "panel.refresh": "重新扫描",
        "panel.export": "导出报告",
        "panel.exporting": "导出中…",
        "panel.preview": "静态预览",
        "panel.previewFailed": "静态预览页解压失败",
        "panel.loading": "正在扫描本机技能与插件…",
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
        "panel.version": "版本",
        "panel.counts": "通过 {pass} · 警告 {warn} · 失败 {fail}",
        "panel.legend": "✅ pass · ⚠️ warn（半分）· ❌ fail（0 分）· ➖ skip（不计分）· S≥90 / A≥80 / B≥70 / C≥60 / D<60",
      },
      en: {
        "app.name": "Audit",
        "toggle.title": "Scan ~/.dsh/skills, installed plugins and workspace dsh-plugins; score them and list fixes",
        "panel.title": "🛡️ Skill & Plugin Audit",
        "panel.hint": "Read-only local scan of skills and plugins with per-check issues and a Markdown report",
        "panel.close": "Close",
        "panel.refresh": "Rescan",
        "panel.export": "Export report",
        "panel.exporting": "Exporting…",
        "panel.preview": "Static preview",
        "panel.previewFailed": "Could not decode the static preview page",
        "panel.loading": "Scanning local skills and plugins…",
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
        "panel.version": "version",
        "panel.counts": "{pass} pass · {warn} warn · {fail} fail",
        "panel.legend": "✅ pass · ⚠️ warn (half) · ❌ fail (0) · ➖ skip (not scored) · S≥90 / A≥80 / B≥70 / C≥60 / D<60",
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

    function format(t, key, values) {
      var text = t(key);
      if (!values) return text;
      return String(text).replace(/\{(\w+)\}/g, function (match, name) {
        return values[name] === undefined ? match : String(values[name]);
      });
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

    function requestScan(getCwd) {
      var cwd = safeCwd(getCwd);
      var url = SCAN_PATH + (cwd ? "?workspace=" + encodeURIComponent(cwd) : "");
      return fetch(url, { cache: "no-store", credentials: "same-origin" }).then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok) throw new Error((payload && payload.error) || "HTTP " + response.status);
          return payload;
        });
      });
    }

    function requestReport(getCwd) {
      var cwd = safeCwd(getCwd);
      return fetch(REPORT_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cwd ? { workspace: cwd } : {}),
      }).then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok) throw new Error((payload && payload.error) || "HTTP " + response.status);
          return payload;
        });
      });
    }

    /* ---------------- 开合状态 ---------------- */
    var store = { open: false };
    var listeners = new Set();
    var getOpen = function () { return store.open; };
    var subscribe = function (cb) {
      listeners.add(cb);
      return function () { listeners.delete(cb); };
    };
    var setOpen = function (value) {
      if (store.open !== value) {
        store.open = value;
        listeners.forEach(function (cb) { cb(); });
      }
    };
    var useOpen = function () { return react.useSyncExternalStore(subscribe, getOpen); };

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

    /* ---------------- 全屏面板（React 直接渲染） ---------------- */
    function SkillAuditPanel(props) {
      var t = props.t;
      var getCwd = props.cwd;
      var open = useOpen();
      var stateHook = react.useState({
        status: "idle",
        data: null,
        error: "",
        exporting: false,
        exportInfo: null,
        exportError: "",
        filter: "all",
        expanded: "",
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

      var load = function () {
        patch({ status: "loading", error: "", exportError: "", exportInfo: null });
        requestScan(getCwd).then(
          function (data) {
            patch({ status: "ready", data: data, expanded: "" });
          },
          function (error) {
            patch({ status: "error", error: messageOf(error) });
          }
        );
      };

      react.useEffect(function () {
        if (open) load();
      }, [open]);

      react.useEffect(function () {
        if (!open) return undefined;
        var onKey = function (event) {
          if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        return function () { document.removeEventListener("keydown", onKey); };
      }, [open]);

      if (!open) return null;

      var onRescan = function () { load(); };
      var onExport = function () {
        patch({ exporting: true, exportError: "" });
        requestReport(getCwd).then(
          function (info) {
            patch({ exporting: false, exportInfo: info });
          },
          function (error) {
            patch({ exporting: false, exportError: messageOf(error) });
          }
        );
      };
      var onPreview = function () {
        patch({ previewError: "" });
        openStaticPreview().catch(function (error) {
          patch({ previewError: messageOf(error) });
        });
      };

      var data = view.data;
      var summary = data ? data.summary : null;
      var assets = data ? data.assets : [];
      var filtered = assets.filter(function (asset) {
        return view.filter === "all" || asset.type === view.filter;
      });

      var header = h(
        "div",
        {
          style: {
            display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px",
            background: "#0f172a", borderBottom: "1px solid #1e293b", flex: "none", flexWrap: "wrap",
          },
        },
        h("span", { style: { fontSize: "15px", fontWeight: 600, color: "#e6e9f2" } }, t("panel.title")),
        h(
          "span",
          { style: { fontSize: "12px", color: "#8b93a7", flex: "1 1 260px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
          t("panel.hint")
        ),
        h("button", { onClick: onRescan, style: buttonStyle("#123a63", "#1d5f9c", "#d7ecff") }, "↻ " + t("panel.refresh")),
        h("button", { onClick: onExport, style: buttonStyle("transparent", "#2e3d59", "#b8c4da") }, view.exporting ? t("panel.exporting") : "⬇ " + t("panel.export")),
        h("button", { onClick: onPreview, style: buttonStyle("transparent", "#2e3d59", "#b8c4da") }, "🖼 " + t("panel.preview")),
        h("button", { onClick: function () { setOpen(false); }, title: t("panel.close"), style: buttonStyle("transparent", "transparent", "#8f8a97") }, "✕")
      );

      var body;
      if (view.status === "error") {
        body = h(
          "div",
          { style: { flex: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", color: "#f87171", fontSize: "13px", padding: "0 24px", textAlign: "center" } },
          h("div", null, t("panel.error") + "：" + view.error),
          h("button", { onClick: onRescan, style: buttonStyle("#123a63", "#1d5f9c", "#d7ecff") }, t("panel.retry"))
        );
      } else if (view.status !== "ready" || !data) {
        body = h(
          "div",
          { style: { flex: "1", display: "flex", alignItems: "center", justifyContent: "center", color: "#8b93a7", fontSize: "13px", padding: "0 24px", textAlign: "center" } },
          t("panel.loading")
        );
      } else {
        var filterTabs = ["all", "skill", "plugin"].map(function (key) {
          var active = view.filter === key;
          var count = key === "all" ? assets.length : assets.filter(function (asset) { return asset.type === key; }).length;
          return h(
            "button",
            {
              key: key,
              onClick: function () { patch({ filter: key }); },
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
          var expanded = view.expanded === asset.id;
          rows.push(
            h(
              "tr",
              {
                key: asset.id,
                onClick: function () { patch({ expanded: expanded ? "" : asset.id }); },
                style: { cursor: "pointer", borderBottom: "1px solid #1e293b", background: expanded ? "#0a1424" : "transparent" },
              },
              h(
                "td",
                { style: cellStyle },
                h("div", { style: { fontWeight: 600 } }, asset.name),
                h("div", { style: { color: "#8b93a7", fontSize: "11.5px", wordBreak: "break-all" } }, asset.path)
              ),
              h("td", { style: cellStyle },
                h("span", { style: Object.assign({ display: "inline-block", padding: "1px 8px", borderRadius: "999px", fontSize: "11.5px" }, typeBadgeStyle(asset.type)) }, t(TYPE_LABEL_KEY[asset.type] || "panel.col.type"))
              ),
              h("td", { style: Object.assign({}, cellStyle, { color: "#8b93a7", fontSize: "12px" }) }, t(SCOPE_LABEL_KEY[asset.scope] || "panel.scope.workspace")),
              h("td", { style: Object.assign({}, cellStyle, { fontVariantNumeric: "tabular-nums", fontWeight: 600 }) }, String(asset.score)),
              h("td", { style: cellStyle }, h("span", { style: gradeStyle(asset.grade) }, asset.grade)),
              h("td", { style: cellStyle }, issueText(asset)),
              h("td", { style: Object.assign({}, cellStyle, { color: "#8b93a7", fontSize: "12px" }) }, expanded ? "▾ " + t("panel.collapse") : "▸ " + t("panel.expand"))
            )
          );
          if (expanded) {
            rows.push(
              h(
                "tr",
                { key: asset.id + ":detail" },
                h("td", { colSpan: 7, style: { padding: 0, borderBottom: "1px solid #1e293b" } }, checkList(t, asset))
              )
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
        if (view.exportInfo) {
          exportLine = h("div", { style: { color: "#34d399", fontSize: "12.5px", margin: "0 16px 10px" } },
            t("panel.exportOk") + "：" + view.exportInfo.path);
        } else if (view.exportError) {
          exportLine = h("div", { style: { color: "#f87171", fontSize: "12.5px", margin: "0 16px 10px" } },
            t("panel.exportFailed") + "：" + view.exportError);
        } else if (view.previewError) {
          exportLine = h("div", { style: { color: "#f87171", fontSize: "12.5px", margin: "0 16px 10px" } },
            t("panel.previewFailed") + "：" + view.previewError);
        }

        body = h(
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
              h(
                "thead",
                null,
                h(
                  "tr",
                  { style: { background: "#0d1526", color: "#8b93a7", fontSize: "12px" } },
                  h("th", { style: headStyle }, t("panel.col.name")),
                  h("th", { style: headStyle }, t("panel.col.type")),
                  h("th", { style: headStyle }, t("panel.col.scope")),
                  h("th", { style: headStyle }, t("panel.col.score")),
                  h("th", { style: headStyle }, t("panel.col.grade")),
                  h("th", { style: headStyle }, t("panel.col.issues")),
                  h("th", { style: headStyle }, "")
                )
              ),
              h("tbody", null, rows)
            )
          ),
          filtered.length === 0
            ? h("div", { style: { color: "#8b93a7", fontSize: "13px", textAlign: "center", padding: "24px" } }, t("panel.empty"))
            : null,
          h("div", { style: { color: "#64748b", fontSize: "11.5px", margin: "12px 16px 16px" } }, t("panel.legend"))
        );
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
              width: "min(1320px, 96vw)", height: "90vh", background: "#0b1220",
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

    function buttonStyle(background, border, color) {
      return {
        background: background, border: "1px solid " + border, borderRadius: "8px",
        color: color, fontSize: "12.5px", cursor: "pointer", padding: "5px 10px",
      };
    }

    var cellStyle = { padding: "9px 12px", verticalAlign: "top", textAlign: "left" };
    var headStyle = { padding: "8px 12px", textAlign: "left", fontWeight: 500 };

    function summaryCard(label, value) {
      return h(
        "div",
        { style: { background: "#101a2e", border: "1px solid #223049", borderRadius: "12px", padding: "10px 13px" } },
        h("div", { style: { color: "#8b93a7", fontSize: "12px" } }, label),
        h("div", { style: { fontSize: "18px", fontWeight: 650, marginTop: "2px" } }, value)
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
          return locale.register(NS, {
            zh: MESSAGES.zh,
            en: MESSAGES.en,
          });
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
    exports.__test = { setOpen: setOpen, detectSessionCwd: detectSessionCwd, NS: NS };
    return module.exports;
  },
});
