# -*- coding: utf-8 -*-
"""Uni Kasher — Key Manager v1 (النسخة القديمة البسيطة اللي كانت شغالة)
صفحة واحدة: توليد + سجل + أجهزة. نفس مفتاحك الخاص ونفس السجل keys.db."""
import base64, hashlib, json, os, sqlite3, sys, threading, uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

sys.stdout.reconfigure(encoding='utf-8')
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import ed25519_pure as ed25519

APP_DIR = _os.path.dirname(_os.path.abspath(__file__))
PRIVATE_KEY_PATH = _os.environ.get('UK_PRIVATE_KEY', r'C:/Users/mohaned said/Downloads/UniKasher-master-private.key')
DB_PATH = _os.path.join(APP_DIR, 'keys.db')
PORT = 8788
PREFIX = 'UNIKASHER1'
APP_ID = 'com.unikasher.pos'

raw = open(PRIVATE_KEY_PATH).read().strip()
PRIV_SEED = base64.urlsafe_b64decode(raw + '=' * (-len(raw) % 4))
PUB_BYTES = ed25519.publickey(PRIV_SEED)
PUB_FINGERPRINT = hashlib.sha256(PUB_BYTES).hexdigest()[:16]

DB_LOCK = threading.Lock()
db = sqlite3.connect(DB_PATH, check_same_thread=False)
db.row_factory = sqlite3.Row
db.execute("""CREATE TABLE IF NOT EXISTS keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_id TEXT UNIQUE,
    license_code TEXT UNIQUE,
    customer TEXT, phone TEXT, note TEXT,
    license_type TEXT, duration TEXT,
    device_id TEXT, device_bound INTEGER DEFAULT 1,
    issued_at TEXT, starts_at INTEGER, expires_at INTEGER, duration_seconds INTEGER,
    status TEXT DEFAULT 'active'
)""")
db.execute("""CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT UNIQUE, owner TEXT, note TEXT,
    added_at TEXT
)""")
db.commit()

DURATIONS = {
    '5m': 5*60, '15m': 15*60, '30m': 30*60, '1h': 3600, '6h': 6*3600,
    '1d': 86400, '3d': 3*86400, '7d': 7*86400, '14d': 14*86400,
    '30d': 30*86400, '60d': 60*86400, '90d': 90*86400,
    '6m': 180*86400, '1y': 365*86400,
}
DUR_LABELS = {
    '5m': '5 دقائق', '15m': '15 دقيقة', '30m': '30 دقيقة', '1h': 'ساعة', '6h': '6 ساعات',
    '1d': 'يوم', '3d': '3 أيام', '7d': 'أسبوع', '14d': 'أسبوعان',
    '30d': 'شهر', '60d': 'شهران', '90d': '3 أشهر',
    '6m': '6 أشهر', '1y': 'سنة',
}

def b64u(b): return base64.urlsafe_b64encode(b).decode().rstrip('=')

def live_status(row):
    """حساب حالة المفتاح من وقته: expired لو العدد انتهى من تاريخ الإصدار
    (تقدير السجل) — البرنامج نفسه عند العميل هو المصدر النهائي."""
    if row.get('status') == 'revoked':
        return 'revoked', 'ملغي يدويًا'
    if row.get('expires_at') and row['expires_at'] > (1 << 61):
        return 'active', 'مدى الحياة'
    if row.get('duration_seconds'):
        try:
            issued_ts = int(datetime.fromisoformat(row['issued_at']).replace(tzinfo=timezone.utc).timestamp())
        except Exception:
            return 'active', '—'
        remaining = issued_ts + row['duration_seconds'] - int(datetime.now(timezone.utc).timestamp())
        if remaining <= 0:
            return 'expired', '⏰ منتهي — انتهت مدته'
        days = remaining // 86400
        hours = (remaining % 86400) // 3600
        minutes = (remaining % 3600) // 60
        if days > 0:
            return 'active', f'متبقي {days} يوم و{hours} ساعة'
        if hours > 0:
            return 'active', f'متبقي {hours} ساعة و{minutes} دقيقة'
        return 'active', f'متبقي {minutes} دقيقة'
    return 'active', '—'

