/* 课堂实时互动系统 · 后端（零第三方依赖，可直接部署到任意 Node 托管） */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
const PUBLIC = path.join(__dirname, "public");

/* ---------- 内容：6 个环节（对应第七章历史抉择） ---------- */
const STAGES = [
  { title: "1949 · 百废待兴", q: "新中国刚成立，第一笔有限的财政，优先投在哪里？",
    options: [
      { label: "大办教育，开展扫盲，建学校、培养师资", delta: { edu: 20, tal: 8, tech: -2 } },
      { label: "集中力量优先发展重工业和军工", delta: { tech: 12, edu: -5, tal: 2 } },
      { label: "维持现状，先稳住政权再说", delta: { edu: 2, tech: 2, tal: 2 } }
    ] },
  { title: "1949 · 人才归国", q: "一批世界顶尖的中国科学家想回国，你的态度是？",
    options: [
      { label: "千方百计争取他们回国，给予尊重与重用", delta: { tal: 18, tech: 6 } },
      { label: "忙于内政，暂时无暇顾及", delta: { tal: -5 } },
      { label: "只接收少数『听话』的人", delta: { tal: 6 } }
    ] },
  { title: "1950年代 · 奠基", q: "国家要工业化，高等教育该如何布局？",
    options: [
      { label: "大规模院系调整，重点培养工科、师范等急需人才", delta: { edu: 14, tal: 12, tech: 4 } },
      { label: "保持旧有大学格局，慢慢来", delta: { edu: 4, tal: 2 } },
      { label: "只搞运动，停课闹革命", delta: { edu: -10, tal: -8 } }
    ] },
  { title: "1950年代 · 两弹一星", q: "面对核讹诈，要不要搞『两弹一星』这样的大科学工程？",
    options: [
      { label: "举国体制，自主攻关两弹一星", delta: { tech: 22, tal: 8, edu: 4 } },
      { label: "暂缓，先解决老百姓的吃饭问题", delta: { tech: 2, edu: 4 } },
      { label: "完全依赖外国援助，不搞自主", delta: { tech: 8, tal: -4 } }
    ] },
  { title: "1959–60年代 · 考验", q: "困难时期，教育与科研经费要不要削减？",
    options: [
      { label: "咬牙保住教育和科研的『火苗』，再难也不下马", delta: { edu: 6, tal: 6, tech: 4 } },
      { label: "大幅削减，先保民生", delta: { edu: -12, tal: -10, tech: -6 } },
      { label: "只保重点，砍掉基础教育", delta: { edu: -6, tal: -2 } }
    ] },
  { title: "1959–60年代 · 大学外迁", q: "一所顶尖大学因战备外迁、多省婉拒，你的态度是？",
    options: [
      { label: "『勒紧裤腰带，也要把科学的苗子保住』——全力接纳", delta: { tal: 10, edu: 8, tech: 4 } },
      { label: "各省都不愿意接，那就任它自生自灭", delta: { tal: -6, edu: -4 } },
      { label: "口头支持，实际不闻不问", delta: { tal: 2 } }
    ] }
];

const BASE = { edu: 10, tech: 12, tal: 15 };
const GROUP_NAMES = ["第1组", "第2组", "第3组", "第4组"];
const MAXV = 100;
const clamp = v => Math.max(0, Math.min(MAXV, v));

/* ---------- 状态（内存，重启即清空，适合单堂课） ---------- */
let state;
function resetState() {
  state = { stageIndex: -1, phase: "idle", students: {}, answers: {}, seq: 1 };
}
resetState();

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
  const out = si >= 0 ? STAGES[si].options.map(() => 0) : [];
  if (si < 0) return out;
  Object.values(state.answers[si] || {}).forEach(ch => { if (out[ch] != null) out[ch]++; });
  return out;
}

