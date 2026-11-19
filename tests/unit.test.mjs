import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig,normalizeURL,safeToken,uniqueName,escapeHTML,csv,resolveURL,fetchBytes} from '../assets/utils.js';
import {detectFormat,typeAllowed} from '../assets/images.js';
import {crc32,buildZip,safeZipPath} from '../assets/zip.js';

test('預設保持原格式且不啟用壓縮／標準化',()=>{
  const cfg=normalizeConfig();assert.equal(cfg.output_format,'keep');assert.equal(cfg.compress,false);assert.equal(cfg.standardize,false);assert.equal(cfg.zip_multiple,true);
});
test('舊／無效設定回復合法值',()=>{
  const c=normalizeConfig({output_format:'xxx',jpeg_quality:500,max_width:-1,compress:'false',file_types:['jpg','exe']});
  assert.equal(c.output_format,'keep');assert.equal(c.jpeg_quality,95);assert.equal(c.max_width,0);assert.equal(c.compress,false);assert.deepEqual(c.file_types,['jpg']);assert.equal(normalizeConfig(null).output_format,'keep');
});
test('網址僅允許 HTTP(S) 並拒絕內嵌帳密',()=>{
  assert.equal(normalizeURL('example.com/a#x'),'https://example.com/a');
  for(const u of ['javascript:alert(1)','file:///tmp/a','https://a:b@example.com',''])assert.throws(()=>normalizeURL(u));
  assert.equal(resolveURL('../img.png','https://example.com/a/b'),'https://example.com/img.png');assert.equal(resolveURL('javascript:alert(1)','https://example.com/'),'');
});
test('Windows 檔名與重複命名',()=>{
  assert.equal(safeToken('../CON'),'_CON');assert.equal(safeToken('..'),'image');assert.equal(safeToken('A:/B*'),'AB');
  const used=new Set();assert.equal(uniqueName('images/A.jpg',used),'images/A.jpg');assert.equal(uniqueName('images/a.jpg',used),'images/a_1.jpg');assert.equal(uniqueName('images/a_1.jpg',used),'images/a_1_1.jpg');
});
test('HTML 與 CSV 不執行輸入',()=>{
  assert.equal(escapeHTML('<script>"x"</script>'),'&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  assert.match(csv([['=1+1','@x','a"b','正常']]),/"'=1\+1"/);assert.match(csv([['a"b']]),/a""b/);
});
test('以 magic bytes 識別 PNG／JPEG／WebP，不依檔名 MIME',()=>{
  const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);assert.equal(detectFormat(png),'PNG');
  assert.equal(detectFormat(new Uint8Array([255,216,255,0,0,0,0,0,0,0,0,0])),'JPEG');
  assert.equal(detectFormat(new TextEncoder().encode('RIFF0000WEBPxxxx')),'WEBP');
  assert.throws(()=>detectFormat(new TextEncoder().encode('<html>blocked</html>')));assert.throws(()=>detectFormat(new Uint8Array(0)));
});
test('JPEG jpg/jpeg 視為同格式',()=>{
  assert.equal(typeAllowed('JPEG',['jpeg']),true);assert.equal(typeAllowed('PNG',['jpg']),false);assert.equal(typeAllowed('PNG',[]),false);
});
test('CRC32 與零依賴 UTF-8 ZIP',async()=>{
  assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
  const zip=await buildZip([{name:'圖片/原檔.png',data:new Uint8Array([1,2,3])}]);
  const b=new Uint8Array(await zip.arrayBuffer()),v=new DataView(b.buffer);assert.equal(v.getUint32(0,true),0x04034b50);assert.equal(v.getUint16(6,true),0x0800);
  const length=v.getUint16(26,true);assert.equal(new TextDecoder().decode(b.slice(30,30+length)),'圖片/原檔.png');assert.deepEqual([...b.slice(30+length,33+length)],[1,2,3]);
});
test('ZIP 拒絕 traversal、磁碟路徑與重複項目',async()=>{
  for(const p of ['../a','a/../b','/a','a\\b','C:/a','a//b','a/./b','a\0b'])assert.throws(()=>safeZipPath(p));
  await assert.rejects(buildZip([{name:'a',data:'a'},{name:'a',data:'b'}]),/重複/);
});
test('網路讀取不帶登入憑證，並保留最終網址與內容',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    assert.equal(options.credentials,'omit');assert.equal(options.mode,'cors');assert.equal(options.referrerPolicy,'no-referrer');
    const r=new Response(new Uint8Array([1,2,3]),{status:200,headers:{'Content-Type':'image/png'}});Object.defineProperty(r,'url',{value:'https://example.com/final.png'});return r;
  };
  try{const r=await fetchBytes('https://example.com/start');assert.equal(r.url,'https://example.com/final.png');assert.deepEqual([...new Uint8Array(await r.blob.arrayBuffer())],[1,2,3]);}
  finally{globalThis.fetch=original;}
});
test('HTTP、CORS/網路錯誤不變成成功資料',async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response('error',{status:503});await assert.rejects(fetchBytes('https://example.com/'),/HTTP 503/);
    globalThis.fetch=async()=>{throw new TypeError('Failed to fetch');};await assert.rejects(fetchBytes('https://example.com/'),/CORS/);
  }finally{globalThis.fetch=original;}
});
test('取消讀取與本機匯入缺檔可辨識',async()=>{
  const original=globalThis.fetch,controller=new AbortController();controller.abort();
  globalThis.fetch=async(_,options)=>{assert.equal(options.signal.aborted,true);throw new DOMException('Aborted','AbortError');};
  try{await assert.rejects(fetchBytes('https://example.com/',{signal:controller.signal}),/取消/);await assert.rejects(fetchBytes('https://local.invalid/missing.png'),/本機匯入/);}
  finally{globalThis.fetch=original;}
});
test('宣告或串流超過上限時拒絕資料',async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response('x',{status:200,headers:{'Content-Length':'100'}});await assert.rejects(fetchBytes('https://example.com/',{maxBytes:2}),/上限/);
    globalThis.fetch=async()=>new Response(new Uint8Array([1,2,3]),{status:200});await assert.rejects(fetchBytes('https://example.com/',{maxBytes:2}),/上限/);
  }finally{globalThis.fetch=original;}
});
