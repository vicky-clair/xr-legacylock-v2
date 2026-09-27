// 冻结参考完整性检查：按 manifest 逐文件核对 SHA-256；参考源码仅作兼容基线，不应随新版注释修改。
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'reference/manifest.json'),'utf8').replace(/^\uFEFF/,''));
for(const entry of manifest.files){
  const p=path.resolve(root,'reference/legacy',entry.path);
  if(!p.startsWith(path.resolve(root,'reference/legacy')+path.sep))throw new Error('Invalid snapshot path');
  const actual=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  if(actual!==entry.sha256)throw new Error('Frozen reference changed: '+entry.path);
}
console.log(`Verified ${manifest.files.length} frozen files; source commit ${manifest.commit}.`);
