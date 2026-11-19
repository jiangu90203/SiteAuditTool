// 開發驗證用途；執行時指定 PLAYWRIGHT_MODULE，或本機已安裝 playwright。
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {crc32} from '../assets/zip.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=await fs.mkdtemp(path.join(os.tmpdir(),'siteaudit-pages-test-'));
let png,jpeg,webp;
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.md':'text/plain'};
const frontend=http.createServer(async(req,res)=>{
  try {
    const raw=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(!raw.startsWith('/project/')){res.writeHead(404);res.end();return;}
    const rel=raw.slice(9)||'index.html',file=path.resolve(root,rel);
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    res.setHeader('content-type',types[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));
  }catch{res.writeHead(404);res.end();}
});
const upstream=http.createServer((req,res)=>{
  if(!req.url.startsWith('/blocked'))res.setHeader('Access-Control-Allow-Origin','*');
  if(req.url.startsWith('/bad.jpg')){res.setHeader('content-type','image/jpeg');res.end('<html>Denied</html>');return;}
  if(req.url.startsWith('/photo.jpg')){res.setHeader('content-type','image/jpeg');res.end(png);return;}
  if(req.url==='/robots.txt'){res.end('User-agent: *\nAllow: /\nSitemap: '+upstreamURL+'/sitemap.xml');return;}
  if(req.url==='/sitemap.xml'){res.setHeader('content-type','application/xml');res.end('<urlset><url><loc>'+upstreamURL+'/page</loc></url></urlset>');return;}
  if(req.url==='/style.css'){res.setHeader('content-type','text/css');res.end('body{background-image:url("/photo.jpg")}');return;}
  if(req.url.startsWith('/slow')){setTimeout(()=>res.end('<html><title>Slow</title></html>'),2500);return;}
  if(req.url.startsWith('/redirect')){res.writeHead(302,{Location:'/page'});res.end();return;}
  res.setHeader('content-type','text/html');res.end(`<!doctype html><html lang="zh-TW"><head><title>商品測試</title><meta name="description" content="測試"><meta property="product:retailer_item_id" content="SKU001"><meta property="og:image" content="/photo.jpg"><link rel="stylesheet" href="/style.css"></head><body><h1>商品</h1><img src="/photo.jpg" alt="透明商品圖"><img src="/bad.jpg"><a href="/second">第二頁</a><a href="https://example.org/">外站</a><form><input name="test" required></form><script>window.IMPORT_EXECUTED=true</script></body></html>`);
});
await new Promise(r=>frontend.listen(0,'127.0.0.1',r));await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
const appURL=`http://127.0.0.1:${frontend.address().port}/project/`,upstreamURL=`http://127.0.0.1:${upstream.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({acceptDownloads:true,viewport:{width:1365,height:960}}),page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let passed=0;
async function step(label,fn){await fn();passed++;console.log('PASS '+label);}
async function idle(){await page.waitForFunction(()=>!document.querySelector('#run').disabled);}
async function downloadClick(selector){const event=page.waitForEvent('download');await page.click(selector);const d=await event;const dest=path.join(output,d.suggestedFilename());await d.saveAs(dest);await idle();return fs.readFile(dest);}
function unzip(bytes){
  const out=new Map();let offset=0;
  while(bytes.readUInt32LE(offset)===0x04034b50){
    const size=bytes.readUInt32LE(offset+18),nl=bytes.readUInt16LE(offset+26),ex=bytes.readUInt16LE(offset+28),name=bytes.subarray(offset+30,offset+30+nl).toString('utf8'),start=offset+30+nl+ex,data=bytes.subarray(start,start+size);
    assert.equal(crc32(data),bytes.readUInt32LE(offset+14));out.set(name,data);offset=start+size;
  }return out;
}
async function setImagesLocal(files){await page.click('[data-mode=images]');await page.selectOption('#source','local');await page.click('#clear-files');await page.setInputFiles('#local-files',files);await page.click('#run');await idle();}
try{
  await page.goto(appURL);
  const generated=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;const ctx=canvas.getContext('2d');ctx.fillStyle='rgba(20,120,220,.7)';ctx.fillRect(0,0,64,32);
    const result={};for(const type of ['png','jpeg','webp'])result[type]=canvas.toDataURL('image/'+type).split(',')[1];return result;
  });png=Buffer.from(generated.png,'base64');jpeg=Buffer.from(generated.jpeg,'base64');webp=Buffer.from(generated.webp,'base64');
  await step('GitHub Pages 子路徑載入、原格式預設',async()=>{
    await page.click('[data-mode=settings]');assert.equal(await page.inputValue('#format'),'keep');assert.equal(await page.isChecked('#compress'),false);assert.equal(await page.locator('script[src^="./"]').count(),1);
  });
  await step('本機 PNG 偽裝 .jpg，原格式逐位元保留並更正副檔名',async()=>{
    await setImagesLocal([{name:'disguised.jpg',mimeType:'image/jpeg',buffer:png}]);assert.match(await page.textContent('#selected-count'),/1／1/);
    const event=page.waitForEvent('download');await page.click('#export');const d=await event;assert.equal(d.suggestedFilename(),'disguised.png');const dest=path.join(output,'original.png');await d.saveAs(dest);await idle();assert.deepEqual(await fs.readFile(dest),png);
  });
  for(const [fmt,bytes,extension] of [['jpeg',jpeg,'jpg'],['png',png,'png'],['webp',webp,'webp']])await step('無壓縮也真正轉 '+fmt,async()=>{
    await page.click('[data-mode=settings]');await page.selectOption('#format','image/'+fmt);await page.click('#save-settings');await page.click('[data-mode=images]');
    const ev=page.waitForEvent('download');await page.click('#export');const d=await ev;assert.ok(d.suggestedFilename().endsWith('.'+extension));const dest=path.join(output,'converted.'+extension);await d.saveAs(dest);await idle();const b=await fs.readFile(dest);
    if(fmt==='jpeg')assert.deepEqual([...b.subarray(0,3)],[255,216,255]);if(fmt==='png')assert.deepEqual([...b.subarray(0,8)],[137,80,78,71,13,10,26,10]);if(fmt==='webp')assert.equal(b.subarray(8,12).toString(),'WEBP');
  });
  await step('重啟還原已儲存設定',async()=>{await page.reload();await page.click('[data-mode=settings]');assert.equal(await page.inputValue('#format'),'image/webp');await page.click('#reset-settings');assert.equal(await page.inputValue('#format'),'keep');});
  await step('多張 ZIP、重複檔名、CRC32、不同原格式',async()=>{
    await setImagesLocal([{name:'first.jpg',mimeType:'image/jpeg',buffer:png},{name:'second.jpg',mimeType:'image/jpeg',buffer:jpeg}]);
    const zip=unzip(await downloadClick('#export'));assert.equal(zip.size,2);assert.deepEqual(zip.get('images/first.png'),png);assert.deepEqual(zip.get('images/second.jpg'),jpeg);
  });
  await step('取消全選阻止空下載',async()=>{await page.click('#select-none');assert.equal(await page.isDisabled('#export'),true);await page.click('#select-all');});
  await step('白底方形／縮放／智慧命名／QA 與失敗清單',async()=>{
    await page.click('[data-mode=settings]');await page.check('#standardize');await page.check('#smart-naming');await page.check('#qa-report');await page.check('#compress');await page.selectOption('#max-width','400');await page.click('#save-settings');await page.click('[data-mode=images]');
    const zip=unzip(await downloadClick('#export'));assert.ok(zip.has('bulk_import.csv'));assert.ok(zip.has('qa_grid.html'));assert.ok(zip.has('missing_images.html'));
    const dims=await page.evaluate(async(data)=>{const b=await createImageBitmap(new Blob([new Uint8Array(data)]));return [b.width,b.height];},[...zip.get('images/item_001.png')]);assert.deepEqual(dims,[64,64]);
    await page.click('[data-mode=settings]');await page.click('#reset-settings');
  });
  await step('CORS 網址讀取、錯誤 MIME 修正、HTML 假圖片排除',async()=>{
    await page.click('[data-mode=images]');await page.selectOption('#source','url');await page.fill('#url',upstreamURL+'/page');await page.click('#run');await idle();assert.match(await page.textContent('#selected-count'),/1／1/);assert.match(await page.textContent('#summary'),/失敗1/);assert.equal(await page.evaluate(()=>window.IMPORT_EXECUTED),undefined);
    const zip=unzip(await downloadClick('#export'));assert.deepEqual(zip.get('images/photo.png'),png);assert.ok(zip.has('missing_images.html'));
  });
  await step('批次圖片按頁面分資料夾且確實轉 JPEG',async()=>{
    await page.click('[data-mode=settings]');await page.selectOption('#format','image/jpeg');await page.click('#save-settings');await page.click('[data-mode=images]');await page.check('#batch');await page.fill('#batch-urls',upstreamURL+'/page\n'+upstreamURL+'/second');await page.click('#run');await idle();
    const zip=unzip(await downloadClick('#export')),names=[...zip.keys()].filter(n=>n.endsWith('.jpg'));assert.equal(names.length,2);assert.ok(names.some(n=>n.startsWith('01_')));assert.ok(names.some(n=>n.startsWith('02_')));for(const name of names)assert.deepEqual([...zip.get(name).subarray(0,3)],[255,216,255]);await page.uncheck('#batch');
  });
  await step('CORS 被拒絕時不顯示假成功',async()=>{
    await page.fill('#url',upstreamURL+'/blocked');await page.click('#run');await idle();assert.match(await page.textContent('#status'),/沒有成功/);assert.equal(await page.isVisible('#picker'),false);assert.equal(await page.isVisible('#result-panel'),false);
  });
  await step('HTML 匯入與本機資源對應，不執行腳本／惡意標籤',async()=>{
    await page.selectOption('#source','html');await page.fill('#url','https://local.invalid/');await page.fill('#html-input','<title>匯入頁</title><img src="first.jpg"><script>window.IMPORT_EXECUTED=true</script>');await page.click('#run');await idle();assert.match(await page.textContent('#selected-count'),/1／1/);assert.equal(await page.evaluate(()=>window.IMPORT_EXECUTED),undefined);
  });
  await step('資訊分析、robots／sitemap、報告 JSON/CSV/source ZIP',async()=>{
    await page.click('[data-mode=audit]');await page.selectOption('#source','url');await page.fill('#url',upstreamURL+'/redirect');await page.locator('#depth').evaluate(e=>{e.value='2';e.dispatchEvent(new Event('input'));});await page.click('#run');await idle();
    const zip=unzip(await downloadClick('#actions button:first-child')),report=JSON.parse(zip.get('results.json').toString());assert.equal(report.results.length,2);assert.equal(report.results[0].meta.title,'商品測試');assert.equal(report.robots_info.status,'PASS');assert.equal(report.sitemap_urls.length,1);assert.ok(zip.has('links.csv'));assert.ok(zip.has('source/page_1_view.html'));assert.equal(report.results[0].stats.forms_count,1);
  });
  await step('靜態鏡像資源與 CSS 相對連結改寫',async()=>{
    await page.click('[data-mode=mirror]');await page.locator('#maxpages').evaluate(e=>{e.value='1';e.dispatchEvent(new Event('input'));});await page.click('#run');await idle();const zip=unzip(await downloadClick('#actions button:first-child'));assert.ok(zip.has('index.html'));assert.ok(zip.has('_mirror_manifest.json'));const html=zip.get('index.html').toString();assert.match(html,/assets\/0001_style.css/);assert.match(zip.get('assets/0001_style.css').toString(),/url\("0002_photo.png"\)/);
  });
  await step('取消慢速工作可重新操作',async()=>{
    await page.click('[data-mode=images]');await page.fill('#url',upstreamURL+'/slow');await page.click('#run');await page.click('#cancel');await idle();assert.match(await page.textContent('#status'),/沒有成功|取消/);assert.equal(await page.isDisabled('#run'),false);
  });
  await step('無效本機圖片不產生假成功',async()=>{
    await page.selectOption('#source','local');await page.click('#clear-files');await page.setInputFiles('#local-files',{name:'fake.jpg',mimeType:'image/jpeg',buffer:Buffer.from('<html>blocked</html>')});await page.click('#run');await idle();assert.match(await page.textContent('#status'),/沒有通過/);assert.equal(await page.isVisible('#picker'),false);
  });
  await step('手機導覽與桌面無水平溢位',async()=>{
    await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('[data-mode=settings]').isVisible());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.click('[data-mode=settings]');assert.equal(await page.isVisible('#format'),true);await page.setViewportSize({width:1365,height:960});
  });
  await step('設定儲存失敗有提示且不崩潰',async()=>{
    await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('blocked','SecurityError');};});await page.click('#save-settings');assert.match(await page.textContent('#settings-status'),/失敗/);
  });
  await page.reload();await page.click('[data-mode=images]');await page.selectOption('#source','local');await page.click('#clear-files');await page.setInputFiles('#local-files',[{name:'sample.jpg',mimeType:'image/jpeg',buffer:png},{name:'banner.webp',mimeType:'image/webp',buffer:webp}]);await page.click('#run');await idle();
  await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log(`RESULT ${passed} browser checks PASS; no uncaught page errors. Artifacts: ${output}`);
}finally{await browser.close();frontend.close();upstream.close();}
