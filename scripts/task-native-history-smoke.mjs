// Synthetic, network-independent history migration probe. Run in the Worker image
// with the compiled API mounted at /app/probe-api; see task-codex-home.md.
import { stageTaskNativeState } from '/app/probe-api/operations/task-native-state-migration.js';
import { mkdir, writeFile, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import path from 'node:path';

const root = await mkdtemp(path.join(tmpdir(), 'linksense-native-history-'));
const report = { version: '', checks: [], observations: {} };
const clients = [];
const captures = [];
const modelServer = createServer(async (request, response) => {
  let raw = ''; for await (const data of request) raw += data;
  let body; try { body = JSON.parse(raw); } catch { body = raw; }
  captures.push({ path: request.url, body });
  const id = `resp_probe_${captures.length}`;
  const item = { id: `msg_probe_${captures.length}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'PROBE_OK', annotations: [] }] };
  const send = () => {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  const emit = (type, value) => response.write(`event: ${type}\ndata: ${JSON.stringify({type, ...value})}\n\n`);
  emit('response.created', { response: { id, object: 'response', status: 'in_progress', output: [] } });
  emit('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
  emit('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: {type:'output_text',text:'',annotations:[]} });
  emit('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: 'PROBE_OK' });
  emit('response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text: 'PROBE_OK' });
  emit('response.content_part.done', { item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] });
  emit('response.output_item.done', { output_index: 0, item });
  emit('response.completed', { response: { id, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } } });
  response.end();
  };
  send();
});
let providerOverrides = [];
function record(name, passed, details) {
  report.checks.push({ name, passed, details });
  console.log(JSON.stringify({ name, passed }));
}
async function put(file, text) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text); }
function environment(label = 'fixture') {
  return { PATH: process.env.PATH, HOME: path.join(root, label), CODEX_HOME: path.join(root, label, ".codex"), LANG: 'C.UTF-8',
    PROBE_CREDENTIAL: `synthetic-${label}`, CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: '1' };
}
class Client {
  constructor(label, overrides = []) {
    this.label = label; this.pending = new Map(); this.next = 1; this.stderr = ''; this.notifications = [];
    this.child = spawn('codex', ['app-server', ...providerOverrides.flatMap(x => ['-c', x]), ...overrides.flatMap(x => ['-c', x])], {
      cwd: path.join(root, label), env: environment(label), stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child.stderr.on('data', x => this.stderr += x);
    createInterface({ input: this.child.stdout }).on('line', line => {
      let message; try { message = JSON.parse(line); } catch { this.stderr += `\nnon-json: ${line}`; return; }
      if (message.id !== undefined && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id); this.pending.delete(message.id); clearTimeout(pending.timer);
        message.error ? pending.reject(new Error(`${this.label} ${pending.method}: ${JSON.stringify(message.error)}`)) : pending.resolve(message.result);
      } else this.notifications.push(message);
    });
    this.child.on('error', err => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); } this.pending.clear(); });
    this.child.on('close', code => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(`${label} exited ${code}: ${this.stderr.slice(-3000)}`)); } this.pending.clear(); });
    clients.push(this);
  }
  request(method, params = {}) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${this.label} timeout ${method}; stderr: ${this.stderr.slice(-2000)}`)); }, 18000);
      this.pending.set(id, { resolve, reject, method, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  async init() {
    const result = await this.request('initialize', { clientInfo: { name: 'linksense_isolation_probe', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    return result;
  }
  async close() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => this.child.kill('SIGKILL'), 2000);
      this.child.once('close', () => { clearTimeout(timer); resolve(); });
      this.child.kill('SIGTERM');
    });
  }
}
const baseConfig = `check_for_update_on_startup = false\nweb_search = "disabled"\nallow_login_shell = false\n[analytics]\nenabled = false\n[features]\nplugins = true\nremote_plugin = false\nplugin_sharing = false\napps = false\nhooks = false\nshell_snapshot = false\nmemories = false\n[skills.bundled]\nenabled = false\n`;
async function turn(client, config) {
  const thread = await client.request('thread/start', { cwd: path.join(root,client.label), model: 'gpt-5.4', modelProvider: 'probe', approvalPolicy: 'never', sandbox: 'danger-full-access', config });
  const before = captures.length;
  const result = await client.request('turn/start', { threadId: thread.thread.id, input: [{ type: 'text', text: `Probe ${client.label}`, text_elements: [] }] });
  const deadline = performance.now() + 15000;
  while (!client.notifications.some(n=>n.method==='turn/completed' && n.params.turn.id===result.turn.id)) {
    if (performance.now()>deadline) throw new Error(`turn timeout ${client.label}: ${JSON.stringify(client.notifications.slice(-6))}`);
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  const terminal = client.notifications.find(n=>n.method==='turn/completed'&&n.params.turn.id===result.turn.id);
  return { threadId: thread.thread.id, status: terminal.params.turn.status, capture: captures.slice(before).find(c=>JSON.stringify(c.body).includes(`Probe ${client.label}`)) };
}
async function awaitCompleted(client,turnId) {
  const deadline=performance.now()+10000;
  while(!client.notifications.some(n=>n.method==='turn/completed'&&n.params.turn.id===turnId)) {
    if(performance.now()>deadline)throw new Error(`completion timed out ${client.label}`);
    await new Promise(resolve=>setTimeout(resolve,20));
  }
}

try {
  await Promise.all(['A','B','C'].map(label=>mkdir(path.join(root,label,'.codex'),{recursive:true})));
  await new Promise(resolve=>modelServer.listen(0,'127.0.0.1',resolve));
  providerOverrides=['model_provider="probe"','model="gpt-5.4"','features.plugins=false','model_providers.probe.name="Probe"',`model_providers.probe.base_url="http://127.0.0.1:${modelServer.address().port}/v1"`,'model_providers.probe.wire_api="responses"','model_providers.probe.requires_openai_auth=false'];
  for(const label of ['A','B','C']) await put(path.join(root,label,'.codex/config.toml'),baseConfig);
  const a=new Client('A'); await a.init(); const first=await turn(a);
  await a.request('thread/goal/set',{threadId:first.threadId,objective:'Synthetic migration goal',status:'paused',tokenBudget:12345});
  const read=await a.request('thread/read',{threadId:first.threadId,includeTurns:true});
  const rollout=read.thread.path;
  if(typeof rollout!=='string') throw new Error('native rollout path absent');
  const relative=path.relative(path.join(root,'A','.codex'),rollout);
  if(relative.startsWith('..'))throw new Error('rollout path outside source home');
  const target=path.join(root,'B','.codex',relative);await mkdir(path.dirname(target),{recursive:true});await copyFile(rollout,target);
  await mkdir(path.join(root,'native-stage'),{recursive:true});
  const states=await stageTaskNativeState({sourceHome:path.join(root,'A','.codex'),stagingRoot:path.join(root,'native-stage'),threadIds:[first.threadId],nativeCodexHome:path.join(root,'B','.codex')});
  for(const state of states)await copyFile(state.source,path.join(root,'B','.codex',state.name));
  const b=new Client('B'); await b.init();
  const bRead=await b.request('thread/read',{threadId:first.threadId,includeTurns:true});
  const migratedGoal=(await b.request('thread/goal/get',{threadId:first.threadId})).goal;
  record('native Goal survives migration with original budget and paused state',migratedGoal?.objective==='Synthetic migration goal'&&migratedGoal?.status==='paused'&&migratedGoal?.tokenBudget===12345,{goal:migratedGoal});
  record('copied rollout is readable by original id in an empty task CODEX_HOME',bRead.thread.id===first.threadId&&bRead.thread.turns.length===1,{path:bRead.thread.path});
  const resumed=await b.request('thread/resume',{threadId:first.threadId,cwd:path.join(root,'B'),model:'gpt-5.4',modelProvider:'probe',approvalPolicy:'never',sandbox:'danger-full-access'});
  const next=await b.request('turn/start',{threadId:first.threadId,input:[{type:'text',text:'Continue migrated fixture',text_elements:[]}]});await awaitCompleted(b,next.turn.id);
  const updated=await b.request('thread/read',{threadId:first.threadId,includeTurns:true});
  record('migrated thread continues in new home with original id',updated.thread.id===first.threadId&&updated.thread.turns.length===2,{path:updated.thread.path});
  const c=new Client('C');await c.init();
  const fork=await c.request('thread/fork',{threadId:first.threadId,path:rollout,lastTurnId:read.thread.turns[0].id,deferGoalContinuation:true,cwd:path.join(root,'C'),model:'gpt-5.4',modelProvider:'probe',approvalPolicy:'never',sandbox:'danger-full-access'});
  record('native path fork writes isolated child home and preserves requested history',fork.thread.id!==first.threadId&&fork.thread.turns.length===1&&fork.thread.path.startsWith(path.join(root,'C','.codex')),{path:fork.thread.path});
  console.log(JSON.stringify(report));
  if(report.checks.some(x=>!x.passed))process.exitCode=1;
} catch(error) { console.error(error);process.exitCode=1; }
finally { for(const client of clients) await client.close();modelServer.closeAllConnections();await new Promise(r=>modelServer.close(r)); await rm(root,{recursive:true,force:true}); }
