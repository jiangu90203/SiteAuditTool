export const DEFAULTS = Object.freeze({
  file_types: ['jpg', 'jpeg', 'png', 'webp'], jpeg_quality: 80,
  max_width: 0, output_format: 'keep', zip_multiple: true,
  theme: 'dark', smart_naming: false, standardize: false, qa_report: false,
  compress: false,
});
export const STORAGE_KEY = 'siteaudit-pages-v23';
export const LIMITS = Object.freeze({file: 30 * 1024 * 1024, total: 250 * 1024 * 1024, images: 500, pages: 50, assets: 300});
export function normalizeConfig(raw = {}) {
  if (!raw || typeof raw !== 'object') raw = {};
  const formats = ['keep', 'image/jpeg', 'image/png', 'image/webp'];
  return {...DEFAULTS,
    theme: raw.theme === 'light' ? 'light' : 'dark',
    output_format: formats.includes(raw.output_format) ? raw.output_format : 'keep',
    jpeg_quality: Math.min(95, Math.max(30, Number(raw.jpeg_quality) || 80)),
    max_width: [0, 2560, 1920, 1280, 800, 400].includes(Number(raw.max_width)) ? Number(raw.max_width) : 0,
    file_types: Array.isArray(raw.file_types) ? raw.file_types.filter(x => ['jpg','jpeg','png','webp','gif','avif','svg','ico','bmp','tiff'].includes(x)) : [...DEFAULTS.file_types],
    ...Object.fromEntries(['zip_multiple','smart_naming','standardize','qa_report','compress'].map(k => [k, typeof raw[k] === 'boolean' ? raw[k] : DEFAULTS[k]])),
  };
}
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function normalizeURL(value) {
  let s = String(value || '').trim();
  if (!s) throw new Error('請輸入網址。');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('僅接受不含帳密的 HTTP／HTTPS 網址。');
  u.hash = '';
  return u.href;
}
export function resolveURL(raw, base, allowData = false) {
  try {
    const u = new URL(raw, base);
    return ['http:', 'https:'].includes(u.protocol) || (allowData && u.protocol === 'data:') ? u.href : '';
  } catch { return ''; }
}
export function safeToken(value, fallback = 'image') {
  const s = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^[. ]+|[. _]+$/g, '').slice(0, 70);
  return s && s !== '.' && s !== '..' ? (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s) ? '_' + s : s) : fallback;
}
export function stemFromURL(url) {
  try { return safeToken(decodeURIComponent(new URL(url).pathname.split('/').pop()).replace(/\.[^.]+$/, ''), 'image'); }
  catch { return 'image'; }
}
export function uniqueName(name, used) {
  const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0,dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  let out = name, i = 0;
  while (used.has(out.toLowerCase())) out = `${stem}_${++i}${ext}`;
  used.add(out.toLowerCase()); return out;
}
export function csv(rows) {
  return '\uFEFF' + rows.map(row => row.map(v => {
    let s = String(v ?? '');
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s; // 防止 Excel 公式注入
    return '"' + s.replace(/"/g, '""') + '"';
  }).join(',')).join('\r\n');
}
export function reportHTML(title, body) {
  return `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHTML(title)}</title><style>body{max-width:1200px;margin:32px auto;padding:0 20px;font:15px/1.7 system-ui;color:#26333d}h1{font-size:24px}table{width:100%;border-collapse:collapse}td,th{padding:8px;border:1px solid #ddd;word-break:break-word;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}.grid img{max-width:100%;height:160px;object-fit:contain}.bad{border:2px solid #b42318;padding:8px}a{color:#0078d4}</style></head><body><h1>${escapeHTML(title)}</h1>${body}</body></html>`;
}
export function stamp() { return new Date().toISOString().replace(/[-:]/g,'').replace('T','_').slice(0,15); }
export function download(blob, filename) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function publicURL(url) {
  try { const u = new URL(url); return u.protocol==='data:'?'data:（內嵌圖片）':u.origin + u.pathname; } catch { return String(url).slice(0,100); }
}
export async function fetchBytes(url, {signal, maxBytes = LIMITS.file} = {}) {
  if (new URL(url).hostname === 'local.invalid') throw new Error('此為本機匯入內容；請一併匯入對應的圖片／資源檔。');
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once:true});
  const timer = setTimeout(() => controller.abort(new Error('讀取逾時（30 秒）')), 30000);
  try {
    const response = await fetch(url, {mode:'cors', credentials:'omit', signal:controller.signal, referrerPolicy:'no-referrer'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('單檔超過 30 MB 上限。');
    const chunks = []; let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const {done, value} = await reader.read(); if (done) break;
          size += value.length;
          if (size > maxBytes) { await reader.cancel(); throw new Error('單檔超過 30 MB 上限。'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    } else {
      const value = new Uint8Array(await response.arrayBuffer());
      if (value.length > maxBytes) throw new Error('單檔超過 30 MB 上限。');
      chunks.push(value);
    }
    return {blob:new Blob(chunks, {type:response.headers.get('content-type') || ''}), url:response.url || url, status_code:response.status};
  } catch (error) {
    if (controller.signal.aborted) throw new Error(signal?.aborted ? '已取消操作。' : '讀取逾時（30 秒）。');
    if (error instanceof TypeError) throw new Error('無法讀取：來源可能未允許 CORS、網路中斷、憑證失效或被瀏覽器阻擋。可改用 HTML／本機資源匯入。');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
