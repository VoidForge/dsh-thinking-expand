"use strict";
(() => {
  // src/constants.ts
  var PACKAGE_NAME = "@local/dsh-thinking-expand";
  var SETTINGS_ENTRY_ID = "thinking-expand";
  var LOCALE_NAMESPACE = "thinkingExpand";

  // src/rules.ts
  var COLLAPSE_DELAY_SECONDS = Object.freeze({ min: 0, max: 60, default: 2 });
  var COLLAPSE_DELAY_MIN_SECONDS = COLLAPSE_DELAY_SECONDS.min;
  var COLLAPSE_DELAY_MAX_SECONDS = COLLAPSE_DELAY_SECONDS.max;
  var COLLAPSE_DELAY_DEFAULT_SECONDS = COLLAPSE_DELAY_SECONDS.default;
  var DEFAULT_POLICY = Object.freeze({
    enabled: true,
    collapseDelaySeconds: COLLAPSE_DELAY_DEFAULT_SECONDS,
    manualOpenProtection: true
  });
  function asRecord(value) {
    return value !== null && typeof value === "object" ? value : {};
  }
  function clampCollapseDelay(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return COLLAPSE_DELAY_DEFAULT_SECONDS;
    return Math.min(COLLAPSE_DELAY_MAX_SECONDS, Math.max(COLLAPSE_DELAY_MIN_SECONDS, Math.round(value)));
  }
  function normalizeConfigSnapshot(snapshot) {
    const status = typeof snapshot?.status === "string" ? snapshot.status : "loading";
    if (status !== "ready") {
      return { ready: false, status, ...DEFAULT_POLICY };
    }
    const value = asRecord(snapshot?.value);
    return {
      ready: true,
      status,
      enabled: value.enabled !== false,
      collapseDelaySeconds: clampCollapseDelay(value.collapseDelay),
      manualOpenProtection: value.manualOpenProtection !== false
    };
  }
  function parseCollapseDelay(text) {
    const trimmed = text.trim();
    if (!/^\d{1,2}(?:\.0+)?$/.test(trimmed)) return void 0;
    const seconds = Number(trimmed);
    return seconds >= COLLAPSE_DELAY_MIN_SECONDS && seconds <= COLLAPSE_DELAY_MAX_SECONDS ? seconds : void 0;
  }
  function formatBlockIdentity(sessionId, nodeKey, ordinal) {
    return sessionId + "\0" + nodeKey + "\0" + String(ordinal);
  }
  function shouldAutoExpand(entry, record, config) {
    return config.ready && config.enabled && entry.isLatest && entry.expanded === false && record.manual !== "closed" && record.giveUp !== true && record.everSuperseded !== true;
  }
  function collapseDueAt(entry, record, config) {
    if (entry.isLatest || entry.expanded === false) return void 0;
    if (record.giveUp === true) return void 0;
    if (record.manual === "open" && config.manualOpenProtection) return void 0;
    const reference = Math.max(record.supersededAt, record.manualOpenedAt);
    if (reference === 0) return void 0;
    return reference + config.collapseDelaySeconds * 1e3;
  }
  function planCollapses(entries, records, config, now) {
    const dueIds = [];
    let nextDue;
    for (const entry of entries) {
      const record = records.get(entry.id);
      if (record === void 0) continue;
      const dueAt = collapseDueAt(entry, record, config);
      if (dueAt === void 0) continue;
      if (dueAt <= now) dueIds.push(entry.id);
      else if (nextDue === void 0 || dueAt < nextDue) nextDue = dueAt;
    }
    return { dueIds, nextDue };
  }
  function settingsDraftFromValue(value) {
    const source = asRecord(value);
    return {
      enabled: source.enabled !== false,
      delayText: String(clampCollapseDelay(source.collapseDelay)),
      manualOpenProtection: source.manualOpenProtection !== false
    };
  }
  function reconcileSettingsDraft(draft, accepted, edited) {
    if (draft === null) return settingsDraftFromValue(accepted);
    const acceptedDraft = settingsDraftFromValue(accepted);
    const next = { ...draft };
    let changed = false;
    if (edited.enabled !== true && next.enabled !== acceptedDraft.enabled) {
      next.enabled = acceptedDraft.enabled;
      changed = true;
    }
    if (edited.manualOpenProtection !== true && next.manualOpenProtection !== acceptedDraft.manualOpenProtection) {
      next.manualOpenProtection = acceptedDraft.manualOpenProtection;
      changed = true;
    }
    if (edited.delayText !== true && next.delayText !== acceptedDraft.delayText) {
      next.delayText = acceptedDraft.delayText;
      changed = true;
    }
    return changed ? next : draft;
  }
  function planSettingsWrite(draft, accepted, edited) {
    const acceptedDraft = settingsDraftFromValue(accepted);
    const operations = [];
    if (edited.enabled === true && draft.enabled !== acceptedDraft.enabled) {
      operations.push({ op: "set", path: ["enabled"], value: draft.enabled });
    }
    if (edited.manualOpenProtection === true && draft.manualOpenProtection !== acceptedDraft.manualOpenProtection) {
      operations.push({ op: "set", path: ["manualOpenProtection"], value: draft.manualOpenProtection });
    }
    if (edited.delayText === true) {
      const delay = parseCollapseDelay(draft.delayText);
      if (delay !== void 0 && delay !== Number(acceptedDraft.delayText)) {
        operations.push({ op: "set", path: ["collapseDelay"], value: delay });
      }
    }
    return operations;
  }
  function editedAcceptedUnchanged(edited, accepted, baseAccepted) {
    const current = settingsDraftFromValue(accepted);
    const base = settingsDraftFromValue(baseAccepted);
    if (edited.enabled === true && current.enabled !== base.enabled) return false;
    if (edited.manualOpenProtection === true && current.manualOpenProtection !== base.manualOpenProtection) return false;
    if (edited.delayText === true && Number(current.delayText) !== Number(base.delayText)) return false;
    return true;
  }

  // src/client.ts
  var THINK_ROOT_SELECTOR = '[data-variant="think"]';
  var DISCLOSURE_ROW_SELECTOR = "[data-disclosure-row][aria-expanded]";
  var CHAT_COLUMN_SELECTOR = '[data-slot="main.conversation"] [data-slot="conversation.view"] [data-chat-flow]';
  var CHAT_CONTENT_SELECTOR = '[data-conversation-content][data-conversation-region="chat"]';
  var CHAT_COLUMN_EXCLUSION = "[data-sidebar-right-session], [data-sidebar-chat], [data-step-process-body]";
  var CHAT_CONTENT_EXCLUSION = "[data-sidebar-right-session], [data-sidebar-chat]";
  var SESSION_ATTRIBUTE = "data-conversation-session";
  var NODE_KEY_ATTRIBUTE = "data-chat-node-key";
  var EXPANDED_ATTRIBUTE = "data-expanded";
  var CLICK_RETRY_MS = 500;
  var CLICK_ATTEMPT_LIMIT = 2;
  var DRAG_SLOP_PX = 4;
  var RULE_RECHECK_MS = 600;
  var MAX_REMEMBERED_BLOCKS = 512;
  function markEdited(current, field) {
    if (current[field] === true) return current;
    const next = { ...current };
    next[field] = true;
    return next;
  }
  var DICTIONARIES = {
    en: {
      loading: "Loading settings…",
      unavailable: "These settings are not available in this profile.",
      readOnly: "This profile stores settings read-only; the plugin keeps its current configuration.",
      enabled: "Auto-expand the current thinking block",
      enabledHint: "Only the latest thinking block stays open.",
      collapseDelay: "Collapse delay (seconds)",
      delayHint: "An older thinking block closes this many seconds after a newer thinking block appears.",
      manualOpenProtection: "Keep blocks I opened manually",
      manualOpenProtectionHint: "When off, manually opened older blocks also close after the delay.",
      invalidDelay: "Enter a whole number from 0 to 60 seconds.",
      save: "Save",
      saving: "Saving…",
      saveFailed: "The Host did not accept the change. Review the current values and retry."
    },
    zh: {
      loading: "正在加载设置…",
      unavailable: "当前配置档无法使用这些设置。",
      readOnly: "当前配置档以只读方式存储设置；插件保持现有配置。",
      enabled: "自动展开当前思考块",
      enabledHint: "只有最新的思考块保持展开。",
      collapseDelay: "收起延迟（秒）",
      delayHint: "出现更新的思考块后，较早的思考块在该秒数后收起。",
      manualOpenProtection: "保留我手动展开的思考块",
      manualOpenProtectionHint: "关闭后，手动展开的较早思考块也会在延迟后收起。",
      invalidDelay: "请输入 0 到 60 之间的整数秒。",
      save: "保存",
      saving: "正在保存…",
      saveFailed: "Host 未接受该修改，请检查当前值后重试。"
    }
  };
  var SETTINGS_CSS = `
.te-panel { display:flex; flex-direction:column; gap:10px; max-width:560px; font-size:13px; line-height:1.5; color:var(--dsw-alias-label-primary); }
.te-row { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:10px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }
.te-row:last-of-type { border-bottom:0; }
.te-row-main { display:flex; flex-direction:column; gap:2px; min-width:0; }
.te-label { font-weight:500; }
.te-hint { margin:0; font-size:12px; line-height:1.5; color:var(--dsw-alias-label-secondary); }
.te-note { margin:0; font-size:12px; line-height:1.5; color:var(--dsw-alias-label-secondary); }
.te-error { margin:0; font-size:12px; line-height:1.5; color:var(--dsw-alias-state-error-primary); }
.te-check { width:16px; height:16px; margin:0; accent-color:var(--dsw-alias-brand-primary); flex:none; }
.te-number { width:88px; flex:none; padding:5px 8px; font:inherit; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:6px; }
.te-number:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
.te-footer { display:flex; align-items:center; gap:10px; padding-top:4px; }
.te-save { appearance:none; border:1px solid transparent; border-radius:6px; padding:5px 14px; font:inherit; font-size:13px; line-height:1.5; cursor:pointer; background:var(--dsw-alias-label-primary); color:var(--dsw-alias-bg-base); }
.te-save:disabled { opacity:0.4; cursor:default; }
.te-save:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
`;
  function createEngine(readConfig) {
    const records = /* @__PURE__ */ new Map();
    const bodyObserver = new MutationObserver((mutations) => {
      if (disposed) return;
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          requestPass();
          return;
        }
        const target = mutation.target;
        if (observedScope !== void 0 && observedScope.isConnected) {
          if (target instanceof Element && target.closest(CHAT_CONTENT_EXCLUSION) !== null) continue;
          if (target instanceof Node && observedScope.contains(target)) continue;
          requestPass();
          return;
        }
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(CHAT_CONTENT_SELECTOR) || node.matches(CHAT_COLUMN_SELECTOR) || node.querySelector(CHAT_CONTENT_SELECTOR) !== null || node.querySelector(CHAT_COLUMN_SELECTOR) !== null) {
            requestPass();
            return;
          }
        }
      }
    });
    let observedScope;
    let scopeObserver;
    let frame = 0;
    let timer = 0;
    let disposed = false;
    let pendingPointer = null;
    let autoClicking = false;
    function now() {
      return performance.now();
    }
    function requestPass() {
      if (disposed || frame !== 0) return;
      frame = requestAnimationFrame(pass);
    }
    function clearFrame() {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    }
    function clearTimer() {
      if (timer !== 0) {
        clearTimeout(timer);
        timer = 0;
      }
    }
    function displayed(element) {
      if (!element.isConnected) return false;
      if (typeof element.checkVisibility === "function") {
        return element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: false });
      }
      return element.getClientRects().length > 0;
    }
    function mainChatRoot() {
      const columns = document.querySelectorAll(CHAT_COLUMN_SELECTOR);
      for (const column of columns) {
        if (column.closest(CHAT_COLUMN_EXCLUSION) !== null) continue;
        if (displayed(column)) return column;
      }
      const contents = document.querySelectorAll(CHAT_CONTENT_SELECTOR);
      for (const content of contents) {
        if (content.closest(CHAT_CONTENT_EXCLUSION) !== null) continue;
        if (!displayed(content)) continue;
        const column = content.querySelector("[data-chat-flow]");
        return column !== null ? column : content;
      }
      return void 0;
    }
    function rebindScope(scope) {
      if (scope === observedScope) return;
      if (scopeObserver !== void 0) scopeObserver.disconnect();
      observedScope = scope;
      if (scope === void 0) {
        scopeObserver = void 0;
        return;
      }
      scopeObserver = new MutationObserver(() => {
        requestPass();
      });
      scopeObserver.observe(scope, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [EXPANDED_ATTRIBUTE]
      });
    }
    function disclosureHit(target) {
      if (!(target instanceof Element)) return void 0;
      const row = target.closest(DISCLOSURE_ROW_SELECTOR);
      if (row === null || row.getAttribute("role") !== "button") return void 0;
      const root = row.closest(THINK_ROOT_SELECTOR);
      return root === null ? void 0 : { row, root };
    }
    function identityFor(root) {
      const sessionElement = root.closest("[" + SESSION_ATTRIBUTE + "]");
      const nodeElement = root.closest("[" + NODE_KEY_ATTRIBUTE + "]");
      const scopeSession = sessionElement === null ? "" : sessionElement.getAttribute(SESSION_ATTRIBUTE) ?? "";
      const nodeKey = nodeElement === null ? "" : nodeElement.getAttribute(NODE_KEY_ATTRIBUTE) ?? "";
      let ordinal = 0;
      if (nodeElement !== null) {
        const siblings = nodeElement.querySelectorAll(THINK_ROOT_SELECTOR);
        for (let index = 0; index < siblings.length; index += 1) {
          if (siblings[index] === root) {
            ordinal = index;
            break;
          }
        }
      }
      return formatBlockIdentity(scopeSession, nodeKey, ordinal);
    }
    function recordFor(id) {
      let record = records.get(id);
      if (record === void 0) {
        record = {
          manual: void 0,
          everSuperseded: false,
          supersededAt: 0,
          manualOpenedAt: 0,
          attempts: 0,
          lastExpandAt: -Infinity,
          lastCollapseAt: -Infinity,
          lastExpanded: false,
          giveUp: false
        };
        records.set(id, record);
      }
      return record;
    }
    function clickRow(root, record, wantExpanded) {
      if (record.giveUp === true || !root.isConnected) return false;
      const clock = now();
      const lastAttempt = wantExpanded ? record.lastExpandAt : record.lastCollapseAt;
      if (clock - lastAttempt < CLICK_RETRY_MS) return false;
      if (record.attempts >= CLICK_ATTEMPT_LIMIT) {
        record.giveUp = true;
        return false;
      }
      const row = root.querySelector(DISCLOSURE_ROW_SELECTOR);
      if (row === null) {
        record.giveUp = true;
        return false;
      }
      if (row.getAttribute("aria-expanded") === (wantExpanded ? "true" : "false")) return false;
      record.attempts += 1;
      if (wantExpanded) record.lastExpandAt = clock;
      else record.lastCollapseAt = clock;
      autoClicking = true;
      try {
        row.click();
      } catch (error) {
        record.giveUp = true;
        console.warn("thinking-expand: could not toggle a thinking block", error);
      } finally {
        autoClicking = false;
      }
      return true;
    }
    function commitManual(root, manual) {
      const record = recordFor(identityFor(root));
      record.manual = manual;
      if (manual === "open") record.manualOpenedAt = now();
      record.attempts = 0;
      record.giveUp = false;
      requestPass();
    }
    function onPointerDown(event) {
      if (disposed || event.button !== 0 || event.isPrimary === false) return;
      const hit = disclosureHit(event.target);
      pendingPointer = hit === void 0 ? null : { row: hit.row, x: event.clientX, y: event.clientY };
    }
    function onPointerCancel() {
      pendingPointer = null;
    }
    function onClick(event) {
      if (disposed || autoClicking || event.button !== 0) return;
      if (event.detail === 0) pendingPointer = null;
      const hit = disclosureHit(event.target);
      if (hit === void 0) {
        pendingPointer = null;
        return;
      }
      if (pendingPointer !== null) {
        if (pendingPointer.row !== hit.row) {
          pendingPointer = null;
          return;
        }
        const dx = event.clientX - pendingPointer.x;
        const dy = event.clientY - pendingPointer.y;
        pendingPointer = null;
        if (Math.hypot(dx, dy) > DRAG_SLOP_PX) return;
      }
      commitManual(hit.root, hit.root.hasAttribute(EXPANDED_ATTRIBUTE) ? "closed" : "open");
    }
    function onKeyDown(event) {
      if (disposed || autoClicking || event.repeat) return;
      if (event.key !== " " && event.key !== "Enter") return;
      const hit = disclosureHit(event.target);
      if (hit === void 0) return;
      commitManual(hit.root, hit.root.hasAttribute(EXPANDED_ATTRIBUTE) ? "closed" : "open");
    }
    function pass() {
      frame = 0;
      if (disposed) return;
      const config = readConfig();
      if (config.ready !== true || config.enabled !== true) {
        clearTimer();
        return;
      }
      const scope = mainChatRoot();
      rebindScope(scope);
      if (scope === void 0) {
        clearTimer();
        return;
      }
      const rootElements = scope.querySelectorAll(THINK_ROOT_SELECTOR);
      if (rootElements.length === 0) {
        clearTimer();
        return;
      }
      const entries = [];
      for (const element of rootElements) {
        entries.push({
          element,
          id: identityFor(element),
          expanded: element.hasAttribute(EXPANDED_ATTRIBUTE),
          isLatest: false
        });
      }
      entries[entries.length - 1].isLatest = true;
      const clock = now();
      for (const entry of entries) {
        const record = recordFor(entry.id);
        if (record.lastExpanded !== entry.expanded) {
          record.lastExpanded = entry.expanded;
          record.attempts = 0;
          record.giveUp = false;
        }
      }
      for (const entry of entries) {
        const record = recordFor(entry.id);
        if (entry.isLatest) {
          record.supersededAt = 0;
          if (shouldAutoExpand(entry, record, config)) clickRow(entry.element, record, true);
        } else {
          record.everSuperseded = true;
          if (entry.expanded && record.supersededAt === 0) record.supersededAt = clock;
        }
      }
      const plan = planCollapses(entries, records, config, clock);
      for (const id of plan.dueIds) {
        const entry = entries.find((candidate) => candidate.id === id);
        const record = entry === void 0 ? void 0 : records.get(id);
        if (entry !== void 0 && record !== void 0) clickRow(entry.element, record, false);
      }
      clearTimer();
      let nextAt = plan.nextDue;
      if (plan.dueIds.length > 0) {
        const retryAt = clock + RULE_RECHECK_MS;
        nextAt = nextAt === void 0 ? retryAt : Math.min(nextAt, retryAt);
      }
      const latestEntry = entries[entries.length - 1];
      const latestRecord = records.get(latestEntry.id);
      if (latestRecord !== void 0 && latestRecord.giveUp !== true && shouldAutoExpand(latestEntry, latestRecord, config)) {
        const expandRetryAt = clock + CLICK_RETRY_MS + 100;
        nextAt = nextAt === void 0 ? expandRetryAt : Math.min(nextAt, expandRetryAt);
      }
      if (nextAt !== void 0) {
        timer = setTimeout(() => {
          timer = 0;
          requestPass();
        }, Math.max(16, nextAt - now()));
      }
      if (records.size > MAX_REMEMBERED_BLOCKS) {
        const live = new Set(entries.map((entry) => entry.id));
        for (const id of [...records.keys()]) if (!live.has(id)) records.delete(id);
      }
    }
    if (document.body !== null) {
      bodyObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [SESSION_ATTRIBUTE]
      });
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        if (!disposed && document.body !== null) {
          bodyObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [SESSION_ATTRIBUTE]
          });
        }
      }, { once: true });
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointercancel", onPointerCancel, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    function dispose() {
      if (disposed) return;
      disposed = true;
      clearFrame();
      clearTimer();
      bodyObserver.disconnect();
      if (scopeObserver !== void 0) scopeObserver.disconnect();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      records.clear();
    }
    return {
      start() {
        requestPass();
      },
      applyConfig() {
        requestPass();
      },
      dispose
    };
  }
  function factory(require2) {
    const React = require2("react");
    const { useEffect, useId, useState } = React;
    function SettingsPanel(props) {
      const { view, configForm } = props;
      const t = typeof props.t === "function" ? props.t : (key) => key;
      const [snapshot, setSnapshot] = useState(() => configForm.getSnapshot());
      const [draft, setDraft] = useState(null);
      const [edited, setEdited] = useState({});
      const [baseRevision, setBaseRevision] = useState(void 0);
      const [baseAccepted, setBaseAccepted] = useState(null);
      const [saving, setSaving] = useState(false);
      const [failed, setFailed] = useState(false);
      const delayInputId = useId();
      useEffect(() => {
        setSnapshot(configForm.getSnapshot());
        return configForm.subscribe(() => {
          setSnapshot(configForm.getSnapshot());
        });
      }, [configForm]);
      useEffect(() => {
        if (snapshot.status !== "ready" || snapshot.value === void 0) return;
        setDraft((previous) => reconcileSettingsDraft(previous, snapshot.value, edited));
        if (baseRevision !== void 0 && baseAccepted !== null && snapshot.revision !== baseRevision && editedAcceptedUnchanged(edited, snapshot.value, baseAccepted)) {
          setBaseRevision(snapshot.revision);
          setBaseAccepted(snapshot.value);
        }
      }, [snapshot, edited, baseRevision, baseAccepted]);
      if (view !== "page") return null;
      const styleElement = React.createElement("style", {
        dangerouslySetInnerHTML: { __html: SETTINGS_CSS }
      });
      const panel = (children) => React.createElement("div", { className: "te-panel" }, styleElement, ...children);
      if (snapshot.status === "loading") {
        return panel([React.createElement("p", { className: "te-note", role: "status" }, t("loading"))]);
      }
      if (snapshot.status !== "ready") {
        return panel([React.createElement("p", { className: "te-note", role: "status" }, t("unavailable"))]);
      }
      const accepted = snapshot.value;
      const writable = snapshot.writable !== false;
      const settings = draft ?? settingsDraftFromValue(accepted);
      const operations = accepted === void 0 ? [] : planSettingsWrite(settings, accepted, edited);
      const delaySeconds = parseCollapseDelay(settings.delayText);
      const disabled = !writable || saving;
      const blocked = disabled || delaySeconds === void 0 || operations.length === 0;
      const editField = (field, patch) => {
        setFailed(false);
        setDraft((current) => ({ ...current ?? settingsDraftFromValue(accepted), ...patch }));
        setEdited((current) => markEdited(current, field));
        if (baseRevision === void 0) {
          setBaseRevision(snapshot.revision);
          setBaseAccepted(accepted ?? null);
        } else if (baseAccepted === null) {
          setBaseAccepted(accepted ?? null);
        }
      };
      const fail = () => {
        setSaving(false);
        setFailed(true);
        const current = configForm.getSnapshot();
        setBaseRevision(current.revision);
        setBaseAccepted(current.value ?? null);
      };
      const save = () => {
        if (blocked) return;
        setSaving(true);
        setFailed(false);
        configForm.mutate(operations, baseRevision ?? snapshot.revision).then((acceptedChange) => {
          if (acceptedChange === true) {
            setSaving(false);
            setEdited({});
            setBaseRevision(void 0);
            setBaseAccepted(null);
            return;
          }
          fail();
        }, fail);
      };
      const checkboxRow = (label, hint, checked, onChecked) => React.createElement(
        "div",
        { className: "te-row" },
        React.createElement(
          "div",
          { className: "te-row-main" },
          React.createElement("span", { className: "te-label" }, label),
          React.createElement("p", { className: "te-hint" }, hint)
        ),
        React.createElement("input", {
          className: "te-check",
          type: "checkbox",
          checked,
          disabled,
          "aria-label": label,
          onChange: (event) => {
            onChecked(event.target.checked);
          }
        })
      );
      return panel([
        writable ? null : React.createElement("p", { className: "te-note", role: "status" }, t("readOnly")),
        checkboxRow(t("enabled"), t("enabledHint"), settings.enabled, (value) => {
          editField("enabled", { enabled: value });
        }),
        React.createElement(
          "div",
          { className: "te-row" },
          React.createElement(
            "div",
            { className: "te-row-main" },
            React.createElement("label", { className: "te-label", htmlFor: delayInputId }, t("collapseDelay")),
            React.createElement("p", { className: "te-hint" }, t("delayHint"))
          ),
          React.createElement("input", {
            id: delayInputId,
            className: "te-number",
            type: "number",
            min: COLLAPSE_DELAY_MIN_SECONDS,
            max: COLLAPSE_DELAY_MAX_SECONDS,
            step: 1,
            value: settings.delayText,
            disabled,
            "aria-invalid": delaySeconds === void 0 || void 0,
            onChange: (event) => {
              editField("delayText", { delayText: event.target.value });
            }
          })
        ),
        delaySeconds === void 0 ? React.createElement("p", { className: "te-error", role: "status" }, t("invalidDelay")) : null,
        checkboxRow(
          t("manualOpenProtection"),
          t("manualOpenProtectionHint"),
          settings.manualOpenProtection,
          (value) => {
            editField("manualOpenProtection", { manualOpenProtection: value });
          }
        ),
        React.createElement(
          "div",
          { className: "te-footer" },
          failed ? React.createElement("p", { className: "te-error", role: "status" }, t("saveFailed")) : null,
          React.createElement("button", {
            type: "button",
            className: "te-save",
            disabled: blocked,
            onClick: save
          }, saving ? t("saving") : t("save"))
        )
      ]);
    }
    return {
      inject: ["slots", "locale", "configForms"],
      apply(ctx) {
        const configForm = ctx.configForms.get(SETTINGS_ENTRY_ID);
        let config = normalizeConfigSnapshot(configForm.getSnapshot());
        const engine = createEngine(() => config);
        ctx.effect(() => {
          const stop = configForm.subscribe(() => {
            config = normalizeConfigSnapshot(configForm.getSnapshot());
            engine.applyConfig();
          });
          return () => {
            stop();
            engine.dispose();
          };
        }, "thinking-expand: configuration");
        ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, DICTIONARIES), "thinking-expand: locale");
        ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
          name: "plugins.bundle.config",
          key: PACKAGE_NAME,
          locale: LOCALE_NAMESPACE,
          inject: () => ({ configForm })
        }, SettingsPanel));
        engine.start();
      }
    };
  }
  if (typeof window !== "undefined" && window.__ModuleLoader__ !== void 0) {
    window.__ModuleLoader__.load({ id: PACKAGE_NAME, factory });
  }
})();
