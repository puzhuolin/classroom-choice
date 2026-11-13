/* 课堂·情景模拟平台 后端（零第三方依赖）
   - 情景库：data/scenarios.json，网页里增删改即时生效，无需重新部署
   - 三种用法：/ 情景大厅 · /play 单人闯关 · /teacher 课堂实时（4 组） */
const http = require("http");
const fs = require("fs");
const path = require("path");
const store = require("./store.js");
const parseDoc = require("./parse-doc.js");

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
const PUBLIC = path.join(__dirname, "public");

const GROUP_NAMES = ["第1组", "第2组", "第3组", "第4组"];
const MAXV = 100;
const clamp = v => Math.max(0, Math.min(MAXV, v));

/* ---------- 后台锁：学生只走 /s，进不了大厅/编辑器/教师端 ----------
   默认口令 1949（环境变量 ADMIN_PIN 可改；设成 off 则关闭锁） */
const ADMIN_PIN = process.env.ADMIN_PIN === "off" ? "" : (process.env.ADMIN_PIN || "1949");
function isAdmin(req) {
  if (!ADMIN_PIN) return true;
  const c = req.headers.cookie || "";
  const m = c.match(/(?:^|;\s*)adm=([^;]+)/);
  return !!m && decodeURIComponent(m[1]) === ADMIN_PIN;
}
function gate(req, res, u) {
  const pin = u && u.searchParams.get("pin");
  if (pin) {
    res.writeHead(302, {
      Location: (u.pathname || "/"),
      "Set-Cookie": "adm=" + encodeURIComponent(pin) + "; Path=/; Max-Age=" + (60 * 60 * 24 * 30) + "; SameSite=Lax"
    });
    res.end();
    return false;
  }
  if (isAdmin(req)) return true;
  res.writeHead(302, { Location: "/admin?next=" + encodeURIComponent((u && (u.pathname + (u.search || ""))) || "/") });
  res.end();
  return false;
}

/* ---------- 状态（内存，重启即清空，适合单堂课） ---------- */
let state;
function resetState(sid, keepStudents) {
  const list = store.loadAll();
  const id = (sid && store.get(sid)) ? sid : (state && state.sid) || (list[0] && list[0].id);
  const students = keepStudents && state ? state.students : {};
  const seq = state ? state.seq : 1;
  state = { sid: id, stageIndex: -1, phase: "idle", students, answers: {}, seq };
}
state = { sid: null, stageIndex: -1, phase: "idle", students: {}, answers: {}, seq: 1 };
resetState(null, false);

const SC = () => store.get(state.sid) || store.loadAll()[0];
const STAGES = () => SC().stages || [];

function pickGroup() {
  const counts = [0, 0, 0, 0];
  Object.values(state.students).forEach(s => counts[s.group]++);
  const min = Math.min(...counts);
  const cand = counts.map((c, i) => (c === min ? i : -1)).filter(i => i >= 0);
  return cand[Math.floor(Math.random() * cand.length)];
}

function curAnswers() {
  const si = state.stageIndex;
  if (si < 0) return {};
  if (!state.answers[si]) state.answers[si] = {};
  return state.answers[si];
}

function optionCounts() {
  const si = state.stageIndex;
  if (si < 0) return [];
  const out = STAGES()[si].options.map(() => 0);
  Object.values(state.answers[si] || {}).forEach(ch => { if (out[ch] != null) out[ch]++; });
  return out;
}

/* 每组每个环节取「多数选项」作为一个组的集体决策 */
function groupPicks(gi) {
  const stages = STAGES();
  const picks = [];
  for (let si = 0; si < stages.length; si++) {
    const ans = state.answers[si] || {};
    const tally = {};
    Object.entries(ans).forEach(([sid, ch]) => {
      const st = state.students[sid];
      if (st && st.group === gi) tally[ch] = (tally[ch] || 0) + 1;
    });
    let best = -1, bestc = -1;
    Object.entries(tally).forEach(([ch, c]) => { if (c > bestc) { bestc = c; best = parseInt(ch, 10); } });
    picks.push(best >= 0 && stages[si].options[best] ? best : -1);
  }
  return picks;
}

