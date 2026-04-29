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

    return new Intl.NumberFormat("en-US", {
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
        nextText = originalText.replace(/hps/i, "战斗HPS");
      } else {
        nextText = originalText + " 战斗";
      }
    } else if (/wdps/i.test(originalText)) {
      nextText = originalText.replace(/wdps/i, "战斗WDPS");
    } else if (/dps/i.test(originalText)) {
      nextText = originalText.replace(/dps/i, "战斗DPS");
    } else {
      nextText = originalText + " 战斗";
    }

    header.innerHTML = nextText + '<span class="wcl-combat-dps-header-tag">扩展</span>';
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
    cell.setAttribute("title", "战斗时间 " + (filterType === "healing" ? "HPS" : "DPS") + ": " + formatFullNumber(nextValue));
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
      '      <h2 class="wcl-combat-dps-widget__title">战斗时间统计</h2>' +
      '      <p class="wcl-combat-dps-widget__subtitle">WCL 大秘境总览换算</p>' +
      "    </div>" +
      '    <button type="button" class="wcl-combat-dps-widget__switch" data-role="toggle" aria-label="切换战斗时间统计"></button>' +
      "  </div>" +
      '  <div class="wcl-combat-dps-widget__meta">' +
      '    <div class="wcl-combat-dps-widget__card">' +
      '      <span class="wcl-combat-dps-widget__label">战斗时间</span>' +
      '      <span class="wcl-combat-dps-widget__value" data-role="combat-time">--:--</span>' +
      "    </div>" +
      '    <div class="wcl-combat-dps-widget__card">' +
      '      <span class="wcl-combat-dps-widget__label">总体时间</span>' +
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
      status.textContent = "等待 WCL 页面数据加载。";
      status.dataset.state = "idle";
      return;
    }

    if (!isSupportedFilterType(latestState.filterType)) {
      status.textContent = "当前不是伤害或治疗统计页，不进行重算。";
      status.dataset.state = "idle";
      return;
    }

    if (latestState.isPullScoped) {
      status.textContent =
        "当前是 pull=" +
        latestState.pullNumber +
        " 的单波页面，WCL 已经按战斗时间统计，不做换算。";
      status.dataset.state = "idle";
      return;
    }

    if (!latestState.hasDungeonPulls) {
      status.textContent = "当前 fight 不是带 dungeon pulls 的大秘境总览。";
      status.dataset.state = "error";
      return;
    }

    if (!Number.isFinite(latestState.scale) || latestState.scale <= 0) {
      status.textContent = "无法计算战斗时间倍率。";
      status.dataset.state = "error";
      return;
    }

    if (enabled) {
      status.textContent =
        "已按战斗时间重算，倍率 x" +
        latestState.scale.toFixed(2) +
        "，共 " +
        latestState.dungeonPullCount +
        " 个 pull，已换算 " +
        getMetricLabel(latestState.filterType) +
        "。";
      status.dataset.state = "active";
    } else {
      status.textContent =
        "已就绪。打开后会把 " +
        getMetricLabel(latestState.filterType) +
        " 从总体时间改为战斗时间口径。";
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
