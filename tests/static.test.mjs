import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const html=await fs.readFile(path.join(root,'index.html'),'utf8');
test('所有靜態入口資源都存在且使用子路徑相容 URL',async()=>{
  for(const m of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g))await fs.access(path.join(root,m[1]));
  assert.doesNotMatch(html,/(?:src|href)="\/(?!\/)/);
  await fs.access(path.join(root,'.nojekyll'));
});
test('UI 元件 ID 唯一，JS 所用的固定 ID 都已定義',async()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  const app=await fs.readFile(path.join(root,'assets/app.js'),'utf8');
  for(const m of app.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.includes(m[1]),'missing UI '+m[1]);
});
test('所有 JS import 都為本地存在模組，沒有 CDN 或 Python bridge',async()=>{
  for(const name of await fs.readdir(path.join(root,'assets'))){
    if(!name.endsWith('.js'))continue;const source=await fs.readFile(path.join(root,'assets',name),'utf8');
    for(const m of source.matchAll(/from\s+['"]([^'"]+)['"]/g)){assert.ok(m[1].startsWith('./'));await fs.access(path.join(root,'assets',m[1]));}
    assert.doesNotMatch(source,/pywebview|mode\s*:\s*['"]no-cors['"]/);
  }
});
test('CSP 禁止外來腳本，原始資料不注入 live innerHTML',async()=>{
  assert.match(html,/script-src 'self'/);assert.doesNotMatch(html,/\bon(?:click|change|input|load)=/);
  const app=await fs.readFile(path.join(root,'assets/app.js'),'utf8');assert.doesNotMatch(app,/\.innerHTML\s*=/);
});
