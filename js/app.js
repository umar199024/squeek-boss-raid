/* Squeek Boss Raid · app (UI, loops, wallet) */
(function () {
  "use strict";
  const C = window.SBR_CONFIG, G = window.SBR_GAME, CH = window.SBR_CHAIN, ART = window.SBR_ART, DEMO = window.SBR_DEMO;
  const $ = (id) => document.getElementById(id);
  const nowS = () => Math.floor(Date.now() / 1000);
  const fmt = (n) => (n === null || n === undefined || Number.isNaN(n) ? "–" : Number(n).toLocaleString("en-US"));
  const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
  const hhmm = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const OUT = { 1: "Z", 2: "J", 3: "S" };
  const qs = new URLSearchParams(location.search);

  const S = {
    demo: qs.get("demo") === "1",
    currentWeek: G.weekOf(nowS()),
    viewWeek: G.weekOf(nowS()),
    slots: new Map(), sources: [], coresInfo: null, active: null,
    orders: [], result: null,
    status: null, statusOk: null, apiCore: null,
    lastWork: null, lastEpoch: null,
    seenSlots: new Set(), firstChainLoad: true,
    live: [], // session-only feed items (live swings, own tx)
    wallet: { eth: null, address: null, chainOk: false },
    cls: Number(localStorage.getItem("sbr.cls")) || 0,
    picks: new Map(JSON.parse(localStorage.getItem("sbr.picks") || "[]")),
    pending: null,
    anim: { t: 0, angle: 0, rpm: 0, mode: "off", flash: 0, shake: 0, bossMode: "idle" },
  };
  if (S.currentWeek < 1) S.currentWeek = S.viewWeek = 1;

  // ======================== data loops ========================
  async function refreshStatus() {
    if (S.demo) { S.status = DEMO.status(nowS()); S.statusOk = true; renderLive(); return; }
    try {
      const st = await CH.getStatus();
      // live swing: new counted work on the same counter epoch (display only, not scored)
      if (st.cumulativeWorkUnits && S.lastWork !== null && st.counterEpoch === S.lastEpoch) {
        const d = Number(BigInt(st.cumulativeWorkUnits) - BigInt(S.lastWork));
        if (d > 0 && S.viewWeek === S.currentWeek && S.result && S.result.state === "live") {
          liveHit(d, false);
          pushLive({ kind: "live", t: nowS(), text: `Live swing <b>+${fmt(d)}</b>`, sub: "counted by the WHEELY9000 · lands when SqueekCore settles the round" });
        }
      }
      if (st.cumulativeWorkUnits) { S.lastWork = st.cumulativeWorkUnits; S.lastEpoch = st.counterEpoch; }
      S.status = st; S.statusOk = true;
    } catch (e) {
      S.statusOk = false;
    }
    renderPills(); renderLive();
  }

  async function refreshChain() {
    if (S.demo) {
      S.slots = DEMO.buildSlots(S.viewWeek, nowS());
      S.orders = DEMO.buildOrders(S.viewWeek, nowS());
      S.sources = [{ id: "demo", rounds: S.slots.size }];
      recompute(); return;
    }
    const info = await CH.refreshCores();
    S.coresInfo = info; S.active = info.active;
    if (!info.anyOk && !S.statusOk) { enterDemo("Couldn't reach Sepolia or the Squeekchain API."); return; }
    const week = S.viewWeek;
    const { slots, sources } = await CH.loadWeekSlots(week);
    if (week !== S.viewWeek) return; // user switched weeks mid-load
    // new certified hits since last load
    const fresh = [];
    for (const [s, w] of slots) {
      const k = week + ":" + s;
      if (!S.seenSlots.has(k)) { S.seenSlots.add(k); if (!S.firstChainLoad && w > 0) fresh.push([s, w]); }
    }
    S.slots = slots; S.sources = sources; S.firstChainLoad = false;
    recompute();
    fresh.sort((a, b) => a[0] - b[0]).forEach(([s, w], i) => setTimeout(() => certifiedHit(w, G.outcomeOf(w) === 3), i * 900));
  }

  async function refreshOrders() {
    if (S.demo) return;
    try {
      S.orders = await CH.loadOrders(G.weekStart(S.viewWeek) - 60);
      if (S.pending && S.orders.some((o) => o.txHash.toLowerCase() === S.pending.hash.toLowerCase())) S.pending = null;
    } catch (e) { /* keep the last good roster */ }
    renderPills(); recompute();
  }

  async function refreshApiCore() {
    if (S.demo) return;
    try { S.apiCore = await CH.getApiCore(); } catch (_) { S.apiCore = null; }
    renderProof();
  }

  function recompute() {
    S.result = G.scoreWeek({ week: S.viewWeek, slots: S.slots, orders: S.orders, now: nowS() });
    renderAll();
  }

  function enterDemo(why) {
    if (S.demo) return;
    S.demo = true;
    $("demoRibbon").hidden = false;
    toast(`${esc(why)} Showing a clearly-labeled <b>demo</b> until a connection comes back. <a href="${location.pathname}">Retry</a>`);
    refreshStatus(); refreshChain();
  }

  // ======================== animation ========================
  const wheelCv = $("wheelCv"), bossCv = $("bossCv");
  function frame(ts) {
    const a = S.anim, dt = Math.min(64, ts - (a.last || ts)); a.last = ts; a.t = ts;
    const rpm = a.mode === "run" ? Math.max(20, Math.min(a.rpm || 60, 140)) : 0;
    a.angle += (rpm / 60) * Math.PI * 2 * (dt / 1000) * 0.6;
    a.flash = Math.max(0, a.flash - dt / 260);
    a.shake = Math.max(0, a.shake - dt / 380);
    const res = S.result;
    const pouch = res ? Math.min(1, res.rawDamage / res.hp) : 0;
    ART.drawWheel(wheelCv, { t: ts, angle: a.angle, mode: a.mode, pouch });
    if (res) ART.drawBoss(bossCv, res.boss, { t: ts, mode: a.bossMode, flash: a.flash, shake: a.shake });
    requestAnimationFrame(frame);
  }

  function center(el) {
    const st = $("stage").getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: r.left - st.left + r.width / 2, y: r.top - st.top + r.height * 0.45 };
  }
  const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function volley(n) {
    if (reduceMotion) return;
    const fx = $("fx"), a = center(wheelCv), b = center(bossCv);
    for (let i = 0; i < n; i++) {
      const s = document.createElement("i"); s.className = "seed"; fx.appendChild(s);
      const lift = 60 + Math.random() * 70, dx = (Math.random() - 0.5) * 30, dy = (Math.random() - 0.5) * 30;
      s.animate([
        { transform: `translate(${a.x}px, ${a.y}px) rotate(0deg)` },
        { transform: `translate(${(a.x + b.x) / 2}px, ${Math.min(a.y, b.y) - lift}px) rotate(260deg)`, offset: 0.5 },
        { transform: `translate(${b.x + dx}px, ${b.y + dy}px) rotate(540deg)` },
      ], { duration: 650 + Math.random() * 250, delay: i * 70, easing: "cubic-bezier(.3,.1,.6,1)", fill: "both" }).onfinish = () => s.remove();
    }
  }

  function popNumber(text, cls) {
    const fx = $("fx"), b = center(bossCv);
    const d = document.createElement("span"); d.className = "dmg " + (cls || ""); d.textContent = text; fx.appendChild(d);
    const x = b.x - 30 + (Math.random() - 0.5) * 60, y = b.y - 30;
    d.animate([
      { transform: `translate(${x}px, ${y}px) scale(.6)`, opacity: 0 },
      { transform: `translate(${x}px, ${y - 30}px) scale(1.15)`, opacity: 1, offset: 0.2 },
      { transform: `translate(${x}px, ${y - 80}px) scale(1)`, opacity: 0 },
    ], { duration: reduceMotion ? 900 : 1500, easing: "ease-out", fill: "both" }).onfinish = () => d.remove();
  }

  function liveHit(d) {
    volley(Math.min(4, 1 + Math.floor(d / 60)));
    setTimeout(() => { S.anim.flash = 0.6; S.anim.shake = 0.4; popNumber("+" + d, "live"); }, 600);
  }
  function certifiedHit(w, crit) {
    volley(Math.min(10, 3 + Math.floor(w / 80)));
    setTimeout(() => {
      S.anim.flash = 1; S.anim.shake = crit ? 1.2 : 0.8;
      popNumber("-" + fmt(w), crit ? "crit" : "");
      const bar = $("hpBar"); bar.classList.remove("hit"); void bar.offsetWidth; bar.classList.add("hit");
    }, 700);
  }

  // ======================== rendering ========================
  function renderAll() {
    renderArena(); renderStrip(); renderPlan(); renderOrder(); renderFeed(); renderBoard(); renderParty(); renderProof(); renderPills(); renderLive();
  }

  function renderPills() {
    const set = (el, state, title) => { el.className = "pill " + state; if (title) el.title = title; };
    if (S.demo) { ["pillApi", "pillChain", "pillLogs"].forEach((p) => set($(p), "warn", "Demo mode")); return; }
    set($("pillApi"), S.statusOk === null ? "" : S.statusOk ? (S.status && S.status.freshness === "online" ? "ok" : "warn") : "bad",
      S.statusOk === false ? "Squeekchain API unreachable from this browser: live wheel telemetry paused, settled rounds still come from Sepolia" : "Squeekchain API /v1/status");
    const chainOk = S.coresInfo && S.coresInfo.anyOk;
    set($("pillChain"), S.coresInfo === null ? "" : chainOk ? "ok" : "bad", chainOk ? "SqueekCore read via " + (CH.rpcHealth.url || "RPC") : "No Sepolia RPC reachable");
    const lh = CH.logHealth;
    set($("pillLogs"), lh.rpc === null && lh.blockscout === null ? "" : lh.blockscout ? "ok" : lh.rpc ? "warn" : "bad",
      lh.blockscout ? "Raid Orders: Blockscout + public RPC" : lh.rpc ? "Raid Orders: public RPC only (recent ~30 h)" : "Raid Orders unavailable");
  }

  function renderLive() {
    const st = S.status, res = S.result;
    let mode = "off", label = "wheel feed offline", cls = "off";
    if (S.statusOk && st) {
      const rpm = st.rpmMilli !== null ? st.rpmMilli / 1000 : null;
      if (st.coreStatus === "COUNTER_FAULT") { mode = "off"; label = "wheel counter fault"; }
      else if (st.freshness !== "online") { mode = "sleep"; label = "feed stale · probably napping"; cls = "sleep"; }
      else if (st.coreStatus === "ACTIVE" || (rpm && rpm > 0)) { mode = "run"; label = "RUNNING · attacking!"; cls = "run"; }
      else { mode = "sleep"; label = "napping · boss gloats"; cls = "sleep"; }
      S.anim.rpm = rpm || 0;
      $("statRpm").textContent = rpm !== null ? rpm.toFixed(1) + " rpm" : "–";
      $("statSpeed").textContent = st.speedMmPerSecond !== null ? (st.speedMmPerSecond * 0.0036).toFixed(2) + " km/h" : "–";
      $("statDist").textContent = st.distanceMm !== null ? (st.distanceMm / 1e6).toFixed(2) + " km" : "–";
    } else {
      // API unreachable: infer from SqueekCore's latest certified round
      let lastActive = null, lastKnown = null;
      for (const [s, w] of S.slots) { if (lastKnown === null || s > lastKnown) lastKnown = s; if (w > 0 && (lastActive === null || s > lastActive)) lastActive = s; }
      if (lastActive !== null && nowS() - G.slotStart(lastActive) < 40 * 60) { mode = "run"; label = "ran recently · SqueekCore"; cls = "run"; S.anim.rpm = 60; }
      else if (lastKnown !== null) { mode = "sleep"; label = "napping · SqueekCore"; cls = "sleep"; }
      ["statRpm", "statSpeed", "statDist"].forEach((k) => ($(k).textContent = "–"));
    }
    if (S.viewWeek !== S.currentWeek) { mode = "sleep"; label = "archived week"; cls = "sleep"; }
    S.anim.mode = mode;
    const ws = $("wheelState"); ws.textContent = label; ws.className = "wheel-state " + cls;
    // boss reaction
    if (res) {
      S.anim.bossMode = res.state === "victory" ? "dead" : res.state === "escaped" ? "idle" : mode === "run" ? "idle" : "sleep";
      $("bossTaunt").textContent = res.state === "victory" ? "Nooo… the wheel… it never stopped…" :
        res.state === "escaped" ? "Ha! See you next season, seedling." :
        mode === "run" ? "Hrk! That wheel! Stop that wheel!" : res.boss.taunt;
      // unsettled ghost
      let ghost = 0;
      if (S.viewWeek === S.currentWeek && res.state === "live" && S.statusOk && st) {
        ghost = Number(st.openRoundWorkUnits || 0) + Number(st.closedWorkUnits || 0);
      }
      ghost = Math.min(ghost, res.hpLeft);
      const left = res.hpLeft / res.hp;
      $("hpGhost").style.left = (left - ghost / res.hp) * 100 + "%";
      $("hpGhost").style.width = (ghost / res.hp) * 100 + "%";
      $("ghostNote").textContent = ghost > 0 ? `+${fmt(ghost)} unsettled` : "";
    }
  }

  function dur(sec) {
    sec = Math.max(0, sec);
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return d ? `${d}d ${h}h ${String(m).padStart(2, "0")}m` : h ? `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s` : `${m}m ${String(s).padStart(2, "0")}s`;
  }

  function renderArena() {
    const r = S.result; if (!r) return;
    const d0 = new Date(r.weekStart * 1000), d1 = new Date((r.weekEnd - 1) * 1000);
    const md = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    $("wkName").textContent = `Week ${r.week} · ${r.boss.name}`;
    $("wkDates").textContent = `${md(d0)} – ${md(d1)} UTC`;
    $("wkPrev").disabled = r.week <= 1;
    $("wkNext").disabled = r.week >= S.currentWeek;
    $("bossName").textContent = r.boss.name;
    $("bossTitle").textContent = r.boss.title.toUpperCase();
    $("hpLeft").textContent = fmt(r.hpLeft);
    $("hpMax").textContent = fmt(r.hp);
    $("dmgDone").textContent = fmt(r.damage);
    $("hpFill").style.width = (r.hpLeft / r.hp) * 100 + "%";
    $("hpBar").setAttribute("aria-valuemax", r.hp); $("hpBar").setAttribute("aria-valuenow", r.hpLeft);
    tickClocks();
    const ban = $("banner");
    if (r.state === "victory" || r.state === "escaped") {
      const mvp = r.board[0];
      ban.hidden = false; ban.className = "banner " + r.state;
      ban.innerHTML = r.state === "victory"
        ? `<h3>Victory!</h3><p>${esc(r.boss.name)} fell in the ${hhmm(G.slotStart(r.killSlot))} round · ${fmt(r.board.filter((p) => p.cleared).length)} raiders cleared it${mvp ? ` · MVP ${short(mvp.addr)}` : ""}</p>`
        : `<h3>The boss escaped</h3><p>${fmt(r.damage)} / ${fmt(r.hp)} HP dealt · ${esc(r.boss.name)} slipped away${mvp ? ` · top raider ${short(mvp.addr)}` : ""}</p>`;
      if (S.viewWeek !== S.currentWeek) ban.innerHTML += `<button class="btn btn-sm" type="button" id="bannerNow">Back to this week</button>`;
      const bn = $("bannerNow"); if (bn) bn.onclick = () => gotoWeek(S.currentWeek);
    } else ban.hidden = true;
  }

  function tickClocks() {
    const r = S.result; if (!r) return;
    const t = nowS();
    if (r.state === "victory") { $("wkClockLabel").textContent = "Defeated"; $("wkClock").textContent = new Date(G.slotStart(r.killSlot) * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }); }
    else if (t >= r.weekEnd) { $("wkClockLabel").textContent = r.state === "closing" ? "Settling last rounds" : "Week over"; $("wkClock").textContent = r.state === "closing" ? "…" : "ended"; }
    else { $("wkClockLabel").textContent = "Boss escapes in"; $("wkClock").textContent = dur(r.weekEnd - t); }
    const cur = G.slotOf(t), left = G.slotStart(cur + 1) - t;
    $("roundClock").textContent = `round closes in ${dur(left)} · settlement lag ~${settleLag()}`;
  }
  function settleLag() {
    const r = S.result; if (!r || r.knownThrough === null) return "–";
    const lag = nowS() - G.slotStart(r.knownThrough + 1);
    return lag < 0 ? "0m" : dur(lag).replace(/ \d+s$/, "");
  }

  function renderStrip() {
    const r = S.result; if (!r) return;
    const cur = G.slotOf(nowS());
    const viewingNow = S.viewWeek === S.currentWeek;
    const endSlot = viewingNow ? cur + 2 : (r.knownThrough !== null ? r.knownThrough : G.weekLastSlot(S.viewWeek));
    const mine = myPlayer();
    const out = [];
    for (let s = endSlot - 19; s <= endSlot; s++) {
      const res = G.slotResult(S.slots, s);
      let cls = "chip", ic = "?", w = "", title;
      const t0 = G.slotStart(s);
      if (res) { cls += " k" + res.out; ic = OUT[res.out]; w = fmt(res.work); title = `${hhmm(t0)} round · ${res.work} work · certified on SqueekCore`; }
      else if (viewingNow && s === cur) { cls += " now"; ic = "▶"; w = "live"; title = "This round is running now"; }
      else if (viewingNow && s > cur) { cls += " fut"; ic = "·"; w = ""; title = "Upcoming round"; }
      else { cls += " pend"; ic = "…"; w = ""; title = "Waiting for SqueekCore settlement"; }
      if (mine && mine.picks.has(s)) { cls += " mine"; title += ` · your call: ${C.outcomes[mine.picks.get(s) - 1].name}`; }
      out.push(`<div class="${cls}" title="${esc(title)}"><span class="ic">${ic}</span><span class="w">${w || "&nbsp;"}</span><span class="tm">${hhmm(t0)}</span></div>`);
    }
    $("strip").innerHTML = out.join("");
  }

  function myPlayer() {
    const a = S.wallet.address; if (!a || !S.result) return null;
    return S.result.board.find((p) => p.addr === a.toLowerCase()) || null;
  }

  // ---------- class picker ----------
  function buildClasses() {
    $("classes").innerHTML = C.classes.map((c) => `
      <button class="cls" type="button" role="radio" aria-checked="false" data-cls="${c.id}">
        <span class="badge" style="background:${c.color}">${C.iconSvg(c.key, 22)}</span>
        <b>${esc(c.name)}</b><small>${esc(c.blurb)}</small>
      </button>`).join("");
    $("classes").addEventListener("click", (e) => {
      const b = e.target.closest(".cls"); if (!b || b.disabled) return;
      S.cls = Number(b.dataset.cls); localStorage.setItem("sbr.cls", S.cls);
      renderPlan(); renderOrder();
    });
    $("classRules").innerHTML = C.classes.map((c) => `<b>${esc(c.name)}</b>: ${esc(c.blurb)}`).join(" ");
  }

  function planStart() {
    const t = nowS(), cur = G.slotOf(t);
    // leave room for the tx to land: the next round only if it starts in > 2.5 min
    return G.slotStart(cur + 1) - t > 150 ? cur + 1 : cur + 2;
  }

  function renderPlan() {
    const mine = myPlayer();
    const locked = mine ? mine.classId : 0;
    document.querySelectorAll(".cls").forEach((b) => {
      const id = Number(b.dataset.cls);
      const on = locked ? id === locked : id === S.cls;
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.disabled = !!locked && id !== locked;
    });
    $("myStatus").textContent = mine ? `enlisted as ${C.classes[mine.classId - 1].name} · class locked this week` : S.wallet.address ? "not enlisted this week" : "connect a wallet to enlist";
    const st = planStart(), lastSlot = G.weekLastSlot(G.weekOf(G.slotStart(st)));
    $("planWindow").textContent = `${hhmm(G.slotStart(st))} – ${hhmm(G.slotStart(st + 16))}`;
    const out = [];
    for (let i = 0; i < 16; i++) {
      const s = st + i, p = S.picks.get(s) || 0, onChain = mine && mine.picks.get(s);
      const dis = s > lastSlot || S.viewWeek !== S.currentWeek;
      out.push(`<button type="button" class="slot p${p}${onChain ? " chain" : ""}" data-slot="${s}" ${dis ? "disabled" : ""}
        title="${hhmm(G.slotStart(s))} round${onChain ? " · on-chain call: " + C.outcomes[onChain - 1].name : ""}">
        <span class="ic">${p ? OUT[p] : "–"}</span><span class="tm">${hhmm(G.slotStart(s))}</span></button>`);
    }
    $("plan").innerHTML = out.join("");
  }

  function savePicks() {
    const min = G.slotOf(nowS());
    for (const k of [...S.picks.keys()]) if (k < min) S.picks.delete(k);
    localStorage.setItem("sbr.picks", JSON.stringify([...S.picks.entries()]));
  }

  function orderValue() {
    const st = planStart(), last = G.weekLastSlot(G.weekOf(G.slotStart(st)));
    const picks = Array.from({ length: 16 }, (_, i) => (st + i <= last ? S.picks.get(st + i) || 0 : 0));
    const mine = myPlayer();
    const cls = mine ? mine.classId : S.cls;
    if (!cls) return null;
    return { value: G.encodeOrder(cls, st, picks), cls, st, picks };
  }

  function renderOrder() {
    const btn = $("orderBtn"), ov = orderValue();
    if (ov) {
      const s = ov.value.toString();
      $("orderCode").innerHTML = `<i>${s[0]}</i>${s[1]}<i>${s.slice(2, 8)}</i>${s.slice(8)}`;
      $("orderCode").title = `magic 8 · class ${ov.cls} · start slot ${ov.st} · ${ov.picks.filter(Boolean).length} calls (base 4)`;
    } else $("orderCode").textContent = "pick a class first";
    const w = S.wallet;
    let label, dis = false;
    if (S.demo) { label = "Demo mode · no transactions"; dis = true; }
    else if (S.viewWeek !== S.currentWeek) label = "Back to this week's raid";
    else if (!getEth()) label = "No wallet found";
    else if (!w.address) label = "Connect wallet to enlist";
    else if (!w.chainOk) label = "Switch to Sepolia";
    else if (!ov) { label = "Pick a class"; dis = true; }
    else if (!S.active) { label = "No live SqueekCore found"; dis = true; }
    else if (S.pending) { label = "Raid Order pending…"; dis = true; }
    else label = myPlayer() ? "Update battle plan" : "Enlist & sign Raid Order";
    btn.textContent = label; btn.disabled = dis;
  }

  // ---------- feed ----------
  function pushLive(item) { S.live.unshift(item); S.live = S.live.slice(0, 20); renderFeed(); }

  function renderFeed() {
    const r = S.result; if (!r) return;
    const items = [];
    for (const f of r.feed) {
      items.push({ t: f.t, html: `<span class="o o${f.out}">${OUT[f.out]}</span><div><b>-${fmt(f.work)}</b> ${f.out === 3 ? "SMASH" : "jab"} on ${esc(r.boss.name)}<small>${hhmm(f.t)} round · certified on SqueekCore · ${fmt(f.hpAfter)} HP left</small></div>`,
        cls: r.killSlot === f.slot ? "kill" : "" });
    }
    const seen = new Set();
    for (const o of S.orders) {
      const d = G.decodeOrder(o.value); if (!d || G.weekOf(G.slotStart(d.startSlot)) !== r.week) continue;
      const first = !seen.has(o.player.toLowerCase()); seen.add(o.player.toLowerCase());
      const n = d.picks.filter(Boolean).length;
      items.push({ t: o.txTime, cls: "sys", html: `<span class="cicon" style="background:${C.classes[d.classId - 1].color}">${C.iconSvg(C.classes[d.classId - 1].key, 16)}</span><div>${short(o.player)} ${first ? "joined the raid" : "updated the plan"}<small>${n} round call${n === 1 ? "" : "s"} · <a href="${C.explorer}/tx/${o.txHash}" target="_blank" rel="noopener">tx ↗</a></small></div>` });
    }
    if (S.viewWeek === S.currentWeek) for (const l of S.live) items.push({ t: l.t, cls: l.kind, html: `<span class="o ${l.kind === "live" ? "o2" : "o1"}">${l.kind === "live" ? "+" : "!"}</span><div>${l.text}<small>${l.sub || ""}</small></div>` });
    items.sort((a, b) => b.t - a.t);
    const list = items.slice(0, 60);
    $("feed").innerHTML = list.length ? list.map((i) => `<li class="${i.cls || ""}">${i.html}<span class="t">${new Date(i.t * 1000).toLocaleDateString([], { weekday: "short" })}<br>${hhmm(i.t)}</span></li>`).join("")
      : `<li class="sys"><span class="o o1">Z</span><div>Quiet so far.<small>Hits appear here as SqueekCore certifies Squeektoshi's rounds.</small></div><span class="t"></span></li>`;
    $("feedCount").textContent = `${fmt(r.activeCount)} hits · ${fmt(r.knownCount)} rounds certified`;
  }

  function classOf(id) { return C.classes[id - 1]; }

  function renderBoard() {
    const r = S.result; if (!r) return;
    const me = S.wallet.address ? S.wallet.address.toLowerCase() : null;
    $("board").innerHTML = r.board.map((p, i) => {
      const c = classOf(p.classId);
      const tags = (p.lastHit ? '<span class="tag" title="Correct call on the killing round">LAST HIT</span>' : "") + (p.cleared ? '<span class="tag" title="Enlisted before the boss fell">CLEAR</span>' : "");
      return `<tr class="${p.addr === me ? "me" : ""}"><td>${i + 1}</td>
        <td><span class="who"><span class="cicon" style="background:${c.color}" title="${esc(c.name)}">${C.iconSvg(c.key, 14)}</span><a href="${C.explorer}/address/${p.addr}" target="_blank" rel="noopener">${short(p.addr)}</a>${p.addr === me ? " (you)" : ""}${tags}</span></td>
        <td class="pts" title="assists ${p.assist} · calls ${p.callPts} · bonus ${p.bonus}">${fmt(p.points)}</td>
        <td>${p.correct}/${p.calls}</td><td>${p.bestStreak}</td></tr>`;
    }).join("");
    $("boardEmpty").hidden = r.board.length > 0;
    $("boardMeta").textContent = r.board.length ? `${r.board.length} raider${r.board.length === 1 ? "" : "s"} · ${r.orderCount} orders` : "";
  }

  function renderParty() {
    const r = S.result; if (!r) return;
    const counts = C.classes.map((c) => `<span>${r.board.filter((p) => p.classId === c.id).length} ${esc(c.name)}</span>`);
    const pend = S.pending && S.viewWeek === S.currentWeek ? `<div class="who"><span class="cicon" style="background:#eee">…</span><div><a href="${C.explorer}/tx/${S.pending.hash}" target="_blank" rel="noopener">${short(S.wallet.address)}</a><small>Raid Order pending…</small></div></div>` : "";
    $("party").innerHTML = `<div class="party-sum">${counts.join("")}</div>` + pend + [...r.board].sort((a, b) => a.enlistTime - b.enlistTime).map((p) => {
      const c = classOf(p.classId);
      return `<div class="who"><span class="cicon" style="background:${c.color}" title="${esc(c.name)}">${C.iconSvg(c.key, 18)}</span><div><a href="${C.explorer}/tx/${p.enlistTx}" target="_blank" rel="noopener" title="${p.addr}">${short(p.addr)}</a><small>${esc(c.name)} · joined ${new Date(p.enlistTime * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</small></div></div>`;
    }).join("");
    $("rosterMeta").textContent = r.board.length ? `${r.board.length} enlisted` : "empty";
    if (!r.board.length && !pend) $("party").innerHTML += `<p class="empty">Nobody has enlisted for week ${r.week} yet. Squeektoshi is fighting alone.</p>`;
  }

  function renderProof() {
    if (S.demo) { $("proof").innerHTML = `<p><b>Demo mode.</b> Neither the Squeekchain API nor a Sepolia RPC answered, so everything above is simulated and labeled. Reload to retry.</p>`; return; }
    const r = S.result, ci = S.coresInfo;
    const deps = (ci ? ci.cores : CH.cores).map((c) => {
      const st = c.state, active = S.active && S.active.core === c.core;
      const src = S.sources.find((x) => x.core === c.core);
      return `<div class="dep ${active ? "active" : ""}"><h4>${esc(c.id)}${active ? ' · <span style="color:#1f8a5f">raid token</span>' : ""}</h4><dl>
        <dt>SqueekCore</dt><dd><a href="${C.explorer}/address/${c.core}" target="_blank" rel="noopener">${c.core}</a></dd>
        <dt>SQK</dt><dd><a href="${C.explorer}/address/${c.token}" target="_blank" rel="noopener">${c.token}</a></dd>
        <dt>State</dt><dd>${st ? `settled through round ${fmt(st.settledThroughRound)} (${new Date(c.frontierTime * 1000).toUTCString().replace(" GMT", " UTC")}) · ${fmt(st.cumulativeWork)} work · height ${fmt(st.blockHeight)}${st.paused ? " · paused" : ""}` : esc(c.error || "not read yet")}</dd>
        <dt>This week</dt><dd>${src ? `${fmt(src.rounds)} certified rounds (core rounds ${src.fromRound}–${src.throughRound})` : "no rounds in this week"}</dd>
      </dl></div>`;
    }).join("");
    const api = S.apiCore && S.apiCore.status === "available"
      ? `API indexes <code>${esc(S.apiCore.installationId)}</code> (core ${short(S.apiCore.core)})` : "API /v1/core unavailable from this browser";
    const lh = CH.logHealth;
    $("proof").innerHTML = `
      <p>Damage is the sum of certified wheel work from <code>SqueekCore.roundPage()</code> for every 10-minute round in this week, merged across known deployments by wall-clock round (max, never summed twice). Re-run it yourself and you'll get <b>${r ? fmt(r.damage) : "–"}</b>.</p>
      ${deps}
      <dl>
        <dt>Raid sigil</dt><dd><a href="${C.explorer}/address/${C.sigil}" target="_blank" rel="noopener">${C.sigil}</a> · keccak256("squeek-boss-raid:sigil:v1"), no key exists</dd>
        <dt>Orders</dt><dd>SQK <code>Approval(owner, sigil, value)</code> logs via ${lh.blockscout ? "Blockscout + public RPC" : lh.rpc ? "public RPC (recent blocks only)" : "–"}</dd>
        <dt>Live feed</dt><dd>${S.statusOk ? "api.squeekchain.com/v1/status" : "unreachable · display falls back to SqueekCore"} · ${api}</dd>
        <dt>RPC</dt><dd>${esc(CH.rpcHealth.url || "–")}</dd>
      </dl>`;
  }

  // ======================== wallet ========================
  let eip6963 = null;
  window.addEventListener("eip6963:announceProvider", (e) => { if (!eip6963) eip6963 = e.detail && e.detail.provider; });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  function getEth() { return window.ethereum || eip6963 || null; }

  async function syncWallet() {
    const eth = getEth(); S.wallet.eth = eth;
    const btn = $("walletBtn");
    if (!eth) { btn.textContent = "No wallet"; btn.className = "btn btn-wallet"; renderOrder(); return; }
    try {
      const [accs, cid] = await Promise.all([eth.request({ method: "eth_accounts" }), eth.request({ method: "eth_chainId" })]);
      S.wallet.address = accs && accs[0] ? window.ethers.getAddress(accs[0]) : null;
      S.wallet.chainOk = String(cid).toLowerCase() === C.chainIdHex;
    } catch (_) { /* ignore */ }
    if (!S.wallet.address) { btn.textContent = "Connect wallet"; btn.className = "btn btn-wallet"; }
    else if (!S.wallet.chainOk) { btn.textContent = "Wrong network"; btn.className = "btn btn-wallet wrong"; }
    else { btn.textContent = short(S.wallet.address); btn.className = "btn btn-wallet connected"; }
    renderPlan(); renderOrder(); renderBoard(); renderStrip();
  }

  async function connect() {
    const eth = getEth();
    if (!eth) { toast(`No browser wallet found. Install <a href="https://metamask.io/download/" target="_blank" rel="noopener">MetaMask</a> (or open this page in your wallet's browser), add some Sepolia test ETH, and come back. Watching works without a wallet.`); return false; }
    try { await eth.request({ method: "eth_requestAccounts" }); } catch (e) { toast("Wallet connection was cancelled."); return false; }
    await syncWallet();
    if (!S.wallet.chainOk) return switchNet();
    return true;
  }

  async function switchNet() {
    const eth = getEth(); if (!eth) return false;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: C.chainIdHex }] });
    } catch (e) {
      if (e && (e.code === 4902 || (e.data && e.data.originalError && e.data.originalError.code === 4902))) {
        try {
          await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: C.chainIdHex, chainName: "Sepolia", nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 }, rpcUrls: [C.rpcs[0]], blockExplorerUrls: [C.explorer] }] });
        } catch (_) { toast("Couldn't add Sepolia to your wallet."); return false; }
      } else { toast("Please switch your wallet to the Sepolia test network."); return false; }
    }
    await syncWallet();
    return S.wallet.chainOk;
  }

  async function sendOrder() {
    if (S.viewWeek !== S.currentWeek) { gotoWeek(S.currentWeek); return; }
    if (!S.wallet.address) { if (!(await connect())) return; }
    if (!S.wallet.chainOk) { if (!(await switchNet())) return; }
    const ov = orderValue(); if (!ov || !S.active) return;
    const ts = $("txStatus"); ts.className = "tx-status"; ts.textContent = "Confirm the Raid Order in your wallet…";
    try {
      const provider = new window.ethers.BrowserProvider(getEth());
      const signer = await provider.getSigner();
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== C.chainId) throw new Error("Wallet is not on Sepolia");
      const token = new window.ethers.Contract(S.active.token, ["function approve(address spender, uint256 value) returns (bool)"], signer);
      const tx = await token.approve(C.sigil, ov.value, { gasLimit: 160000n });
      S.pending = { hash: tx.hash, at: nowS() };
      ts.innerHTML = `Sent · <a href="${C.explorer}/tx/${tx.hash}" target="_blank" rel="noopener">view on Etherscan ↗</a> · waiting for a block…`;
      pushLive({ kind: "sys", t: nowS(), text: "Your Raid Order is on its way", sub: `<a href="${C.explorer}/tx/${tx.hash}" target="_blank" rel="noopener">${short(tx.hash)} ↗</a>` });
      renderOrder(); renderParty();
      const rc = await tx.wait(1);
      ts.className = "tx-status ok";
      ts.innerHTML = `Raid Order confirmed in block ${fmt(rc.blockNumber)} · <a href="${C.explorer}/tx/${tx.hash}" target="_blank" rel="noopener">tx ↗</a>`;
      setTimeout(refreshOrders, 1500); setTimeout(refreshOrders, 15000);
      setTimeout(() => { if (S.pending && S.pending.hash === tx.hash) { S.pending = null; renderOrder(); renderParty(); } }, 120000);
    } catch (e) {
      S.pending = null;
      ts.className = "tx-status err";
      const inner = e && (e.error || (e.info && e.info.error) || (e.info && e.info.payload && null));
      const innerMsg = inner && (inner.message || (inner.data && inner.data.message)) || "";
      const msg = ((e && (e.shortMessage || e.reason || e.message)) || String(e)) + (innerMsg ? " (" + innerMsg + ")" : "");
      ts.textContent = /rejected|denied|ACTION_REJECTED/i.test(msg) ? "You cancelled the transaction. Nothing was sent." :
        /insufficient funds|exceeds balance|gas required exceeds|could not coalesce/i.test(msg) ? "Your wallet couldn't send this on Sepolia, usually because it has no Sepolia test ETH for gas. Grab a little from a Sepolia faucet, check the wallet is on Sepolia, and try again." : "Couldn't send: " + msg.slice(0, 160);
      renderOrder(); renderParty();
    }
  }

  // ======================== misc ========================
  let toastTimer;
  function toast(html) {
    let t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.innerHTML = html; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 9000);
  }

  function gotoWeek(w) {
    w = Math.max(1, Math.min(S.currentWeek, w));
    if (w === S.viewWeek) return;
    S.viewWeek = w; S.slots = new Map(); S.firstChainLoad = true;
    recompute();
    refreshChain().catch(console.error);
    refreshOrders().catch(console.error);
  }

  function bind() {
    $("walletBtn").addEventListener("click", async () => {
      if (!S.wallet.address) connect(); else if (!S.wallet.chainOk) switchNet();
      else window.open(`${C.explorer}/address/${S.wallet.address}`, "_blank", "noopener");
    });
    $("orderBtn").addEventListener("click", () => {
      if (!getEth() && !S.demo) { connect(); return; }
      sendOrder();
    });
    $("wkPrev").addEventListener("click", () => gotoWeek(S.viewWeek - 1));
    $("wkNext").addEventListener("click", () => gotoWeek(S.viewWeek + 1));
    $("plan").addEventListener("click", (e) => {
      const b = e.target.closest(".slot"); if (!b || b.disabled) return;
      const s = Number(b.dataset.slot), p = ((S.picks.get(s) || 0) + 1) % 4;
      if (p) S.picks.set(s, p); else S.picks.delete(s);
      savePicks(); renderPlan(); renderOrder();
    });
    document.querySelector(".plan-tools").addEventListener("click", (e) => {
      const b = e.target.closest("[data-fill]"); if (!b) return;
      const st = planStart(), last = G.weekLastSlot(G.weekOf(G.slotStart(st))), f = b.dataset.fill;
      for (let i = 0; i < 16; i++) {
        const s = st + i; if (s > last) continue;
        let p = 0;
        if (f === "pattern") { const h = new Date(G.slotStart(s) * 1000).getUTCHours(); p = h >= 21 || h < 2 ? (i % 3 === 0 ? 3 : 2) : 1; }
        else p = Number(f);
        if (p) S.picks.set(s, p); else S.picks.delete(s);
      }
      savePicks(); renderPlan(); renderOrder();
    });
    const eth = getEth();
    if (eth && eth.on) {
      eth.on("accountsChanged", syncWallet);
      eth.on("chainChanged", syncWallet);
    }
  }

  // ======================== boot ========================
  async function boot() {
    if (S.demo) $("demoRibbon").hidden = false;
    buildClasses(); bind();
    recompute();
    requestAnimationFrame(frame);
    setTimeout(syncWallet, 300);
    await refreshStatus();
    await Promise.allSettled([refreshChain(), refreshOrders(), refreshApiCore()]);
    setInterval(refreshStatus, C.pollStatusMs);
    setInterval(() => refreshChain().catch(console.error), C.pollChainMs);
    setInterval(() => refreshOrders().catch(console.error), C.pollRosterMs);
    let lastSlot = G.slotOf(nowS());
    setInterval(() => {
      tickClocks();
      const s = G.slotOf(nowS());
      if (s !== lastSlot) {
        lastSlot = s;
        const w = G.weekOf(nowS());
        if (w !== S.currentWeek) { const follow = S.viewWeek === S.currentWeek; S.currentWeek = w; if (follow) gotoWeek(w); }
        renderStrip(); renderPlan(); renderOrder();
      }
    }, 1000);
  }
  boot().catch((e) => { console.error(e); enterDemo("Something went wrong loading the raid."); });
})();