def generate_key(customer, phone, note, license_type, duration_key, device_id, start_days=0):
    if duration_key == 'lifetime':
        duration_seconds = None; expires_at = (1 << 62); dur_label = 'مدى الحياة'
    else:
        duration_seconds = DURATIONS[duration_key]; expires_at = 0
        dur_label = DUR_LABELS.get(duration_key, duration_key)
    starts_at = int((datetime.now(timezone.utc) + timedelta(days=int(start_days or 0))).timestamp()) if int(start_days or 0) > 0 else 0
    license_id = 'UK-' + uuid.uuid4().hex
    payload = {
        'v': 1, 'license_id': license_id, 'app_id': APP_ID,
        'license_type': license_type,
        'issued_at': int(datetime.now(timezone.utc).timestamp()),
        'starts_at': starts_at, 'expires_at': expires_at,
        'duration_seconds': duration_seconds,
        'device_id': device_id if device_id else None,
        'customer': customer or None,
    }
    payload_bytes = json.dumps(payload, separators=(',', ':')).encode()
    signature = ed25519.signature(PRIV_SEED, payload_bytes)
    code = f'{PREFIX}.{b64u(payload_bytes)}.{b64u(signature)}'
    with DB_LOCK:
        cur = db.execute("""INSERT INTO keys (license_id, license_code, customer, phone, note, license_type,
            duration, device_id, device_bound, issued_at, starts_at, expires_at, duration_seconds, status)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'active')""",
            (license_id, code, customer, phone, note, license_type, dur_label,
             device_id or None, 1 if device_id else 0, datetime.now(timezone.utc).isoformat(),
             starts_at, expires_at, duration_seconds))
        db.commit()
    return cur.lastrowid

