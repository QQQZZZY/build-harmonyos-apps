const token = location.hash.slice(1), canvas = document.querySelector('#screen'), ctx = canvas.getContext('2d');
window.addEventListener('hashchange', () => location.reload());
const el = id => document.getElementById(id);
let status, image, selecting = false, start, end, lastFrame = '', sending = false;
async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (!response.ok) throw new Error((await response.json()).error);
  return response;
}
function message(value) { el('message').textContent = value; }
async function action(value) {
  if (sending) { message('上一条操作正在执行，请稍候'); throw new Error('上一条操作正在执行'); }
  sending = true;
  message('正在执行…');
  try { const response = await api('action', { method: 'POST', body: JSON.stringify(value) }); message('操作已完成'); return response.json(); }
  catch (error) { message(error.message); throw error; }
  finally { sending = false; }
}
function draw() {
  if (!image) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0);
  const rect = selecting && start && end ? { x: Math.min(start.x,end.x), y: Math.min(start.y,end.y), width: Math.abs(start.x-end.x), height: Math.abs(start.y-end.y) } : status?.source === 'sck' ? status.crop : null;
  if (rect) { ctx.strokeStyle = '#6db8ff'; ctx.lineWidth = Math.max(2,canvas.width / 600); ctx.strokeRect(rect.x*canvas.width,rect.y*canvas.height,rect.width*canvas.width,rect.height*canvas.height); }
}
function point(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: Math.min(1,Math.max(0,(event.clientX-rect.left)/rect.width)), y: Math.min(1,Math.max(0,(event.clientY-rect.top)/rect.height)) };
}
canvas.addEventListener('pointerdown', event => {
  if (!image || status?.stale || (!selecting && !status?.crop)) return;
  start = point(event); end = start; canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => { if (start) { end = point(event); if (selecting) draw(); } });
canvas.addEventListener('pointercancel', () => { start = end = null; draw(); });
canvas.addEventListener('pointerup', async event => {
  if (!start) return;
  const a = start, b = point(event); start = end = null;
  try {
    if (selecting) {
      const rect = { x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), width: Math.abs(a.x-b.x), height: Math.abs(a.y-b.y) };
      status = await action({ action: 'calibrate', rect }); selecting = false;
    } else {
      const distance = Math.hypot((a.x-b.x)*canvas.clientWidth,(a.y-b.y)*canvas.clientHeight);
      await action(distance < 8 ? { action: 'tap', point: b } : { action: 'swipe', start: a, end: b });
    }
  } catch {} draw();
});
el('calibrate').addEventListener('click', () => { selecting = !selecting; message(selecting ? '拖选实际设备触摸屏区域' : '已取消校准'); draw(); });
el('text-form').addEventListener('submit', async event => { event.preventDefault(); try { await action({ action:'text', text:el('text').value }); } catch {} });
el('tree').addEventListener('click', async () => { try { el('output').textContent = JSON.stringify(await action({action:'tree'}),null,2); el('output').parentElement.open = true; } catch {} });
el('back').addEventListener('click', async () => { try { await action({action:'key',key:'Back'}); } catch {} });
el('download').addEventListener('click', async () => {
  try { const blob = await (await api('frame')).blob(), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = status?.source === 'sck' ? 'hos-window.jpg' : 'hos-device.png'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); } catch(error) { message(error.message); }
});
async function updateStatus() {
  try {
    status = await (await api('status')).json();
    el('connection').textContent = status.stale ? '画面暂不可用' : '已连接';
    el('warning').textContent = status.warning || '';
    el('metadata').replaceChildren();
    for (const [label,value] of [['设备',status.device],['画面',status.source === 'sck' ? 'ScreenCaptureKit' : 'HDC 截图'],['分辨率',status.deviceSize ? `${status.deviceSize.width} × ${status.deviceSize.height}` : '—']]) {
      const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; el('metadata').append(dt,dd);
    }
    el('calibrate').disabled = status.source !== 'sck' || status.stale;
    el('hint').textContent = selecting ? '拖选触摸屏区域' : status.stale ? '画面暂停，输入已停用' : !status.crop ? '先校准屏幕区域，再操作设备' : '点击轻触 · 拖动滑动';
    draw();
  } catch (error) { el('connection').textContent = '连接中断'; message(error.message); if(status)status.stale=true; }
}
async function updateFrame() {
  try {
    const response = await api('frame'), stamp = response.headers.get('X-Frame-Time');
    if (stamp !== lastFrame) {
      const next = await createImageBitmap(await response.blob()); image?.close(); image = next; lastFrame = stamp;
      canvas.width = next.width; canvas.height = next.height; draw();
    }
  } catch (error) { message(error.message); }
  setTimeout(updateFrame,100);
}
if (!token) message('请使用 serve-hos 输出的完整地址，包含 # 后的访问令牌');
else { await updateStatus(); updateFrame(); setInterval(updateStatus,1000); }
