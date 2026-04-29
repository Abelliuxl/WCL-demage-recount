(function () {
  const STATE_EVENT = "wcl-combat-dps-state";
  const REQUEST_EVENT = "wcl-combat-dps-request";
  const STORAGE_KEY = "enabled";
  const POSITION_STORAGE_KEY = "position";
  const DEFAULT_ENABLED = false;
  const NONE_SENTINEL = "__WCL_COMBAT_NONE__";

  let widget = null;
  let tableObserver = null;
  let bodyObserver = null;
  let applyQueued = false;
  let latestState = null;
  let enabled = DEFAULT_ENABLED;
  let widgetPosition = null;
  let dragState = null;

  const UI_LANGUAGE = resolveUiLanguage();
  const TEXT = {
    en: {
      combatPrefix: "Combat",
      headerTag: "Ext",
      widgetTitle: "Combat-Time Stats",
      widgetSubtitle: "WCL Mythic+ Recalculation",
      toggleAriaLabel: "Toggle combat-time stats",
      combatTimeLabel: "Combat Time",
      overallTimeLabel: "Overall Time",
      waitingData: "Waiting for WCL report data to load.",
      unsupportedView: "Current view is not damage or healing. No recalculation is applied.",
      pullScoped:
        "Current page is pull={pullNumber}. Warcraft Logs already uses pull-time context, so no recalculation is applied.",
      noDungeonPulls: "Current fight is not a Mythic+ overview with dungeon pulls.",
      invalidScale: "Unable to compute combat-time scale.",
      activeStatus:
        "Recalculated by combat time: x{scale}, {pullCount} pulls, converted {metricLabel}.",
      idleStatus:
        "Ready. Turn on to convert {metricLabel} from overall time to combat time.",
      tooltipMetric: "Combat-time {metric}: {value}"
    },
    zh: {
      combatPrefix: "\u6218\u6597",
      headerTag: "\u6269\u5c55",
      widgetTitle: "\u6218\u6597\u65f6\u95f4\u7edf\u8ba1",
      widgetSubtitle: "WCL \u5927\u79d8\u5883\u603b\u89c8\u6362\u7b97",
      toggleAriaLabel: "\u5207\u6362\u6218\u6597\u65f6\u95f4\u7edf\u8ba1",
      combatTimeLabel: "\u6218\u6597\u65f6\u95f4",
      overallTimeLabel: "\u603b\u4f53\u65f6\u95f4",
      waitingData: "\u7b49\u5f85 WCL \u9875\u9762\u6570\u636e\u52a0\u8f7d\u3002",
      unsupportedView: "\u5f53\u524d\u4e0d\u662f\u4f24\u5bb3\u6216\u6cbb\u7597\u7edf\u8ba1\u9875\uff0c\u4e0d\u8fdb\u884c\u91cd\u7b97\u3002",
      pullScoped: "\u5f53\u524d\u662f pull={pullNumber} \u7684\u5355\u6ce2\u9875\u9762\uff0cWCL \u5df2\u6309\u6218\u6597\u65f6\u95f4\u7edf\u8ba1\uff0c\u4e0d\u505a\u6362\u7b97\u3002",
      noDungeonPulls: "\u5f53\u524d fight \u4e0d\u662f\u5e26 dungeon pulls \u7684\u5927\u79d8\u5883\u603b\u89c8\u3002",
      invalidScale: "\u65e0\u6cd5\u8ba1\u7b97\u6218\u6597\u65f6\u95f4\u500d\u7387\u3002",
      activeStatus: "\u5df2\u6309\u6218\u6597\u65f6\u95f4\u91cd\u7b97\uff0c\u500d\u7387 x{scale}\uff0c\u5171 {pullCount} \u4e2a pull\uff0c\u5df2\u6362\u7b97 {metricLabel}\u3002",
      idleStatus: "\u5df2\u5c31\u7eea\u3002\u6253\u5f00\u540e\u4f1a\u628a {metricLabel} \u4ece\u603b\u4f53\u65f6\u95f4\u6539\u4e3a\u6218\u6597\u65f6\u95f4\u53e3\u5f84\u3002",
      tooltipMetric: "\u6218\u6597\u65f6\u95f4{metric}\uff1a{value}"
    }
  };

  function resolveUiLanguage() {
    const locale =
      typeof chrome !== "undefined" &&
      chrome.i18n &&
      typeof chrome.i18n.getUILanguage === "function"
        ? chrome.i18n.getUILanguage()
        : navigator.language;

    const normalized = String(locale || "en").toLowerCase();
    return normalized.startsWith("zh") ? "zh" : "en";
  }

  function t(key, variables) {
    const dict = TEXT[UI_LANGUAGE] || TEXT.en;
    let template = dict[key] || TEXT.en[key] || key;
    if (!variables) {
      return template;
    }

    for (const [name, value] of Object.entries(variables)) {
      template = template.replace(new RegExp("\\{" + name + "\\}", "g"), String(value));
    }
    return template;
  }

  function getCombatMetric(metric) {
    return UI_LANGUAGE === "zh" ? t("combatPrefix") + metric : t("combatPrefix") + " " + metric;
  }

  function isSupportedFilterType(filterType) {
    return filterType === "damage-done" || filterType === "healing";
  }

  function getMetricTokens(filterType) {
    if (filterType === "healing") {
      return ["hps"];
    }

    return ["dps", "wdps"];
  }

  function getMetricLabel(filterType) {
    return filterType === "healing" ? "HPS" : "DPS/WDPS";
  }

  function injectBridge() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("bridge.js");
    script.dataset.wclCombatDpsBridge = "true";
    script.onload = function () {
      script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  function formatCompactNumber(value) {
    if (!Number.isFinite(value)) {
      return "";
    }

    if (value > 1e9) {
      return (value / 1e9).toFixed(2) + "b";
    }
    if (value > 1e8) {
      return (value / 1e6).toFixed(0) + "m";
    }
    if (value > 1e7) {
      return (value / 1e6).toFixed(1) + "m";
    }
    if (value > 1e6) {
      return (value / 1e6).toFixed(2) + "m";
    }
    if (value > 1e3) {
      return (value / 1e3).toFixed(0) + "k";
    }
    return value.toFixed(1);
  }

  function formatFullNumber(value) {
    if (!Number.isFinite(value)) {
      return "";
    }

    return new Intl.NumberFormat(UI_LANGUAGE === "zh" ? "zh-CN" : "en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(value);
  }

  function formatDuration(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return "--:--";
    }

    const totalSeconds = Math.round(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return String(hours) + ":" + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
    }

    return String(minutes) + ":" + String(seconds).padStart(2, "0");
  }

  function parseCompactNumber(text) {
    if (!text) {
      return null;
    }

    const normalized = String(text)
      .replace(/\u2212/g, "-")
      .replace(/,/g, "")
      .trim()
      .toLowerCase();

    const match = normalized.match(/(-?\d+(?:\.\d+)?)([kmb])?$/);
    if (!match) {
      return null;
    }

    const base = Number(match[1]);
    if (!Number.isFinite(base)) {
      return null;
    }

    const suffix = match[2];
    if (suffix === "k") {
      return base * 1e3;
    }
    if (suffix === "m") {
      return base * 1e6;
    }
    if (suffix === "b") {
      return base * 1e9;
    }
    return base;
  }

  function getCellNumericValue(cell) {
    const attributes = ["data-order", "data-sort", "sorttable_customkey", "data-value", "data-raw"];
    for (const attribute of attributes) {
      const raw = cell.getAttribute(attribute);
      if (!raw) {
        continue;
      }

      const numericValue = parseCompactNumber(raw);
      if (numericValue !== null) {
        return numericValue;
      }
    }

    const title = cell.getAttribute("title");
    if (title) {
      const numericValue = parseCompactNumber(title);
      if (numericValue !== null) {
        return numericValue;
      }
    }

    return parseCompactNumber(cell.textContent);
  }

  function getStoredCellValue(cell) {
    if (cell.dataset.wclCombatOriginalValue) {
      const value = Number(cell.dataset.wclCombatOriginalValue);
      return Number.isFinite(value) ? value : null;
    }

    const numericValue = getCellNumericValue(cell);
    if (numericValue === null) {
      return null;
    }

    cell.dataset.wclCombatOriginalValue = String(numericValue);
    return numericValue;
  }

  function rememberMarkup(element) {
    if (!element.dataset.wclCombatOriginalHtml) {
      element.dataset.wclCombatOriginalHtml = element.innerHTML;
    }
    if (!element.dataset.wclCombatOriginalTitle) {
      element.dataset.wclCombatOriginalTitle =
        element.getAttribute("title") === null ? NONE_SENTINEL : element.getAttribute("title");
    }
    if (!element.dataset.wclCombatOriginalOrder) {
      element.dataset.wclCombatOriginalOrder =
        element.getAttribute("data-order") === null ? NONE_SENTINEL : element.getAttribute("data-order");
    }
    if (!element.dataset.wclCombatOriginalSort) {
      element.dataset.wclCombatOriginalSort =
        element.getAttribute("data-sort") === null ? NONE_SENTINEL : element.getAttribute("data-sort");
    }
  }

  function restoreMarkedNodes() {
    const nodes = document.querySelectorAll("[data-wcl-combat-original-html]");
    for (const node of nodes) {
      node.innerHTML = node.dataset.wclCombatOriginalHtml || "";

      if (node.dataset.wclCombatOriginalTitle === NONE_SENTINEL) {
        node.removeAttribute("title");
      } else {
        node.setAttribute("title", node.dataset.wclCombatOriginalTitle || "");
      }

      if (node.dataset.wclCombatOriginalOrder === NONE_SENTINEL) {
        node.removeAttribute("data-order");
      } else {
        node.setAttribute("data-order", node.dataset.wclCombatOriginalOrder || "");
      }

      if (node.dataset.wclCombatOriginalSort === NONE_SENTINEL) {
        node.removeAttribute("data-sort");
      } else {
        node.setAttribute("data-sort", node.dataset.wclCombatOriginalSort || "");
      }

      node.classList.remove("wcl-combat-dps-patched");
      delete node.dataset.wclCombatOriginalHtml;
      delete node.dataset.wclCombatOriginalTitle;
      delete node.dataset.wclCombatOriginalOrder;
      delete node.dataset.wclCombatOriginalSort;
      delete node.dataset.wclCombatOriginalValue;
    }
  }

  function shouldEnhance() {
    return Boolean(
      enabled &&
        latestState &&
        latestState.ready &&
        isSupportedFilterType(latestState.filterType) &&
        !latestState.isPullScoped &&
        latestState.hasDungeonPulls &&
        Number.isFinite(latestState.scale) &&
        latestState.scale > 0
    );
  }

  function getHeaderCells(table) {
    const headRow = table.tHead && table.tHead.rows && table.tHead.rows[0];
    if (!headRow) {
      return [];
    }
    return Array.from(headRow.cells);
  }

  function findMetricColumnIndexes(table, filterType) {
    const headers = getHeaderCells(table);
    const indexes = [];
    const tokens = getMetricTokens(filterType);

    headers.forEach((header, index) => {
      const text = header.textContent.replace(/\s+/g, " ").trim().toLowerCase();
      if (tokens.some((token) => text.includes(token))) {
        indexes.push(index);
      }
    });

    return indexes;
  }

  function patchHeader(header, filterType) {
    rememberMarkup(header);

    const originalText = header.textContent.replace(/\s+/g, " ").trim();
    let nextText = originalText;
    if (filterType === "healing") {
      if (/hps/i.test(originalText)) {
        nextText = originalText.replace(/hps/i, getCombatMetric("HPS"));
      } else {
        nextText = originalText + " " + t("combatPrefix");
      }
    } else if (/wdps/i.test(originalText)) {
      nextText = originalText.replace(/wdps/i, getCombatMetric("WDPS"));
    } else if (/dps/i.test(originalText)) {
      nextText = originalText.replace(/dps/i, getCombatMetric("DPS"));
    } else {
      nextText = originalText + " " + t("combatPrefix");
    }

    header.innerHTML = nextText + '<span class="wcl-combat-dps-header-tag">' + t("headerTag") + "</span>";
  }

  function patchCell(cell, scale, filterType) {
    const originalValue = getStoredCellValue(cell);
    if (!Number.isFinite(originalValue)) {
      return;
    }

    rememberMarkup(cell);

    const nextValue = originalValue * scale;
    cell.textContent = formatFullNumber(nextValue);
    cell.setAttribute("data-order", String(nextValue));
    cell.setAttribute("data-sort", String(nextValue));
    cell.setAttribute(
      "title",
      t("tooltipMetric", {
        metric: filterType === "healing" ? "HPS" : "DPS",
        value: formatFullNumber(nextValue)
      })
    );
    cell.classList.add("wcl-combat-dps-patched");
  }

  function patchTable(table, scale, filterType) {
    const columnIndexes = findMetricColumnIndexes(table, filterType);
    if (!columnIndexes.length) {
      return;
    }

    const headers = getHeaderCells(table);
    for (const columnIndex of columnIndexes) {
      if (headers[columnIndex]) {
        patchHeader(headers[columnIndex], filterType);
      }

      for (const body of Array.from(table.tBodies)) {
        for (const row of Array.from(body.rows)) {
          const cell = row.cells[columnIndex];
          if (cell) {
            patchCell(cell, scale, filterType);
          }
        }
      }

      if (table.tFoot) {
        for (const row of Array.from(table.tFoot.rows)) {
          const cell = row.cells[columnIndex];
          if (cell) {
            patchCell(cell, scale, filterType);
          }
        }
      }
    }
  }

  function applyEnhancement() {
    applyQueued = false;
    restoreMarkedNodes();

    if (!shouldEnhance()) {
      return;
    }

    const container = document.querySelector("#table-container");
    if (!container) {
      return;
    }

    const tables = container.querySelectorAll("table");
    for (const table of tables) {
      patchTable(table, latestState.scale, latestState.filterType);
    }
  }

  function queueApply() {
    if (applyQueued) {
      return;
    }

    applyQueued = true;
    window.requestAnimationFrame(applyEnhancement);
  }

  function saveEnabledState(nextValue) {
    enabled = nextValue;
    chrome.storage.sync.set({ [STORAGE_KEY]: nextValue });
    renderWidget();
    queueApply();
  }

  function clampWidgetPosition(position) {
    if (!position || !widget) {
      return null;
    }

    const width = widget.offsetWidth || 232;
    const height = widget.offsetHeight || 180;
    const maxLeft = Math.max(0, window.innerWidth - width - 8);
    const maxTop = Math.max(0, window.innerHeight - height - 8);

    return {
      left: Math.min(Math.max(8, Math.round(position.left)), maxLeft),
      top: Math.min(Math.max(8, Math.round(position.top)), maxTop)
    };
  }

  function applyWidgetPosition() {
    if (!widget) {
      return;
    }

    const nextPosition = clampWidgetPosition(widgetPosition);
    if (!nextPosition) {
      widget.style.removeProperty("left");
      widget.style.removeProperty("top");
      widget.style.removeProperty("right");
      widget.style.removeProperty("bottom");
      return;
    }

    widgetPosition = nextPosition;
    widget.style.left = String(nextPosition.left) + "px";
    widget.style.top = String(nextPosition.top) + "px";
    widget.style.right = "auto";
    widget.style.bottom = "auto";
  }

  function saveWidgetPosition() {
    if (!widgetPosition) {
      chrome.storage.sync.remove(POSITION_STORAGE_KEY);
      return;
    }

    chrome.storage.sync.set({ [POSITION_STORAGE_KEY]: widgetPosition });
  }

  function finishDrag() {
    if (!dragState || !widget) {
      return;
    }

    const handle = widget.querySelector(".wcl-combat-dps-widget__top");
    if (handle) {
      handle.dataset.dragging = "false";
    }

    widget.classList.remove("wcl-combat-dps-widget--dragging");
    dragState = null;
    saveWidgetPosition();
  }

  function startDrag(event) {
    if (!widget) {
      return;
    }

    const handle = widget.querySelector(".wcl-combat-dps-widget__top");
    const toggle = widget.querySelector('[data-role="toggle"]');
    if (!handle || event.button !== 0 || (toggle && toggle.contains(event.target))) {
      return;
    }

    const rect = widget.getBoundingClientRect();
    widgetPosition = {
      left: rect.left,
      top: rect.top
    };
    applyWidgetPosition();

    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };

    handle.dataset.dragging = "true";
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function updateDrag(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    widgetPosition = clampWidgetPosition({
      left: event.clientX - dragState.offsetX,
      top: event.clientY - dragState.offsetY
    });
    applyWidgetPosition();
  }

  function buildWidget() {
    if (widget) {
      return widget;
    }

    widget = document.createElement("section");
    widget.id = "wcl-combat-dps-widget";
    widget.innerHTML =
      '<div class="wcl-combat-dps-widget__body">' +
      '  <div class="wcl-combat-dps-widget__top">' +
      '    <div>' +
      '      <h2 class="wcl-combat-dps-widget__title">' + t("widgetTitle") + '</h2>' +
      '      <p class="wcl-combat-dps-widget__subtitle">' + t("widgetSubtitle") + '</p>' +
      "    </div>" +
      '    <button type="button" class="wcl-combat-dps-widget__switch" data-role="toggle" aria-label="' + t("toggleAriaLabel") + '"></button>' +
      "  </div>" +
      '  <div class="wcl-combat-dps-widget__meta">' +
      '    <div class="wcl-combat-dps-widget__card">' +
      '      <span class="wcl-combat-dps-widget__label">' + t("combatTimeLabel") + '</span>' +
      '      <span class="wcl-combat-dps-widget__value" data-role="combat-time">--:--</span>' +
      "    </div>" +
      '    <div class="wcl-combat-dps-widget__card">' +
      '      <span class="wcl-combat-dps-widget__label">' + t("overallTimeLabel") + '</span>' +
      '      <span class="wcl-combat-dps-widget__value" data-role="overall-time">--:--</span>' +
      "    </div>" +
      "  </div>" +
      '  <div class="wcl-combat-dps-widget__status" data-role="status"></div>' +
      "</div>";

    const handle = widget.querySelector(".wcl-combat-dps-widget__top");
    handle.dataset.dragging = "false";
    handle.addEventListener("pointerdown", startDrag);
    handle.addEventListener("pointermove", updateDrag);
    handle.addEventListener("pointerup", finishDrag);
    handle.addEventListener("pointercancel", finishDrag);

    widget.querySelector('[data-role="toggle"]').addEventListener("click", function () {
      saveEnabledState(!enabled);
    });

    return widget;
  }
  function ensureWidgetMounted() {
    if (!document.body) {
      return;
    }

    const currentWidget = buildWidget();
    if (!currentWidget.isConnected) {
      document.body.appendChild(currentWidget);
      applyWidgetPosition();
    }
  }

  function renderWidget() {
    ensureWidgetMounted();
    if (!widget) {
      return;
    }

    applyWidgetPosition();

    const toggle = widget.querySelector('[data-role="toggle"]');
    const combatTime = widget.querySelector('[data-role="combat-time"]');
    const overallTime = widget.querySelector('[data-role="overall-time"]');
    const status = widget.querySelector('[data-role="status"]');

    toggle.dataset.enabled = String(enabled);
    toggle.setAttribute("aria-pressed", String(enabled));

    combatTime.textContent = latestState ? formatDuration(latestState.combatDurationMs) : "--:--";
    overallTime.textContent = latestState ? formatDuration(latestState.overallDurationMs) : "--:--";

    if (!latestState || !latestState.ready) {
      status.textContent = t("waitingData");
      status.dataset.state = "idle";
      return;
    }

    if (!isSupportedFilterType(latestState.filterType)) {
      status.textContent = t("unsupportedView");
      status.dataset.state = "idle";
      return;
    }

    if (latestState.isPullScoped) {
      status.textContent = t("pullScoped", {
        pullNumber: latestState.pullNumber
      });
      status.dataset.state = "idle";
      return;
    }

    if (!latestState.hasDungeonPulls) {
      status.textContent = t("noDungeonPulls");
      status.dataset.state = "error";
      return;
    }

    if (!Number.isFinite(latestState.scale) || latestState.scale <= 0) {
      status.textContent = t("invalidScale");
      status.dataset.state = "error";
      return;
    }

    if (enabled) {
      status.textContent = t("activeStatus", {
        scale: latestState.scale.toFixed(2),
        pullCount: latestState.dungeonPullCount,
        metricLabel: getMetricLabel(latestState.filterType)
      });
      status.dataset.state = "active";
    } else {
      status.textContent = t("idleStatus", {
        metricLabel: getMetricLabel(latestState.filterType)
      });
      status.dataset.state = "idle";
    }
  }
  function observeTableContainer() {
    const container = document.querySelector("#table-container");
    if (!container) {
      return;
    }

    if (tableObserver) {
      tableObserver.disconnect();
    }

    tableObserver = new MutationObserver(() => {
      queueApply();
      renderWidget();
    });

    tableObserver.observe(container, {
      childList: true,
      subtree: true
    });
  }

  function observeBodyUntilReady() {
    if (bodyObserver) {
      return;
    }

    bodyObserver = new MutationObserver(() => {
      ensureWidgetMounted();
      observeTableContainer();
    });

    bodyObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function requestLatestState() {
    document.dispatchEvent(new CustomEvent(REQUEST_EVENT));
  }

  function initializeStorage() {
    chrome.storage.sync.get(
      { [STORAGE_KEY]: DEFAULT_ENABLED, [POSITION_STORAGE_KEY]: null },
      (items) => {
      enabled = Boolean(items[STORAGE_KEY]);
      widgetPosition = items[POSITION_STORAGE_KEY];
      renderWidget();
      queueApply();
      }
    );

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") {
        return;
      }

      let shouldRender = false;
      if (changes[STORAGE_KEY]) {
        enabled = Boolean(changes[STORAGE_KEY].newValue);
        shouldRender = true;
      }
      if (changes[POSITION_STORAGE_KEY]) {
        widgetPosition = changes[POSITION_STORAGE_KEY].newValue || null;
        shouldRender = true;
      }
      if (shouldRender) {
        renderWidget();
        queueApply();
      }
    });
  }

  document.addEventListener(STATE_EVENT, (event) => {
    latestState = event.detail;
    renderWidget();
    observeTableContainer();
    queueApply();
  });

  injectBridge();
  observeBodyUntilReady();
  initializeStorage();
  window.addEventListener("resize", () => {
    if (!widgetPosition) {
      return;
    }
    widgetPosition = clampWidgetPosition(widgetPosition);
    applyWidgetPosition();
    saveWidgetPosition();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      ensureWidgetMounted();
      observeTableContainer();
      renderWidget();
      requestLatestState();
    });
  } else {
    ensureWidgetMounted();
    observeTableContainer();
    renderWidget();
    requestLatestState();
  }
})();


