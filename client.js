/**
 * dsh-session-delete — 工作区侧栏「删除会话 / 归档全部会话 / 删除全部会话」（Client 半）
 *
 * 形态：dsh.client web bundle（由 __ModuleLoader__ 按需加载的普通模块，
 * 浏览器全局 fetch/document 可用；无 React 依赖）。
 *
 * 机制：
 *   - document 捕获点击 + React fiber 读取行数据（会话/工作区 id）；
 *   - MutationObserver 监听菜单挂载，克隆现有菜单项 DOM 注入新命令
 *     （danger 样式复用「删除工作区」项，样式与主题自动一致）；
 *   - 操作经同源 fetch POST /dsh-session-delete/{delete,delete-all,archive-all}
 *     调 Host 半（见 index.js）。
 *
 * 注册 id 必须与组合行 name 完全一致：'dsh-session-delete'。
 */
window.__ModuleLoader__.load({
	id: "dsh-session-delete",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var react = require('react');

		function apply(ctx) {
			if (typeof document === "undefined" || document.body === null) return;

			/* ---- 样式：自挂 <style data-plugin="dsh-session-delete">，随插件卸载移除 ---- */
			var styleTag = document.createElement("style");
			styleTag.setAttribute("data-plugin", "dsh-session-delete");
			styleTag.textContent = [
				".sesdel-overlay{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;}",
				".sesdel-modal{min-width:340px;max-width:460px;background:var(--dsw-alias-button-elevated-fill,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);border:1px solid var(--dsw-alias-border-l,rgba(0,0,0,.08));border-radius:12px;padding:20px;box-shadow:0 12px 40px rgba(0,0,0,.28);}",
				".sesdel-title{font-size:16px;font-weight:600;margin:0 0 8px;}",
				".sesdel-body{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#555);margin:0;white-space:pre-wrap;word-break:break-all;}",
				".sesdel-error{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#d92d20);margin:8px 0 0;white-space:pre-wrap;}",
				".sesdel-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:18px;}",
				".sesdel-btn{min-width:76px;height:30px;padding:0 12px;border-radius:8px;font-size:13px;cursor:pointer;border:1px solid var(--dsw-alias-border-l,rgba(9,9,11,.2));background:transparent;color:inherit;}",
				".sesdel-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));}",
				".sesdel-btn-primary{background:var(--dsw-alias-state-business-primary,#2f6fed);border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff);}",
				".sesdel-btn-primary.sesdel-danger{background:var(--dsw-alias-state-error-primary,#d92d20);}",
				".sesdel-btn-primary:disabled{opacity:.55;cursor:default;}",
				".sesdel-settings{padding:4px 0;}",
				".sesdel-settings-desc{font-size:13px;color:var(--dsw-alias-label-secondary,#555);margin:4px 0 12px;}",
				".sesdel-settings-table{border-collapse:collapse;width:100%;font-size:13px;}",
				".sesdel-settings-table th,.sesdel-settings-table td{border-bottom:1px solid var(--dsw-alias-border-l,rgba(0,0,0,.08));padding:8px 10px;text-align:left;vertical-align:middle;}",
				".sesdel-settings-table button{margin-right:6px;padding:4px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l,rgba(9,9,11,.2));background:transparent;color:inherit;cursor:pointer;}",
				".sesdel-settings-table button:disabled{opacity:.5;cursor:default;}",
				".sesdel-msg{font-size:13px;color:var(--dsw-alias-state-error-primary,#d92d20);}"
			].join("\n");
			document.head.appendChild(styleTag);

			/* ---- 语言（跟随 GUI locale；默认中文） ---- */
			var lang = "zh";
			var locale = ctx.get("locale");
			try {
				var snap = locale !== undefined && typeof locale.getLocale === "function" ? locale.getLocale() : undefined;
				var lid = typeof snap === "string" ? snap : (snap !== null && snap !== undefined && typeof snap.id === "string" ? snap.id : "");
				if (lid.toLowerCase().indexOf("en") === 0) lang = "en";
			} catch (e) {}

			var DICT = {
				zh: {
					deleteSession: "删除会话", archiveAll: "归档全部会话", deleteAll: "删除全部会话",
					restoreArchived: "恢复归档会话", restoreAllArchived: "恢复全部已归档会话",
					delTitle: "删除会话",
					delBody: function (t) { return "将永久删除会话“" + t + "”的全部本地记录（含日志文件），不可恢复。"; },
					archTitle: "归档全部会话",
					archBody: function (l, n) { return "将归档工作区“" + l + "”下未归档的 " + n + " 个会话。归档的会话不再显示，但记录保留。"; },
					archBody0: function (l) { return "将归档工作区“" + l + "”下全部未归档的会话。归档的会话不再显示，但记录保留。"; },
					restoreTitle: "恢复归档会话",
					restoreBody: function (l, n) { return "将恢复工作区“" + l + "”下 " + n + " 个已归档会话到原工作区。如果原工作区已删除，将按会话项目目录自动重建。"; },
					restoreBody0: function (l) { return "将恢复工作区“" + l + "”下全部已归档会话到原工作区。如果原工作区已删除，将按会话项目目录自动重建。"; },
					restoreAllTitle: "恢复全部已归档会话",
					restoreAllBody: function (n) { return "将恢复全部 " + n + " 个已归档会话到各自原工作区。如果原工作区已删除，将自动按会话项目目录重建工作区。"; },
					settingsTitle: "会话管理",
					settingsDesc: "查看、恢复或物理删除已归档的会话。归档时会同步备份工作区信息，恢复时自动恢复原工作区。",
					emptyArchived: "暂无已归档的对话。",
					colName: "会话",
					colWorkspace: "工作区",
					colArchivedAt: "归档时间",
					colActions: "操作",
					restoreOne: "恢复",
					deleteOne: "删除",
					loading: "加载中…",
					restoredOne: "已恢复会话。",
					deletedOne: "已删除会话。",
					delAllTitle: "删除全部会话",
					delAllBody: function (l, n) { return "将永久删除工作区“" + l + "”下全部 " + n + " 个会话（含已归档）的本地记录，不可恢复。正在运行的会话将被跳过。"; },
					delAllBody0: function (l) { return "将永久删除工作区“" + l + "”下全部会话（含已归档）的本地记录，不可恢复。正在运行的会话将被跳过。"; },
					cancel: "取消", ok: "好的", busy: "处理中…",
					errLive: "该会话正在本进程中运行或已被打开，无法删除。请重启 DSH 后再删除。",
					errMissing: "未找到该会话的持久化记录（可能从未写入磁盘）。",
					errSandbox: "沙箱拒绝了删除操作。",
					errRm: "删除会话文件失败。",
					errNetwork: "请求失败（服务不可达）。",
					errUnknown: "操作失败。",
					archResult: function (n, f) { return "已归档 " + n + " 个会话。" + (f > 0 ? "失败 " + f + " 个。" : ""); },
					restoreResult: function (n, f) { return "已恢复 " + n + " 个会话。" + (f > 0 ? "失败 " + f + " 个。" : ""); },
					delAllResult: function (d, lv, f) { return "已删除 " + d + " 个" + (lv > 0 ? "，跳过运行中 " + lv + " 个" : "") + (f > 0 ? "，失败 " + f + " 个" : "") + "。"; }
				},
				en: {
					deleteSession: "Delete Session", archiveAll: "Archive All Sessions", deleteAll: "Delete All Sessions",
					restoreArchived: "Restore Archived Sessions", restoreAllArchived: "Restore All Archived Sessions",
					delTitle: "Delete session",
					delBody: function (t) { return "Permanently delete all local records (including the log file) of session “" + t + "”. This cannot be undone."; },
					archTitle: "Archive all sessions",
					archBody: function (l, n) { return "Archive " + n + " unarchived sessions in workspace “" + l + "”. Archived sessions are hidden but kept."; },
					archBody0: function (l) { return "Archive all unarchived sessions in workspace “" + l + "”. Archived sessions are hidden but kept."; },
					restoreTitle: "Restore Archived Sessions",
					restoreBody: function (l, n) { return "Restore " + n + " archived sessions in workspace “" + l + "” to their original workspace. If the original workspace was deleted, it will be recreated from each session's project directory."; },
					restoreBody0: function (l) { return "Restore all archived sessions in workspace “" + l + "” to their original workspace. If the original workspace was deleted, it will be recreated from each session's project directory."; },
					restoreAllTitle: "Restore All Archived Sessions",
					restoreAllBody: function (n) { return "Restore all " + n + " archived sessions to their original workspaces. Deleted workspace registrations will be recreated from each session's project directory."; },
					settingsTitle: "Session Management",
					settingsDesc: "View, restore, or permanently delete archived sessions. Workspace information is backed up when archiving and restored automatically on restore.",
					emptyArchived: "No archived conversations yet.",
					colName: "Session",
					colWorkspace: "Workspace",
					colArchivedAt: "Archived At",
					colActions: "Actions",
					restoreOne: "Restore",
					deleteOne: "Delete",
					loading: "Loading…",
					restoredOne: "Session restored.",
					deletedOne: "Session deleted.",
					delAllTitle: "Delete all sessions",
					delAllBody: function (l, n) { return "Permanently delete all " + n + " sessions (archived included) in workspace “" + l + "”. Running sessions are skipped. This cannot be undone."; },
					delAllBody0: function (l) { return "Permanently delete all sessions (archived included) in workspace “" + l + "”. Running sessions are skipped. This cannot be undone."; },
					cancel: "Cancel", ok: "OK", busy: "Working…",
					errLive: "This session is live in the current process and cannot be deleted. Restart DSH first.",
					errMissing: "No persisted record found for this session.",
					errSandbox: "The sandbox denied the deletion.",
					errRm: "Failed to remove session files.",
					errNetwork: "Request failed (service unreachable).",
					errUnknown: "Operation failed.",
					archResult: function (n, f) { return "Archived " + n + " session(s)." + (f > 0 ? " Failed: " + f + "." : ""); },
					restoreResult: function (n, f) { return "Restored " + n + " session(s)." + (f > 0 ? " Failed: " + f + "." : ""); },
					delAllResult: function (d, lv, f) { return "Deleted " + d + "." + (lv > 0 ? " Skipped running: " + lv + "." : "") + (f > 0 ? " Failed: " + f + "." : ""); }
				}
			};
			var L = DICT[lang];

			var ICONS = {
				trash: "M2.5 4.2h11M6.3 2h3.4M4.2 4.2l.6 8.6c0 .7.6 1.2 1.2 1.2h4c.7 0 1.2-.5 1.2-1.2l.6-8.6M6.5 7v4.2M9.5 7v4.2",
				archive: "M2.2 4.3h11.6M3.2 4.3v7.7c0 .9.7 1.6 1.6 1.6h6.4c.9 0 1.6-.7 1.6-1.6V4.3M6.4 7.8h3.2M2.2 4.3l.9-2.1h9.8l.9 2.1",
				restore: "M3.5 8.2a5 5 0 1 1 1.6 3.6M3.5 12.5v-3.2h3.2"
			};

			var pendingRow = null;
			var openModalClose = null;

			/* ---- Host 半通信：同源 fetch ---- */
			async function callApi(path, body) {
				var r;
				try {
					r = await fetch(path, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body)
					});
				} catch (e) {
					return null;
				}
				try {
					return await r.json();
				} catch (e) {
					return null;
				}
			}

			function fiberOf(el) {
				try {
					var keys = Object.keys(el);
					for (var i = 0; i < keys.length; i++) {
						if (keys[i].indexOf("__reactFiber$") === 0) return el[keys[i]];
					}
				} catch (e) {}
				return null;
			}

			function rowTarget(rowEl) {
				var f = fiberOf(rowEl);
				var guard = 0;
				while (f !== null && f !== undefined && guard++ < 40) {
					var p = f.memoizedProps;
					if (p !== null && p !== undefined && typeof p === "object") {
						if (p.node !== null && p.node !== undefined && typeof p.node.id === "string" && typeof p.onArchive === "function") {
							return { kind: "session", id: p.node.id, title: String(p.node.title == null ? "" : p.node.title) };
						}
						if (p.group !== null && p.group !== undefined && typeof p.group.key === "string" && typeof p.onCreate === "function" && p.actions !== undefined && p.group.workspaceId !== undefined) {
							return { kind: "workspace", workspaceId: String(p.group.workspaceId), label: String(p.group.label == null ? "" : p.group.label) };
						}
					}
					f = f.return;
				}
				return null;
			}

			function menuItemsIds(menuEl) {
				var f = fiberOf(menuEl);
				var guard = 0;
				while (f !== null && f !== undefined && guard++ < 30) {
					var p = f.memoizedProps;
					if (p !== null && p !== undefined && Array.isArray(p.items)) {
						var ids = [];
						for (var i = 0; i < p.items.length; i++) ids.push(p.items[i] === null || p.items[i] === undefined ? "" : String(p.items[i].id));
						return ids;
					}
					f = f.return;
				}
				return null;
			}

			function makeIcon(d) {
				var NS = "http://www.w3.org/2000/svg";
				var svg = document.createElementNS(NS, "svg");
				svg.setAttribute("viewBox", "0 0 16 16");
				svg.setAttribute("width", "16");
				svg.setAttribute("height", "16");
				var path = document.createElementNS(NS, "path");
				path.setAttribute("d", d);
				path.setAttribute("fill", "none");
				path.setAttribute("stroke", "currentColor");
				path.setAttribute("stroke-width", "1.3");
				path.setAttribute("stroke-linecap", "round");
				path.setAttribute("stroke-linejoin", "round");
				svg.appendChild(path);
				return svg;
			}

			function closeOpenMenu() {
				try {
					document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
				} catch (e) {}
			}

			function addItem(viewport, template, dangerTemplate, label, iconD, danger, handler) {
				var wrap = template.cloneNode(true);
				wrap.removeAttribute("id");
				var btn = wrap.querySelector("button");
				if (btn === null) return;
				if (danger && dangerTemplate !== null && dangerTemplate !== undefined) {
					var dbtn = dangerTemplate.querySelector("button");
					if (dbtn !== null) btn.setAttribute("class", dbtn.getAttribute("class") == null ? "" : dbtn.getAttribute("class"));
				} else if (danger) {
					btn.style.color = "var(--dsw-alias-state-error-primary)";
				}
				var labelSpan = null;
				var spans = btn.querySelectorAll(":scope > span");
				for (var i = 0; i < spans.length; i++) {
					if (spans[i].children.length === 0) labelSpan = spans[i];
				}
				if (labelSpan !== null) labelSpan.textContent = label;
				else btn.appendChild(document.createTextNode(label));
				var oldSvg = btn.querySelector("svg");
				var icon = makeIcon(iconD);
				if (oldSvg !== null) {
					if (oldSvg.parentNode !== null) oldSvg.parentNode.replaceChild(icon, oldSvg);
				} else {
					btn.insertBefore(icon, btn.firstChild);
				}
				btn.addEventListener("click", function (e) {
					e.stopPropagation();
					e.preventDefault();
					handler();
				});
				viewport.appendChild(wrap);
			}

			function tryInject(menuEl) {
				if (menuEl.getAttribute("data-sesdel") !== null) return;
				var ids = menuItemsIds(menuEl);
				if (ids === null) return;
				var isSession = ids.indexOf("archive") !== -1 && ids.indexOf("fork") !== -1;
				var isWorkspace = ids.indexOf("delete") !== -1 && ids.indexOf("archive") === -1 && ids.indexOf("fork") === -1;
				if (!isSession && !isWorkspace) return;
				var row = pendingRow !== null && Date.now() - pendingRow.ts < 2000 ? pendingRow : null;
				if (row === null) return;
				if (isSession && row.kind !== "session") return;
				if (isWorkspace && row.kind !== "workspace") return;
				var viewport = menuEl.querySelector('div[role="presentation"]');
				if (viewport === null) return;
				var wraps = [];
				for (var i = 0; i < viewport.children.length; i++) {
					if (viewport.children[i].tagName === "DIV") wraps.push(viewport.children[i]);
				}
				if (wraps.length === 0) return;
				menuEl.setAttribute("data-sesdel", "1");
				var dangerTemplate = isWorkspace ? wraps[wraps.length - 1] : null;
				if (isSession) {
					addItem(viewport, wraps[0], null, L.deleteSession, ICONS.trash, true, function () {
						closeOpenMenu();
						confirmDeleteSession(row);
					});
					addItem(viewport, wraps[0], null, L.restoreAllArchived, ICONS.restore, false, function () {
						closeOpenMenu();
						confirmRestoreAll();
					});
				} else {
					addItem(viewport, wraps[0], dangerTemplate, L.archiveAll, ICONS.archive, false, function () {
						closeOpenMenu();
						confirmArchiveAll(row);
					});
					var c = workspaceCounts(row.workspaceId);
					var archivedCount = c === null ? 0 : (c.total - c.unarchived);
					if (archivedCount > 0) {
						addItem(viewport, wraps[0], null, L.restoreArchived, ICONS.restore, false, function () {
							closeOpenMenu();
							confirmRestoreWorkspace(row, archivedCount);
						});
					}
					addItem(viewport, wraps[0], dangerTemplate, L.deleteAll, ICONS.trash, true, function () {
						closeOpenMenu();
						confirmDeleteAll(row);
					});
				}
				console.log("[dsh-session-delete] injected into", isSession ? "session" : "workspace", "menu for", row.id || row.workspaceId);
			}

			function workspaceCounts(workspaceId) {
				try {
					var ws = ctx.get("workspaces");
					if (ws === undefined || ws.list === undefined || typeof ws.list.getSnapshot !== "function") return null;
					var snap = ws.list.getSnapshot();
					var item = snap !== null && snap !== undefined && Array.isArray(snap.items)
						? snap.items.find(function (w) { return w.workspaceId === workspaceId; })
						: undefined;
					if (item === undefined || !Array.isArray(item.sessionIds)) return null;
					var archived = new Set(Array.isArray(snap.archivedSessionIds) ? snap.archivedSessionIds : []);
					var unarchived = 0;
					for (var i = 0; i < item.sessionIds.length; i++) {
						if (!archived.has(item.sessionIds[i])) unarchived += 1;
					}
					return { total: item.sessionIds.length, unarchived: unarchived };
				} catch (e) {
					return null;
				}
			}

			function openConfirm(cfg) {
				if (openModalClose !== null) openModalClose();
				var overlay = document.createElement("div");
				overlay.className = "sesdel-overlay";
				var modal = document.createElement("div");
				modal.className = "sesdel-modal";
				modal.setAttribute("role", "dialog");
				modal.setAttribute("aria-modal", "true");
				var title = document.createElement("div");
				title.className = "sesdel-title";
				title.textContent = cfg.title;
				var body = document.createElement("div");
				body.className = "sesdel-body";
				body.textContent = cfg.body;
				var err = document.createElement("div");
				err.className = "sesdel-error";
				err.setAttribute("role", "alert");
				var footer = document.createElement("div");
				footer.className = "sesdel-footer";
				var btnCancel = document.createElement("button");
				btnCancel.type = "button";
				btnCancel.className = "sesdel-btn";
				btnCancel.textContent = L.cancel;
				var btnOk = document.createElement("button");
				btnOk.type = "button";
				btnOk.className = "sesdel-btn sesdel-btn-primary" + (cfg.danger ? " sesdel-danger" : "");
				btnOk.textContent = cfg.confirm;
				footer.appendChild(btnCancel);
				footer.appendChild(btnOk);
				modal.appendChild(title);
				modal.appendChild(body);
				modal.appendChild(err);
				modal.appendChild(footer);
				overlay.appendChild(modal);
				function close() {
					document.removeEventListener("keydown", onKey);
					if (overlay.parentNode !== null) overlay.parentNode.removeChild(overlay);
					if (openModalClose === close) openModalClose = null;
				}
				function onKey(e) {
					if (e.key === "Escape") close();
				}
				overlay.addEventListener("click", function (e) {
					if (e.target === overlay) close();
				});
				document.addEventListener("keydown", onKey);
				btnCancel.addEventListener("click", close);
				btnOk.addEventListener("click", async function () {
					btnOk.disabled = true;
					btnOk.textContent = L.busy;
					err.textContent = "";
					try {
						var outcome = await cfg.run();
						if (typeof outcome === "string" && outcome !== "") {
							err.textContent = outcome;
							btnOk.disabled = false;
							btnOk.textContent = cfg.confirm;
							return;
						}
						if (outcome !== null && typeof outcome === "object" && typeof outcome.done === "string") {
							body.textContent = outcome.done;
							while (footer.firstChild !== null) footer.removeChild(footer.firstChild);
							var okBtn = document.createElement("button");
							okBtn.type = "button";
							okBtn.className = "sesdel-btn sesdel-btn-primary";
							okBtn.textContent = L.ok;
							okBtn.addEventListener("click", close);
							footer.appendChild(okBtn);
							okBtn.focus();
							return;
						}
						close();
					} catch (e2) {
						err.textContent = e2 !== null && e2 !== undefined && e2.message ? String(e2.message) : String(e2);
						btnOk.disabled = false;
						btnOk.textContent = cfg.confirm;
					}
				});
				openModalClose = close;
				document.body.appendChild(overlay);
				btnOk.focus();
			}

			function errorText(res) {
				if (res === null || res === undefined) return L.errNetwork;
				if (res.code === "live") return L.errLive;
				if (res.code === "missing") return L.errMissing;
				if (res.code === "sandbox-denied") return L.errSandbox + (res.detail ? "\n" + String(res.detail).slice(0, 300) : "");
				if (res.code === "rm-failed" || res.code === "run-error" || res.code === "list-failed") return L.errRm + (res.detail ? "\n" + String(res.detail).slice(0, 300) : "");
				return L.errUnknown + (res.code ? " (" + String(res.code) + ")" : "");
			}

			function confirmDeleteSession(row) {
				openConfirm({
					title: L.delTitle,
					body: L.delBody(row.title),
					confirm: L.deleteSession,
					danger: true,
					run: async function () {
						var res = await callApi("/dsh-session-delete/delete", { sessionId: row.id });
						if (res !== null && res !== undefined && res.ok) return null;
						return errorText(res);
					}
				});
			}

			function confirmArchiveAll(row) {
				var c = workspaceCounts(row.workspaceId);
				openConfirm({
					title: L.archTitle,
					body: c === null ? L.archBody0(row.label) : L.archBody(row.label, c.unarchived),
					confirm: L.archiveAll,
					danger: false,
					run: async function () {
						var res = await callApi("/dsh-session-delete/archive-all", { workspaceId: row.workspaceId });
						if (res === null || res === undefined || !res.ok) return errorText(res);
						return { done: L.archResult(res.archived, (res.failed || []).length) };
					}
				});
			}

			function confirmDeleteAll(row) {
				var c = workspaceCounts(row.workspaceId);
				openConfirm({
					title: L.delAllTitle,
					body: c === null ? L.delAllBody0(row.label) : L.delAllBody(row.label, c.total),
					confirm: L.deleteAll,
					danger: true,
					run: async function () {
						var res = await callApi("/dsh-session-delete/delete-all", { workspaceId: row.workspaceId });
						if (res === null || res === undefined || !res.ok) return errorText(res);
						return { done: L.delAllResult(res.deleted, res.live, (res.failed || []).length) };
					}
				});
			}

			function confirmRestoreWorkspace(row, count) {
				openConfirm({
					title: L.restoreTitle,
					body: count === 0 ? L.restoreBody0(row.label) : L.restoreBody(row.label, count),
					confirm: L.restoreArchived,
					danger: false,
					run: async function () {
						var res = await callApi("/dsh-session-delete/restore-all", { workspaceId: row.workspaceId });
						if (res === null || res === undefined || !res.ok) return errorText(res);
						return { done: L.restoreResult(res.restored || 0, (res.failed || []).length) };
					}
				});
			}

			function globalArchivedCount() {
				try {
					var ws = ctx.get("workspaces");
					if (ws === undefined || ws.list === undefined || typeof ws.list.getSnapshot !== "function") return 0;
					var snap = ws.list.getSnapshot();
					return Array.isArray(snap.archivedSessionIds) ? snap.archivedSessionIds.length : 0;
				} catch (e) {
					return 0;
				}
			}

			function confirmRestoreAll() {
				var count = globalArchivedCount();
				openConfirm({
					title: L.restoreAllTitle,
					body: L.restoreAllBody(count),
					confirm: L.restoreAllArchived,
					danger: false,
					run: async function () {
						var res = await callApi("/dsh-session-delete/restore-all", {});
						if (res === null || res === undefined || !res.ok) return errorText(res);
						return { done: L.restoreResult(res.restored || 0, (res.failed || []).length) };
					}
				});
			}

			/* ---- 设置页：已归档会话管理 ---- */
			function SessionManagerSettingsPage() {
				var rowsState = react.useState(null);
				var rows = rowsState[0];
				var setRows = rowsState[1];
				var busyState = react.useState(false);
				var busy = busyState[0];
				var setBusy = busyState[1];
				var msgState = react.useState(null);
				var msg = msgState[0];
				var setMsg = msgState[1];

				function load() {
					setBusy(true);
					setMsg(null);
					callApi("/dsh-session-delete/list-archived", {})
						.then(function (r) {
							setRows(r !== null && r !== undefined && Array.isArray(r.sessions) ? r.sessions : []);
						})
						.catch(function () {
							setRows([]);
							setMsg(L.errNetwork);
						})
						.finally(function () {
							setBusy(false);
						});
				}

				react.useEffect(function () { load(); }, []);

				async function restoreSession(id) {
					setBusy(true);
					setMsg(null);
					var r = await callApi("/dsh-session-delete/restore", { sessionId: id });
					if (r === null || r === undefined || !r.ok) {
						setMsg(errorText(r));
					} else {
						setMsg(L.restoredOne);
					}
					setBusy(false);
					load();
				}

				async function deleteSession(id) {
					if (!confirm(L.delBody(id))) return;
					setBusy(true);
					setMsg(null);
					var r = await callApi("/dsh-session-delete/delete", { sessionId: id });
					if (r === null || r === undefined || !r.ok) {
						setMsg(errorText(r));
					} else {
						setMsg(L.deletedOne);
					}
					setBusy(false);
					load();
				}

				var th = function (text) {
					return react.createElement('th', null, text);
				};

				return react.createElement('div', { className: 'sesdel-settings' },
					react.createElement('h3', null, L.settingsTitle),
					react.createElement('p', { className: 'sesdel-settings-desc' }, L.settingsDesc),
					msg ? react.createElement('p', { className: 'sesdel-msg' }, msg) : null,
					rows === null
						? react.createElement('p', null, L.loading)
						: rows.length === 0
							? react.createElement('p', null, L.emptyArchived)
							: react.createElement('table', { className: 'sesdel-settings-table' },
								react.createElement('thead', null,
									react.createElement('tr', null,
										th(L.colName), th(L.colWorkspace), th(L.colArchivedAt), th(L.colActions))),
								react.createElement('tbody', null, rows.map(function (row) {
									return react.createElement('tr', { key: row.id },
										react.createElement('td', null, row.title || row.id),
										react.createElement('td', null, row.workspaceTitle || row.workspacePath || row.cwd || ''),
										react.createElement('td', null, row.archivedAt ? new Date(row.archivedAt).toLocaleString() : ''),
										react.createElement('td', null,
											react.createElement('button', {
												type: 'button',
												disabled: busy,
												onClick: function () { restoreSession(row.id); }
											}, L.restoreOne),
											' ',
											react.createElement('button', {
												type: 'button',
												disabled: busy,
												onClick: function () { deleteSession(row.id); }
											}, L.deleteOne)
										)
									);
								}))
							)
				);
			}

			var onClick = function (e) {
				try {
					var t = e.target;
					if (t === null || t === undefined || typeof t.closest !== "function") return;
					var rowEl = t.closest('[role="treeitem"]');
					if (rowEl === null) return;
					var target = rowTarget(rowEl);
					if (target !== null) {
						pendingRow = {
							kind: target.kind, id: target.id, workspaceId: target.workspaceId,
							title: target.title, label: target.label, ts: Date.now()
						};
					}
				} catch (err) {
					console.error("[dsh-session-delete] click hook", err);
				}
			};
			document.addEventListener("click", onClick, true);

			var observer = new MutationObserver(function (muts) {
				for (var m = 0; m < muts.length; m++) {
					var added = muts[m].addedNodes;
					for (var n = 0; n < added.length; n++) {
						var node = added[n];
						if (!(node instanceof Element)) continue;
						var menus = node.matches('div[role="menu"]')
							? [node]
							: (typeof node.querySelectorAll === "function" ? Array.from(node.querySelectorAll('div[role="menu"]')) : []);
						for (var k = 0; k < menus.length; k++) {
							try {
								tryInject(menus[k]);
							} catch (err) {
								console.error("[dsh-session-delete] inject", err);
							}
						}
					}
				}
			});
			observer.observe(document.body, { childList: true, subtree: true });

			console.log("[dsh-session-delete] client ready, lang=" + lang);

			var slots = ctx.get("slots");
			if (slots !== undefined && slots !== null) {
				ctx.effect(function () {
					return slots.inject("settings.section", function () {
						return slots.register(
							{
								name: "settings.section",
								id: "dsh-session-delete",
								order: 42,
								label: function () { return L.settingsTitle; }
							},
							SessionManagerSettingsPage
						);
					});
				}, "dsh-session-delete settings section");
			}

			ctx.effect(function () {
				return function () {
					document.removeEventListener("click", onClick, true);
					observer.disconnect();
					if (openModalClose !== null) openModalClose();
					if (styleTag.parentNode !== null) styleTag.parentNode.removeChild(styleTag);
				};
			}, "dsh-session-delete client cleanup");
		}

		exports.apply = apply;
		return module.exports;
	}
});
