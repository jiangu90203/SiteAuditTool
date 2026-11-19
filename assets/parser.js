// 對應 v22 scraper.parse_page、image_picker.extract_images 與 _parse_product_info。
import {resolveURL} from './utils.js';
const text=e=>e?.textContent?.trim()||'';
export function parseDocument(html, baseURL) {
  const doc=new DOMParser().parseFromString(html,'text/html');
  const base=resolveURL(doc.querySelector('base[href]')?.getAttribute('href')||baseURL,baseURL)||baseURL;
  return {doc,base};
}
export function extractImages(doc, base) {
  const items=[], seen=new Set();
  const add=(raw,source,el)=>{
    if(!raw?.trim())return;
    const url=resolveURL(raw.trim(),base,true);
    if(!url||seen.has(url))return;
    seen.add(url);items.push({url,source,alt:el?.getAttribute('alt')||'',title:el?.getAttribute('title')||'',width:el?.getAttribute('width')||'',height:el?.getAttribute('height')||''});
  };
  const srcset=(s,source)=>{if(s?.trim().startsWith('data:'))return;for(const part of (s||'').split(','))add(part.trim().split(/\s+/)[0],source);};
  for(const el of doc.querySelectorAll('img')) {
    for(const attr of ['src','data-src','data-lazy-src','data-original','data-lazy','data-img']) {
      const raw=el.getAttribute(attr);if(raw&&!raw.startsWith('data:')){add(raw,'img',el);break;}
      if(raw?.startsWith('data:image/'))add(raw,'img',el);
    }
    srcset(el.getAttribute('srcset'),'img');
  }
  for(const el of doc.querySelectorAll('source[srcset]'))srcset(el.getAttribute('srcset'),'picture');
  const css=(s,source)=>{for(const m of s.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi))add(m[1],source);};
  for(const el of doc.querySelectorAll('[style]'))css(el.getAttribute('style'),'css-bg');
  for(const el of doc.querySelectorAll('style'))css(el.textContent,'css-block');
  for(const el of doc.querySelectorAll('meta'))if(/og:image|twitter:image/i.test((el.getAttribute('property')||'')+(el.getAttribute('name')||'')))add(el.getAttribute('content'),'og-meta');
  for(const el of doc.querySelectorAll('link[href]'))if(/icon/i.test(el.getAttribute('rel')||''))add(el.getAttribute('href'),'icon');
  return items;
}
export function productInfo(doc) {
  const first=(selectors)=>{
    for(const selector of selectors) {const el=doc.querySelector(selector);const v=el?.getAttribute('content')||el?.getAttribute('data-sku')||text(el);if(v)return v.trim();}
    return '';
  };
  return {sku:first(['[itemprop="sku"]','meta[property="product:retailer_item_id"]','[data-sku]']).slice(0,60),name:first(['[itemprop="name"]','meta[property="og:title"]','title','h1']).slice(0,80)};
}
export function parsePage(html,url,fetch_info={}) {
  const {doc,base}=parseDocument(html,url), all=[], seen=new Set(), origin=new URL(url).origin;
  for(const el of doc.querySelectorAll('a[href]')) {
    const raw=el.getAttribute('href');if(raw.startsWith('#'))continue;
    const full=resolveURL(raw,base);if(!full||seen.has(full))continue;seen.add(full);
    all.push({url:full,text:text(el).slice(0,120),title:el.title,rel:[...el.relList],target:el.target});
  }
  const headings={};for(let i=1;i<=6;i++){const list=[...doc.querySelectorAll('h'+i)].map(text);if(list.length)headings['h'+i]=list;}
  const canonical=doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
  const meta={title:text(doc.querySelector('title')),description:'',keywords:[],author:'',robots:'',canonical:canonical?resolveURL(canonical,base):'',charset:doc.querySelector('meta[charset]')?.getAttribute('charset')||'',viewport:'',language:doc.documentElement.lang,other:{}};
  const og={},twitter={};
  for(const el of doc.querySelectorAll('meta')){
    const name=(el.getAttribute('name')||el.getAttribute('property')||'').toLowerCase(), value=el.getAttribute('content')||'';
    if(['description','author','robots','viewport'].includes(name))meta[name]=value;
    else if(name==='keywords')meta.keywords=value.split(',').map(x=>x.trim()).filter(Boolean);
    else if(name)meta.other[name]=value;
    if(name.startsWith('og:'))og[name.slice(3)]=value;
    if(name.startsWith('twitter:'))twitter[name.slice(8)]=value;
  }
  const forms=[...doc.querySelectorAll('form')].map((f,index)=>({index,action:f.getAttribute('action')||'',method:(f.getAttribute('method')||'get').toUpperCase(),fields:[...f.querySelectorAll('input,textarea,select')].map(e=>({tag:e.localName,name:e.getAttribute('name')||'',type:e.getAttribute('type')||'text',placeholder:e.getAttribute('placeholder')||'',required:e.hasAttribute('required')}))}));
  const structured_data=[],parse_errors=[];
  for(const el of doc.querySelectorAll('script[type="application/ld+json"]'))try{structured_data.push(JSON.parse(el.textContent));}catch(error){parse_errors.push('JSON-LD: '+error.message);}
  const images=extractImages(doc,base);
  const scripts=[...doc.querySelectorAll('script')].map(e=>e.getAttribute('src')?{type:'external',src:resolveURL(e.getAttribute('src'),base),async:e.hasAttribute('async'),defer:e.hasAttribute('defer')}:{type:'inline',snippet:e.textContent.trim().slice(0,200)});
  const stylesheets=[...doc.querySelectorAll('link[rel~="stylesheet"][href]')].map(e=>resolveURL(e.getAttribute('href'),base)).filter(Boolean);
  const tables=[...doc.querySelectorAll('table')].map((t,index)=>({index,rows:[...t.querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll('th,td')].map(text)),row_count:t.querySelectorAll('tr').length}));
  const clone=doc.body.cloneNode(true);clone.querySelectorAll('script,style,noscript,header,footer,nav,aside').forEach(e=>e.remove());
  const text_content=text(clone).replace(/\s+/g,' '), internal=all.filter(x=>new URL(x.url).origin===origin);
  return {url,crawled_at:new Date().toISOString(),fetch_info,meta,headings,links:{all,internal,external:all.filter(x=>new URL(x.url).origin!==origin)},images,tables,forms,scripts,stylesheets,text_content,structured_data,social_tags:{open_graph:og,twitter_card:twitter},parse_errors,
    stats:{total_links:all.length,internal_links:internal.length,external_links:all.length-internal.length,images_count:images.length,tables_count:tables.length,forms_count:forms.length,word_count:text_content?text_content.split(/\s+/).length:0,h1_count:headings.h1?.length||0}};
}
