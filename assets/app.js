import {DEFAULTS,STORAGE_KEY,LIMITS,normalizeConfig,normalizeURL,resolveURL,safeToken,stemFromURL,uniqueName,escapeHTML,csv,reportHTML,stamp,download,publicURL,fetchBytes} from './utils.js';
import {buildZip} from './zip.js';
import {FORMATS,inspectImage,transformImage,typeAllowed} from './images.js';
import {parseDocument,parsePage,extractImages,productInfo} from './parser.js';
import {createMirror} from './mirror.js';

const $=id=>document.getElementById(id);
let cfg=normalizeConfig(),mode='audit',busy=false,controller=null;
let items=[],failures=[],selected=new Set(),lastPages=[];
const localFiles=new Map(),history=[];
function log(message,type='info') {
  const el=document.createElement('div');el.className='ll '+type;el.textContent=message;$('log').append(el);
  while($('log').children.length>600)$('log').firstChild.remove();$('log').scrollTop=$('log').scrollHeight;
}
function status(message){$('status').textContent=message;}
function loadConfig(){try{cfg=normalizeConfig(JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}'));}catch(error){log('設定無法讀取，已使用預設值：'+error.message,'warn');cfg=normalizeConfig();}}
function applyConfig(){
  document.body.dataset.theme=cfg.theme;$('format').value=cfg.output_format;$('quality').value=cfg.jpeg_quality;$('quality-val').textContent=cfg.jpeg_quality+'%';$('max-width').value=cfg.max_width;
  for(const [id,key] of [['compress','compress'],['zip-multiple','zip_multiple'],['smart-naming','smart_naming'],['standardize','standardize'],['qa-report','qa_report']])$(id).checked=cfg[key];
  $('file-types').replaceChildren();
  for(const type of ['jpg','jpeg','png','webp','gif','avif','svg','ico','bmp','tiff']){
    const label=document.createElement('label');label.className='ftchk';const input=document.createElement('input');input.type='checkbox';input.value=type;input.checked=cfg.file_types.includes(type);label.append(input,type.toUpperCase());$('file-types').append(label);
  }
  pickerHint();
}
function readConfig(){return normalizeConfig({...cfg,output_format:$('format').value,jpeg_quality:Number($('quality').value),max_width:Number($('max-width').value),compress:$('compress').checked,zip_multiple:$('zip-multiple').checked,smart_naming:$('smart-naming').checked,standardize:$('standardize').checked,qa_report:$('qa-report').checked,file_types:[...$('file-types').querySelectorAll('input:checked')].map(e=>e.value)});}
function persist(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(cfg));return true;}catch(error){log('設定儲存失敗：'+error.message,'error');return false;}}
function setMode(next){
  if(busy)return;mode=next;
  document.querySelectorAll('[data-mode]').forEach(e=>e.classList.toggle('active',e.dataset.mode===mode));
  document.querySelectorAll('.mode-panel').forEach(e=>e.hidden=e.id!=='mode-'+mode);
  $('source-panel').hidden=mode==='settings';$('run-wrap').hidden=mode==='settings';$('run').textContent={audit:'開始資訊擷取',mirror:'建立靜態鏡像 ZIP',images:'開始圖片擷取'}[mode]||'';
  if(mode!=='settings'&&mode!=='images'&&$('source').value==='local'){$('source').value='html';sourceChanged();}
  $('source').querySelector('[value="local"]').disabled=mode!=='images';
}
function sourceChanged(){
  const source=$('source').value;$('url-source').hidden=source!=='url';$('html-source').hidden=source!=='html';$('batch-urls').hidden=!$('batch').checked;
}
function pickerHint(){if($('picker-settings'))$('picker-settings').textContent=`輸出：${cfg.output_format==='keep'?'原格式':cfg.output_format.replace('image/','').toUpperCase()} ｜ ${cfg.compress?'壓縮／縮放開':'壓縮關'} ｜ ${cfg.standardize?'白底方形開':'標準化關'}。可在「設定」調整；單張直接下載，多張預設 ZIP。`;}
function setBusy(value){
  busy=value;
  for(const el of document.querySelectorAll('button,input,select,textarea')) {
    if(el.id==='cancel'){el.disabled=!value;continue;}
    if(value){el.dataset.previousDisabled=String(el.disabled);el.disabled=true;}
    else if('previousDisabled' in el.dataset){el.disabled=el.dataset.previousDisabled==='true';delete el.dataset.previousDisabled;}
  }
  if(!value){$('run').disabled=false;$('cancel').disabled=true;updateSelection();}
}
function checkAbort(){if(controller?.signal.aborted)throw new Error('已取消操作。');}
function releaseItems(){for(const it of items)URL.revokeObjectURL(it.preview);items=[];selected.clear();$('image-grid').replaceChildren();$('picker').hidden=true;}
function recordHistory(label,ok){history.unshift({label,mode,ok});history.splice(8);$('history').replaceChildren();for(const h of history){const e=document.createElement('div');e.className='hist-item';e.textContent=`${h.ok?'✓':'✗'} ${h.label}`;$('history').append(e);}}
function addLocal(files){
  let total=[...localFiles.values()].reduce((n,f)=>n+f.size,0);
  for(const file of files){
    const key=file.webkitRelativePath||file.name;
    if(file.size>LIMITS.file){log(`本機檔案略過：${safeToken(file.name)} 超過 30 MB`,'error');continue;}
    const next=total-(localFiles.get(key)?.size||0)+file.size;
    if(next>LIMITS.total){log('本機匯入已達 250 MB 上限，其餘未匯入。','error');break;}
    total=next;localFiles.set(key,file);
  }
  $('file-count').textContent=`已匯入 ${localFiles.size} 檔／${(total/1048576).toFixed(1)} MB`;
}
function localMatch(url){
  let pathname;try{pathname=decodeURIComponent(new URL(url).pathname).replace(/^\//,'');}catch{return null;}
  const exact=[...localFiles].filter(([path])=>path===pathname||path.endsWith('/'+pathname));
  if(exact.length===1)return exact[0][1];
  const basename=pathname.split('/').pop(), matches=[...localFiles].filter(([path])=>path.split('/').pop()===basename);
  if(matches.length>1)throw new Error('本機存在多個同名檔案，無法確認對應來源；請保留資源資料夾路徑。');
  return matches[0]?.[1]||null;
}
async function resource(url,signal){
  const file=localMatch(url);if(file)return {blob:file,url,status_code:null,local:true};
  return fetchBytes(url,{signal});
}
async function loadPage(url){
  checkAbort();const r=await resource(url,controller.signal),html=await r.blob.text();
  if(!/<(?:!doctype\s+html|html|head|body|title|div|img|p|meta|a|section|main)[\s>]/i.test(html))throw new Error('回應不是可辨識的 HTML。');
  return {html,url:r.url||url,requestURL:url,fetch_info:{status_code:r.status_code,local_import:!!r.local,ssl_details:'瀏覽器版無法讀取憑證細節'}};
}
async function sourcePages(){
  if($('source').value==='html') {
    const html=$('html-input').value;if(!html.trim())throw new Error('請貼上或匯入 HTML。');
    if(new Blob([html]).size>LIMITS.file)throw new Error('HTML 超過 30 MB。');
    const url=$('url').value.trim()?normalizeURL($('url').value):'https://local.invalid/';
    return [{html,url,requestURL:url,fetch_info:{local_import:true,status_code:null}}];
  }
  const urls=($('batch').checked?$('batch-urls').value.split(/\r?\n/):[$('url').value]).map(x=>x.trim()).filter(Boolean).map(normalizeURL);
  if(!urls.length)throw new Error('請輸入至少一個網址。');
  if(urls.length>LIMITS.pages)throw new Error('每次最多 50 個頁面。');
  const pages=[];
  for(const url of new Set(urls)){
    checkAbort();log('讀取頁面：'+publicURL(url));
    try{pages.push(await loadPage(url));}catch(error){checkAbort();failures.push({url,source:'page',error:error.message});log('頁面失敗：'+error.message,'error');}
  }
  if(!pages.length)throw new Error('沒有成功讀取的頁面。請查看記錄，或改用 HTML 匯入。');return pages;
}
async function crawl(pages,max){
  // 匯入 HTML 不自動連外遞迴，避免意外擴大操作範圍。
  if($('source').value==='html'||pages.length>=max)return pages;
  const origin=new URL(pages[0].url).origin,seen=new Set(pages.flatMap(p=>[p.url,p.requestURL]));
  let attempts=pages.length;const maxAttempts=Math.min(250,max*5);
  for(let i=0;i<pages.length&&pages.length<max;i++){
    const result=parsePage(pages[i].html,pages[i].url);
    for(const link of result.links.internal){
      const url=new URL(link.url);url.hash='';if(url.origin!==origin||seen.has(url.href))continue;seen.add(url.href);
      if(attempts++>=maxAttempts){failures.push({url:url.href,source:'crawl',error:'已達遞迴嘗試上限，未繼續擷取。'});log('已達遞迴嘗試上限，未繼續擷取。','warn');return pages;}
      checkAbort();try{log('遞迴讀取：'+publicURL(url.href));pages.push(await loadPage(url.href));}catch(error){checkAbort();failures.push({url:url.href,source:'page',error:error.message});log('頁面略過：'+error.message,'warn');}
      if(pages.length>=max)break;
    }
  }return pages;
}
function resultSummary(stats,detail=''){
  $('result-panel').hidden=false;$('summary').replaceChildren();$('actions').replaceChildren();$('result-detail').textContent=detail;
  for(const [label,value] of Object.entries(stats)){const card=document.createElement('div');card.className='r-card';const n=document.createElement('div');n.className='num';n.textContent=value;const l=document.createElement('div');l.className='lbl';l.textContent=label;card.append(n,l);$('summary').append(card);}
}
function action(label,fn){const b=document.createElement('button');b.className='btn-act';b.textContent=label;b.addEventListener('click',fn);$('actions').append(b);}
async function siteExtras(page){
  const data={robots:{status:'NOT RUN',content:'',url:''},sitemap_urls:[],errors:[]};
  if(page.fetch_info.local_import){data.errors.push({error:'本機匯入：未連線抓取 robots.txt／sitemap。'});return data;}
  const origin=new URL(page.url).origin;data.robots.url=origin+'/robots.txt';
  try{data.robots.content=await (await resource(data.robots.url,controller.signal)).blob.text();data.robots.status='PASS';}catch(error){checkAbort();data.robots.status='FAIL';data.errors.push({url:data.robots.url,error:error.message});}
  const roots=[...data.robots.content.matchAll(/^sitemap:\s*(.+)$/gmi)].map(m=>resolveURL(m[1].trim(),origin)).filter(Boolean);
  if(!roots.length)roots.push(origin+'/sitemap.xml');
  const seen=new Set();
  async function sitemap(url,depth=0){
    if(depth>2||data.sitemap_urls.length>=500||seen.has(url)||seen.size>=10)return;seen.add(url);
    try{
      const xml=new DOMParser().parseFromString(await (await resource(url,controller.signal)).blob.text(),'application/xml');
      if(xml.querySelector('parsererror'))throw new Error('Sitemap 不是有效 XML。');
      for(const el of xml.querySelectorAll('url > loc')){const u=resolveURL(el.textContent.trim(),url);if(u)data.sitemap_urls.push(u);if(data.sitemap_urls.length>=500)break;}
      for(const el of xml.querySelectorAll('sitemap > loc')){const u=resolveURL(el.textContent.trim(),url);if(u)await sitemap(u,depth+1);}
    }catch(error){checkAbort();data.errors.push({url,error:error.message});}
  }
  for(const root of roots.slice(0,3))await sitemap(root);
  return data;
}
function failureReport(errors){return reportHTML('擷取失敗清單',`<p>${errors.length} 項失敗／限制</p><table><tr><th>來源</th><th>網址</th><th>原因</th></tr>${errors.map(e=>`<tr><td>${escapeHTML(e.source||'')}</td><td>${escapeHTML(e.url?.startsWith('data:')?publicURL(e.url):e.url||'')}</td><td>${escapeHTML(e.error)}</td></tr>`).join('')}</table>`);}
async function audit(pages){
  const results=pages.map(p=>parsePage(p.html,p.url,p.fetch_info));
  const extras=await siteExtras(pages[0]);const errors=[...failures,...extras.errors];
  const body=results.map(r=>`<h2>${escapeHTML(r.meta.title||r.url)}</h2><p>${escapeHTML(r.url)}</p><table>${Object.entries(r.stats).map(([k,v])=>`<tr><th>${escapeHTML(k)}</th><td>${v}</td></tr>`).join('')}</table><h3>Meta／SEO</h3><pre>${escapeHTML(JSON.stringify(r.meta,null,2))}</pre><h3>標題結構</h3><pre>${escapeHTML(JSON.stringify(r.headings,null,2))}</pre>`).join('');
  const report=reportHTML('網站資訊擷取報告',body+`<p>錯誤／環境限制：${errors.length}，詳見 missing_images.html 與 JSON。SSL 憑證與完整重新導向鏈未執行。</p>`);
  const files=[{name:'report.html',data:report},{name:'results.json',data:JSON.stringify({results,site_info:{browser_only:true,broken_links:'NOT RUN',ssl_details:'NOT RUN'},robots_info:extras.robots,sitemap_urls:extras.sitemap_urls,errors},null,2)},
    {name:'summary.csv',data:csv([['url','title','links','images','words','forms'],...results.map(r=>[r.url,r.meta.title,r.stats.total_links,r.stats.images_count,r.stats.word_count,r.stats.forms_count])])},
    {name:'links.csv',data:csv([['page_url','url','text','internal'],...results.flatMap(r=>r.links.all.map(l=>[r.url,l.url,l.text,new URL(l.url).origin===new URL(r.url).origin?'Y':'N']))])},
    {name:'images.csv',data:csv([['page_url','source_url','alt','source'],...results.flatMap(r=>r.images.map(i=>[r.url,i.url,i.alt,i.source]))])},
    {name:'sitemap.csv',data:csv([['url'],...extras.sitemap_urls.map(u=>[u])])},{name:'missing_images.html',data:failureReport(errors)}];
  pages.forEach((p,i)=>files.push({name:`source/page_${i+1}.html.txt`,data:p.html},{name:`source/page_${i+1}_view.html`,data:reportHTML('HTML 原始碼檢視',`<p>${escapeHTML(p.url)}</p><pre>${escapeHTML(p.html)}</pre>`)}));
  const zip=await buildZip(files);checkAbort();
  resultSummary({'頁面':results.length,'連結':results.reduce((n,r)=>n+r.stats.total_links,0),'圖片':results.reduce((n,r)=>n+r.stats.images_count,0),'失敗／限制':errors.length},results.map(r=>r.meta.title+'\n'+r.url).join('\n\n'));
  action('下載完整報告 ZIP',()=>download(zip,`audit_${stamp()}.zip`));action('下載 JSON',()=>download(new Blob([files[1].data],{type:'application/json'}),'results.json'));action('下載 HTML 報告',()=>download(new Blob([report],{type:'text/html'}),'report.html'));
}
async function collectImages(pages){
  let total=0,candidates=0;
  async function addImage(blob,meta){
    checkAbort();const info=await inspectImage(blob);if(!typeAllowed(info.format,cfg.file_types))return;
    if(total+info.blob.size>LIMITS.total)throw new Error('圖片總量超過 250 MB 上限。');total+=info.blob.size;
    const item={...meta,...info,index:items.length,preview:URL.createObjectURL(info.blob)};items.push(item);selected.add(item.index);
  }
  if($('source').value==='local'){
    if(!localFiles.size)throw new Error('請先加入本機圖片。');
    for(const [name,file] of localFiles){
      checkAbort();if(items.length>=LIMITS.images)break;
      if(/\.(html?|css|js|json|txt|woff2?|ttf|otf)$/i.test(name))continue;
      try{await addImage(file,{url:'',originalName:file.name,alt:'',source:'local',page:0,folder:'01_本機圖片',product:{}});}catch(error){checkAbort();failures.push({url:name,source:'local',error:error.message});log('本機圖片略過：'+error.message,'warn');}
    }
  }else{
    for(let pi=0;pi<pages.length;pi++){
      const page=pages[pi],{doc,base}=parseDocument(page.html,page.url),product=productInfo(doc),folder=`${String(pi+1).padStart(2,'0')}_${safeToken(product.name||new URL(page.url).hostname,'page')}`;
      for(const img of extractImages(doc,base)){
        checkAbort();if(++candidates>LIMITS.images){log('已達 500 個圖片候選上限，未繼續擷取。','warn');break;}
        status(`驗證圖片 ${candidates}…`);
        try{const r=await resource(img.url,controller.signal);await addImage(r.blob,{...img,page:pi,folder,product,pageURL:page.url});}catch(error){checkAbort();failures.push({...img,error:error.message});log('圖片略過：'+publicURL(img.url)+' — '+error.message,'warn');}
      }
    }
  }
  if(!items.length)throw new Error('沒有通過驗證且符合設定類型的圖片。請檢查圖片類型、CORS 或改匯入本機圖片。');
  renderImages();
  resultSummary({'有效圖片':items.length,'失敗':failures.length,'頁面':pages.length||1},'圖片已依內容驗證，尚未下載。請在下方選取並下載。');
}
function renderImages(){
  $('picker').hidden=false;$('image-grid').replaceChildren();$('image-filter').replaceChildren(new Option('全部','all'));
  for(const source of new Set(items.map(i=>i.source)))$('image-filter').add(new Option(source,source));
  for(const it of items){
    const card=document.createElement('label');card.className='image-card selected';card.dataset.source=it.source;card.dataset.index=it.index;
    const input=document.createElement('input');input.type='checkbox';input.checked=selected.has(it.index);input.setAttribute('aria-label','選取圖片 '+(it.originalName||stemFromURL(it.url)));
    input.addEventListener('change',()=>{input.checked?selected.add(it.index):selected.delete(it.index);card.classList.toggle('selected',input.checked);updateSelection();});
    const image=document.createElement('img');image.src=it.preview;image.alt=it.alt||'';image.loading='lazy';
    const info=document.createElement('div');info.className='image-info';info.textContent=(it.originalName||stemFromURL(it.url)+it.ext)+`\n${it.format} · ${it.width}×${it.height} · ${(it.blob.size/1024).toFixed(0)} KB`;
    if(it.width<400||it.height<400){const low=document.createElement('div');low.className='low';low.textContent='低解析度';info.append(low);}
    card.append(input,image,info);$('image-grid').append(card);
  }pickerHint();updateSelection();
}
function updateSelection(){
  $('selected-count').textContent=`已選 ${selected.size}／${items.length} 張`;$('export').disabled=busy||selected.size===0;
}
function selectVisible(value){for(const card of $('image-grid').children){if(card.hidden)continue;const index=Number(card.dataset.index);value?selected.add(index):selected.delete(index);card.querySelector('input').checked=value;card.classList.toggle('selected',value);}updateSelection();}
async function thumbnail(blob){
  const url=URL.createObjectURL(blob),image=new Image();
  try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('QA 縮圖讀取逾時。')),10000);image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(new Error('QA 縮圖讀取失敗。'));};image.src=url;});
    const canvas=document.createElement('canvas'),scale=Math.min(1,240/image.naturalWidth,240/image.naturalHeight);canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png');
  }finally{URL.revokeObjectURL(url);}
}
async function exportSelected(){
  if(busy||!selected.size)return;cfg=readConfig();persist();controller=new AbortController();setBusy(true);
  const files=[],rows=[],errors=[...failures],used=new Set();let cards='',total=0,conversionFailures=0;
  try{
    for(const it of items.filter(i=>selected.has(i.index))){
      checkAbort();status(`轉檔與驗證 ${rows.length+1}／${selected.size}…`);
      try{
        const output=await transformImage(it,cfg);checkAbort();
        const n=String(rows.filter(r=>r.page===it.page).length+1).padStart(3,'0');
        const stem=cfg.smart_naming?safeToken(it.product?.sku||it.product?.name,'item')+'_'+n:safeToken(it.originalName?.replace(/\.[^.]+$/,'')||stemFromURL(it.url),'image');
        const folder=(lastPages.length>1||$('batch').checked)?it.folder:'images';
        const filename=uniqueName(`${folder}/${stem}${output.ext}`,used);
        if(total+output.blob.size>LIMITS.total)throw new Error('輸出總量超過 250 MB 上限。');total+=output.blob.size;
        const low=it.width<400||it.height<400;files.push({name:filename,data:output.blob});
        rows.push({page:it.page,filename,local_path:filename,url:it.url,width:output.width,height:output.height,low_res:low?'Y':'',alt:it.alt||'',sku:it.product?.sku||'',product_name:it.product?.name||''});
        if(output.note)log(output.note,'warn');
        if(cfg.qa_report){
          try{cards+=`<article class="${low?'bad':''}"><img src="${await thumbnail(output.blob)}" alt="${escapeHTML(it.alt)}"><p>${escapeHTML(filename)}<br>${output.width}×${output.height}${low?' · 低解析度':''}</p></article>`;}
          catch(error){errors.push({url:it.url||it.originalName,source:'qa',error:error.message});log('QA 縮圖失敗，原圖片仍保留：'+error.message,'warn');}
        }
      }catch(error){checkAbort();conversionFailures++;errors.push({url:it.url||it.originalName,source:'conversion',error:error.message});log('輸出略過：'+error.message,'error');}
    }
    if(!rows.length)throw new Error('所有圖片皆轉檔失敗，沒有產生下載。');
    if(cfg.smart_naming)files.push({name:'bulk_import.csv',data:csv([['filename','local_path','source_url','width','height','low_res','alt','sku','product_name'],...rows.map(r=>[r.filename,r.local_path,r.url,r.width,r.height,r.low_res,r.alt,r.sku,r.product_name])])});
    if(cfg.qa_report){files.push({name:'qa_grid.html',data:reportHTML('圖片 QA 檢視',`<p>低解析度：${rows.filter(r=>r.low_res).length} 張</p><div class="grid">${cards}</div>`)});}
    if(errors.length||cfg.qa_report)files.push({name:'missing_images.html',data:failureReport(errors)});
    const metadata=files.length>rows.length;
    if(rows.length===1&&!metadata){download(files[0].data,files[0].name.split('/').pop());}
    else if(!cfg.zip_multiple&&!metadata){for(const file of files)download(file.data,file.name.split('/').pop());}
    else{const zip=await buildZip(files);checkAbort();download(zip,`images_${stamp()}.zip`);}
    status(`已下載 ${rows.length} 張；${conversionFailures} 張轉檔失敗。`);log($('status').textContent,'success');
  }catch(error){status(error.message);log('圖片輸出：'+error.message,'error');}
  finally{setBusy(false);controller=null;}
}
async function run(){
  if(busy||mode==='settings')return;cfg=readConfig();persist();releaseItems();failures=[];lastPages=[];$('result-panel').hidden=true;controller=new AbortController();setBusy(true);status('處理中…');
  try{
    if(!cfg.file_types.length&&mode==='images')throw new Error('請在設定中至少勾選一種圖片類型。');
    if($('source').value==='local'&&mode!=='images')throw new Error('本機圖片僅供圖片擷取使用。');
    let pages=$('source').value==='local'?[]:await sourcePages();
    if(mode==='audit')pages=await crawl(pages,Number($('depth').value));
    if(mode==='mirror')pages=await crawl(pages,Number($('maxpages').value));
    lastPages=pages;
    if(mode==='images')await collectImages(pages);
    else if(mode==='audit')await audit(pages);
    else {
      const result=await createMirror(pages,resource,{signal:controller.signal,log});
      result.files.push({name:'_頁面失敗.html',data:failureReport(failures)});
      const zip=await buildZip(result.files);checkAbort();resultSummary({'頁面':pages.length,'資源':result.assetCount,'失敗／限制':result.errors.length+failures.length},'有限靜態副本，非完整動態網站。請先查看 ZIP 內的鏡像報告。');action('下載靜態鏡像 ZIP',()=>download(zip,`mirror_${stamp()}.zip`));
    }
    const message=mode==='images'?`圖片準備完成：${items.length} 張，失敗 ${failures.length}。請選取後下載。`:'處理完成；請下載結果並查看失敗／限制報告。';status(message);log(message,'success');recordHistory(pages[0]?publicURL(pages[0].url):'本機圖片',true);
  }catch(error){releaseItems();status(error.message);log('操作未完成：'+error.message,'error');recordHistory($('source').value==='local'?'本機圖片':publicURL($('url').value),false);}
  finally{setBusy(false);controller=null;}
}