function endingOf(s) {
  const min = Math.min(s.edu, s.tech, s.tal);
  if (min >= 50) return { tag: "科教兴国", em: "🏆" };
  if (min >= 40) return { tag: "稳步前行", em: "🌱" };
  if (s.edu <= s.tech && s.edu <= s.tal) return { tag: "无源之水", em: "🌵" };
  if (s.tal <= s.tech) return { tag: "有器无人", em: "🤖" };
  return { tag: "受制于人", em: "🔒" };
}

/* 某组的“小组决策”：每个环节取组内多数选项，累加属性 */
function groupStats(gi) {
  const s = { ...BASE };
  for (let si = 0; si < STAGES.length; si++) {
    const ans = state.answers[si] || {};
    const tally = {};
    Object.entries(ans).forEach(([sid, ch]) => {
      const st = state.students[sid];
      if (st && st.group === gi) tally[ch] = (tally[ch] || 0) + 1;
    });
    let best = -1, bestc = -1;
    Object.entries(tally).forEach(([ch, c]) => {
      if (c > bestc) { bestc = c; best = parseInt(ch, 10); }
    });
    if (best >= 0 && STAGES[si].options[best]) {
      const d = STAGES[si].options[best].delta || {};
      ["edu", "tech", "tal"].forEach(k => (s[k] = clamp(s[k] + (d[k] || 0))));
    }
  }
  s.power = Math.round((s.edu + s.tech + s.tal) / 3);
  return s;
}

function buildState() {
  const si = state.stageIndex;
  const stage = si >= 0 ? STAGES[si] : null;
  const counts = optionCounts();
  const studentsArr = Object.values(state.students);
  const basePower = Math.round((BASE.edu + BASE.tech + BASE.tal) / 3);
  const groups = GROUP_NAMES.map((name, gi) => {
    const members = studentsArr
      .filter(s => s.group === gi)
      .map(s => ({ id: s.id, name: s.name, choice: (state.answers[si] || {})[s.id] ?? null,
                   answered: (state.answers[si] || {})[s.id] != null }));
    const gcounts = stage ? stage.options.map(() => 0) : [];
    members.forEach(m => { if (m.choice != null && gcounts[m.choice] != null) gcounts[m.choice]++; });
    const st = groupStats(gi);
    const delta = { edu: st.edu - BASE.edu, tech: st.tech - BASE.tech, tal: st.tal - BASE.tal };
    // 增长主要来源：增量最大且为正的那一项
    let main = null, mv = -Infinity;
    ["edu", "tech", "tal"].forEach(k => { if (delta[k] > mv) { mv = delta[k]; main = k; } });
    if (mv <= 0) main = null;
    // 正增量占比（用于堆叠贡献条）
    const posSum = ["edu", "tech", "tal"].reduce((a, k) => a + Math.max(0, delta[k]), 0) || 1;
    const contrib = {
      edu: Math.round(Math.max(0, delta.edu) / posSum * 100),
      tech: Math.round(Math.max(0, delta.tech) / posSum * 100),
      tal: Math.round(Math.max(0, delta.tal) / posSum * 100)
    };
    return {
      gi, name, members, counts: gcounts,
      stats: { edu: st.edu, tech: st.tech, tal: st.tal }, power: st.power,
      delta, contrib, main, growth: st.power - basePower
    };
  });
  const answeredCount = stage ? Object.keys(state.answers[si] || {}).length : 0;
  const totalStudents = studentsArr.length;
  let ranking = null;
  if (state.phase === "done") {
    ranking = groups
      .map(g => { const e = endingOf(g.stats); return { name: g.name, power: g.power, edu: g.stats.edu, tech: g.stats.tech, tal: g.stats.tal, tag: e.tag, em: e.em }; })
      .sort((a, b) => b.power - a.power);
  }
  return {
    stageIndex: si, phase: state.phase, totalStages: STAGES.length,
    stage: stage ? { title: stage.title, q: stage.q, options: stage.options.map(o => ({ label: o.label })) } : null,
    base: BASE, basePower, counts, groups, answeredCount, totalStudents, ranking
  };
}

