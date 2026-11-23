/* 把 .docx / .pptx / .txt / .md 里的文字抽出来（零第三方依赖）
   - docx/pptx 本质是 zip：自己读中央目录，用 zlib.inflateRawSync 解压
   - 再用正则取 <w:t> / <a:t> 文本，按段落换行
   导出 parseFile(buf, filename) → { ok, kind, title, text, count, warning } */
const zlib = require("zlib");

/* ---------- 极简 zip 读取 ---------- */
function openZip(buf) {
  let eo = -1;
  const min = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eo = i; break; }
  }
  if (eo < 0) throw new Error("这不是有效的 Office 文件（找不到 zip 结构）");
  const count = buf.readUInt16LE(eo + 10);
  let off = buf.readUInt32LE(eo + 16);
  const files = Object.create(null);
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nlen);
    files[name] = { method, csize, lho };
    off += 46 + nlen + elen + clen;
  }
  return {
    names: Object.keys(files),
    read(name) {
      const f = files[name];
      if (!f) return null;
      const lnlen = buf.readUInt16LE(f.lho + 26);
      const lelen = buf.readUInt16LE(f.lho + 28);
      const start = f.lho + 30 + lnlen + lelen;
      const raw = buf.subarray(start, start + f.csize);
      if (f.method === 0) return raw.toString("utf8");
      if (f.method === 8) return zlib.inflateRawSync(raw).toString("utf8");
      return null;
    }
  };
}

/* ---------- XML 实体 ---------- */
function decodeEnt(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/* 按段落取文本：<w:p> / <a:p> 之间是一个自然段 */
function paragraphs(xml) {
  const out = [];
  const segs = String(xml).split(/<\/w:p>|<\/a:p>/);
  for (const seg of segs) {
    const ts = [...seg.matchAll(/<(?:w|a):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:w|a):t>/g)].map(m => decodeEnt(m[1]));
    const line = ts.join("").replace(/\s+/g, " ").trim();
    if (line) out.push(line);
  }
  return out;
}

function slideNo(name) {
  const m = name.match(/slide(\d+)\.xml$/i);
  return m ? parseInt(m[1], 10) : 0;
}

function cleanJoin(parts, sep) {
  return parts.join(sep || "\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ---------- 主入口 ---------- */
function parseFile(buf, filename) {
  const name = String(filename || "").toLowerCase();
  const ext = (name.match(/\.([a-z0-9]+)$/) || [, ""])[1];

  if (ext === "txt" || ext === "md" || ext === "markdown") {
    const text = buf.toString("utf8").replace(/\r\n?/g, "\n").trim();
    return { ok: true, kind: "text", title: "", text: text.slice(0, 120000), count: text.split(/\n\s*\n/).filter(Boolean).length };
  }

  if (ext === "doc" || ext === "ppt") {
    return { ok: false, error: "老格式 ." + ext + " 读不了，请在 Office/WPS 里「另存为」.doc" + (ext === "ppt" ? "t" : "x") + " 后再上传。" };
  }

  if (ext !== "docx" && ext !== "pptx") {
    return { ok: false, error: "只支持 .docx / .pptx / .txt / .md" };
  }

  let zip;
  try { zip = openZip(buf); } catch (e) { return { ok: false, error: e.message }; }

  if (ext === "docx") {
    const xml = zip.read("word/document.xml");
    if (!xml) return { ok: false, error: "这个 .docx 里没有正文（可能是加密文档或损坏）" };
    const ps = paragraphs(xml);
    if (!ps.length) return { ok: false, error: "文档里没有抽到文字（可能是纯图片扫描件）" };
    /* 标题：取第一个短段落 */
    const title = ps[0] && ps[0].length <= 40 ? ps[0] : "";
    const body = title ? ps.slice(1) : ps;
    /* 教案类文档“一段一行”，用单换行连接；后续按小标题切幕 */
    return { ok: true, kind: "docx", title, text: cleanJoin(body, "\n").slice(0, 120000), count: body.length };
  }

  /* pptx */
  const slides = zip.names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => slideNo(a) - slideNo(b));
  if (!slides.length) return { ok: false, error: "这个 .pptx 里没有幻灯片" };
  const chunks = [];
  slides.forEach((s, i) => {
    const xml = zip.read(s);
    if (!xml) return;
    const ps = paragraphs(xml);
    if (!ps.length) return;
    chunks.push("【第" + (i + 1) + "页】" + ps.join(" "));
  });
  if (!chunks.length) return { ok: false, error: "幻灯片里没有抽到文字（可能是纯图片页）" };
  return { ok: true, kind: "pptx", title: "", text: cleanJoin(chunks).slice(0, 120000), count: chunks.length };
}

module.exports = { parseFile, openZip, paragraphs };
