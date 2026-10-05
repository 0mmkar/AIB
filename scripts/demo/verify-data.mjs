import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const work = path.join(root, '.demo-work/v2');
const { dataDir } = JSON.parse(fs.readFileSync(path.join(work, 'capture-run.json'), 'utf8'));
const demoRead = p => JSON.parse(fs.readFileSync(path.join(dataDir, p), 'utf8'));
const original = read('data/extracts/_index.json');
const demo = demoRead('extracts/_index.json');
const proof = { files: [], reportingMonths: [], differences: 0 };
for (const source of original) {
  const target = demo.find(e => e.filename === source.filename);
  assert.ok(target, 'Missing source ' + source.filename);
  const sha256 = hash(path.join(root,'data/extracts',source.stored));
  assert.equal(hash(path.join(dataDir,'extracts',target.stored)), sha256);
  proof.files.push({ filename: source.filename, sha256, identical: true });
}
assert.equal(original.length, demo.length);
const a = read('data/snapshot.json'), b = demoRead('snapshot.json');
for (const key of ['as_of','records','measured','months','totals']) assert.deepEqual(a[key],b[key],key);
for (const month of a.months) {
  const a = read('data/analyses/' + month + '.json');
  const b = demoRead('analyses/' + month + '.json');
  for (const key of ['reporting_month','as_of','partial','results','summary','quality','quality_summary','drivers','items']) assert.deepEqual(a[key],b[key], month + ': ' + key);
  proof.reportingMonths.push(month);
}
fs.writeFileSync(path.join(work,'data-verification.json'),JSON.stringify(proof,null,2));
console.log(`Identical source bytes: ${proof.files.length} files. Identical results, items, findings and drivers: ${proof.reportingMonths.length} months. Differences: 0.`);
