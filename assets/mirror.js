import {parseDocument, parsePage} from './parser.js';
import {inspectImage} from './images.js';
import {LIMITS, resolveURL, safeToken, escapeHTML, reportHTML} from './utils.js';
// 靜態鏡像沿用 v22 的「先抓資源、再改寫 HTML/CSS」流程。
// 與桌面版的差異：僅能存取 CORS／本機匯入資源，不假裝是完整動態網站。
export async function createMirror(pages, readResource, {signal, log=()=>{}}={}) {
  const files=[], errors=[], assets=new Map(), pageNames=new Map();let total=0;
  pages.forEach((p,i)=>{const path=i===0?'index.html':`page_${String(i+1).padStart(3,'0')}.html`;pageNames.set(p.url,path);if(p.requestURL)pageNames.set(p.requestURL,path);});
  function check() {if(signal?.aborted)throw new Error('已取消操作。');}
  function account(bytes){total+=bytes;if(total>LIMITS.total)throw new Error('鏡像超過 250 MB 上限。');}
  async function rewriteCSS(css, base, fromCSS) {
    const refs=[...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)|@import\s+["']([^"']+)["']/gi)];
    for(const m of refs) {
      check();const raw=(m[1]||m[2]).trim().replace(/["']$/,'');
      if(raw.startsWith('data:')||raw.startsWith('#'))continue;
      const abs=resolveURL(raw,base);if(!abs)continue;
      const path=await asset(abs);
      const replacement=path?(fromCSS?path.replace(/^assets\//,''):path):abs;
      css=css.replace(m[0],m[1]?`url("${replacement}")`:`@import "${replacement}"`);
    }
    return css;
  }
  async function asset(url) {
    if(assets.has(url))return assets.get(url);
    if(assets.size>=LIMITS.assets){errors.push({url,error:'超過 300 個資源上限'});return null;}
    check();
    const stem=safeToken(new URL(url).pathname.split('/').pop(),'resource');
    let path=`assets/${String(assets.size+1).padStart(4,'0')}_${stem}`;
    assets.set(url,path); // 先登記，避免 CSS 循環 import 無限遞迴。
    try {
      const result=await readResource(url,signal);account(result.blob.size);
      let data=result.blob;
      if(/^image\//i.test(data.type)||/\.(jpe?g|png|gif|webp|avif|ico|svg|bmp|tiff?)(?:[?#]|$)/i.test(url)){
        const checked=await inspectImage(data);
        path=path.replace(/\.[^/.]+$/,'')+checked.ext;data=checked.blob;assets.set(url,path);
      }
      const isCSS=/\.css(?:[?#]|$)/i.test(url)||/text\/css/i.test(data.type);
      const knownExt=isCSS?'.css':/javascript/i.test(data.type)?'.js':null;
      if(knownExt&&!path.endsWith(knownExt)){path=path.replace(/\.[^/.]+$/,'')+knownExt;assets.set(url,path);}
      if(isCSS) data=await rewriteCSS(await data.text(),result.url||url,true);
      files.push({name:path,data});log(`資源：${path}`);return path;
    } catch(error){if(signal?.aborted)throw error;assets.set(url,null);errors.push({url,error:error.message});log(`資源略過：${error.message}`,'warn');return null;}
  }
  for(const page of pages) {
    check();const {doc,base}=parseDocument(page.html,page.url);
    // 失敗的相對路徑改成原站絕對 URL，避免錯指向 ZIP 裡不存在的檔案。
    const rewrite=async(el,attr)=>{
      const raw=el.getAttribute(attr);if(!raw||raw.startsWith('data:')||raw.startsWith('#'))return;
      const abs=resolveURL(raw,base);if(!abs)return;
      const path=await asset(abs);el.setAttribute(attr,path||abs);
    };
    for(const el of doc.querySelectorAll('link[href]'))if(/stylesheet|icon|preload/i.test(el.getAttribute('rel')||''))await rewrite(el,'href');
    for(const el of doc.querySelectorAll('script[src],img,source,video,audio,iframe[src]')) {
      if(el.localName==='iframe'){const u=resolveURL(el.getAttribute('src'),base);if(u)el.setAttribute('src',u);errors.push({url:u,error:'iframe 仍連原站，不屬於離線副本'});continue;}
      for(const attr of ['src','poster','data-src','data-lazy-src','data-original'])if(el.hasAttribute(attr))await rewrite(el,attr);
      for(const attr of ['srcset','data-srcset']) {
        const raw=el.getAttribute(attr);if(!raw||raw.trim().startsWith('data:'))continue;
        const parts=[];for(const part of raw.split(',')){
          const [src,...rest]=part.trim().split(/\s+/),abs=resolveURL(src,base);
          parts.push((abs?(await asset(abs)||abs):src)+' '+rest.join(' '));
        }el.setAttribute(attr,parts.join(', '));
      }
    }
    for(const el of doc.querySelectorAll('[style]'))el.setAttribute('style',await rewriteCSS(el.getAttribute('style'),base,false));
    for(const el of doc.querySelectorAll('style'))el.textContent=await rewriteCSS(el.textContent,base,false);
    for(const el of doc.querySelectorAll('a[href]')){
      const raw=el.getAttribute('href');if(raw.startsWith('#'))continue;
      const abs=resolveURL(raw,base);if(!abs)continue;
      const u=new URL(abs),hash=u.hash;u.hash='';el.setAttribute('href',pageNames.has(u.href)?pageNames.get(u.href)+hash:abs);
    }
    for(const el of doc.querySelectorAll('form'))el.setAttribute('action',resolveURL(el.getAttribute('action')||page.url,base)||page.url);
    doc.querySelectorAll('base').forEach(e=>e.remove());
    const output='<!doctype html>\n'+doc.documentElement.outerHTML;account(new TextEncoder().encode(output).length);
    files.push({name:pageNames.get(page.url),data:output});
  }
  files.push({name:'_鏡像報告.html',data:reportHTML('靜態鏡像報告',`<p>已存 ${pages.length} 頁、${files.length-pages.length} 個資源。此為有限靜態副本，不含登入、資料庫與動態 API；外部 JS 仍可能連回原站。</p><p>失敗／未離線項目：${errors.length}。只開啟你信任的網站副本。</p><table><tr><th>來源</th><th>原因</th></tr>${errors.map(e=>`<tr><td>${escapeHTML(e.url)}</td><td>${escapeHTML(e.error)}</td></tr>`).join('')}</table>`)});
  files.push({name:'_mirror_manifest.json',data:JSON.stringify({pages:pages.map(p=>({url:p.url,path:pageNames.get(p.url),stats:parsePage(p.html,p.url).stats})),failed:errors,complete_dynamic_site:false},null,2)});
  return {files,errors,assetCount:[...assets.values()].filter(Boolean).length};
}
