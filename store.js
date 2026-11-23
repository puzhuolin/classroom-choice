/* 情景库：运行时读写 data/scenarios.json。
   网页里新增/修改情景 → 立即写盘、立即生效，无需重新部署。
   注意：Railway 等平台的文件系统是临时的，重新部署会回到部署时的 data/ 内容，
   所以编辑器里提供了「导出备份 / 导入恢复」。 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "scenarios.json");

let cache = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function persist() {
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error("[store] 写盘失败：", e.message);
    return false;
  }
}

/* 老数据自愈：早期版本写盘的情景没有 takeaways / discuss / sections，
   读盘时按同 id 的种子补齐，用户自己改过的内容一律不动。 */
function healOld(arr) {
  const seeds = require("./seed.js");
  let changed = false;
  arr.forEach(s => {
    const sd = seeds.find(x => x.id === s.id);
    if (!sd) return;
    ["takeaways", "discuss"].forEach(k => {
      if ((!Array.isArray(s[k]) || !s[k].length) && Array.isArray(sd[k]) && sd[k].length) {
        s[k] = sd[k].map(x => String(x));
        changed = true;
      }
    });
    if ((!Array.isArray(s.sections) || !s.sections.length) && Array.isArray(sd.sections) && sd.sections.length) {
      s.sections = JSON.parse(JSON.stringify(sd.sections));
      changed = true;
    }
  });
  return changed;
}

function loadAll() {
  if (cache) return cache;
  ensureDir();
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) cache = arr;
  } catch (e) { /* 文件不存在或损坏 → 走种子 */ }
  if (!cache || !cache.length) {
    cache = JSON.parse(JSON.stringify(require("./seed.js")));
    persist();
    console.log("[store] 已写入种子情景：" + cache.map(s => s.title).join("、"));
  } else if (healOld(cache)) {
    persist();
    console.log("[store] 已为旧情景补齐教学要点/讨论题等字段");
  }
  return cache;
}

