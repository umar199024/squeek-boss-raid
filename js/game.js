/* Squeek Boss Raid · rules engine
 * Pure, deterministic functions. Given the same certified rounds (SqueekCore) and the
 * same Raid Orders (Approval logs on SQK), every browser computes the same boss HP,
 * the same roster and the same leaderboard. No server, no randomness, no clocks except
 * on-chain timestamps. Runs in the browser and in Node (see tests/).
 */
(function (root) {
  "use strict";
  const C = root.SBR_CONFIG || (typeof require !== "undefined" ? (require("./config.js"), globalThis.SBR_CONFIG) : null);

  // ---------- calendar ----------
  const weekOf = (t) => Math.floor((t - C.epoch) / C.weekSeconds) + 1;
  const weekStart = (w) => C.epoch + (w - 1) * C.weekSeconds;
  const weekEnd = (w) => weekStart(w + 1);
  const slotOf = (t) => Math.floor((t - C.epoch) / C.slotSeconds);
  const slotStart = (s) => C.epoch + s * C.slotSeconds;
  const weekFirstSlot = (w) => (w - 1) * C.slotsPerWeek;
  const weekLastSlot = (w) => w * C.slotsPerWeek - 1;
  const bossForWeek = (w) => C.bosses[(((w - 1) % C.bosses.length) + C.bosses.length) % C.bosses.length];

  // SqueekCore V3: round r covers [genesis + (r-1)*600, genesis + r*600).
  const coreRoundToSlot = (genesis, r) => Math.floor((genesis + (r - 1) * C.slotSeconds - C.epoch) / C.slotSeconds);
  const slotToCoreRound = (genesis, s) => Math.floor((slotStart(s) - genesis) / C.slotSeconds) + 1;

  // ---------- outcomes ----------
  function outcomeOf(work) {
    if (work === 0) return 1;            // nap
    return work >= C.smashThreshold ? 3 : 2; // smash : jab
  }

  // ---------- Raid Order encoding ----------
  // A Raid Order is SQK.approve(SIGIL, value) with value < 1 SQK (1e18 base units),
  // written in decimal as  8 C SSSSSS PPPPPPPPPP :
  //   8        magic digit
  //   C        class id 1..4
  //   SSSSSS   first planned slot, counted in 10-minute slots from the season epoch
  //   P…       16 calls in base 4 (0 none, 1 nap, 2 jab, 3 smash); call i is for slot S+i
  const E17 = 10n ** 17n, E16 = 10n ** 16n, E10 = 10n ** 10n, PICK_SPACE = 4n ** 16n;
  const PLAN_LEN = 16;

  function encodeOrder(classId, startSlot, picks) {
    if (!(classId >= 1 && classId <= 4)) throw new Error("bad class");
    if (!(startSlot >= 0 && startSlot < 1e6)) throw new Error("bad slot");
    let p = 0n;
    for (let i = PLAN_LEN - 1; i >= 0; i--) {
      const v = BigInt(picks[i] || 0);
      if (v < 0n || v > 3n) throw new Error("bad pick");
      p = p * 4n + v;
    }
    return 8n * E17 + BigInt(classId) * E16 + BigInt(startSlot) * E10 + p;
  }

  function decodeOrder(value) {
    let v;
    try { v = BigInt(value); } catch (_) { return null; }
    if (v < 8n * E17 || v >= 9n * E17) return null;
    const classId = Number((v / E16) % 10n);
    if (classId < 1 || classId > 4) return null;
    const startSlot = Number((v / E10) % 1000000n);
    let p = v % E10;
    if (p >= PICK_SPACE) return null;
    const picks = [];
    for (let i = 0; i < PLAN_LEN; i++) { picks.push(Number(p % 4n)); p /= 4n; }
    return { classId, startSlot, picks };
  }

  // ---------- scoring ----------
  const SCORE = {
    assistDiv: 10,          // 1 point per 10 work in a round you were enlisted for
    warriorSmashAssist: 15, // ×1.5 (per 100)
    tankAssist: 125,        // ×1.25 (per 100)
    callBonus: { warrior: [3, 150], mage: [2, 150], healer: [1, 300] }, // [outcome, per-100 multiplier]
    streakStep: 10, mageStreakStep: 20, streakCapPct: 100, // +10% per consecutive correct call, up to +100%
    secondWind: 50, secondWindNaps: 6,
    raidClear: 500, lastHit: 250,
  };

  /**
   * @param {object} p
   *  week: number
   *  slots: Map<number, number>   certified work per slot (absent = not certified yet)
   *  orders: Array<{player, txTime, blockNumber, logIndex, txHash, value}>
   *  now: unix seconds (only used to label the week live/over; never for scoring)
   */
  function scoreWeek(p) {
    const week = p.week, boss = bossForWeek(week);
    const first = weekFirstSlot(week), last = weekLastSlot(week);
    const wStart = weekStart(week), wEnd = weekEnd(week);

    // 1) Orders of this week, in chain order.
    const orders = (p.orders || [])
      .map((o) => ({ ...o, player: o.player.toLowerCase(), dec: decodeOrder(o.value) }))
      // An order belongs to the week of its first planned round (so you can enlist for
      // Monday's first round on Sunday night); it must still be sent before that week ends.
      .filter((o) => o.dec && weekOf(slotStart(o.dec.startSlot)) === week && o.txTime < wEnd)
      .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);

    const players = new Map();
    for (const o of orders) {
      let pl = players.get(o.player);
      if (!pl) {
        const cls = C.classes.find((c) => c.id === o.dec.classId);
        pl = { addr: o.player, classId: cls.id, cls: cls.key, enlistTime: o.txTime, enlistTx: o.txHash,
          picks: new Map(), orders: 0, points: 0, assist: 0, callPts: 0, bonus: 0,
          calls: 0, correct: 0, streak: 0, bestStreak: 0, lastHit: false, cleared: false };
        players.set(o.player, pl);
      }
      pl.orders++;
      o.dec.picks.forEach((pick, i) => {
        const s = o.dec.startSlot + i;
        if (!pick || s < first || s > last) return;
        if (slotStart(s) < o.txTime) return; // only calls made before the round began count
        pl.picks.set(s, pick);
      });
    }

    // 2) Walk certified slots in time order.
    let damage = 0, killSlot = null, knownCount = 0, activeCount = 0, napRun = 0, bestRound = null;
    let knownThrough = null;
    const feed = [];
    const hp = boss.hp;
    for (let s = first; s <= last; s++) {
      if (!p.slots.has(s)) continue;
      const work = p.slots.get(s);
      knownCount++; knownThrough = s;
      const out = outcomeOf(work);
      const t0 = slotStart(s);
      if (work > 0) activeCount++;
      if (!bestRound || work > bestRound.work) bestRound = { slot: s, work };
      if (killSlot !== null) continue; // raid is over, boss is down

      const before = damage;
      damage += work;
      const secondWind = work > 0 && napRun >= SCORE.secondWindNaps;
      napRun = work > 0 ? 0 : napRun + 1;

      for (const pl of players.values()) {
        if (pl.enlistTime > t0) continue;
        // assists
        if (work > 0) {
          let a = Math.floor(work / SCORE.assistDiv);
          if (pl.cls === "warrior" && out === 3) a = Math.floor((work * SCORE.warriorSmashAssist) / 100);
          if (pl.cls === "tank") a = Math.floor((Math.floor(work / SCORE.assistDiv) * SCORE.tankAssist) / 100);
          pl.assist += a; pl.points += a;
        }
        if (secondWind && pl.cls === "healer") { pl.bonus += SCORE.secondWind; pl.points += SCORE.secondWind; }
        // calls
        const pick = pl.picks.get(s);
        if (pick) {
          pl.calls++;
          if (pick === out) {
            pl.correct++; pl.streak++;
            pl.bestStreak = Math.max(pl.bestStreak, pl.streak);
            let base = C.outcomes[out - 1].base;
            const cb = SCORE.callBonus[pl.cls];
            if (cb && cb[0] === out) base = Math.floor((base * cb[1]) / 100);
            const step = pl.cls === "mage" ? SCORE.mageStreakStep : SCORE.streakStep;
            const pct = Math.min((pl.streak - 1) * step, SCORE.streakCapPct);
            const pts = Math.floor((base * (100 + pct)) / 100);
            pl.callPts += pts; pl.points += pts;
            pl._hitThis = true;
          } else if (pl.cls !== "tank") {
            pl.streak = 0;
          }
        }
      }

      if (work > 0) feed.push({ slot: s, t: t0, work, out, hpAfter: Math.max(0, hp - damage) });
      if (before < hp && damage >= hp) {
        killSlot = s;
        for (const pl of players.values()) {
          if (pl.enlistTime <= t0) { pl.cleared = true; pl.bonus += SCORE.raidClear; pl.points += SCORE.raidClear; }
          if (pl._hitThis && pl.picks.get(s) === out) { pl.lastHit = true; pl.bonus += SCORE.lastHit; pl.points += SCORE.lastHit; }
        }
      }
      for (const pl of players.values()) delete pl._hitThis;
    }

    const now = p.now || 0;
    let state = "live";
    if (killSlot !== null) state = "victory";
    else if (now >= wEnd && knownThrough === last) state = "escaped";
    else if (now >= wEnd) state = "closing"; // week over, last rounds still settling
    else if (now < wStart) state = "upcoming";

    const board = [...players.values()].sort((a, b) => b.points - a.points || a.enlistTime - b.enlistTime);
    board.forEach((pl) => { pl.picksArr = [...pl.picks.entries()].sort((a, b) => a[0] - b[0]); });
    return {
      week, boss, hp, damage: Math.min(damage, hp), rawDamage: damage, hpLeft: Math.max(0, hp - damage),
      killSlot, state, knownCount, activeCount, knownThrough, bestRound, feed, board,
      orderCount: orders.length, weekStart: wStart, weekEnd: wEnd,
    };
  }

  // Round result for a slot (used by the round strip and the plan editor).
  function slotResult(slots, s) {
    if (!slots.has(s)) return null;
    const work = slots.get(s);
    return { work, out: outcomeOf(work) };
  }

  const API = {
    weekOf, weekStart, weekEnd, slotOf, slotStart, weekFirstSlot, weekLastSlot, bossForWeek,
    coreRoundToSlot, slotToCoreRound, outcomeOf, encodeOrder, decodeOrder, scoreWeek, slotResult,
    PLAN_LEN, SCORE,
  };
  root.SBR_GAME = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
