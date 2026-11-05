/* Squeek Boss Raid · clearly-labeled demo data
 * Used only when neither the Squeekchain API nor any Sepolia RPC can be reached,
 * or when the page is opened with ?demo=1. Nothing here is ever mixed with real data;
 * the page shows a DEMO ribbon whenever it is active.
 */
(function (root) {
  "use strict";
  const G = root.SBR_GAME;

  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // Squeektoshi-shaped activity: mostly naps, runs around 21:00–01:00 UTC.
  function buildSlots(week, now) {
    const r = rng(week * 7919);
    const slots = new Map();
    const first = G.weekFirstSlot(week), last = Math.min(G.weekLastSlot(week), G.slotOf(now) - 2);
    for (let s = first; s <= last; s++) {
      const h = new Date(G.slotStart(s) * 1000).getUTCHours();
      const night = h >= 21 || h < 2;
      const p = night ? 0.55 : 0.04;
      slots.set(s, r() < p ? Math.floor(60 + r() * 620) : 0);
    }
    return slots;
  }

  function buildOrders(week, now) {
    const r = rng(week * 104729);
    const names = ["0x5eed00000000000000000000000000000000a11c", "0xc4ee00000000000000000000000000000000b0b0",
      "0x9a9a0000000000000000000000000000000000ed", "0x7a7e00000000000000000000000000000000ca75",
      "0x3d3d00000000000000000000000000000000f00d", "0x1ce000000000000000000000000000000000beef"];
    const orders = [];
    const ws = G.weekStart(week);
    names.forEach((addr, i) => {
      const t = ws + Math.floor(r() * 3 * 86400);
      if (t > now) return;
      const start = G.slotOf(t) + 1;
      const picks = Array.from({ length: 16 }, () => (r() < 0.7 ? 1 + Math.floor(r() * 3) : 0));
      orders.push({ player: addr, txTime: t, blockNumber: 1000 + i, logIndex: 0, txHash: "0x" + "d".repeat(64),
        value: G.encodeOrder(1 + (i % 4), start, picks).toString(), token: "demo", src: "demo" });
    });
    return orders;
  }

  function status(now) {
    const h = new Date(now * 1000).getUTCHours();
    const run = h >= 21 || h < 2;
    return { freshness: "online", coreStatus: run ? "ACTIVE" : "IDLE", rpmMilli: run ? 74000 : 0,
      speedMmPerSecond: run ? 1090 : 0, distanceMm: 2400000, cumulativeWorkUnits: null, openRoundWorkUnits: run ? "180" : "0", closedWorkUnits: "0" };
  }

  root.SBR_DEMO = { buildSlots, buildOrders, status };
})(window);
