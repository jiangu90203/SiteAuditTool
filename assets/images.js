import {LIMITS} from './utils.js';
export const FORMATS = Object.freeze({
  JPEG:{ext:'.jpg',mime:'image/jpeg'}, PNG:{ext:'.png',mime:'image/png'},
  WEBP:{ext:'.webp',mime:'image/webp'}, GIF:{ext:'.gif',mime:'image/gif'},
  BMP:{ext:'.bmp',mime:'image/bmp'}, TIFF:{ext:'.tiff',mime:'image/tiff'},
  ICO:{ext:'.ico',mime:'image/x-icon'}, AVIF:{ext:'.avif',mime:'image/avif'},
  SVG:{ext:'.svg',mime:'image/svg+xml'},
});
export function detectFormat(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ascii=(start,end)=>String.fromCharCode(...b.slice(start,end));
  if (b.length<12) throw new Error('圖片為空或內容不完整。');
  if(b[0]===255&&b[1]===216&&b[2]===255) return 'JPEG';
  if([137,80,78,71,13,10,26,10].every((x,i)=>b[i]===x)) return 'PNG';
  if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP') return 'WEBP';
  if(/^GIF8[79]a$/.test(ascii(0,6))) return 'GIF';
  if(ascii(0,2)==='BM') return 'BMP';
  if(ascii(0,4)==='II*\0'||ascii(0,4)==='MM\0*') return 'TIFF';
  if(b[0]===0&&b[1]===0&&b[2]===1&&b[3]===0) return 'ICO';
  if(ascii(4,8)==='ftyp'&&/avif|avis/.test(ascii(8,40))) return 'AVIF';
  const head=new TextDecoder().decode(b.slice(0,8192)).replace(/^\uFEFF/,'').replace(/^\s*<\?xml[^>]*>\s*/i,'').replace(/^(\s*<!--[\s\S]*?-->)+\s*/,'');
  if(/^\s*<svg(?:\s|>)/i.test(head)) return 'SVG';
  throw new Error('不是可辨識的圖片，可能下載到 HTML 錯誤頁。');
}
export function typeAllowed(format, types) {
  const key=FORMATS[format]?.ext.slice(1);
  return key==='jpg' ? types.includes('jpg')||types.includes('jpeg') : types.includes(key);
}
async function decoded(blob) {
  const url=URL.createObjectURL(blob), image=new Image();
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('圖片解碼逾時。')),10000);
      image.onload=()=>{clearTimeout(timer);resolve();};
      image.onerror=()=>{clearTimeout(timer);reject(new Error('圖片解碼失敗或瀏覽器不支援該格式。'));};
      image.src=url;
    });
    if(!image.naturalWidth || !image.naturalHeight) throw new Error('無法讀取圖片尺寸。');
    if(image.naturalWidth*image.naturalHeight>40000000) throw new Error('圖片超過 4,000 萬像素上限。');
    return image;
  } finally { URL.revokeObjectURL(url); }
}
export async function inspectImage(input) {
  if(!input.size || input.size>LIMITS.file) throw new Error('圖片為空或超過 30 MB。');
  const format=detectFormat(new Uint8Array(await input.slice(0,8192).arrayBuffer()));
  const {ext,mime}=FORMATS[format], blob=new Blob([input],{type:mime});
  if(format==='SVG') {
    const xml=new DOMParser().parseFromString(await blob.text(),'image/svg+xml');
    if(xml.querySelector('parsererror')||xml.documentElement.localName!=='svg') throw new Error('SVG 格式無效。');
  }
  try {
    const image=await decoded(blob);
    return {blob,format,ext,mime,width:image.naturalWidth,height:image.naturalHeight};
  } catch(error) {
    // TIFF 等瀏覽器可能無解碼器：不可宣稱驗證成功或默默轉成別的內容。
    throw new Error(`${format}：${error.message} 請改用桌面版處理。`);
  }
}
export async function transformImage(info, cfg) {
  const explicit=cfg.output_format!=='keep';
  if(!cfg.compress&&!cfg.standardize&&!explicit) return {...info,note:''};
  let mime=explicit?cfg.output_format:info.mime;
  if(cfg.standardize&&!['image/jpeg','image/png','image/webp'].includes(mime)) mime='image/jpeg';
  if(!['image/jpeg','image/png','image/webp'].includes(mime)) {
    // 原格式 GIF 不經 Canvas，以免動畫被默默截成第一幀。
    return {...info,note:'此原格式不支援 Canvas 壓縮，保留原檔。'};
  }
  const image=await decoded(info.blob);
  let w=image.naturalWidth,h=image.naturalHeight;
  if(cfg.compress&&cfg.max_width&&w>cfg.max_width) {h=Math.max(1,Math.round(h*cfg.max_width/w));w=cfg.max_width;}
  const canvas=document.createElement('canvas');
  canvas.width=cfg.standardize?Math.max(w,h):w; canvas.height=cfg.standardize?Math.max(w,h):h;
  if(canvas.width*canvas.height>40000000) throw new Error('轉檔畫布超過 4,000 萬像素上限。');
  const ctx=canvas.getContext('2d');
  if(!ctx) throw new Error('瀏覽器無法建立 Canvas。');
  if(mime==='image/jpeg'||cfg.standardize){ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);}
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(image,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
  const quality=(cfg.compress?cfg.jpeg_quality:95)/100;
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('圖片編碼失敗。')),mime,quality));
  const output=await inspectImage(blob);
  if(output.mime!==mime) throw new Error(`瀏覽器未支援指定格式 ${mime}，已停止輸出，避免副檔名不符。`);
  return {...output,note:(['GIF','AVIF'].includes(info.format)?'已轉換靜態畫面；動畫不會保留。':'')};
}
