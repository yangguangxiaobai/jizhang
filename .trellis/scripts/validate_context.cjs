/*
 * 校验所有 Trellis 任务的 implement.jsonl / check.jsonl 是否为合法 JSON、
 * 引用文件是否存在。放在 .trellis/scripts/ 下作为项目自定义工具。
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const tasksDir = path.join(root, '.trellis', 'tasks');

let errors = 0;
let checked = 0;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(tasksDir).filter((f) => /\.jsonl$/.test(f));

for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const lines = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l, i) => ({ text: l, n: i + 1 }))
    .filter((l) => l.text.trim() !== '');

  for (const line of lines) {
    checked += 1;
    let obj;
    try {
      obj = JSON.parse(line.text);
    } catch (err) {
      errors += 1;
      console.log(`  JSON ERR  ${rel}:${line.n}  ${err.message}`);
      continue;
    }
    if (typeof obj.file !== 'string' || obj.file.trim() === '') {
      errors += 1;
      console.log(`  NO FILE   ${rel}:${line.n}  missing "file" field`);
      continue;
    }
    if (typeof obj.reason !== 'string' || obj.reason.trim() === '') {
      errors += 1;
      console.log(`  NO REASON ${rel}:${line.n}  missing "reason" field`);
      continue;
    }
    const target = path.join(root, obj.file);
    if (!fs.existsSync(target)) {
      errors += 1;
      console.log(`  MISSING   ${rel}:${line.n}  referenced file not found: ${obj.file}`);
    }
  }

  if (lines.length === 0) {
    console.log(`  EMPTY     ${rel}  (no entries — seed row alone is not ready)`);
  }
}

console.log(
  `\nchecked ${checked} entries across ${files.length} jsonl files — ${errors} problem(s)`,
);
process.exitCode = errors === 0 ? 0 : 1;
