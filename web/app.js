const token = location.hash.slice(1), el = id => document.getElementById(id);
const canvas = el('screen'), ctx = canvas.getContext('2d');
let status, image, frameSession, etag = '', busy = false, switching = false, selecting = false;
let start, end, pressedAt, nodes = [], selected, deviceData = { devices: [], emulators: [] }, composing = false, connected = false;
window.addEventListener('hashchange', () => location.reload());
function message(text) { el('message').textContent = text; }
async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (!response.ok && response.status !== 304) {
    let detail; try { detail = (await response.json()).error; } catch {}
    throw new Error(detail || `请求失败 (${response.status})`);
  }
  return response;
}
function currentEmulator() { return deviceData.emulators?.find(device => device.serial && device.serial === status?.device); }
function deviceName() { return deviceData.devices?.find(device => device.serial === status?.device)?.name || status?.deviceName || currentEmulator()?.name || status?.device || 'HarmonyOS'; }
function ready() { return !!image && status?.active && !status.stale && frameSession === status.session && !busy && !switching && !!status.crop && !selecting; }
function resetSession() {
  image?.close(); image = null; frameSession = undefined; etag = ''; nodes = []; selected = undefined; message('设备会话已更新');
  start = end = null; selecting = false; el('logs').textContent = ''; el('text').value = ''; el('text-target').checked = false; el('bundle').value = ''; el('keyword').value = ''; el('launch-bundle').value = ''; el('launch-ability').value = ''; el('hap').value = ''; el('application-result').textContent = ''; el('application-result').hidden = true; renderNodes(); showProperties(); draw();
}
function applyStatus(next) {
  if (status && Number(next.session) < Number(status.session)) return;
  if (status && next.session !== status.session) resetSession();
  status = next; connected = true;
  el('device-name').textContent = deviceName();
  el('connection').textContent = busy ? '执行中' : !next.active ? '已停止' : next.stale ? '画面暂停' : image && frameSession === next.session ? 'Live' : '等待画面';
  el('connection').classList.toggle('live', ready());
  el('session-label').textContent = `会话 ${next.session ?? '—'}`;
  el('warning').textContent = next.warning || '';
  el('metadata').replaceChildren();
  for (const [label, value] of [['设备', deviceName()], ['来源', next.source === 'sck' ? 'ScreenCaptureKit' : next.source === 'hdc' ? 'HDC' : '—'], ['尺寸', next.deviceSize ? `${next.deviceSize.width} × ${next.deviceSize.height}` : '—'], ['采集', next.capturedAt ? new Date(next.capturedAt).toLocaleTimeString() : '—']]) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value || '—'; el('metadata').append(dt, dd);
  }
  if (next.events) renderEvents(next.events);
  renderApplication(next.application);
  controls(); draw();
}
function controls() {
  el('connection').textContent = busy ? '执行中' : !connected ? '连接中断' : !status?.active ? '已停止' : status.stale ? '画面暂停' : image && frameSession === status.session ? 'Live' : '等待画面';
  el('connection').classList.toggle('live', ready());
  document.querySelectorAll('[data-selected]').forEach(control => { control.disabled = !status?.device || !connected || busy || switching; });
  const emulator = currentEmulator();
  document.querySelectorAll('[data-target]').forEach(control => { control.disabled = !emulator || busy || switching; });
  el('fold-row').hidden = emulator?.deviceType !== 'foldable';
  document.querySelectorAll('[data-device]').forEach(button => { button.disabled = !ready(); });
  for (const id of ['node-tap', 'node-longpress']) el(id).disabled = !ready() || !selected?.id;
  el('clear-selection').disabled = busy || switching;
  el('calibrate').disabled = busy || switching || !image || status?.stale || status?.source !== 'sck';
  el('calibrate').textContent = selecting ? '取消校准' : '校准';
  el('retry').disabled = busy;
  el('hint').textContent = selecting ? '拖选实际触摸屏区域，排除外壳和工具栏' : switching ? '切换设备中，输入已停用' : status?.stale ? '画面暂停，输入已停用' : !status?.crop ? '先校准触摸屏区域' : frameSession !== status?.session ? '等待当前设备画面' : '点击轻触 · 按住长按 · 滚轮滑动';
}
async function updateStatus() { try { applyStatus(await (await api('status')).json()); } catch (error) { connected = false; if (status) status.stale = true; el('connection').textContent = '连接中断'; controls(); message(error.message); } }
async function action(value) {
  if (busy) throw new Error('上一条操作正在执行');
  const session = status?.session;
  const transition = ['device_select', 'retry', 'emulator_stop', 'emulator_control'].includes(value.action);
  busy = true; switching = transition; controls(); renderDevices(); message('正在执行…');
  try {
    const result = await (await api('action', { method: 'POST', body: JSON.stringify({ ...value, session }) })).json();
    await updateStatus();
    if (!transition && session !== status?.session) throw new Error('设备会话已变化，请重新读取');
    message('命令已完成；设备状态以画面和控件为准'); return result;
  } catch (error) { if (transition || session === status?.session) message(error.message); throw error; }
  finally { busy = false; switching = false; controls(); renderDevices(); }
}
function renderApplication(application, fill = false) {
  el('application').replaceChildren();
  const fields = application ? [['Bundle',application.bundle],['Ability',application.ability],['版本',application.version],['安装',application.installedAt ? new Date(application.installedAt).toLocaleString() : null],['启动',application.launchedAt ? new Date(application.launchedAt).toLocaleString() : null]] : [['应用','暂无记录']];
  for (const [label,value] of fields) {
    if (!value) continue;
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; el('application').append(dt,dd);
  }
  if (fill && application) {
    el('launch-bundle').value = application.bundle || ''; el('launch-ability').value = application.ability || '';
    el('bundle').value = application.bundle || '';
  }
}
async function installFile(file) {
  if (busy || switching || !status?.device || !connected) { message('请先选择设备，并等待当前操作完成'); return; }
  if (!file || !/\.hap$/i.test(file.name)) { message('请选择 .hap 安装包'); return; }
  if (!file.size || file.size > 128 * 1024 * 1024) { message('安装包必须非空，且不超过 128 MiB'); return; }
  const session = status.session;
  busy = true; controls(); renderDevices(); message('正在安装…');
  try {
    const result = await (await api('install', { method:'POST', body:file, headers:{'Content-Type':'application/octet-stream','X-Preview-Session':String(session),'X-Hap-Name':encodeURIComponent(file.name)} })).json();
    await updateStatus();
    if (session !== status?.session) return;
    if (result.application) status.application = result.application;
    renderApplication(status.application,true);
    el('application-result').textContent = `安装成功${result.application?.bundle ? ` · ${result.application.bundle}` : ''}`;
    el('application-result').hidden = !el('application-result').textContent;
    message('安装已完成');
  } catch(error) { if (session === status?.session) message(error.message); }
  finally { busy = false; controls(); renderDevices(); }
}
el('install-form').onsubmit = event => { event.preventDefault(); installFile(el('hap').files[0]); };
el('launch-form').onsubmit = async event => {
  event.preventDefault(); if (!status?.device || busy || switching || !el('launch-form').reportValidity()) return;
  try { const result = await action({action:'launch',bundle:el('launch-bundle').value.trim(),ability:el('launch-ability').value.trim()}); if (result.application) status.application = result.application; renderApplication(status.application); } catch {}
};
const viewport = el('viewport');
viewport.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = busy || switching ? 'none' : 'copy'; viewport.classList.add('drop-target'); } });
viewport.addEventListener('dragleave', () => viewport.classList.remove('drop-target'));
viewport.addEventListener('drop', event => {
  event.preventDefault(); viewport.classList.remove('drop-target');
  const files = event.dataTransfer.files; if (files.length !== 1) { message('每次请拖入一个 .hap 安装包'); return; } installFile(files[0]);
});
function crop() { return !selecting && status?.crop ? status.crop : { x: 0, y: 0, width: 1, height: 1 }; }
function fit() {
  if (!image) return;
  const viewport = el('viewport'), scale = el('zoom').value === 'fit' ? Math.min((viewport.clientWidth - 24) / canvas.width, (viewport.clientHeight - 24) / canvas.height) : Number(el('zoom').value);
  canvas.style.width = `${Math.max(1, canvas.width * scale)}px`; canvas.style.height = `${Math.max(1, canvas.height * scale)}px`;
}
function draw() {
  canvas.style.visibility = image ? 'visible' : 'hidden'; el('empty').hidden = !!image;
  if (!image) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
  const c = crop(); canvas.width = Math.max(1, Math.round(image.width * c.width)); canvas.height = Math.max(1, Math.round(image.height * c.height));
  ctx.drawImage(image, image.width * c.x, image.height * c.y, image.width * c.width, image.height * c.height, 0, 0, canvas.width, canvas.height);
  let rect;
  if (selecting && start && end) rect = { x: Math.min(start.x,end.x), y: Math.min(start.y,end.y), width: Math.abs(start.x-end.x), height: Math.abs(start.y-end.y) };
  else if (selected?.bounds && status.deviceSize) {
    const [l,t,r,b] = selected.bounds, s = status.deviceSize;
    rect = { x: c.x + l / s.width * c.width, y: c.y + t / s.height * c.height, width: (r-l) / s.width * c.width, height: (b-t) / s.height * c.height };
  }
  if (rect) { ctx.strokeStyle = '#9cc0ff'; ctx.lineWidth = Math.max(2, canvas.width/500); ctx.strokeRect((rect.x-c.x)/c.width*canvas.width,(rect.y-c.y)/c.height*canvas.height,rect.width/c.width*canvas.width,rect.height/c.height*canvas.height); }
  fit();
}
function point(event) {
  const r = canvas.getBoundingClientRect(), c = crop();
  return { x: c.x + Math.max(0,Math.min(1,(event.clientX-r.left)/r.width))*c.width, y: c.y + Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))*c.height };
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || (!selecting && !ready()) || busy || !image) return;
  start = point(event); end = start; pressedAt = performance.now(); canvas.setPointerCapture(event.pointerId); event.preventDefault();
});
canvas.addEventListener('pointermove', event => { if (start) { end = point(event); if (selecting) draw(); } });
canvas.addEventListener('pointercancel', () => { start = end = null; draw(); });
canvas.addEventListener('pointerup', async event => {
  if (!start) return;
  const a = start, b = point(event), held = performance.now()-pressedAt, c = crop(); start = end = null;
  const distance = Math.hypot((a.x-b.x)/c.width*canvas.clientWidth,(a.y-b.y)/c.height*canvas.clientHeight);
  try {
    if (selecting) {
      const rect = { x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), width: Math.abs(a.x-b.x), height: Math.abs(a.y-b.y) };
      if (rect.width < .02 || rect.height < .02) throw new Error('校准区域太小，请重新拖选');
      await action({ action: 'calibrate', rect }); selecting = false; controls();
    } else if (ready()) {
      const mode = el('gesture').value;
      await action(distance >= 8 ? { action: mode === 'drag' ? 'drag' : 'swipe', start: a, end: b } : { action: mode === 'doubletap' ? 'doubletap' : mode === 'longpress' || held >= 600 ? 'longpress' : 'tap', point: b });
    }
  } catch (error) { message(error.message); } draw();
});
canvas.addEventListener('wheel', event => {
  event.preventDefault(); if (!ready() || Math.abs(event.deltaY)+Math.abs(event.deltaX)<1) return;
  const c = crop(), p = point(event), clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
  const endPoint = { x: clamp(p.x-Math.sign(event.deltaX)*c.width*.25,c.x+.02*c.width,c.x+.98*c.width), y: clamp(p.y-Math.sign(event.deltaY)*c.height*.25,c.y+.02*c.height,c.y+.98*c.height) };
  action({ action:'swipe', start:p, end:endPoint }).catch(() => {});
}, { passive:false });
el('calibrate').onclick = () => { selecting = !selecting; start = end = null; selected = undefined; controls(); draw(); };
el('fit').onclick = () => { el('zoom').value = 'fit'; fit(); }; el('zoom').onchange = fit; new ResizeObserver(fit).observe(el('viewport'));
for (const [id,key] of [['home','Home'],['back','Back']]) el(id).onclick = () => action({action:'key',key}).catch(() => {});
el('retry').onclick = () => action({action:'retry',source:el('source').value}).catch(() => {});
for (const form of document.querySelectorAll('form[data-command]')) form.onsubmit = event => {
  event.preventDefault();
  if (!currentEmulator() || busy || switching || !form.reportValidity()) return;
  const input = form.querySelector('[name]');
  if (form.dataset.command === 'fold' && currentEmulator().deviceType !== 'foldable') return;
  action({ action:'emulator_control', command:form.dataset.command, [input.name]:input.type === 'number' ? Number(input.value) : input.value }).catch(() => {});
};
el('power').onclick = () => { if (currentEmulator() && !busy && !switching) action({ action:'emulator_control', command:'power' }).catch(() => {}); };
el('text').addEventListener('compositionstart', () => { composing = true; }); el('text').addEventListener('compositionend', () => { composing = false; });
el('text').addEventListener('paste', () => { message('粘贴内容已放入输入框，点击发送文本'); });
el('text-form').onsubmit = async event => {
  event.preventDefault(); if (composing || !ready()) return;
  const text = el('text').value; if (!text) return;
  if (el('text-target').checked && !selected?.id) { message('请先选择有 id 的控件'); return; }
  try { await action({ action:'text', text, ...(el('text-target').checked ? { id:selected.id } : {}) }); } catch {}
};
el('download').onclick = async () => {
  const session = status.session;
  try {
    const response = await api('screenshot'), blob = await response.blob();
    if (session !== status.session || (response.headers.get('X-Preview-Session') && Number(response.headers.get('X-Preview-Session')) !== session)) throw new Error('设备已切换，请重新截图');
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'hos-device.png'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  } catch (error) { message(error.message); }
};
function flatten(tree) {
  const result = [];
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    const attrs = value.attributes || value;
    if ('type' in attrs || 'bounds' in attrs || 'id' in attrs || 'text' in attrs) {
      let bounds = attrs.bounds;
      if (typeof bounds === 'string') bounds = bounds.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
      if (bounds && !Array.isArray(bounds)) bounds = [bounds.left ?? bounds.x, bounds.top ?? bounds.y, bounds.right ?? bounds.x+ bounds.width, bounds.bottom ?? bounds.y+bounds.height];
      result.push({ ...attrs, ...(Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite) ? {bounds} : {bounds:null}) });
    }
    for (const [key,child] of Object.entries(value)) if (key !== 'attributes' && child && typeof child === 'object') walk(child);
  }
  walk(tree); return result;
}
function renderNodes() {
  const query = el('node-search').value.toLowerCase(); el('nodes').replaceChildren();
  const filtered = nodes.filter(node => `${node.id || ''} ${node.text || ''} ${node.type || ''}`.toLowerCase().includes(query));
  for (const node of filtered) {
    const button = document.createElement('button'), small = document.createElement('small'); button.className = `node${node === selected ? ' selected' : ''}`;
    button.textContent = node.text || node.type || '控件'; small.textContent = `${node.type || ''}${node.id ? ` · ${node.id}` : ' · 无 id'}`; button.append(small);
    button.onclick = () => { selected = node; showProperties(); renderNodes(); draw(); }; el('nodes').append(button);
  }
  if (!filtered.length) el('nodes').textContent = nodes.length ? '没有匹配控件' : '尚未读取 UI 树';
}
function showProperties() { el('properties').textContent = selected ? JSON.stringify(selected,null,2) : '尚未选择控件'; controls(); }
el('tree').onclick = async () => { try { nodes = flatten(await action({action:'tree'})); selected = undefined; renderNodes(); showProperties(); draw(); } catch {} };
el('node-search').oninput = renderNodes;
el('clear-selection').onclick = () => { selected = undefined; renderNodes(); showProperties(); draw(); };
for (const [id,kind] of [['node-tap','tap'],['node-longpress','longpress']]) el(id).onclick = () => { if (selected?.id) action({action:kind,id:selected.id}).catch(() => {}); };
el('logs-form').onsubmit = async event => {
  event.preventDefault(); if (!ready()) return;
  try { const result = await action({action:'logs',bundle:el('bundle').value || undefined,keyword:el('keyword').value || undefined,level:el('level').value || undefined,tail:200,crash:el('crash').checked}); el('logs').textContent = result.stdout || '暂无匹配日志'; } catch {}
};
function renderEvents(events) {
  const labels = {tap:'轻触',doubletap:'双击',longpress:'长按',swipe:'滑动',drag:'拖拽',text:'文本输入',key:'按键',tree:'读取控件',ui_tree:'读取控件',logs:'读取日志',device_select:'切换设备',emulator_start:'启动模拟器',emulator_stop:'停止模拟器',emulator_control:'模拟器场景',retry:'重试采集',calibrate:'屏幕校准',install:'安装应用',launch:'启动应用',screenshot:'设备截图',preview_start:'启动预览',preview_stop:'停止预览'};
  const seen = new Set(); el('events').replaceChildren();
  for (const event of [...events].reverse()) {
    const id = event.id ?? `${event.time}:${event.action}:${event.device}`; if (seen.has(id)) continue; seen.add(id);
    const item = document.createElement('li'), detail = document.createElement('small');
    const actionName = event.action.replace(/^hos_/, '');
    item.textContent = `${event.status === 'error' ? '失败' : '完成'} · ${labels[actionName] || actionName}${event.status === 'error' && event.summary ? ` · ${event.summary}` : ''}`;
    detail.textContent = `${new Date(event.time).toLocaleTimeString()} · ${event.durationMs ?? '—'} ms · ${event.device || '—'}`; item.append(detail); el('events').append(item);
  }
}
async function loadDevices() {
  try { deviceData = await (await api('devices')).json(); el('device-message').textContent = ''; renderDevices(); if (status) applyStatus(status); } catch(error) { el('device-message').textContent = error.message; }
}
function renderDevices() {
  const query = el('device-search').value.toLowerCase();
  for (const [listId,list] of [['devices',deviceData.devices || []],['emulators',deviceData.emulators || []]]) {
    el(listId).replaceChildren();
    for (const device of list.filter(d => `${d.name || ''} ${d.serial || ''} ${d.deviceType || ''}`.toLowerCase().includes(query))) {
      const card = document.createElement('div'), button = document.createElement('button'), title = document.createElement('strong'), description = document.createElement('small');
      card.className = `device-card${device.serial && device.serial === status?.device ? ' selected' : ''}`; button.className = 'device-select';
      title.textContent = device.name || device.serial || '设备'; description.textContent = listId === 'devices' ? device.serial : `${device.status || '—'}${device.deviceType ? ` · ${device.deviceType}` : ''}`; button.append(title,description);
      button.disabled = busy || !device.serial; button.onclick = () => action({action:'device_select',device:device.serial}).catch(() => {}); card.append(button);
      if (listId === 'emulators') {
        const row = document.createElement('div'); row.className = 'row';
        for (const [label,kind] of [['启动','emulator_start'],['停止','emulator_stop']]) {
          const control = document.createElement('button'); control.textContent = label; control.disabled = busy || (kind === 'emulator_start' ? device.status !== 'stopped' : device.status !== 'running'); control.onclick = async () => { try { await action({action:kind,name:device.name}); await loadDevices(); } catch {} }; row.append(control);
        }
        card.append(row);
      }
      el(listId).append(card);
    }
    if (!el(listId).children.length) el(listId).textContent = '暂无匹配设备';
  }
}
el('device-search').oninput = renderDevices; el('refresh-devices').onclick = loadDevices;
async function updateFrame() {
  const requestedSession = status?.session;
  try {
    const response = await api('frame', {headers:etag ? {'If-None-Match':etag} : {}});
    if (response.status !== 304) {
      const session = Number(response.headers.get('X-Preview-Session'));
      if (requestedSession === status?.session && session === status?.session && !switching) {
        const next = await createImageBitmap(await response.blob());
        if (session === status?.session && !switching) { image?.close(); image = next; frameSession = session; etag = response.headers.get('ETag') || ''; draw(); controls(); } else next.close();
      }
    }
  } catch { /* Status reports unavailable frames without repeated error messages. */ }
  setTimeout(updateFrame,150);
}
if (!token) { message('请使用 serve-hos 输出的完整地址，包含访问令牌'); controls(); }
else { await updateStatus(); await loadDevices(); updateFrame(); setInterval(updateStatus,1000); setInterval(loadDevices,10000); }