/* ---------- HTTP 工具 ---------- */
function send(res, code, body, type) {
  res.writeHead(code, { "Content-Type": type || "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
  res.end(body);
}
function sendJSON(res, obj, code) { send(res, code || 200, JSON.stringify(obj)); }
function readBody(req) {
  return new Promise(resolve => {
    let d = "";
    req.on("data", c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { resolve({}); } });
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

  // 页面
  if (p === "/" ) { res.writeHead(302, { Location: "/teacher" }); res.end(); return; }
  if (p === "/teacher" || p === "/teacher.html") return serveFile(res, "teacher.html");
  if (p === "/s" || p === "/student" || p === "/student.html") return serveFile(res, "student.html");

  // API：学生加入
  if (p === "/api/join" && req.method === "POST") {
    const b = await readBody(req);
    let name = String(b.name || "").trim().slice(0, 12);
    if (!name) return sendJSON(res, { ok: false, error: "请填写名字" }, 400);
    const id = "s" + (state.seq++);
    const gi = pickGroup();
    state.students[id] = { id, name, group: gi, joinedAt: Date.now() };
    return sendJSON(res, { ok: true, id, name, group: gi, groupName: GROUP_NAMES[gi] });
  }

  // API：学生轮询自己视图
  if (p === "/api/me") {
    const id = u.searchParams.get("id");
    const st = state.students[id];
    if (!st) return sendJSON(res, { ok: false, error: "not_joined" }, 404);
    const si = state.stageIndex;
    const phase = state.phase;
    const stage = (si >= 0 && (phase === "open" || phase === "closed")) ? STAGES[si] : null;
    const mine = (state.answers[si] || {})[id];
    return sendJSON(res, {
      ok: true, id, name: st.name, group: st.group, groupName: GROUP_NAMES[st.group],
      stageIndex: si, phase, totalStages: STAGES.length,
      stage: stage ? { title: stage.title, q: stage.q, options: stage.options.map(o => ({ label: o.label })) } : null,
      myChoice: mine == null ? null : mine,
      counts: phase === "closed" ? optionCounts() : null
    });
  }

  // API：学生作答
  if (p === "/api/answer" && req.method === "POST") {
    const b = await readBody(req);
    const id = b.id, ch = parseInt(b.choice, 10);
    if (!state.students[id]) return sendJSON(res, { ok: false, error: "not_joined" }, 400);
    if (state.phase !== "open" || state.stageIndex < 0) return sendJSON(res, { ok: false, error: "closed" }, 400);
    if (!(ch >= 0 && ch < STAGES[state.stageIndex].options.length)) return sendJSON(res, { ok: false, error: "bad_choice" }, 400);
    curAnswers()[id] = ch;
    return sendJSON(res, { ok: true });
  }

  // API：教师端全量状态
  if (p === "/api/state") return sendJSON(res, buildState());

  // API：教师控制
  if (p === "/api/control" && req.method === "POST") {
    const b = await readBody(req);
    const a = b.action;
    if (a === "start") { state.stageIndex = 0; state.phase = "open"; }
    else if (a === "restart") { resetState(); state.stageIndex = 0; state.phase = "open"; }
    else if (a === "open") { if (state.stageIndex >= 0 && state.phase !== "done") state.phase = "open"; }
    else if (a === "close") { if (state.stageIndex >= 0 && state.phase !== "done") state.phase = "closed"; }
    else if (a === "next") {
      if (state.stageIndex < STAGES.length - 1) { state.stageIndex++; state.phase = "open"; }
      else { state.phase = "done"; }
    }
    else if (a === "prev") { if (state.stageIndex > 0) { state.stageIndex--; state.phase = "closed"; } }
    else if (a === "finish") { state.phase = "done"; }
    else if (a === "reset") { resetState(); }
    return sendJSON(res, { ok: true, phase: state.phase, stageIndex: state.stageIndex });
  }

  send(res, 404, "Not found", "text/plain; charset=utf-8");
});

server.listen(PORT, HOST, () => {
  console.log("课堂实时系统已启动： http://localhost:" + PORT + "  教师端 /teacher  学生端 /s");
});
