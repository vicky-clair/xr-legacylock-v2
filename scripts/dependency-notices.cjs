// 依赖说明生成器：从锁定的 Windows Cargo 元数据和生产 npm 依赖读取本地许可证。
// 结果包含 Rust 构建与测试依赖，供发布审查使用，不等同于法律审核或完整运行时 SBOM。
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const metadata = JSON.parse(execFileSync('cargo', ['metadata','--locked','--format-version','1','--filter-platform','x86_64-pc-windows-msvc'], {cwd:root, encoding:'utf8', maxBuffer:64*1024*1024, timeout:120000}));
const packages = [];
const texts = ['Third-party notices\nGenerated from pinned local dependencies. This inventory includes Windows Rust build/test dependencies and production npm dependencies; it is not a legal audit.'];
function add(name, version, license, directory, ecosystem) {
  // 保留依赖原始许可证文字；未找到顶层许可文件的条目仍列入清单供人工复核。
  const licenseFiles = fs.readdirSync(directory).filter(file => /^(licen[cs]e|copying|notice)([.\-_]|$)/i.test(file) && fs.statSync(path.join(directory,file)).isFile());
  packages.push({ecosystem,name,version,license:license||'UNSPECIFIED',licenseFiles});
  for (const file of licenseFiles) {
    const contents = fs.readFileSync(path.join(directory,file),'utf8');
    texts.push(`\n${'='.repeat(72)}\n${ecosystem}: ${name} ${version}\n${file}\n${contents}`);
  }
}
for (const pkg of metadata.packages) {
  if (pkg.source) add(pkg.name,pkg.version,pkg.license,path.dirname(pkg.manifest_path),'cargo');
}
const lock = JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
// npm 部分仅包含生产依赖；Cargo 元数据则包含所选 Windows 平台的构建和测试依赖。
for (const [directory,pkg] of Object.entries(lock.packages)) {
  if (!directory || pkg.dev) continue;
  const absolute = path.join(root,directory);
  const manifest=JSON.parse(fs.readFileSync(path.join(absolute,'package.json'),'utf8'));
  add(manifest.name,manifest.version,manifest.license,absolute,'npm');
}
packages.sort((a,b)=>(a.ecosystem+a.name+a.version).localeCompare(b.ecosystem+b.name+b.version));
fs.mkdirSync(path.join(root,'docs','dependencies'),{recursive:true});
fs.writeFileSync(path.join(root,'docs','dependencies','inventory.json'),JSON.stringify({scope:'Pinned Windows Rust build/test and production npm dependencies',packages},null,2)+'\n');
fs.writeFileSync(path.join(root,'docs','dependencies','THIRD-PARTY-NOTICES.txt'),texts.join('\n'));
console.log(`Recorded ${packages.length} dependency entries; review unspecified licenses and missing license files before commercial release.`);