PAGE = '''<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>مدير مفاتيح Uni Kasher</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Tahoma,sans-serif;background:#F5EFE2;color:#160029;padding:1.5rem 1rem;line-height:1.7}
.wrap{max-width:1150px;margin:0 auto}
.top{height:4px;border-radius:99px;background:linear-gradient(90deg,#D44D5C,#E8E5A4,#772344);margin-bottom:1.2rem}
h1{font-size:1.45rem;font-weight:800}
.sub{color:#4d3d53;font-size:.85rem;margin-bottom:1.2rem}
.card{background:#fffdf8;border:1px solid #e2d5d9;border-radius:1.1rem;padding:1.25rem 1.4rem;margin-bottom:1.1rem;box-shadow:0 10px 30px -22px rgba(22,0,41,.35)}
h2{font-size:1rem;font-weight:800;color:#772344;margin-bottom:.9rem}
label{display:block;font-size:.8rem;font-weight:700;margin-bottom:.3rem}
input,select{width:100%;padding:.55rem .8rem;border:1px solid #ddd;border-radius:.7rem;font-family:inherit;font-size:.88rem;background:#fff}
input:focus,select:focus{outline:2px solid #D44D5C;outline-offset:1px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:.8rem}
.row{display:flex;gap:.8rem;flex-wrap:wrap;align-items:flex-end}
.btn{background:linear-gradient(135deg,#D44D5C,#772344);color:#F5EFE2;border:0;border-radius:.75rem;padding:.65rem 1.5rem;font-weight:800;font-size:.9rem;cursor:pointer;font-family:inherit}
.btn.secondary{background:#fff;color:#772344;border:1.5px solid #772344}
.btn:hover{opacity:.92}
.result{margin-top:1rem;padding:1rem;border-radius:.8rem;background:rgba(232,229,164,.25);border:1px dashed #772344;display:none}
.result .code{font-family:Consolas,monospace;font-size:.75rem;direction:ltr;text-align:left;word-break:break-all;background:#fff;padding:.7rem;border-radius:.5rem;margin:.5rem 0;user-select:all}
table{width:100%;border-collapse:collapse;font-size:.82rem}
th{background:rgba(232,229,164,.4);padding:.5rem .6rem;text-align:right;border-bottom:2px solid #772344;white-space:nowrap}
td{padding:.45rem .6rem;border-bottom:1px solid #f0e5ea}
tr:hover td{background:rgba(232,229,164,.12)}
.badge{display:inline-block;padding:.1rem .55rem;border-radius:99px;font-size:.7rem;font-weight:800}
.b-active{background:rgba(33,100,75,.14);color:#21644b}
.b-revoked{background:rgba(155,36,58,.14);color:#9b243a}
.b-trial{background:rgba(90,80,160,.14);color:#4a4494}
.b-full{background:rgba(33,100,75,.14);color:#21644b}
.code-mini{font-family:Consolas,monospace;font-size:.66rem;direction:ltr;text-align:left;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle;cursor:pointer}
.toolbar{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.8rem}
.search{max-width:280px}
.filter{width:auto;min-width:130px;padding:.45rem .6rem;font-size:.82rem}
.empty{color:#4d3d53;text-align:center;padding:1.5rem;font-size:.85rem}
.toast{position:fixed;bottom:1rem;left:1rem;background:#160029;color:#F5EFE2;padding:.6rem 1.2rem;border-radius:.7rem;font-size:.85rem;display:none;z-index:99}
.info{font-size:.75rem;color:#4d3d53;margin-top:.4rem}
.copy-btn{background:none;border:1px solid #ccc;border-radius:.4rem;padding:.15rem .5rem;font-size:.7rem;cursor:pointer;font-family:inherit}
</style></head><body>
<div class="wrap"><div class="top"></div>
<h1>🔐 مدير مفاتيح Uni Kasher</h1>
<p class="sub">بصمة مفتاحك الخاص: <b>__FP__</b> · متوافق مع تفعيل البرنامج offline (Ed25519) · السجل محفوظ محليًا في keys.db</p>

<div class="card">
<h2>توليد مفتاح جديد</h2>
<div class="grid">
  <div><label>اسم العميل / الجهة</label><input id="customer" placeholder="مثال: سوبر ماركت النور"></div>
  <div><label>رقم الهاتف</label><input id="phone" placeholder="اختياري"></div>
  <div><label>نوع الترخيص</label>
    <select id="ltype"><option value="TRIAL">تجربة</option><option value="FULL">اشتراك كامل</option></select>
  </div>
  <div><label>المدة</label>
    <select id="dur">
      <option value="5m">5 دقائق</option>
      <option value="15m">15 دقيقة</option>
      <option value="30m">30 دقيقة</option>
      <option value="1h">ساعة</option><option value="6h">6 ساعات</option>
      <option value="1d">يوم</option><option value="3d">3 أيام</option>
      <option value="7d" selected>أسبوع</option><option value="14d">أسبوعان</option>
      <option value="30d">شهر</option><option value="60d">شهران</option>
      <option value="90d">3 أشهر</option><option value="6m">6 أشهر</option>
      <option value="1y">سنة</option><option value="lifetime">مدى الحياة</option>
    </select>
  </div>
  <div><label>Device ID (ربط بجهاز)</label><input id="device" placeholder="من شاشة التفعيل — اتركه فارغًا لمفتاح غير مربوط"></div>
  <div><label>يبدأ بعد (أيام) — اختياري</label><input id="startdays" type="number" min="0" value="0"></div>
  <div style="grid-column:1/-1"><label>ملاحظة</label><input id="note" placeholder="اختياري"></div>
</div>
<div style="margin-top:1rem"><button class="btn" onclick="gen()">⚡ توليد المفتاح</button></div>
<div id="result" class="result">
  <b>المفتاح الجديد — انسخه وأرسله للعميل:</b>
  <div class="code" id="newcode"></div>
  <button class="copy-btn" onclick="copyNew()">📋 نسخ</button>
  <div class="info" id="newmeta"></div>
</div>
</div>

<div class="card">
<h2>سجل المفاتيح</h2>
<div class="toolbar">
  <input class="search" id="q" placeholder="بحث بالاسم/الهاتف/الكود/الملاحظة..." oninput="render()">
  <select id="f-status" class="filter" onchange="render()">
    <option value="">كل الحالات</option>
    <option value="active">نشط فقط</option>
    <option value="expired">منتهي فقط</option>
    <option value="revoked">ملغي فقط</option>
  </select>
  <select id="f-type" class="filter" onchange="render()">
    <option value="">كل الأنواع</option>
    <option value="TRIAL">تجربة</option>
    <option value="FULL">اشتراك</option>
  </select>
  <select id="f-dur" class="filter" onchange="render()">
    <option value="">كل المدد</option>
    <option value="5m">5 دقائق</option><option value="15m">15 دقيقة</option><option value="30m">30 دقيقة</option>
    <option value="1h">ساعة</option><option value="1d">يوم</option><option value="7d">أسبوع</option>
    <option value="30d">شهر</option><option value="90d">3 أشهر</option><option value="1y">سنة</option><option value="lifetime">مدى الحياة</option>
  </select>
  <button class="btn secondary" onclick="render()">🔄 تحديث</button>
</div>
<div style="overflow-x:auto">
<p style="font-size:.78rem;color:#4d3d53;margin-bottom:.4rem">النتائج: <b id="count-label">—</b></p>
<table><thead><tr>
<th>العميل</th><th>الهاتف</th><th>النوع</th><th>المدة</th><th>Device ID</th><th>المفتاح</th><th>تاريخ الإصدار</th><th>المتبقي</th><th>الحالة</th><th></th>
</tr></thead><tbody id="rows"></tbody></table></div>
</div>

<div class="card">
<h2>أجهزة العملاء (Device IDs)</h2>
<div class="row">
  <div style="flex:1;min-width:220px"><label>Device ID جديد</label><input id="dev-id" placeholder="الصقه من شاشة التفعيل"></div>
  <div style="flex:1;min-width:180px"><label>صاحب الجهاز</label><input id="dev-owner" placeholder="اسم العميل"></div>
  <button class="btn secondary" onclick="addDev()">➕ حفظ الجهاز</button>
</div>
<div id="devs" style="margin-top:.8rem"></div>
</div>

<div class="toast" id="toast"></div>
</div>
<script>
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.style.display='block';setTimeout(()=>t.style.display='none',2500)}
async function gen(){
  const body={customer:v('customer'),phone:v('phone'),note:v('note'),ltype:v('ltype'),dur:v('dur'),device:v('device'),startdays:v('startdays')};
  const r=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json();
  if(d.error){toast(d.error);return}
  document.getElementById('result').style.display='block';
  document.getElementById('newcode').textContent=d.code;
  document.getElementById('newmeta').textContent='license_id: '+d.license_id;
  toast('تم توليد المفتاح وحفظه في السجل ✓');
  render();
}
function v(id){return document.getElementById(id).value.trim()}
function copyNew(){navigator.clipboard.writeText(document.getElementById('newcode').textContent);toast('تم النسخ ✓')}
function copyCode(c){navigator.clipboard.writeText(c);toast('تم نسخ المفتاح ✓')}
async function revoke(id){if(!confirm('إلغاء هذا المفتاح في السجل؟'))return;await fetch('/api/revoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});render()}
async function addDev(){await fetch('/api/devices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:v('dev-id'),owner:v('dev-owner')})});document.getElementById('dev-id').value='';document.getElementById('dev-owner').value='';loadDevs();toast('تم حفظ الجهاز ✓')}
async function delDev(id){if(!confirm('حذف الجهاز؟'))return;await fetch('/api/devices/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});loadDevs()}
async function loadDevs(){
  const r=await fetch('/api/devices');const d=await r.json();
  const el=document.getElementById('devs');
  if(!d.length){el.innerHTML='<div class="empty">لا توجد أجهزة محفوظة</div>';return}
  el.innerHTML='<table><thead><tr><th>Device ID</th><th>صاحبه</th><th></th></tr></thead><tbody>'+
    d.map(x=>`<tr><td class="code-mini" title="${x.device_id}">${x.device_id}</td><td>${x.owner||'—'}</td><td><button class="copy-btn" onclick="navigator.clipboard.writeText('${x.device_id}');toast('نسخ ✓')">📋</button> <button class="copy-btn" onclick="delDev(${x.id})">🗑</button></td></tr>`).join('')+'</tbody></table>';
}
async function render(){
  const q=document.getElementById('q').value.trim();
  const fs=document.getElementById('f-status').value;
  const ft=document.getElementById('f-type').value;
  const fd=document.getElementById('f-dur').value;
  const r=await fetch('/api/keys?q='+encodeURIComponent(q));let d=await r.json();
  if(fs)d=d.filter(x=>x.live_status===fs);
  if(ft)d=d.filter(x=>x.license_type===ft);
  if(fd)d=d.filter(x=>x.duration===fd);
  const tb=document.getElementById('rows');
  document.getElementById('count-label').textContent=d.length+' مفتاح';
  if(!d.length){tb.innerHTML='<tr><td colspan="10"><div class="empty">لا توجد نتائج مطابقة للفلتر — جرّب تغيير الفلاتر</div></td></tr>';return}
  tb.innerHTML=d.map(x=>{
    const typeBadge=x.license_type==='TRIAL'?'<span class="badge b-trial">تجربة</span>':'<span class="badge b-full">اشتراك</span>';
    let stBadge;
    if(x.live_status==='expired'){stBadge='<span class="badge b-revoked">⏰ منتهي</span>'}
    else if(x.live_status==='revoked'){stBadge='<span class="badge b-revoked">ملغي</span>'}
    else{stBadge='<span class="badge b-active">نشط</span>'}
    return `<tr>
      <td><b>${x.customer||'—'}</b>${x.note?'<br><span style="display:inline-block;margin-top:.15rem;font-size:.68rem;background:rgba(232,229,164,.5);border-radius:.4rem;padding:.05rem .4rem;color:#534360">📝 '+x.note+'</span>':''}</td>
      <td>${x.phone||'—'}</td><td>${typeBadge}</td><td>${x.duration}</td>
      <td class="code-mini" title="${x.device_id||''}">${x.device_id||'غير مربوط'}</td>
      <td><span class="code-mini" title="${x.license_code}" onclick="copyCode('${x.license_code}')">${x.license_code}</span> <button class="copy-btn" onclick="copyCode('${x.license_code}')">📋</button></td>
      <td style="font-size:.72rem">${x.issued_at}</td>
      <td style="font-size:.72rem;color:${x.live_status==='expired'?'#9b243a':'#4d3d53'};font-weight:${x.live_status==='expired'?'800':'400'}">${x.remaining_note||'—'}</td>
      <td>${stBadge}</td>
      <td>${x.live_status==='active'?`<button class="copy-btn" onclick="revoke(${x.id})">إلغاء</button>`:''}</td>
    </tr>`}).join('');
}
loadDevs();render();
</script></body></html>'''

