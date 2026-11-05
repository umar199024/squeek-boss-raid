// node tests/rules.test.js  — no dependencies
"use strict";
const assert = require("assert");
require("../js/config.js");
const G = require("../js/game.js");
const C = globalThis.SBR_CONFIG;

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

t("calendar: week 1 starts Monday 2026-10-26 00:00 UTC", () => {
  assert.strictEqual(new Date(G.weekStart(1) * 1000).toISOString(), "2026-10-26T00:00:00.000Z");
  assert.strictEqual(new Date(G.weekStart(2) * 1000).toISOString(), "2026-11-02T00:00:00.000Z");
  assert.strictEqual(G.weekOf(G.weekStart(2)), 2);
  assert.strictEqual(G.weekOf(G.weekStart(2) - 1), 1);
});

t("SqueekCore round <-> slot mapping (genesis 1793022600, stream-game core)", () => {
  const g = 1793022600;
  // round 926 is the first round of week 2 on that core (cumulative work 71387 after round 925)
  assert.strictEqual(G.slotToCoreRound(g, G.weekFirstSlot(2)), 926);
  assert.strictEqual(G.coreRoundToSlot(g, 926), G.weekFirstSlot(2));
});

t("Raid Order encode/decode round-trip, value < 1 SQK", () => {
  const picks = [1, 2, 3, 0, 0, 1, 1, 1, 3, 3, 2, 2, 0, 0, 0, 3];
  const v = G.encodeOrder(3, 1234, picks);
  assert.ok(v < 10n ** 18n && v >= 8n * 10n ** 17n);
  assert.strictEqual(v.toString().slice(0, 8), "83001234");
  const d = G.decodeOrder(v);
  assert.deepStrictEqual(d, { classId: 3, startSlot: 1234, picks });
  assert.strictEqual(G.decodeOrder(0n), null);
  assert.strictEqual(G.decodeOrder(10n ** 18n), null);
  assert.strictEqual(G.decodeOrder(8n * 10n ** 17n + 5n * 10n ** 16n), null); // class 5
});

t("scoring: assists, calls, late calls ignored, class locked, victory + last hit", () => {
  const week = 3, first = G.weekFirstSlot(week);
  const slots = new Map();
  // slot first..first+5: nap, jab 200, smash 500, nap, smash 600, ...
  [0, 200, 500, 0, 600].forEach((w, i) => slots.set(first + i, w));
  const t0 = G.slotStart(first);
  const orders = [
    // A: Warrior, joined before slot 0, calls nap, jab, smash, smash(wrong: nap), smash
    { player: "0xAAA0000000000000000000000000000000000001", txTime: t0 - 30, blockNumber: 1, logIndex: 0, txHash: "0x1",
      value: G.encodeOrder(1, first, [1, 2, 3, 3, 3]).toString() },
    // B: Mage, joined after slot 1 started -> its slot-1 call is too late, slot 2+ counts; tries to switch class later
    { player: "0xBBB0000000000000000000000000000000000002", txTime: G.slotStart(first + 1) + 10, blockNumber: 2, logIndex: 0, txHash: "0x2",
      value: G.encodeOrder(2, first + 1, [2, 3, 1, 3]).toString() },
    { player: "0xBBB0000000000000000000000000000000000002", txTime: G.slotStart(first + 1) + 20, blockNumber: 3, logIndex: 0, txHash: "0x3",
      value: G.encodeOrder(4, first + 2, [3]).toString() },
  ];
  const boss = G.bossForWeek(week);
  const saved = boss.hp; boss.hp = 1200; // kill on slot first+4 (cumulative 1300)
  try {
    const r = G.scoreWeek({ week, slots, orders, now: G.slotStart(first + 10) });
    assert.strictEqual(r.state, "victory");
    assert.strictEqual(r.killSlot, first + 4);
    assert.strictEqual(r.damage, 1200);
    const A = r.board.find((p) => p.addr.startsWith("0xaaa"));
    const B = r.board.find((p) => p.addr.startsWith("0xbbb"));
    assert.strictEqual(B.cls, "mage", "class is locked to the first order of the week");
    // A assists: 200/10=20, smash 500 *1.5/10 = 75, smash 600 -> 90  => 185
    assert.strictEqual(A.assist, 185);
    // A calls: nap ok (10), jab ok (100*1.1=110), smash ok (120*1.5=180 *1.2 = 216), wrong, smash ok (180) => 516
    assert.strictEqual(A.callPts, 10 + 110 + 216 + 180);
    assert.strictEqual(A.correct, 4); assert.strictEqual(A.calls, 5); assert.strictEqual(A.bestStreak, 3);
    assert.ok(A.cleared && A.lastHit);
    // B: slot1 call too late (ignored); slot2 smash ok (120); slot3 nap ok (10, streak 2 => +20% mage => 12); slot4 smash ok (120 *1.4 = 168)
    assert.strictEqual(B.calls, 3);
    assert.strictEqual(B.callPts, 120 + 12 + 168);
    // B assists only from slot 2 (enlisted mid slot 1): 50 + 60
    assert.strictEqual(B.assist, 110);
    assert.strictEqual(A.points, A.assist + A.callPts + 500 + 250);
    assert.strictEqual(r.board[0].addr, A.addr);
  } finally { boss.hp = saved; }
});

t("week over with HP left = escaped", () => {
  const week = 4, first = G.weekFirstSlot(week), slots = new Map();
  for (let s = first; s <= G.weekLastSlot(week); s++) slots.set(s, s % 50 === 0 ? 300 : 0);
  const r = G.scoreWeek({ week, slots, orders: [], now: G.weekEnd(week) + 5 });
  assert.strictEqual(r.state, "escaped");
});

t("deterministic", () => {
  const week = 2, first = G.weekFirstSlot(week), slots = new Map([[first, 420], [first + 1, 0]]);
  const o = [{ player: "0x" + "c".repeat(40), txTime: G.slotStart(first) - 1, blockNumber: 9, logIndex: 1, txHash: "0x9", value: G.encodeOrder(4, first, [3, 1]).toString() }];
  assert.deepStrictEqual(JSON.stringify(G.scoreWeek({ week, slots, orders: o, now: 1 })), JSON.stringify(G.scoreWeek({ week, slots, orders: o, now: 1 })));
});

console.log(`\n${n} tests passed`);