/* ---------- 判题型结算 ---------- */
function judgeOf(gi, sc) {
  const stages = sc.stages || [];
  const pairsDef = sc.pairs || [];
  const hits = pairsDef.map(() => []);
  const flags = [];
  let score = 0;
  const sideAll = {};
  groupPicks(gi).forEach((pick, si) => {
    if (pick < 0) { flags.push({ ok: null, side: "" }); return; }
    const st = stages[si], o = st.options[pick];
    if (o.ok) score++;
    if (!o.ok && o.side) sideAll[o.side] = (sideAll[o.side] || 0) + 1;
    flags.push({ ok: !!o.ok, side: o.side || "" });
    if (st.pair != null && hits[st.pair]) hits[st.pair].push({ ok: !!o.ok, side: o.side || "" });
  });
  const pairs = pairsDef.map((p, i) => {
    const h = hits[i];
    if (!h.length) return { i, a: p.a, b: p.b, state: "none", side: "" };
    const bad = h.filter(x => !x.ok);
    return bad.length ? { i, a: p.a, b: p.b, state: "bad", side: bad[0].side }
                      : { i, a: p.a, b: p.b, state: "ok", side: "" };
  });
  const sideTally = {};
  pairs.forEach(p => { if (p.state === "bad" && p.side) sideTally[p.side] = (sideTally[p.side] || 0) + 1; });
  Object.entries(sideAll).forEach(([k, v]) => { sideTally[k] = (sideTally[k] || 0) + v; });
  let mainSide = null, mv = 0;
  Object.entries(sideTally).forEach(([k, v]) => { if (v > mv) { mv = v; mainSide = k; } });
  return {
    score, pairs, flags,
    unified: pairs.filter(p => p.state === "ok").length,
    sideTally, mainSide, mainSideCount: mv,
    total: stages.length
  };
}

/* ---------- 属性型结算 ---------- */
function attrsOf(gi, sc) {
  const base = sc.base || {};
  const dims = (sc.dims || []).map(d => d.key);
  const s = {};
  dims.forEach(k => { s[k] = Number(base[k] || 0); });
  groupPicks(gi).forEach((pick, si) => {
    if (pick < 0) return;
    const o = sc.stages[si].options[pick];
    const d = o.delta || {};
    dims.forEach(k => { s[k] = clamp(s[k] + (Number(d[k]) || 0)); });
  });
  s.power = dims.length ? Math.round(dims.reduce((a, k) => a + s[k], 0) / dims.length) : 0;
  return s;
}

/* ---------- 结局匹配（数据驱动，顺序即优先级） ---------- */
function endingFor(sc, ctx) {
  const list = (sc.endings && sc.endings.length) ? sc.endings : [{ type: "default", emoji: "🎯", title: "结束", text: "" }];
  if (sc.mode === "attrs") {
    const dims = (sc.dims || []).map(d => d.key);
    const vals = dims.map(k => ctx.stats[k]);
    const min = Math.min.apply(null, vals);
    const weakest = dims[vals.indexOf(min)];
    for (const e of list) {
      if (e.type === "minDim" && min >= (e.min || 0)) return e;
      if (e.type === "weakest" && e.dim === weakest) return e;
      if (e.type === "default") return e;
    }
  } else {
    for (const e of list) {
      if (e.type === "score" && ctx.score >= (e.min || 0)) return e;
      if (e.type === "default") return e;
    }
  }
  return list[list.length - 1];
}

