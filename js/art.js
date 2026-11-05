/* Squeek Boss Raid · pixel art
 * Everything is drawn in code on tiny canvases (no image assets), then thresholded to
 * hard pixels and outlined, and scaled up with image-rendering: pixelated.
 */
(function (root) {
  "use strict";
  const TAU = Math.PI * 2;
  const INK = "#2a1630";

  function mk(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }

  // Hard-edge alpha so arcs read as pixels, then add a 1px ink outline.
  function crisp(src, outline = INK) {
    const w = src.width, h = src.height;
    const sx = src.getContext("2d");
    const img = sx.getImageData(0, 0, w, h), d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 110 ? 255 : 0;
    sx.putImageData(img, 0, 0);
    const out = mk(w, h), o = out.getContext("2d");
    if (outline) {
      const sil = mk(w, h), s = sil.getContext("2d");
      s.drawImage(src, 0, 0);
      s.globalCompositeOperation = "source-in"; s.fillStyle = outline; s.fillRect(0, 0, w, h);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) o.drawImage(sil, dx, dy);
    }
    o.drawImage(src, 0, 0);
    return out;
  }

  const P = {
    e(ctx, x, y, rx, ry, col, rot = 0) { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); ctx.fill(); },
    c(ctx, x, y, r, col) { P.e(ctx, x, y, r, r, col); },
    r(ctx, x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); },
    poly(ctx, pts, col) { ctx.fillStyle = col; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); },
    line(ctx, x1, y1, x2, y2, col, w = 1) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); },
    ring(ctx, x, y, r, w, col) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); },
  };

  // ---------------- Squeektoshi on the WHEELY9000 ----------------
  function drawWheel(canvas, st) {
    const W = canvas.width, H = canvas.height, ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = 50, R = 40;
    // stand (behind)
    const back = mk(W, H), b = back.getContext("2d");
    P.poly(b, [[cx - 4, cy], [cx + 4, cy], [cx + 26, H - 10], [cx + 18, H - 10]], "#b8743f");
    P.poly(b, [[cx - 4, cy], [cx + 4, cy], [cx - 18, H - 10], [cx - 26, H - 10]], "#c98550");
    P.r(b, cx - 36, H - 12, 72, 6, "#8f5a32");
    ctx.drawImage(crisp(back), 0, 0);

    // wheel
    const wl = mk(W, H), w = wl.getContext("2d");
    P.c(w, cx, cy, R - 2, "rgba(255,255,255,0.0)");
    w.save(); w.translate(cx, cy); w.rotate(st.angle);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      P.line(w, 0, 0, Math.cos(a) * (R - 3), Math.sin(a) * (R - 3), "#8aa0b8", 1.6);
    }
    w.restore();
    P.ring(w, cx, cy, R, 5, "#d7e2ee");
    P.ring(w, cx, cy, R - 4, 1.4, "#9fb2c6");
    // rungs
    for (let i = 0; i < 24; i++) {
      const a = st.angle + (i / 24) * TAU;
      P.c(w, cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6), 1.1, "#b9c8d8");
    }
    P.c(w, cx, cy, 4, "#ffcc4d");
    ctx.drawImage(crisp(wl), 0, 0);

    // hamster
    const hm = mk(W, H), h = hm.getContext("2d");
    const running = st.mode === "run";
    const bob = running ? Math.round(Math.sin(st.t * 0.03) * 1.2) : 0;
    const hx = cx, hy = cy + R - 15 + bob;
    if (st.mode === "sleep" || st.mode === "off") {
      // curled up, asleep at the bottom of the wheel
      P.e(h, hx, hy + 4, 15, 9, "#f2b45a");
      P.e(h, hx + 3, hy + 7, 10, 5, "#fff1d8");
      P.c(h, hx - 11, hy + 1, 6.5, "#f2b45a");
      P.c(h, hx - 13, hy - 5, 3, "#f7a7a7");
      P.r(h, hx - 15, hy + 1, 3, 1, INK); // closed eye
      P.c(h, hx - 17, hy + 3, 1.3, "#ff7d9b");
    } else {
      const leg = running ? Math.sin(st.t * 0.045) : 0;
      // legs
      P.r(h, hx - 9 + leg * 3, hy + 9, 3, 4, "#e59b8f");
      P.r(h, hx + 6 - leg * 3, hy + 9, 3, 4, "#e59b8f");
      // body, leaning forward when running
      P.e(h, hx, hy + 2, 15, 10, "#f2b45a", running ? -0.12 : 0);
      P.e(h, hx - 2, hy + 5, 10, 6, "#fff1d8");
      // head
      P.c(h, hx - 13, hy - 2, 7.5, "#f2b45a");
      P.c(h, hx - 15, hy + 1, 4.5, "#fff1d8");
      P.c(h, hx - 9, hy - 9, 3, "#f7a7a7");
      P.c(h, hx - 15, hy - 3, 1.6, INK);
      P.c(h, hx - 21, hy - 0, 1.4, "#ff7d9b");
      // cheek pouch fills with seeds as the raid goes on
      if (st.pouch > 0.3) P.c(h, hx - 12, hy + 2, 2 + st.pouch * 2, "#ffc98a");
    }
    ctx.drawImage(crisp(hm), 0, 0);

    // zZz
    if (st.mode === "sleep") {
      ctx.fillStyle = "#fff";
      ctx.font = "8px 'Press Start 2P', monospace";
      const k = (st.t / 900) % 1;
      ctx.globalAlpha = 1 - k;
      ctx.fillText("z", cx + 2 + k * 6, cy + 12 - k * 14);
      ctx.globalAlpha = Math.max(0, 1 - ((k + 0.5) % 1));
      ctx.fillText("Z", cx + 8 + ((k + 0.5) % 1) * 6, cy + 4 - ((k + 0.5) % 1) * 14);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------- Bosses ----------------
  const BOSS = {
    cat(b, t, m, col) {
      const sw = Math.sin(t * 0.004) * 6;
      P.poly(b, [[70, 70], [78 + sw, 40], [84 + sw, 42], [76, 74]], col[1]); // tail
      P.e(b, 48, 70, 28, 18, col[0]);
      P.e(b, 48, 76, 16, 10, col[2]);
      P.poly(b, [[24, 34], [28, 10], [42, 26]], col[0]);
      P.poly(b, [[72, 34], [68, 10], [54, 26]], col[0]);
      P.poly(b, [[28, 30], [30, 16], [38, 26]], "#ff9fb0");
      P.poly(b, [[68, 30], [66, 16], [58, 26]], "#ff9fb0");
      P.e(b, 48, 40, 27, 22, col[0]);
      for (let i = -1; i <= 1; i++) P.r(b, 46 + i * 7, 19, 3, 7, col[1]);
      const eye = m === "sleep" ? 1 : 6;
      P.e(b, 37, 38, 6, eye, "#b6ff6a"); P.e(b, 59, 38, 6, eye, "#b6ff6a");
      if (m !== "sleep") { P.r(b, 36, 33, 2, 10, INK); P.r(b, 58, 33, 2, 10, INK); }
      P.poly(b, [[29, 30], [44, 34], [43, 31]], INK); P.poly(b, [[67, 30], [52, 34], [53, 31]], INK);
      P.poly(b, [[45, 47], [51, 47], [48, 51]], "#ff7d9b");
      P.r(b, 43, 54, 10, 2, INK); P.r(b, 44, 56, 2, 2, "#fff"); P.r(b, 50, 56, 2, 2, "#fff");
      for (const y of [48, 52]) { P.line(b, 30, y, 14, y - 2, "#fff", 1); P.line(b, 66, y, 82, y - 2, "#fff", 1); }
    },
    vacuum(b, t, m, col) {
      const v = m === "sleep" ? 0 : Math.sin(t * 0.05) * 1.2;
      P.r(b, 26, 74, 46, 10, "#3d3550");
      P.c(b, 32, 85, 5, INK); P.c(b, 66, 85, 5, INK);
      P.r(b, 30 + v, 30, 38, 46, col[0]);
      P.r(b, 34 + v, 36, 30, 26, col[2]);
      P.r(b, 46 + v, 8, 6, 24, "#9b93c9");
      P.r(b, 40 + v, 6, 18, 6, col[1]);
      // hose arm
      const ha = Math.sin(t * 0.003) * 0.4;
      for (let i = 0; i < 10; i++) P.c(b, 73 + i * 1.3 + Math.sin(i * 0.6 + ha * 3) * 2.2, 70 - i * 3.6, 3.2, i % 2 ? col[1] : "#5d51b8");
      P.r(b, 82 + Math.sin(5.4 + ha * 3) * 2.2, 26, 7, 5, "#3d3550");
      // face
      const glow = m === "sleep" ? "#6b6490" : "#fff36a";
      P.c(b, 42 + v, 46, 6, glow); P.c(b, 57 + v, 46, 6, glow);
      if (m !== "sleep") { P.c(b, 43 + v, 47, 2, "#d23a3a"); P.c(b, 58 + v, 47, 2, "#d23a3a"); }
      P.r(b, 38 + v, 56, 23, 4, INK);
      for (let i = 0; i < 5; i++) P.poly(b, [[39 + v + i * 4.5, 56], [43 + v + i * 4.5, 56], [41 + v + i * 4.5, 59]], "#fff");
      P.poly(b, [[34, 38], [46, 42], [46, 40]], INK); P.poly(b, [[64, 38], [52, 42], [52, 40]], INK);
    },
    vet(b, t, m, col) {
      const sway = Math.sin(t * 0.003) * 2;
      P.poly(b, [[24, 90], [30, 46], [66, 46], [72, 90]], col[0]); // coat
      P.r(b, 46, 46, 4, 44, col[1]);
      P.poly(b, [[38, 46], [48, 60], [58, 46]], "#5ad1c5");
      P.c(b, 48, 30, 16, "#ffd7b5");
      P.e(b, 48, 17, 17, 7, "#5b4636");
      P.c(b, 48, 13, 6, "#d7e4ee"); P.c(b, 48, 13, 3, "#ffffff");
      P.ring(b, 41, 31, 4.5, 1.6, INK); P.ring(b, 55, 31, 4.5, 1.6, INK); P.r(b, 45, 30, 6, 1, INK);
      const eye = m === "sleep" ? 0.8 : 2;
      P.e(b, 41, 31, 2, eye, INK); P.e(b, 55, 31, 2, eye, INK);
      P.r(b, 43, 40, 10, 2, "#b0533a");
      // syringe
      b.save(); b.translate(76 + sway, 52); b.rotate(-0.6 + sway * 0.05);
      P.r(b, -4, -20, 8, 26, "#e9f6ff"); P.r(b, -3, -14, 6, 14, "#7ff0c8"); P.r(b, -6, -24, 12, 4, "#9bb4c6");
      P.r(b, -1, 6, 2, 12, "#c9d6e2");
      b.restore();
      P.c(b, 72 + sway, 60, 6, "#ffd7b5");
    },
    bath(b, t, m, col) {
      for (let i = 0; i < 4; i++) {
        const k = ((t * 0.0006 + i * 0.27) % 1);
        P.c(b, 26 + i * 15 + Math.sin(t * 0.004 + i) * 3, 52 - k * 44, 3 + i % 2 * 2, "rgba(214,242,255,0.95)");
      }
      for (const [x, d] of [[18, 1], [78, -1]]) {
        const s = Math.sin(t * 0.004 + x) * 4;
        for (let i = 0; i < 7; i++) P.c(b, x + d * (i * 1.2) + Math.sin(i * 0.8 + t * 0.004) * 3, 58 - i * 5 + s * (i / 7), 5 - i * 0.5, "#e86fb0");
      }
      P.e(b, 48, 62, 38, 10, col[2]);
      P.poly(b, [[10, 62], [86, 62], [80, 84], [16, 84]], col[0]);
      P.r(b, 12, 62, 72, 4, col[1]);
      P.r(b, 20, 84, 6, 6, "#c8a24a"); P.r(b, 70, 84, 6, 6, "#c8a24a");
      const eye = m === "sleep" ? 1 : 5;
      P.e(b, 38, 56, 5, eye, "#fff"); P.e(b, 58, 56, 5, eye, "#fff");
      if (m !== "sleep") { P.c(b, 39, 57, 2, INK); P.c(b, 59, 57, 2, INK); }
      P.c(b, 48, 50, 4, "#ffdf3d"); P.poly(b, [[51, 50], [56, 51], [51, 52]], "#ff8a2a");
    },
    bowl(b, t, m, col) {
      const j = m === "sleep" ? 0 : Math.round(Math.sin(t * 0.01));
      P.e(b, 48, 46 + j, 36, 9, col[2]);
      P.e(b, 48, 47 + j, 30, 6, "#5a2a32");
      P.poly(b, [[12, 46 + j], [84, 46 + j], [70, 78 + j], [26, 78 + j]], col[0]);
      P.r(b, 30, 76 + j, 36, 6, col[1]);
      P.poly(b, [[60, 52 + j], [56, 60 + j], [62, 64 + j], [58, 72 + j]], col[1]);
      const eye = m === "sleep" ? 1 : 5;
      P.e(b, 36, 58 + j, 5, eye, "#fff"); P.e(b, 56, 58 + j, 5, eye, "#fff");
      if (m !== "sleep") { P.c(b, 37, 59 + j, 2.2, INK); P.c(b, 57, 59 + j, 2.2, INK); }
      P.poly(b, [[28, 50 + j], [42, 54 + j], [42, 52 + j]], INK); P.poly(b, [[64, 50 + j], [50, 54 + j], [50, 52 + j]], INK);
      P.e(b, 46, 70 + j, 7, 3, INK);
      P.r(b, 22, 86, 2, 2, "#e9c46a"); P.r(b, 70, 88, 3, 2, "#e9c46a"); P.r(b, 50, 89, 2, 2, "#e9c46a");
    },
    owl(b, t, m, col) {
      const f = m === "sleep" ? 0 : Math.sin(t * 0.008) * 5;
      P.poly(b, [[22, 44], [6, 60 - f], [22, 74]], col[1]);
      P.poly(b, [[74, 44], [90, 60 - f], [74, 74]], col[1]);
      P.e(b, 48, 58, 26, 30, col[0]);
      P.e(b, 48, 66, 16, 18, "#d9b98c");
      for (let i = 0; i < 4; i++) P.poly(b, [[40 + i * 5, 60 + (i % 2) * 6], [42 + i * 5, 64 + (i % 2) * 6], [38 + i * 5, 64 + (i % 2) * 6]], col[1]);
      P.poly(b, [[26, 34], [24, 16], [38, 30]], col[0]); P.poly(b, [[70, 34], [72, 16], [58, 30]], col[0]);
      P.c(b, 37, 42, 10, "#fff4c4"); P.c(b, 59, 42, 10, "#fff4c4");
      if (m === "sleep") { P.r(b, 31, 42, 12, 2, INK); P.r(b, 53, 42, 12, 2, INK); }
      else { P.c(b, 37, 42, 6, col[2]); P.c(b, 59, 42, 6, col[2]); P.c(b, 37, 42, 3, INK); P.c(b, 59, 42, 3, INK); }
      P.poly(b, [[44, 50], [52, 50], [48, 58]], "#f0a43a");
      P.poly(b, [[26, 32], [44, 38], [44, 35]], INK); P.poly(b, [[70, 32], [52, 38], [52, 35]], INK);
      P.r(b, 38, 86, 6, 4, "#f0a43a"); P.r(b, 52, 86, 6, 4, "#f0a43a");
    },
  };

  function drawBoss(canvas, boss, st) {
    const W = canvas.width, H = canvas.height, ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    const spr = mk(96, 96), b = spr.getContext("2d");
    (BOSS[boss.key] || BOSS.cat)(b, st.t, st.mode, boss.colors);
    let img = crisp(spr);
    if (st.mode === "dead") {
      const g = img.getContext("2d");
      g.globalCompositeOperation = "source-atop"; g.fillStyle = "rgba(40,20,50,0.55)"; g.fillRect(0, 0, 96, 96);
    }
    if (st.flash > 0) {
      const g = img.getContext("2d");
      g.globalCompositeOperation = "source-atop"; g.fillStyle = `rgba(255,255,255,${Math.min(1, st.flash)})`; g.fillRect(0, 0, 96, 96);
    }
    const shake = st.shake > 0 ? Math.round((Math.random() - 0.5) * st.shake * 6) : 0;
    const breathe = st.mode === "dead" ? 0 : Math.round(Math.sin(st.t * 0.002) * 1.5);
    // shadow
    ctx.fillStyle = "rgba(20,8,30,0.35)";
    ctx.beginPath(); ctx.ellipse(W / 2, H - 8, 30, 5, 0, 0, TAU); ctx.fill();
    ctx.save();
    if (st.mode === "dead") { ctx.translate(W / 2, H - 10); ctx.rotate(0.25); ctx.translate(-W / 2, -(H - 10)); }
    ctx.drawImage(img, (W - 96) / 2 + shake, H - 96 - 8 + breathe);
    ctx.restore();
    if (st.mode === "sleep") {
      ctx.fillStyle = "#ffe9a8"; ctx.font = "7px 'Press Start 2P', monospace";
      ctx.fillText("…", W - 26, 18 + Math.sin(st.t * 0.003) * 2);
    }
  }

  // Small static boss portrait for cards and the cover image.
  function bossPortrait(boss, size = 96, mode = "idle") {
    const c = mk(110, 110);
    drawBoss(c, boss, { t: 1000, mode, flash: 0, shake: 0 });
    return c;
  }

  root.SBR_ART = { drawWheel, drawBoss, bossPortrait, crisp };
})(window);