class Handler(BaseHTTPRequestHandler):
    def _html(self, code=200, body=b'', ctype='text/html; charset=utf-8'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/' or self.path.startswith('/index'):
            html = PAGE.replace('__FP__', PUB_FINGERPRINT)
            self._html(body=html.encode())
        elif self.path.startswith('/api/keys'):
            q = parse_qs(urlparse(self.path).query).get('q', [''])[0].strip()
            if q:
                rows = db.execute("""SELECT * FROM keys WHERE customer LIKE ? OR phone LIKE ? OR license_code LIKE ? OR note LIKE ?
                                      ORDER BY id DESC""", (f'%{q}%', f'%{q}%', f'%{q}%', f'%{q}%')).fetchall()
            else:
                rows = db.execute('SELECT * FROM keys ORDER BY id DESC').fetchall()
            out = []
            for r in rows:
                d = dict(r)
                st, note = live_status(d)
                d['live_status'] = st
                d['remaining_note'] = note
                out.append(d)
            self._html(body=json.dumps(out, ensure_ascii=False).encode(), ctype='application/json; charset=utf-8')
        elif self.path.startswith('/api/devices'):
            rows = db.execute('SELECT * FROM devices ORDER BY id DESC').fetchall()
            self._html(body=json.dumps([dict(r) for r in rows], ensure_ascii=False).encode(), ctype='application/json; charset=utf-8')
        else:
            self._html(404, b'not found')

    def do_POST(self):
        ln = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(ln) or b'{}')
        if self.path == '/api/generate':
            customer = body.get('customer', '').strip()
            dur = body.get('dur', '7d')
            if dur != 'lifetime' and dur not in DURATIONS:
                return self._html(400, json.dumps({'error': 'مدة غير صالحة'}, ensure_ascii=False).encode(), 'application/json; charset=utf-8')
            new_id = generate_key(customer, body.get('phone', ''), body.get('note', ''),
                                  body.get('ltype', 'TRIAL'), dur, body.get('device', ''), body.get('startdays', 0))
            row = db.execute('SELECT * FROM keys WHERE id=?', (new_id,)).fetchone()
            out = dict(code=row['license_code'], license_id=row['license_id'])
            self._html(body=json.dumps(out, ensure_ascii=False).encode(), ctype='application/json; charset=utf-8')
        elif self.path == '/api/revoke':
            db.execute("UPDATE keys SET status='revoked' WHERE id=?", (body.get('id'),))
            db.commit()
            self._html(body=b'{"ok":true}', ctype='application/json')
        elif self.path == '/api/devices':
            dev = body.get('device_id', '').strip()
            if dev:
                db.execute("INSERT OR IGNORE INTO devices (device_id, owner, added_at) VALUES (?,?,datetime('now'))",
                           (dev, body.get('owner', '').strip()))
                db.commit()
            self._html(body=b'{"ok":true}', ctype='application/json')
        elif self.path == '/api/devices/delete':
            db.execute('DELETE FROM devices WHERE id=?', (body.get('id'),))
            db.commit()
            self._html(body=b'{"ok":true}', ctype='application/json')
        else:
            self._html(404, b'not found')

    def log_message(self, *a): pass

if __name__ == '__main__':
    print(f'🔑 مدير مفاتيح Uni Kasher v1 يعمل على: http://localhost:{PORT}')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