/* ---------- 学生个人复盘（课堂结束后下发到学生手机） ---------- */
function buildPersonalReview(sc, sid) {
  const stages = sc.stages || [];
  const pairsDef = sc.pairs || [];
  const hits = pairsDef.map(() => []);
  const items = [];
  let score = 0;

  stages.forEach((st, si) => {
    const ch = (state.answers[si] || {})[sid];
    if (ch == null || !st.options[ch]) {
      items.push({ si, title: st.title || ("第" + (si + 1) + "幕"), q: st.q || "", label: null, ok: null });
      return;
    }
    const o = st.options[ch];
    if (o.ok) score++;
    if (st.pair != null && hits[st.pair]) hits[st.pair].push({ ok: !!o.ok, side: o.side || "" });
    const pv = (st.pair != null && pairsDef[st.pair]) ? pairsDef[st.pair] : null;
    items.push({
      si,
      title: st.title || ("第" + (si + 1) + "幕"),
      q: st.q || "",
      label: o.label,
      ok: !!o.ok,
      side: o.side || "",
      rtitle: o.title || "",
      text: o.text || "",
      anchor: o.anchor || "",
      tip: o.tip || "",
      pairName: pv ? (pv.a + " ⇄ " + pv.b) : ""
    });
  });

  const pairs = pairsDef.map((p, i) => {
    const h = hits[i];
    if (!h.length) return { a: p.a, b: p.b, state: "none", side: "", hint: p.hint || "" };
    const bad = h.filter(x => !x.ok);
    return bad.length
      ? { a: p.a, b: p.b, state: "bad", side: bad[0].side, hint: p.hint || "" }
      : { a: p.a, b: p.b, state: "ok", side: "", hint: p.hint || "" };
  });

  const unified = pairs.filter(p => p.state === "ok").length;
  const end = endingFor(sc, { score });
  // 评价等级
  const ratio = stages.length ? score / stages.length : 0;
  const level = ratio >= 0.99 ? { tag: "优秀", color: "#1f7a4d" }
    : ratio >= 0.7 ? { tag: "良好", color: "#1f5fa8" }
    : ratio >= 0.5 ? { tag: "及格", color: "#c07a12" }
    : { tag: "待补", color: "#b81c22" };

  return {
    score, total: stages.length, level,
    ending: { emoji: end.emoji || "🎯", title: end.title || "结束", text: end.text || "" },
    items, pairs, unified, pairTotal: pairsDef.length,
    takeaways: sc.takeaways || [],
    discuss: sc.discuss || []
  };
}

function buildState() {
  const sc = SC();
  const si = state.stageIndex;
  const stage = si >= 0 ? STAGES()[si] : null;
  const counts = optionCounts();
  const studentsArr = Object.values(state.students);
  const reveal = state.phase === "closed" || state.phase === "done";
  const mode = sc.mode || "judge";

  const groups = GROUP_NAMES.map((name, gi) => {
    const members = studentsArr
      .filter(s => s.group === gi)
      .map(s => ({
        id: s.id, name: s.name,
        choice: (state.answers[si] || {})[s.id] ?? null,
        answered: (state.answers[si] || {})[s.id] != null
      }));
    const gcounts = stage ? stage.options.map(() => 0) : [];
    members.forEach(m => { if (m.choice != null && gcounts[m.choice] != null) gcounts[m.choice]++; });
    const base = { gi, name, members, counts: gcounts };

    if (mode === "judge") {
      const r = judgeOf(gi, sc);
      return Object.assign(base, {
        score: r.score, total: r.total, unified: r.unified,
        pairs: r.pairs, flags: r.flags, mainSide: r.mainSide, mainSideCount: r.mainSideCount,
        sideTally: r.sideTally
      });
    }
    const st = attrsOf(gi, sc);
    const bs = sc.base || {};
    const dims = (sc.dims || []).map(d => d.key);
    const statVals = {};
    dims.forEach(k => { statVals[k] = st[k]; });
    const basePower = dims.length ? Math.round(dims.reduce((a, k) => a + Number(bs[k] || 0), 0) / dims.length) : 0;
    const delta = {}, contrib = {};
    let main = null, mv = -Infinity;
    dims.forEach(k => {
      delta[k] = st[k] - Number(bs[k] || 0);
      if (delta[k] > mv) { mv = delta[k]; main = k; }
    });
    if (mv <= 0) main = null;
    const posSum = dims.reduce((a, k) => a + Math.max(0, delta[k]), 0) || 1;
    dims.forEach(k => { contrib[k] = Math.round(Math.max(0, delta[k]) / posSum * 100); });
    return Object.assign(base, {
      stats: statVals, power: st.power, delta, contrib, main, growth: st.power - basePower
    });
  });

  const answeredCount = stage ? Object.keys(state.answers[si] || {}).length : 0;
  let ranking = null;
  if (state.phase === "done") {
    if (mode === "judge") {
      ranking = groups.map(x => {
        const e = endingFor(sc, x);
        return { name: x.name, score: x.score, total: x.total, unified: x.unified, tag: e.title, em: e.emoji };
      }).sort((a, b) => b.score - a.score || b.unified - a.unified);
    } else {
      ranking = groups.map(x => {
        const e = endingFor(sc, x);
        return { name: x.name, power: x.power, stats: x.stats, tag: e.title, em: e.emoji };
      }).sort((a, b) => b.power - a.power);
    }
  }

  return {
    game: { key: sc.id, name: sc.title, subtitle: sc.subtitle, type: mode, emoji: sc.emoji, cover: sc.cover || null },
    pairsDef: mode === "judge" ? (sc.pairs || null) : null,
    dimsDef: mode === "attrs" ? (sc.dims || null) : null,
    stageIndex: si, phase: state.phase, totalStages: STAGES().length,
    stage: stage ? {
      title: stage.title, q: stage.q,
      media: stage.media || null,
      options: stage.options.map(o => ({
        label: o.label,
        ok: reveal ? !!o.ok : undefined,
        tip: reveal ? (o.tip || "") : undefined,
        side: reveal ? (o.side || "") : undefined
      }))
    } : null,
    base: sc.base || null,
    counts, groups, answeredCount, totalStudents: studentsArr.length, ranking
  };
}

