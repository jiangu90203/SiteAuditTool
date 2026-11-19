// 沿用 v22 image_picker.py MiniZip 的 STORE + CRC32 策略；無 CDN 與執行期套件。
const encoder = new TextEncoder();
const table = new Uint32Array(256);
for (let n=0;n<256;n++) { let c=n; for(let k=0;k<8;k++) c=(c&1)?0xedb88320^(c>>>1):c>>>1; table[n]=c>>>0; }
export function crc32(bytes) { let c=0xffffffff; for(const b of bytes)c=table[(c^b)&255]^(c>>>8); return (c^0xffffffff)>>>0; }
export function safeZipPath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || /^[a-z]:/i.test(path) || /[\x00-\x1f]/.test(path) || path.split('/').some(x=>!x||x==='.'||x==='..')) throw new Error('不安全的 ZIP 路徑。');
  return path;
}
export async function buildZip(files) {
  if (files.length > 65535) throw new Error('ZIP 檔案數超過上限。');
  const local=[], central=[], names=new Set(); let offset=0;
  for (const file of files) {
    const name=encoder.encode(safeZipPath(file.name));
    if(names.has(file.name)) throw new Error('ZIP 檔名重複：'+file.name);
    names.add(file.name);
    const bytes=file.data instanceof Blob?new Uint8Array(await file.data.arrayBuffer()):typeof file.data==='string'?encoder.encode(file.data):file.data;
    if(!(bytes instanceof Uint8Array)) throw new Error('ZIP 資料型別錯誤。');
    if (name.length>65535 || offset+bytes.length>0xffffffff) throw new Error('ZIP 超過支援大小。');
    const crc=crc32(bytes), lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(6,0x0800,true);
    lh.setUint16(12,33,true);lh.setUint32(14,crc,true);lh.setUint32(18,bytes.length,true);lh.setUint32(22,bytes.length,true);lh.setUint16(26,name.length,true);
    local.push(lh.buffer,name,bytes);
    const ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);ch.setUint16(8,0x0800,true);
    ch.setUint16(14,33,true);ch.setUint32(16,crc,true);ch.setUint32(20,bytes.length,true);ch.setUint32(24,bytes.length,true);ch.setUint16(28,name.length,true);ch.setUint32(42,offset,true);
    central.push(ch.buffer,name);offset+=30+name.length+bytes.length;
  }
  const size=central.reduce((n,x)=>n+(x.byteLength||0),0), end=new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true);end.setUint16(8,files.length,true);end.setUint16(10,files.length,true);end.setUint32(12,size,true);end.setUint32(16,offset,true);
  return new Blob([...local,...central,end.buffer],{type:'application/zip'});
}