document.querySelectorAll('[data-mode]').forEach(e=>e.addEventListener('click',()=>setMode(e.dataset.mode)));
$('source').addEventListener('change',sourceChanged);$('batch').addEventListener('change',sourceChanged);
$('run').addEventListener('click',run);$('url').addEventListener('keydown',e=>{if(e.key==='Enter')run();});
$('cancel').addEventListener('click',()=>controller?.abort());
$('theme').addEventListener('click',()=>{cfg.theme=cfg.theme==='dark'?'light':'dark';document.body.dataset.theme=cfg.theme;persist();});
$('save-settings').addEventListener('click',()=>{cfg=readConfig();$('settings-status').textContent=persist()?'已儲存':'儲存失敗，僅本次有效';pickerHint();});
$('reset-settings').addEventListener('click',()=>{cfg=normalizeConfig();applyConfig();$('settings-status').textContent=persist()?'已恢復原格式預設':'僅本次恢復預設';});
$('quality').addEventListener('input',()=>$('quality-val').textContent=$('quality').value+'%');
for(const id of ['depth','maxpages'])$(id).addEventListener('input',()=>$(id+'-val').textContent=$(id).value+' 頁');
for(const id of ['local-files','local-folder'])$(id).addEventListener('change',()=>{addLocal($(id).files);$(id).value='';});
$('clear-files').addEventListener('click',()=>{localFiles.clear();$('file-count').textContent='尚未匯入';});
$('html-file').addEventListener('change',async()=>{const file=$('html-file').files[0];if(!file)return;if(file.size>LIMITS.file){status('HTML 超過 30 MB。');return;}setBusy(true);$('cancel').disabled=true;try{$('html-input').value=await file.text();status('已匯入 HTML；請確認原網址與本機資源。');}catch(error){status('HTML 讀取失敗：'+error.message);}finally{setBusy(false);}});
$('clear-log').addEventListener('click',()=>$('log').replaceChildren());$('select-all').addEventListener('click',()=>selectVisible(true));$('select-none').addEventListener('click',()=>selectVisible(false));
$('image-filter').addEventListener('change',()=>{for(const card of $('image-grid').children)card.hidden=$('image-filter').value!=='all'&&card.dataset.source!==$('image-filter').value;});
$('export').addEventListener('click',exportSelected);
window.addEventListener('beforeunload',()=>{for(const it of items)URL.revokeObjectURL(it.preview);});
loadConfig();applyConfig();sourceChanged();setMode('audit');log('Pages v23 就緒。預設原格式；無 CDN、無 API Key、無自動上傳。','head');