/* ---------- HTTP 工具 ---------- */
function send(res, code, body, type) {
  res.writeHead(code, {
    "Content-Type": type || "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"
  });
  res.end(body);
}
function sendJSON(res, obj, code) { send(res, code || 200, JSON.stringify(obj)); }
function readBody(req) {
  return new Promise(resolve => {
    let d = "";
    req.on("data", c => { d += c; if (d.length > 4e6) req.destroy(); });
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { resolve({}); } });
  });
}
/* 原始字节（上传 docx/pptx 用） */
function readRaw(req, limit) {
  return new Promise(resolve => {
    const chunks = [];
    let size = 0, dead = false;
    req.on("data", c => {
      if (dead) return;
      size += c.length;
      if (size > (limit || 24e6)) { dead = true; resolve(null); return; }
      chunks.push(c);
    });
    req.on("end", () => { if (!dead) resolve(Buffer.concat(chunks)); });
    req.on("error", () => { if (!dead) { dead = true; resolve(null); } });
  });
}
function serveFile(res, file) {
  const full = path.join(PUBLIC, file);
  fs.readFile(full, (err, data) => {
    if (err) { send(res, 404, "Not found", "text/plain; charset=utf-8"); return; }
    send(res, 200, data, "text/html; charset=utf-8");
  });
}