/* ---------- 校验 ---------- */
function normalize(sc) {
  const e = [];
  if (!sc || typeof sc !== "object") return { error: ["情景数据为空"] };
  const id = String(sc.id || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
  if (!id) e.push("缺少 id（只能用字母数字下划线）");
  if (!String(sc.title || "").trim()) e.push("缺少标题");
  const mode = sc.mode === "attrs" ? "attrs" : "judge";
  if (!Array.isArray(sc.stages) || !sc.stages.length) e.push("至少要有一幕");
  (sc.stages || []).forEach((st, i) => {
    if (!String(st.q || "").trim() && !String(st.scene || "").trim()) e.push("第 " + (i + 1) + " 幕既没有问题也没有情景描述");
    const opts = st.options || [];
    if (opts.length < 2) e.push("第 " + (i + 1) + " 幕至少要两个选项");
    opts.forEach((o, j) => { if (!String(o.label || "").trim()) e.push("第 " + (i + 1) + " 幕第 " + (j + 1) + " 个选项没有文字"); });
    if (mode === "judge" && !opts.some(o => o.ok)) e.push("第 " + (i + 1) + " 幕没有标记正确解");
  });
  if (mode === "attrs" && (!Array.isArray(sc.dims) || sc.dims.length < 1)) e.push("属性型情景至少要有一个维度");
  if (e.length) return { error: e };

  const out = {
    id,
    title: String(sc.title).trim(),
    subtitle: String(sc.subtitle || "").trim(),
    emoji: String(sc.emoji || "🎮").slice(0, 4),
    mode,
    intro: sc.intro && typeof sc.intro === "object" ? sc.intro : {},
    cover: (sc.cover && String(sc.cover.url || "").trim())
      ? { url: String(sc.cover.url).trim(), caption: String(sc.cover.caption || "").trim() }
      : undefined,
    pairs: Array.isArray(sc.pairs) ? sc.pairs : undefined,
    dims: Array.isArray(sc.dims) ? sc.dims : undefined,
    base: sc.base && typeof sc.base === "object" ? sc.base : undefined,
    stages: sc.stages.map(st => ({
      title: String(st.title || "").trim(),
      scene: String(st.scene || "").trim(),
      q: String(st.q || "").trim(),
      pair: (st.pair === 0 || st.pair) ? Number(st.pair) : undefined,
      media: (st.media && String(st.media.url || "").trim())
        ? { url: String(st.media.url).trim(), caption: String(st.media.caption || "").trim() }
        : undefined,
      options: (st.options || []).map(o => {
        const x = { label: String(o.label || "").trim() };
        if (o.ok) x.ok = true;
        if (o.side) x.side = String(o.side).trim();
        ["title", "text", "anchor", "tip"].forEach(k => { if (o[k]) x[k] = String(o[k]); });
        if (o.delta && typeof o.delta === "object") {
          x.delta = {};
          Object.entries(o.delta).forEach(([k, v]) => { const n = Number(v); if (!isNaN(n) && n) x.delta[k] = n; });
        }
        return x;
      })
    })),
    endings: Array.isArray(sc.endings) ? sc.endings.map(en => ({
      type: ["score", "minDim", "weakest", "default"].includes(en.type) ? en.type : "default",
      min: en.min === undefined ? undefined : Number(en.min),
      dim: en.dim || undefined,
      emoji: en.emoji || "🎯",
      title: String(en.title || "").trim(),
      text: String(en.text || "").trim()
    })) : [],
    sections: Array.isArray(sc.sections) ? sc.sections.map(s => ({ title: String(s.title || ""), html: String(s.html || "") })) : [],
    discuss: Array.isArray(sc.discuss) ? sc.discuss.map(x => String(x)).filter(Boolean) : [],
    takeaways: Array.isArray(sc.takeaways) ? sc.takeaways.map(x => String(x)).filter(Boolean) : [],
    updatedAt: Date.now()
  };
  return { scenario: out };
}

/* ---------- CRUD ---------- */
function list() {
  return loadAll().map(s => ({
    id: s.id, title: s.title, subtitle: s.subtitle, emoji: s.emoji, mode: s.mode,
    cover: s.cover || null,
    stages: (s.stages || []).length, updatedAt: s.updatedAt || 0
  }));
}

function get(id) {
  return loadAll().find(s => s.id === id) || null;
}

function upsert(sc) {
  const { scenario, error } = normalize(sc);
  if (error) return { ok: false, error };
  const arr = loadAll();
  const i = arr.findIndex(s => s.id === scenario.id);
  if (i >= 0) arr[i] = scenario; else arr.push(scenario);
  if (!persist()) return { ok: false, error: ["保存到磁盘失败（部署环境可能不允许写入）"] };
  return { ok: true, scenario };
}

function remove(id) {
  const arr = loadAll();
  const i = arr.findIndex(s => s.id === id);
  if (i < 0) return { ok: false, error: ["找不到该情景"] };
  if (arr.length <= 1) return { ok: false, error: ["至少保留一个情景"] };
  arr.splice(i, 1);
  persist();
  return { ok: true };
}

/* 导入：整体替换或按 id 合并 */
function importAll(data, mode) {
  const arr = Array.isArray(data) ? data : (data && data.scenarios);
  if (!Array.isArray(arr)) return { ok: false, error: ["导入内容不是情景数组"] };
  const clean = [];
  const errs = [];
  arr.forEach((s, i) => {
    const { scenario, error } = normalize(s);
    if (error) errs.push("第 " + (i + 1) + " 个：" + error.join("；"));
    else clean.push(scenario);
  });
  if (!clean.length) return { ok: false, error: errs.length ? errs : ["没有可用情景"] };
  if (mode === "replace") cache = clean;
  else {
    const base = loadAll().slice();
    clean.forEach(s => {
      const i = base.findIndex(x => x.id === s.id);
      if (i >= 0) base[i] = s; else base.push(s);
    });
    cache = base;
  }
  persist();
  return { ok: true, count: clean.length, skipped: errs };
}

module.exports = { loadAll, list, get, upsert, remove, importAll, FILE };
