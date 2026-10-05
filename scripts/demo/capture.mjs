import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORK = path.join(ROOT, '.demo-work/v2');
const SHOTS = path.join(WORK, 'shots');
const FINISH = process.argv.includes('--finish');
fs.mkdirSync(SHOTS, { recursive: true });
const pause = ms => new Promise(r => setTimeout(r, ms));
const children = [];
let socket;
const manifest = FINISH ? JSON.parse(fs.readFileSync(path.join(WORK, 'capture.json'), 'utf8')) : {};
const errors = [];
const dataDir = FINISH ? JSON.parse(fs.readFileSync(path.join(WORK, 'capture-run.json'), 'utf8')).dataDir : path.join(WORK, 'runs', String(Date.now()), 'data');
fs.writeFileSync(path.join(WORK, 'capture-run.json'), JSON.stringify({ dataDir }));
// The server loads the existing local AWS settings; no credentials enter browser assets.
const env = { ...process.env, PORT: '5274', DATA_DIR: dataDir, SKIP_BOOTSTRAP_DATA: '1' };
const start = (args, extraEnv = {}) => {
  const p = spawn(process.execPath, args, { cwd: ROOT, env: { ...env, ...extraEnv }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', x => fs.appendFileSync(path.join(WORK, 'capture-server.log'), x));
  p.stderr.on('data', x => fs.appendFileSync(path.join(WORK, 'capture-server.log'), x));
  children.push(p); return p;
};
try {
  // A dedicated dataset keeps the user's running application's imports untouched.
  start(['server/index.js']);
  fs.writeFileSync(path.join(WORK, 'vite.config.mjs'), `import react from '@vitejs/plugin-react'; export default { plugins:[react()], root: ${JSON.stringify(ROOT)}, server: { watch: {ignored:['**/.demo-work/**','**/.demo-tools/**','**/deliverables/**']}, port: 5273, strictPort: true, proxy: { '/api': 'http://localhost:5274' } } };`);
  start(['node_modules/vite/bin/vite.js', '--config', path.join(WORK, 'vite.config.mjs')]);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch('http://localhost:5273/api/bootstrap')).ok) { ready = true; break; } } catch {}
    await pause(150);
  }
  if (!ready) throw Error('Isolated demo servers did not start');
  const profile = path.join(os.tmpdir(), 'aib-demo-edge-' + Date.now());
  const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  children.push(browser);
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await pause(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
    if (pending.has(msg.id)) {
      const p = pending.get(msg.id); clearTimeout(p.timer); pending.delete(msg.id);
      msg.error ? p.reject(Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(Error('Timeout: ' + method)), 25000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const js = async expression => {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const waitFor = async expression => {
    for (let i = 0; i < 120; i++) { if (await js(expression)) return; await pause(150); }
    throw Error('UI wait expired: ' + expression);
  };
  const shot = async (name, target = null) => {
    await pause(400);
    const image = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(image.data, 'base64'));
    const visible = await js('document.body.innerText');
    if (/TCS|BaNCS|SLA position|\bExtracts\b/.test(visible)) throw Error('Outdated customer terminology in ' + name);
    manifest[name] = { target, hash: await js('location.hash') };
    fs.writeFileSync(path.join(WORK, 'capture.json'), JSON.stringify(manifest, null, 2));
    console.log('Captured ' + name);
  };
  const rect = expression => js(`(() => { const e = ${expression}; if (!e) throw Error('Missing element'); const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,cursor:getComputedStyle(e).cursor}; })()`);
  const click = async expression => {
    await js(`(${expression}).scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})`);
    const r = await rect(expression), x = r.x + r.w / 2, y = r.y + r.h / 2;
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x, y });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x, y });
    return r;
  };
  const button = text => `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes(${JSON.stringify(text)}))`;
  const navigate = async (hash, check) => {
    await js(`location.hash=${JSON.stringify(hash)}; window.scrollTo(0,0)`);
    if (check) await waitFor(check);
    await pause(400);
  };
  const scrollTo = async expression => {
    await js(`(${expression}).scrollIntoView({block:'start',behavior:'instant'})`);
    await pause(200);
  };
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 760, deviceScaleFactor: 1.5, mobile: false });
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  if (!FINISH) {
  await call('Page.navigate', { url: 'http://localhost:5273/#data-sources' });
  await waitFor("!!document.querySelector('input[type=file]')");
  await shot('extracts-empty', await rect("document.querySelector('.dropzone')"));
  const root = await call('DOM.getDocument');
  const input = await call('DOM.querySelector', { nodeId: root.root.nodeId, selector: 'input[type=file]' });
  const currentSources = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/extracts/_index.json'), 'utf8'));
  const inputDir = path.join(WORK, 'input'); fs.mkdirSync(inputDir, { recursive: true });
  const files = currentSources.map(e => {
    const target = path.join(inputDir, path.basename(e.filename));
    fs.copyFileSync(path.join(ROOT, 'data/extracts', e.stored), target);
    return target;
  });
  await call('DOM.setFileInputFiles', { nodeId: input.nodeId, files });
  await waitFor("document.querySelectorAll('.expected-row.is-present').length === 5 && !document.querySelector('.file-row.is-working')");
  await shot('extracts-loaded', await rect("document.querySelector('.expected')"));
  await shot('extracts-controls', await rect(button('Rebuild packs')));
  await click(button('Rebuild packs'));
  await waitFor("!!document.querySelector('.toast') && document.querySelector('.toast').textContent.includes('All packs rebuilt')");
  await shot('extracts-rebuilt');
  await click(button('Open dashboard')); await waitFor("!!document.querySelector('.period-card')");
  await shot('dashboard');
  await shot('dashboard-pack-shortcut', await rect(button('Governance pack')));
  await shot('choose-month', await rect("Array.from(document.querySelectorAll('.period-card')).find(e=>e.textContent.includes('August 2026'))"));
  await click("Array.from(document.querySelectorAll('.period-card')).find(e=>e.textContent.includes('August 2026'))");
  await waitFor("!!document.querySelector('.sla-table')");
  await shot('position');
  await click("document.querySelector('.actions-btn')");
  await shot('reports-menu', await rect("Array.from(document.querySelectorAll('.actions-item')).find(e=>e.textContent.includes('SLA Status'))"));
  await click("Array.from(document.querySelectorAll('.actions-item')).find(e=>e.textContent.includes('SLA Status'))");
  await shot('rates', await rect("document.querySelector('.sla-table')"));
  const targetRow = "Array.from(document.querySelectorAll('.sla-table tbody tr')).find(e=>e.textContent.includes('23B NUL'))";
  await shot('select-sla', await rect(targetRow));
  await click(targetRow);
  await waitFor("!!document.querySelector('.item-table')");
  await scrollTo("document.querySelector('.item-table').closest('.card')");
  await shot('drilldown');
  await click("Array.from(document.querySelectorAll('.filter-bar button')).find(e=>e.textContent.startsWith('missed'))");
  await shot('drilldown-missed', await rect("document.querySelector('.item-table')"));
  await navigate('2026-08/exceptions', "document.querySelector('.topbar h1')?.textContent==='SLA exceptions'");
  await shot('exceptions');
  await scrollTo("document.querySelector('.filter-bar').closest('.card')");
  await shot('exception-filter', await rect(button('Open overdue')));
  await click(button('Open overdue'));
  await shot('exceptions-overdue', await rect("document.querySelector('.item-table')"));
  await navigate('2026-08/status', "!!document.querySelector('.sla-table')");
  await scrollTo("Array.from(document.querySelectorAll('h2')).find(e=>e.textContent==='Data quality').closest('.card')");
  await shot('quality');
  await js('window.scrollTo(0,0)');
  await shot('open-intelligence', await rect("document.querySelector('.intel-dock')"));
  await click("document.querySelector('.intel-dock')");
  await waitFor("!!document.querySelector('.narrative-card')");
  const narrativeSource = await js("document.querySelector('.narrative-source').textContent");
  if (!narrativeSource.includes('amazon.nova-pro')) throw Error('Narrative did not use Nova: ' + narrativeSource);
  await shot('intelligence');
  await scrollTo("document.querySelector('.narrative-card')");
  await shot('narrative');
  await scrollTo("document.querySelector('.intel-grid')");
  await shot('trends', await rect("document.querySelector('.chart-wrap')"));
  await js("(()=>{const e=document.querySelector('.trend-head select');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(e,'23C');e.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await shot('trends-cancellation', await rect("document.querySelector('.chart-wrap')"));
  await scrollTo("document.querySelector('.scope-bar')");
  await js("(()=>{const e=document.querySelector('.scope-bar select');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(e,'2026-08');e.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await waitFor("document.querySelector('.narrative-scope')?.textContent.includes('Up to August')");
  const scopedSource = await js("document.querySelector('.narrative-source').textContent");
  if (!scopedSource.includes('amazon.nova-pro')) throw Error('Scoped narrative did not use Nova: ' + scopedSource);
  await shot('scope', await rect("document.querySelector('.scope-bar')"));
  await scrollTo("Array.from(document.querySelectorAll('.intel-panel h2')).find(e=>e.textContent==='Where failures concentrate').closest('.card')");
  await shot('drivers');
  await scrollTo("Array.from(document.querySelectorAll('.intel-panel h2')).find(e=>e.textContent.startsWith('Overdue backlog')).closest('.card')");
  await shot('backlog', await rect("document.querySelector('.demand-row')"));
  await scrollTo("document.querySelector('.ask-box')");
  await click("document.querySelector('.ask-input')");
  await call('Input.insertText', { text: 'Where are the 23B NUL failures concentrated?' });
  await shot('ask-typed', await rect("document.querySelector('.ask-send')"));
  await click("document.querySelector('.ask-send')");
  await waitFor("!!document.querySelector('.ask-text')");
  const answerSource = await js("document.querySelector('.ask-tag').textContent");
  if (!answerSource.includes('amazon.nova-pro')) throw Error('Q&A did not use Nova: ' + answerSource);
  await shot('ask-answer', await rect("document.querySelector('.ask-answer')"));
  fs.writeFileSync(path.join(WORK, 'qa.txt'), await js("document.querySelector('.ask-text').textContent"));
  fs.writeFileSync(path.join(WORK, 'nova-verification.json'), JSON.stringify({ narrativeSource, scopedSource, answerSource }, null, 2));
  await click("document.querySelector('.intel-back')");
  await waitFor("!document.querySelector('.intel-panel.is-open')");
  } else {
    await call('Page.navigate', { url: 'http://localhost:5273/#2026-08/status' });
    await waitFor("!!document.querySelector('.sla-table')");
  }
  // The closing panel transition lasts 800ms even after its state class changes.
  await pause(1000);
  await scrollTo("document.querySelector('.sla-table').closest('.card')");
  await shot('rates', await rect("document.querySelector('.sla-table')"));
  await js('window.scrollTo(0,0)');
  await shot('pack-shortcut', await rect(button('Governance pack')));
  await click(button('Governance pack'));
  await waitFor("!!document.querySelector('.pack-page')");
  await shot('pack');
  await shot('export', await rect(button('Export as PDF')));
  const pdf = await call('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(path.join(WORK, 'sample-governance-pack.pdf'), Buffer.from(pdf.data, 'base64'));
  await call('Emulation.setEmulatedMedia', { media: 'print' });
  await shot('pack-print');
  await call('Emulation.setEmulatedMedia', { media: 'screen' });
  await navigate('dashboard', "!!document.querySelector('.period-card')");
  await click("document.querySelector('.rail-search input')");
  await call('Input.insertText', { text: 'July 2025' });
  await shot('search', await rect("document.querySelector('.rail-search')"));
  fs.writeFileSync(path.join(WORK, 'capture-errors.json'), JSON.stringify(errors));
  if (errors.length) throw Error(errors.join('; '));
  await call('Browser.close');
  console.log(`Finished: ${Object.keys(manifest).length} screenshots; no browser exceptions.`);
} catch (e) { console.error(e); process.exitCode = 1; }
finally { socket?.close(); for (const p of children.reverse()) p.kill(); }
