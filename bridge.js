(function () {
  const STATE_EVENT = "wcl-combat-dps-state";
  const REQUEST_EVENT = "wcl-combat-dps-request";

  let scheduled = false;
  let reportsHooked = false;
  let filtersHooked = false;

  function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function parseQueryObject() {
    if (window.queryRouting && typeof window.queryRouting.get === "function") {
      try {
        const value = window.queryRouting.get();
        if (value && typeof value === "object") {
          return value;
        }
      } catch (error) {
        // Ignore queryRouting failures and fall back to the URL.
      }
    }

    const query = {};
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of params.entries()) {
      query[key] = value;
    }
    return query;
  }

  function getPrimaryCache() {
    return Array.isArray(window.reportsCache) ? window.reportsCache[0] || null : null;
  }

  function getFightIds(cache, query) {
    if (cache && Array.isArray(cache.filterFightsArray) && cache.filterFightsArray.length > 0) {
      return cache.filterFightsArray
        .map((value) => toFiniteNumber(value))
        .filter((value) => value !== null);
    }

    if (Array.isArray(window.filterFightsArray) && window.filterFightsArray.length > 0) {
      return window.filterFightsArray
        .map((value) => toFiniteNumber(value))
        .filter((value) => value !== null);
    }

    const fightId = toFiniteNumber(query.fight);
    return fightId === null ? [] : [fightId];
  }

  function getFightRecord(cache, fightIds) {
    if (!fightIds.length) {
      return null;
    }

    const fightId = fightIds.length === 1 ? fightIds[0] : fightIds[fightIds.length - 1];
    if (cache && cache.fightsTable && cache.fightsTable[fightId]) {
      return cache.fightsTable[fightId];
    }
    if (Array.isArray(window.fightsTable) && window.fightsTable[fightId]) {
      return window.fightsTable[fightId];
    }
    return null;
  }

  function mergeIntervals(intervals) {
    if (!intervals.length) {
      return 0;
    }

    intervals.sort((left, right) => left[0] - right[0]);

    let total = 0;
    let currentStart = intervals[0][0];
    let currentEnd = intervals[0][1];

    for (let index = 1; index < intervals.length; index += 1) {
      const [start, end] = intervals[index];
      if (start <= currentEnd) {
        currentEnd = Math.max(currentEnd, end);
        continue;
      }

      total += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    }

    total += currentEnd - currentStart;
    return total;
  }

  function computeCombatDurationMs(fight) {
    if (!fight || !Array.isArray(fight.dungeonPulls) || fight.dungeonPulls.length === 0) {
      return null;
    }

    const intervals = fight.dungeonPulls
      .map((pull) => {
        const start = toFiniteNumber(pull && pull.start_time);
        const end = toFiniteNumber(pull && pull.end_time);
        if (start === null || end === null || end <= start) {
          return null;
        }
        return [start, end];
      })
      .filter(Boolean);

    if (!intervals.length) {
      return null;
    }

    return mergeIntervals(intervals);
  }

  function collectState() {
    const query = parseQueryObject();
    const cache = getPrimaryCache();
    const pullNumber = toFiniteNumber(query.pull);
    const selectedFightIds = getFightIds(cache, query);
    const fight = getFightRecord(cache, selectedFightIds);
    const fightId = fight ? toFiniteNumber(fight.id) : (selectedFightIds.length === 1 ? selectedFightIds[0] : null);
    const fightStartTime = fight ? toFiniteNumber(fight.start_time) : null;
    const fightEndTime = fight ? toFiniteNumber(fight.end_time) : null;
    const overallDurationMs =
      fightStartTime !== null && fightEndTime !== null ? fightEndTime - fightStartTime : null;
    const combatDurationMs = computeCombatDurationMs(fight);
    const scale =
      combatDurationMs && overallDurationMs && combatDurationMs > 0
        ? overallDurationMs / combatDurationMs
        : null;

    return {
      href: window.location.href,
      ready: Boolean(cache),
      filterType: window.filterType || null,
      filterView: window.filterView || null,
      hostilityType: toFiniteNumber(window.hostilityType),
      pullNumber: pullNumber,
      isPullScoped: pullNumber !== null && pullNumber > 0,
      fightId: fightId,
      selectedFightIds: selectedFightIds,
      fightName: fight && typeof fight.name === "string" ? fight.name : null,
      overallDurationMs:
        Number.isFinite(overallDurationMs) && overallDurationMs > 0 ? overallDurationMs : null,
      combatDurationMs:
        Number.isFinite(combatDurationMs) && combatDurationMs > 0 ? combatDurationMs : null,
      dungeonPullCount:
        fight && Array.isArray(fight.dungeonPulls) ? fight.dungeonPulls.length : 0,
      hasDungeonPulls: Boolean(fight && Array.isArray(fight.dungeonPulls) && fight.dungeonPulls.length),
      scale: Number.isFinite(scale) && scale > 0 ? scale : null
    };
  }

  function emitState() {
    document.dispatchEvent(
      new CustomEvent(STATE_EVENT, {
        detail: collectState()
      })
    );
  }

  function scheduleEmit(delayMs) {
    if (scheduled) {
      return;
    }

    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      emitState();
    }, delayMs);
  }

  function hookGlobalArrays() {
    if (!reportsHooked && Array.isArray(window.reportsCacheOnChangeHandlers)) {
      window.reportsCacheOnChangeHandlers.push(() => scheduleEmit(40));
      reportsHooked = true;
    }

    if (!filtersHooked && Array.isArray(window.reportEventFiltersOnChangeHandlers)) {
      window.reportEventFiltersOnChangeHandlers.push(() => scheduleEmit(40));
      filtersHooked = true;
    }
  }

  function patchHistoryMethod(methodName) {
    const original = window.history && window.history[methodName];
    if (typeof original !== "function") {
      return;
    }

    window.history[methodName] = function () {
      const result = original.apply(this, arguments);
      scheduleEmit(40);
      return result;
    };
  }

  patchHistoryMethod("pushState");
  patchHistoryMethod("replaceState");

  window.addEventListener("popstate", () => scheduleEmit(40));
  window.addEventListener("hashchange", () => scheduleEmit(40));
  window.addEventListener("load", () => scheduleEmit(0));
  document.addEventListener(REQUEST_EVENT, () => scheduleEmit(0));

  window.setInterval(() => {
    hookGlobalArrays();
  }, 1000);

  hookGlobalArrays();
  scheduleEmit(0);
})();