/* ---------- 路由 ---------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;

  if (req.method === "OPTIONS") { send(res, 204, ""); return; }

  /* ===== 页面（后台加锁：学生只走 /s） ===== */
  if (p === "/admin") return serveFile(res, "admin.html");
  /* 入口页：对外固定链接用，不需要口令（只是个跳板，不含任何数据） */
  if (p === "/entry" || p === "/entry.html" || p === "/start") return serveFile(res, "entry.html");
  if (p === "/" || p === "/hub") { if (!gate(req, res, u)) return; return serveFile(res, "hub.html"); }
  if (p === "/play") { if (!gate(req, res, u)) return; return serveFile(res, "play.html"); }
  if (p === "/editor") { if (!gate(req, res, u)) return; return serveFile(res, "editor.html"); }
  if (p === "/teacher" || p === "/teacher.html") { if (!gate(req, res, u)) return; return serveFile(res, "teacher.html"); }
  if (p === "/s" || p === "/student" || p === "/student.html") return serveFile(res, "student.html");

  /* 静态资源：public/img 下的封面图等 */
  if (p.startsWith("/img/") || p.startsWith("/assets/")) {
    const full = path.join(PUBLIC, path.normalize(p).replace(/^([/\\])+/, ""));
    if (!full.startsWith(PUBLIC)) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    const ext = (full.match(/\.([a-z0-9]+)$/i) || [, ""])[1].toLowerCase();
    const types = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", mp4: "video/mp4", webm: "video/webm" };
    return fs.readFile(full, (err, data) => {
      if (err) return send(res, 404, "Not found", "text/plain; charset=utf-8");
      res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "public, max-age=3600" });
      res.end(data);
    });
  }

  /* ===== 后台登录 ===== */
  if (p === "/api/admin/login" && req.method === "POST") {
    const b = await readBody(req);
    if (!ADMIN_PIN) return sendJSON(res, { ok: true });
    if (String(b.pin || "") === ADMIN_PIN) {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": "adm=" + encodeURIComponent(ADMIN_PIN) + "; Path=/; Max-Age=" + (60 * 60 * 24 * 30) + "; SameSite=Lax"
      });
      return res.end(JSON.stringify({ ok: true }));
    }
    return sendJSON(res, { ok: false, error: "口令不对" }, 400);
  }
  if (p === "/api/admin/logout") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Set-Cookie": "adm=; Path=/; Max-Age=0" });
    return res.end(JSON.stringify({ ok: true }));
  }

  /* ===== 情景库 ===== */
  if (p === "/api/scenarios") return sendJSON(res, { scenarios: store.list(), current: state.sid });

  /* 上传 Word/PPT，抽出文字（编辑器「导入课件」用） */
  if (p === "/api/parse" && req.method === "POST") {
    if (!isAdmin(req)) return sendJSON(res, { ok: false, error: "需要口令" }, 401);
    const buf = await readRaw(req, 24e6);
    if (!buf) return sendJSON(res, { ok: false, error: "文件过大（上限 24MB）" }, 413);
    if (!buf.length) return sendJSON(res, { ok: false, error: "没有收到文件内容" }, 400);
    let out;
    try { out = parseDoc.parseFile(buf, decodeURIComponent(u.searchParams.get("name") || "")); }
    catch (e) { out = { ok: false, error: "解析失败：" + e.message }; }
    return sendJSON(res, out, out.ok ? 200 : 400);
  }

  if (p === "/api/scenario") {
    if (req.method === "GET") {
      const sc = store.get(u.searchParams.get("id")) || store.loadAll()[0];
      return sc ? sendJSON(res, sc) : sendJSON(res, { error: "not_found" }, 404);
    }
    if (req.method === "POST") {
      const b = await readBody(req);
      const r = store.upsert(b);
      return sendJSON(res, r, r.ok ? 200 : 400);
    }
    if (req.method === "DELETE") {
      const r = store.remove(u.searchParams.get("id"));
      return sendJSON(res, r, r.ok ? 200 : 400);
    }
  }

  if (p === "/api/export") {
    const all = store.loadAll();
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": "attachment; filename=scenarios.json"
    });
    return res.end(JSON.stringify(all, null, 2));
  }

  if (p === "/api/import" && req.method === "POST") {
    const b = await readBody(req);
    const r = store.importAll(b.data, b.mode);
    return sendJSON(res, r, r.ok ? 200 : 400);
  }

  /* ===== 课堂实时 ===== */
  if (p === "/api/meta") {
    const sc = SC();
    return sendJSON(res, {
      game: { key: sc.id, name: sc.title, subtitle: sc.subtitle, type: sc.mode, emoji: sc.emoji, cover: sc.cover || null },
      totalStages: STAGES().length
    });
  }

  if (p === "/api/join" && req.method === "POST") {
    const b = await readBody(req);
    let name = String(b.name || "").trim().slice(0, 12);
    if (!name) return sendJSON(res, { ok: false, error: "请填写名字" }, 400);
    const id = "s" + (state.seq++);
    const gi = pickGroup();
    state.students[id] = { id, name, group: gi, joinedAt: Date.now() };
    return sendJSON(res, { ok: true, id, name, group: gi, groupName: GROUP_NAMES[gi] });
  }

  if (p === "/api/me") {
    const id = u.searchParams.get("id");
    const st = state.students[id];
    if (!st) return sendJSON(res, { ok: false, error: "not_joined" }, 404);
    const sc = SC();
    const si = state.stageIndex, phase = state.phase;
    const stage = (si >= 0 && (phase === "open" || phase === "closed")) ? STAGES()[si] : null;
    const mine = (state.answers[si] || {})[id];
    const out = {
      ok: true, id, name: st.name, group: st.group, groupName: GROUP_NAMES[st.group],
      game: { key: sc.id, name: sc.title, subtitle: sc.subtitle, type: sc.mode, emoji: sc.emoji, cover: sc.cover || null },
      scenario: {
        title: sc.title, subtitle: sc.subtitle, emoji: sc.emoji, cover: sc.cover || null,
        lead: (sc.intro && sc.intro.lead) || "",
        roleName: (sc.intro && sc.intro.roleName) || "",
        task: (sc.intro && sc.intro.task) || ""
      },
      stageIndex: si, phase, totalStages: STAGES().length,
      stage: stage ? { title: stage.title, q: stage.q, media: stage.media || null, options: stage.options.map(o => ({ label: o.label })) } : null,
      myChoice: mine == null ? null : mine,
      counts: phase === "closed" ? optionCounts() : null
    };

    /* 本轮投票结束后：把"你这一票带来的结果"发给学生本人 */
    if (phase === "closed" && stage && mine != null && stage.options[mine]) {
      const o = stage.options[mine];
      const pv = (stage.pair != null && (sc.pairs || [])[stage.pair]) ? sc.pairs[stage.pair] : null;
      out.myOption = {
        label: o.label, ok: !!o.ok, side: o.side || "",
        title: o.title || "", text: o.text || "",
        anchor: o.anchor || "", tip: o.tip || ""
      };
      out.myPair = pv ? { a: pv.a, b: pv.b, hint: pv.hint || "", side: o.side || "", ok: !!o.ok } : null;
      out.correctIndex = stage.options.findIndex(x => x.ok);
    }

    /* 课堂结束：个人完整复盘（评价 + 与教学内容挂钩的分析） */
    if (phase === "done") out.review = buildPersonalReview(sc, id);

    return sendJSON(res, out);
  }

  if (p === "/api/answer" && req.method === "POST") {
    const b = await readBody(req);
    const id = b.id, ch = parseInt(b.choice, 10);
    if (!state.students[id]) return sendJSON(res, { ok: false, error: "not_joined" }, 400);
    if (state.phase !== "open" || state.stageIndex < 0) return sendJSON(res, { ok: false, error: "closed" }, 400);
    if (!(ch >= 0 && ch < STAGES()[state.stageIndex].options.length)) return sendJSON(res, { ok: false, error: "bad_choice" }, 400);
    curAnswers()[id] = ch;
    return sendJSON(res, { ok: true });
  }

  if (p === "/api/state") return sendJSON(res, buildState());

  if (p === "/api/control" && req.method === "POST") {
    const b = await readBody(req);
    const a = b.action;
    if (a === "start") { state.stageIndex = 0; state.phase = "open"; }
    else if (a === "restart") { resetState(null, false); state.stageIndex = 0; state.phase = "open"; }
    else if (a === "open") { if (state.stageIndex >= 0 && state.phase !== "done") state.phase = "open"; }
    else if (a === "close") { if (state.stageIndex >= 0 && state.phase !== "done") state.phase = "closed"; }
    else if (a === "next") {
      if (state.stageIndex < STAGES().length - 1) { state.stageIndex++; state.phase = "open"; }
      else { state.phase = "done"; }
    }
    else if (a === "prev") { if (state.stageIndex > 0) { state.stageIndex--; state.phase = "closed"; } }
    else if (a === "finish") { state.phase = "done"; }
    else if (a === "reset") { resetState(null, false); }
    else if (a === "setScenario") {
      if (store.get(b.id)) resetState(b.id, b.keepStudents !== false);
    }
    return sendJSON(res, {
      ok: true, phase: state.phase, stageIndex: state.stageIndex,
      scenario: state.sid, totalStudents: Object.keys(state.students).length
    });
  }

  send(res, 404, "Not found", "text/plain; charset=utf-8");
});

server.listen(PORT, HOST, () => {
  const all = store.loadAll();
  console.log("情景模拟平台已启动： http://localhost:" + PORT);
  console.log("  学生端 /s（学生只走这里）    后台口令：" + (ADMIN_PIN ? ADMIN_PIN : "未启用"));
  console.log("  大厅 /    闯关 /play?s=id    课堂 /teacher    编辑器 /editor");
  console.log("  情景库（" + all.length + "）：" + all.map(s => s.title).join("、"));
});
