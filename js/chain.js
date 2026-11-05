/* Squeek Boss Raid · data layer
 * - Squeekchain public API (live wheel telemetry, deployment identities)
 * - SqueekCore on Sepolia via public JSON-RPC (state, configuration, roundPage)
 * - Raid Orders: SQK Approval(owner, SIGIL, value) logs via Blockscout + public RPC
 * Everything is read-only. Writes happen only in app.js, from the player's own wallet.
 */
(function (root) {
  "use strict";
  const C = root.SBR_CONFIG, G = root.SBR_GAME;
  const ethers = root.ethers;
  const coder = ethers.AbiCoder.defaultAbiCoder();

  const SEL = {
    state: "0xc19d93fb",          // state()
    configuration: "0x5d1ca631",  // configuration()  (checked at runtime below)
    roundPage: "0xc8b9e08f",      // roundPage(uint64,uint64,uint256)
  };
  // Compute selectors/topics with ethers so nothing is hand-typed wrong.
  const id = (s) => ethers.id(s);
  SEL.configuration = id("configuration()").slice(0, 10);
  SEL.state = id("state()").slice(0, 10);
  SEL.roundPage = id("roundPage(uint64,uint64,uint256)").slice(0, 10);
  const TOPIC_APPROVAL = id("Approval(address,address,uint256)");
  const SIGIL_TOPIC = ethers.zeroPadValue(C.sigil.toLowerCase(), 32);

  const T_STATE = ["tuple(uint64,uint64,uint96,uint64,uint96,uint32,uint256,bool)"];
  const T_CONFIG = ["tuple(bytes32,uint64,uint64,uint64,uint16,address,address,uint32,uint64,uint64,uint96)"];
  const T_PAGE = ["tuple(uint64,tuple(uint64,uint96,uint32),tuple(uint64,uint96,uint32),tuple(uint64,uint64,uint96,uint32,bytes32)[])"];

  // ---------- fetch helpers ----------
  async function fetchJson(url, opts = {}, timeoutMs = 12000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...opts, signal: ctl.signal, cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  let rpcIndex = 0;
  const rpcHealth = { last: null, url: null, ok: false };
  async function rpc(method, params) {
    let lastErr;
    for (let k = 0; k < C.rpcs.length; k++) {
      const url = C.rpcs[(rpcIndex + k) % C.rpcs.length];
      try {
        const j = await fetchJson(url, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        }, 15000);
        if (j.error) throw Object.assign(new Error(j.error.message || "rpc error"), { code: j.error.code });
        rpcIndex = (rpcIndex + k) % C.rpcs.length;
        rpcHealth.ok = true; rpcHealth.url = url; rpcHealth.last = Date.now();
        return j.result;
      } catch (e) { lastErr = e; }
    }
    rpcHealth.ok = false;
    throw lastErr || new Error("all RPCs failed");
  }
  const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);

  // ---------- Squeekchain API ----------
  const apiHealth = { ok: null, last: null, error: null };
  async function api(path) {
    try {
      const j = await fetchJson(C.api + path, {}, 10000);
      apiHealth.ok = true; apiHealth.last = Date.now(); apiHealth.error = null;
      return j;
    } catch (e) {
      apiHealth.ok = false; apiHealth.error = String(e.message || e);
      throw e;
    }
  }

  /** Live wheel telemetry from GET /v1/status (display only; never scored). */
  async function getStatus() {
    const j = await api("/status");
    if (j.schemaVersion !== 1) console.warn("unexpected /v1/status schemaVersion", j.schemaVersion);
    const m = j.measurement || null;
    const b = j.builder && j.builder.status === "available" ? j.builder : null;
    const str = (x) => (x === undefined || x === null ? null : String(x));
    return {
      generatedAt: j.generatedAt || null,
      freshness: m ? m.freshness : "unavailable",    // online | stale
      coreStatus: m ? m.coreStatus : null,            // IDLE | ACTIVE | COUNTER_FAULT
      provenance: m ? m.provenance : null,
      rpmMilli: m && Number.isFinite(m.rpmMilli) ? m.rpmMilli : null,
      speedMmPerSecond: m && Number.isFinite(m.speedMmPerSecond) ? m.speedMmPerSecond : null,
      distanceMm: m && Number.isFinite(m.distanceMm) ? m.distanceMm : null,
      cumulativeWorkUnits: m ? str(m.cumulativeWorkUnits) : null,
      counterEpoch: m ? m.counterEpoch : null,
      observedAt: m ? m.observedAt : null,
      openRoundWorkUnits: b && b.queued ? str(b.queued.openRoundWorkUnits) : null,
      closedWorkUnits: b && b.queued ? str(b.queued.closedWorkUnits) : null,
      blockHeight: b && b.projected ? str(b.projected.blockHeight) : null,
    };
  }

  /** GET /v1/core: which SqueekCore the public API currently indexes. */
  async function getApiCore() {
    const j = await api("/core");
    if (j.status !== "available") return { status: j.status, reason: j.reason };
    return {
      status: "available", installationId: j.installationId,
      core: j.identities && j.identities.core, genesis: Number(j.configuration && j.configuration.genesisTimestamp),
      settledThroughRound: j.core && j.core.settledThroughRound, paused: j.core && j.core.paused,
    };
  }

  // ---------- SqueekCore ----------
  const cores = C.deployments.map((d) => ({ ...d, genesis: null, state: null, error: null, weeks: new Map() }));

  async function readCore(c) {
    try {
      if (c.genesis === null) {
        const raw = await call(c.core, SEL.configuration);
        const [cfg] = coder.decode(T_CONFIG, raw);
        c.genesis = Number(cfg[1]);
        c.roundDuration = Number(cfg[2]);
        if (c.roundDuration !== C.slotSeconds) throw new Error("unexpected roundDuration " + c.roundDuration);
      }
      const [st] = coder.decode(T_STATE, await call(c.core, SEL.state));
      c.state = {
        settledThroughRound: Number(st[0]), cumulativeWork: st[1].toString(), cumulativeBlockUnits: st[2].toString(),
        blockHeight: st[3].toString(), workPerThousandBlocks: Number(st[5]), paused: st[7],
      };
      c.frontierTime = c.genesis + c.state.settledThroughRound * C.slotSeconds;
      c.error = null;
    } catch (e) { c.error = String(e.message || e); }
    return c;
  }

  async function refreshCores() {
    await Promise.all(cores.map(readCore));
    const live = cores.filter((c) => c.state && c.state.settledThroughRound > 0 && !c.state.paused);
    live.sort((a, b) => b.frontierTime - a.frontierTime);
    const active = live[0] || null;
    return { cores, active, anyOk: cores.some((c) => c.state) };
  }

  async function roundPage(core, after, through, max) {
    const data = SEL.roundPage + coder.encode(["uint64", "uint64", "uint256"], [after, through, max]).slice(2);
    const [pg] = coder.decode(T_PAGE, await call(core, data));
    return {
      certifiedThroughRound: Number(pg[0]),
      startWork: BigInt(pg[1][0]),
      endWork: BigInt(pg[2][0]),
      rounds: pg[3].map((r) => ({ roundId: Number(r[0]), cumulativeWork: BigInt(r[1]) })),
    };
  }

  /** Certified work per round of one core within a raid week (incremental). */
  async function loadCoreWeek(c, week) {
    if (!c.state || c.genesis === null) return null;
    const firstSlot = G.weekFirstSlot(week), lastSlot = G.weekLastSlot(week);
    const rStart = Math.max(1, G.slotToCoreRound(c.genesis, firstSlot));
    const rEnd = Math.min(c.state.settledThroughRound, G.slotToCoreRound(c.genesis, lastSlot));
    if (rEnd < rStart) return null;
    let wk = c.weeks.get(week);
    if (!wk) { wk = { through: rStart - 1, prevWork: null, works: new Map() }; c.weeks.set(week, wk); }
    let guard = 0;
    while (wk.through < rEnd && guard++ < 200) {
      const pg = await roundPage(c.core, wk.through, rEnd, 16);
      let prev = pg.startWork;
      for (const r of pg.rounds) {
        wk.works.set(r.roundId, Number(r.cumulativeWork - prev));
        prev = r.cumulativeWork;
      }
      if (pg.certifiedThroughRound <= wk.through) break;
      wk.through = pg.certifiedThroughRound;
    }
    return { rStart, through: wk.through, works: wk.works };
  }

  /** Merge every known core into one wall-clock slot map for the week. */
  async function loadWeekSlots(week) {
    const slots = new Map();
    const sources = [];
    for (const c of cores) {
      let res = null;
      try { res = await loadCoreWeek(c, week); } catch (e) { c.error = String(e.message || e); }
      if (!res) continue;
      let n = 0;
      for (let r = res.rStart; r <= res.through; r++) {
        const s = G.coreRoundToSlot(c.genesis, r);
        const w = res.works.get(r) || 0;
        slots.set(s, Math.max(slots.get(s) || 0, w));
        n++;
      }
      sources.push({ id: c.id, core: c.core, rounds: n, fromRound: res.rStart, throughRound: res.through });
    }
    return { slots, sources };
  }

  // ---------- Raid Orders (Approval logs) ----------
  const blockTimeCache = new Map();
  async function blockTime(numHex) {
    if (blockTimeCache.has(numHex)) return blockTimeCache.get(numHex);
    const b = await rpc("eth_getBlockByNumber", [numHex, false]);
    const t = Number(b.timestamp);
    blockTimeCache.set(numHex, t);
    return t;
  }

  const orderStore = new Map(); // key tx:log -> order
  // Orders are immutable once mined, so cache them locally: a returning visitor keeps the
  // full-week roster even if Blockscout is rate-limiting and the RPC only has recent logs.
  const ORDER_CACHE = "sbr.orders.v1";
  try { (JSON.parse(localStorage.getItem(ORDER_CACHE) || "[]")).forEach((o) => orderStore.set(o.key, o)); } catch (_) { /* ignore */ }
  function saveOrders() {
    try { localStorage.setItem(ORDER_CACHE, JSON.stringify([...orderStore.values()].slice(-2000))); } catch (_) { /* ignore */ }
  }
  const logHealth = { blockscout: null, rpc: null, coverageFrom: null };

  function addOrder(log, ts, src) {
    const key = log.transactionHash.toLowerCase() + ":" + Number(log.logIndex);
    if (orderStore.has(key)) return;
    const owner = "0x" + log.topics[1].slice(26);
    orderStore.set(key, {
      key, player: ethers.getAddress(owner), token: log.address.toLowerCase(), value: BigInt(log.data).toString(),
      txHash: log.transactionHash, blockNumber: Number(log.blockNumber), logIndex: Number(log.logIndex), txTime: ts, src,
    });
  }

  async function loadOrders(fromTime) {
    const tokens = [...new Set(cores.map((c) => c.token.toLowerCase()))];
    const latestHex = await rpc("eth_blockNumber", []);
    const latest = Number(latestHex);
    const latestTs = await blockTime(latestHex);
    const fromBlock = Math.max(0, latest - Math.ceil((latestTs - fromTime) / 12) - 600);

    // 1) Blockscout for the whole window (keyless, CORS, filtered by the sigil in topic2).
    //    Re-scanned at most every 10 minutes; the public RPC covers the newest blocks in between.
    const bsFresh = logHealth.bsFrom !== undefined && logHealth.bsFrom <= fromTime && Date.now() - logHealth.bsAt < 600000;
    if (!bsFresh) {
      try {
        for (const tok of tokens) {
          let from = fromBlock, pages = 0;
          while (pages++ < 10) {
            const u = `${C.blockscoutApi}?module=logs&action=getLogs&fromBlock=${from}&toBlock=latest&address=${tok}` +
              `&topic0=${TOPIC_APPROVAL}&topic2=${SIGIL_TOPIC}&topic0_2_opr=and`;
            let j;
            try { j = await fetchJson(u, {}, 15000); }
            catch (e) { await new Promise((r) => setTimeout(r, 1500)); j = await fetchJson(u, {}, 15000); } // one retry (429s)
            const res = Array.isArray(j.result) ? j.result : [];
            if (j.status === "0" && j.message && !/no (records|logs)/i.test(j.message)) throw new Error(j.message);
            for (const l of res) addOrder(l, Number(l.timeStamp), "blockscout");
            if (res.length < 1000) break;
            from = Number(res[res.length - 1].blockNumber);
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        logHealth.blockscout = true; logHealth.bsFrom = fromTime; logHealth.bsAt = Date.now();
        logHealth.coverageFrom = fromTime;
      } catch (e) {
        logHealth.blockscout = false;
      }
    }

    // 2) Public RPC for the freshest blocks (and as the fallback when Blockscout is down).
    try {
      const span = logHealth.blockscout ? 2500 : C.recentLogBlocks;
      const start = Math.max(fromBlock, latest - span);
      const logs = await rpc("eth_getLogs", [{
        address: tokens, fromBlock: "0x" + start.toString(16), toBlock: latestHex,
        topics: [TOPIC_APPROVAL, null, SIGIL_TOPIC],
      }]);
      for (const l of logs) {
        const ts = l.blockTimestamp ? Number(l.blockTimestamp) : await blockTime(l.blockNumber);
        addOrder(l, ts, "rpc");
      }
      logHealth.rpc = true;
      if (!logHealth.blockscout) logHealth.coverageFrom = Math.max(fromTime, latestTs - span * 12);
    } catch (e) {
      logHealth.rpc = false;
    }
    saveOrders();
    return [...orderStore.values()];
  }

  root.SBR_CHAIN = {
    rpc, call, api, getStatus, getApiCore, refreshCores, loadWeekSlots, loadOrders, roundPage,
    cores, rpcHealth, apiHealth, logHealth, TOPIC_APPROVAL, SIGIL_TOPIC,
  };
})(window);
