// ============================================
// 淇粰銉诲晱閬?鈥?鍓嶇 v3
// 淇锛氭秷闄ら€掑綊淇濆簳 / DOM 绌烘寚閽?/ 鏃ュ織閫忎紶 / file:// 妫€娴?
// ============================================
// 鍗忚妫€娴嬶細蹇呴』閫氳繃 http://localhost:3456 璁块棶锛屼笉鑳藉弻鍑绘墦寮€鏂囦欢
if (location.protocol === 'file:') {
  document.body.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;color:#c9b37e;background:#14161a;text-align:center;padding:40px"><div><h1 style="letter-spacing:6px;margin-bottom:16px">淇粰銉婚棶閬?/h1><p style="color:#a9a598;line-height:2">璇蜂娇鐢ㄤ互涓嬫柟寮忓惎鍔細</p><p style="color:#7ec98a;margin:12px 0;font-size:18px">鍙屽嚮 <b>鍚姩娓告垙.bat</b></p><p style="color:#6b7280;font-size:13px">鎴栧湪鍛戒护琛屾墽琛?br><code style="background:#1d2026;padding:4px 10px;border-radius:4px;color:#d8d4c8">node server.js</code><br>鐒跺悗璁块棶 <b>http://localhost:3456</b></p></div></div>';
  throw new Error('璇烽€氳繃 http://localhost:3456 璁块棶');
}

(async function autoStart() {
  if (location.protocol === 'file:') return;
  var ga = document.getElementById('game-area');
  if (ga) ga.style.display = '';
  var sb = document.getElementById('btn-save');
  if (sb) sb.style.display = '';
  // 鑷姩鍒涘缓闅忔満瑙掕壊锛屽垱寤哄畬鎴愬悗鍐嶅垏鍒板垱瑙?Tab 璁╃帺瀹剁湅鍒拌鑹蹭俊鎭?
  var res = await API.newGame({});
  if (res.ok) {
    UI.render(res.scene, res.state);
  }
})();

const $ = id => document.getElementById(id);

// ==== 璇婃柇锛氬惎鍔ㄥ悗鑷姩 ping 鏈嶅姟绔紝闂绔嬪嵆鍙 ====
(async function diag() {
  try {
    const res = await fetch('/api/ping');
    const data = await res.json();
    if (data.pong) console.log('[璇婃柇] 鏈嶅姟绔繛鎺ユ垚鍔?);
  } catch(e) {
    console.error('[璇婃柇] 鏈嶅姟绔笉鍙揪:', e.message);
    console.error('[璇婃柇] 褰撳墠椤甸潰:', location.href);
    console.error('[璇婃柇] fetch URL 搴斾负:', location.origin + '/api/ping');
  }
})();

const API = {
  async call(url, body) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const opt = body ? { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal:ctrl.signal } : { signal:ctrl.signal };
      const res = await fetch(url, opt);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch(e) {
      console.error('[API閿欒]', url, e.name, e.message);
      return { ok:false, error: (e.name==='AbortError'?'鏈嶅姟鍣ㄨ秴鏃?:'杩炴帴澶辫触: '+e.message) };
    } finally { clearTimeout(t); }
  },
  newGame(d)  { return this.call('/api/new-game', d); },
  action(c)   { return this.call('/api/action', c); },
  item(body)  { return this.call('/api/item', body); },
  save(s)     { return this.call('/api/save', {slot:s}); },
  load(s)     { return this.call('/api/load', {slot:s}); },
  saves()     { return this.call('/api/saves'); },
};

function fmtAttrs(obj) { return Object.entries(obj||{}).map(function(kv){return kv[0]+(kv[1]>0?'+':'')+kv[1]}).join(' '); };

// ===== 娓告垙 UI =====
const UI = {

  // 鑳屽寘绠＄悊鍐呭锛堝鐢ㄥ師 openBag HTML 缁撴瀯锛?
  _buildBagManageContent() {
    const d = this.state; if (!d) return '';
    const fq = d.faqi;
    let h = '';

    // 涓€銆佺┛鎴翠綅
    h += '<div class="fq-sec"><div class="bag-sec-title">绌挎埓</div><div class="fq-wear-row">';
    for (const slot in d.equipment) {
      const eq = d.equipment[slot];
      if (eq) {
        h += '<div class="fq-cell fq-has" onclick="UI.itemOp(\'unequip\',null,\''+slot+'\')" onmouseenter="UI._tipShow(this)" onmouseleave="UI._tipHide()">';
        h += '<img src="img/items/'+eq.id+'.webp" class="fq-cell-icon" onerror="this.style.display=\'none\'">';
        h += '<span class="fq-cell-name '+this._rarityCls(eq.rarity)+'">'+eq.name+'</span>';
        h += this._fqTipData(eq);
        h += '</div>';
      } else {
        h += '<div class="fq-cell"><span class="fq-slot-label">'+slot+'</span></div>';
      }
    }
    h += '</div></div>';
    return h;
  },

  _rarityCls(r) { return {"鍑″搧":"", "鐏靛搧":"rar-ling", "鐜勫搧":"rar-xuan", "浠欏搧":"rar-xian"}[r] || ""; },

  openBag() {
    this._bagManageExpanded = true;
    if (this.activeTab !== 'bag') {
      this.switchTab('bag');
    } else {
      this._renderBagTab();
    }
  },

  closeBag() { this._tipHide(); if (this.activeTab === 'bag') this.switchTab('bag'); },

  _fmtStats(stats) {
    if (!stats) return '';
    return Object.entries(stats).map(([k,v]) => k + (v>0?'+':'') + v).join('銆€');
  },

  // ---- 娉曞櫒鏁村锛歜attle 瑙﹀彂璇存槑 鈫?浜鸿瘽 ----
  _battleDesc(b) {
    if (!b) return '';
    const pct = v => Math.round(v * 100) + '%';
    const parts = [];
    if (b.trigger != null) parts.push(pct(b.trigger) + '鍑犵巼');
    if (b.damage) parts.push('閫犳垚' + b.damage[0] + '~' + b.damage[1] + '浼ゅ');
    if (b.heal) parts.push('鎭㈠' + b.heal[0] + '~' + b.heal[1] + '姘旇');
    if (b.stun === true) parts.push('鍥颁綇鏁屼汉涓€鍥炲悎');
    if (b.stunChance) parts.push(pct(b.stunChance) + '鍑犵巼闄勫姞鍍电洿');
    return parts.join('路');
  },

  // 闅愯棌鐨?tooltip 鏁版嵁鍧楋紙闅忔牸瀛愭覆鏌擄紝hover 鏃跺鍒惰繘娴眰锛?
  _fqTipData(it) {
    let t = '<div class="fq-tip-name '+this._rarityCls(it.rarity)+'">'+it.name+(it.rarity?'銆€<span class="fq-tip-rar">'+it.rarity+'</span>':'')+'</div>';
    if (it.stats && Object.keys(it.stats).length) t += '<div class="fq-tip-stats">'+this._fmtStats(it.stats)+'</div>';
    const bd = this._battleDesc(it.battle);
    if (bd) t += '<div class="fq-tip-battle">'+bd+'</div>';
    if (it.desc) t += '<div class="fq-tip-desc">'+it.desc+'</div>';
    return '<div class="fq-tipdata" hidden>'+t+'</div>';
  },

  // 娴眰 tooltip锛氬崟渚?fixed 瀹氫綅锛屼笉琚脊绐楁粴鍔ㄨ鍓?
  _tipEl: null,
  _tipShow(host) {
    const data = host.querySelector('.fq-tipdata');
    if (!data || !data.innerHTML) return;
    let tip = this._tipEl;
    if (!tip) { tip = document.createElement('div'); tip.className = 'fq-tip'; document.body.appendChild(tip); this._tipEl = tip; }
    tip.innerHTML = data.innerHTML;
    tip.style.left = '0px'; tip.style.top = '0px'; tip.style.display = 'block';
    const r = host.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    const x = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 8));
    let y = r.top - th - 8;
    if (y < 8) y = r.bottom + 8;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  },
  _tipHide() { if (this._tipEl) this._tipEl },

  // 闃靛垪鏍煎瓙锛氱偣鍑诲垏鎹㈡牸鍐呮搷浣滄潯
  _fqToggle(el) {
    const on = el.classList.contains('sel');
    el.parentElement.querySelectorAll('.fq-cell.sel').forEach(c => c.classList.remove('sel'));
    if (!on) el.classList.add('sel');
  },

  _stackItems(items) {
    var map = new Map();
    (items || []).forEach(function(it) {
      var id = (it && it.id) || it;
      if (map.has(id)) map.get(id).n++;
      else map.set(id, { item: (typeof it === 'object' ? it : {id:it, name:it}), n: 1 });
    });
    var out = []; map.forEach(function(v) { out.push(v); }); return out;
  },

  async itemOp(op, id, slot) {
    if (op === 'drop' && !confirm('纭畾涓㈠純锛熶涪寮冨悗鏃犳硶鎵惧洖銆?)) return;
    const r = await API.item({ op, id, slot });
    if (r.ok) {
      this.state = r.state;
      this._renderHUD();
      if (this.activeTab === 'bag') this._renderBagTab(); // 鍒锋柊鑳屽寘 Tab
      if (r.message) this.toast(r.message);
    } else {
      this.toast(r.error || '鎿嶄綔澶辫触', 3000, true);
    }
  },

  // ---- 瀛樻。锛堟ā鎬侊級 ----
  async saveGame() { this._showModal("save"); },
  async loadGame() { this._showModal("load"); },
  async _showModal(mode) {
    const res = await API.saves();
    const box = $("modal-content");
    let h = '<h3>'+(mode==="save"?"瀛樻。":"璇绘。")+'</h3>';
    (res.saves || []).forEach(s => {
      h += '<div class="slot"><div class="slot-info"><div class="slot-name">瀛樻。 '+s.slot+'</div>';
      if (!s.empty) h += '<div class="slot-line1">'+s.name+' 路 '+s.realm+'銆€<span class="slot-scene">'+s.scene+'</span></div><div class="slot-line2">'+(s.time?new Date(s.time).toLocaleString():"")+'</div>';
      else h += '<div class="slot-empty">鈥斺€?绌?鈥斺€?/div>';
      h += '</div><div class="slot-actions">';
      if (mode==="save") h += '<button onclick="UI._doSave('+s.slot+')">'+(s.empty?"瀛樺叆":"瑕嗙洊")+'</button>';
      else if (!s.empty) h += '<button onclick="UI._doLoad('+s.slot+')">璇诲彇</button>';
      h += '</div></div>';
    });
    h += '<button class="choice-btn" onclick="$(\'modal-overlay\').hidden=true" style="width:100%;text-align:center;margin-top:8px">鍏?闂?/button>';
    box.innerHTML = h;
    $("modal-overlay").hidden = false;
  },
  async _doSave(slot) { $("modal-overlay").hidden = true; const r = await API.save(slot); UI.toast(r.ok ? "宸插瓨鍏?瀛樻。 "+slot : r.error||"瀛樻。澶辫触", 3000, !r.ok); },
  async _doLoad(slot) { $("modal-overlay").hidden = true; const r = await API.load(slot); if (r.ok) { this.state = r.state; var ga = $("game-area"); if (ga) ga.style.display = ""; var sb = $("btn-save"); if (sb) sb.style.display = ""; this._renderScene(r.scene); this._renderHUD(); } else UI.toast(r.error||"璇绘。澶辫触", 3000, true); },

  // ---- 灞炴€ц鎯呴潰鏉?----
  // ===== Tab 瀵艰埅绯荤粺 =====
  switchTab(tabId) {
    if (this.activeTab === tabId) return;
    this.activeTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(function(b){
      var sel = b.dataset.tab === tabId;
      b.classList.toggle('active', sel);
      b.setAttribute('aria-selected', String(sel));
    });
    document.querySelectorAll('.tab-page').forEach(function(p){p.style.display='none';});
    var page=document.getElementById('tab-'+tabId);
    if(page) page.style.display='';
    var cp=document.getElementById('char-panel'); if(cp) cp.style.display=(tabId==='play')?'':'none';
    if(tabId!=='play') this._renderTab(tabId);
  },

  _renderTab(tabId) {
    var panel=document.getElementById('tab-'+tabId); if(!panel) return;
    this['_render'+tabId.charAt(0).toUpperCase()+tabId.slice(1)+'Tab'](panel);
  },

  // ---- 鍒涜 Tab锛堝唴宓岋紝闈炲叏灞忥級----
  _createData: null,
  _renderCreateTab(panel) {
    // 宸叉湁瑙掕壊鏃舵樉绀哄綋鍓嶄俊鎭?+ 閲嶅紑锛屼笉鏄剧ず鍒涘缓琛ㄥ崟
    if (this.state) {
      var d = this.state;
      var h = '<div class=tab-content><h3>褰撳墠瑙掕壊</h3>';
      h += '<p>'+d.name+' 路 '+d.realm+' 路 鐏垫牴'+d.linggen+' 路 浣撹川'+d.constitution+'</p>';
      h += '<p>鏃舵棩: 绗?+(d.day||1)+'鏃?路 鐏电煶: '+(d.stones||0)+'</p>';
      h += '<p style=margin-top:16px><button class="more-btn more-danger" onclick=UI._doRestart() style="padding:8px 24px;border-radius:4px;background:var(--surface);border:1px solid var(--danger);color:var(--danger);cursor:pointer;font-size:14px">閲嶆柊寮€濮嬶紙鏀惧純褰撳墠杩涘害锛?/button></p>';
      h += '</div>';
      panel.innerHTML = h;
      return;
    }
    // 鏃犺鑹叉椂鏄剧ず鍒涘缓琛ㄥ崟
    var cd = this._createData || { name: '', linggen: null, constitution: null, origin: null, rerolls: 3, confirmed: false };
    this._createData = cd;
    var lg = cd.linggen, cn = cd.constitution, og = cd.origin;
    var cls = function(t){ return (t && t.cls) || 'c-gray'; };
    var h = '<div class=tab-content><h3>寮€鍒涙柊灞€</h3>';
    // 閬撳彿
    h += '<p style=margin:8px 0>閬撳彿 <input id=nameInput value="'+cd.name+'" placeholder=鐣欑┖鍒欏ぉ璧?maxlength=6 style="background:#0f131a;border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:4px;font-size:16px;width:160px;text-align:center;letter-spacing:4px"></p>';
    // 娴嬬伒鎸夐挳
    h += '<p><button class=btn-gold style="padding:8px 24px;border-radius:4px;cursor:pointer;background:linear-gradient(135deg,rgba(201,179,126,.15),rgba(168,137,76,.1));border:1px solid var(--accent);color:var(--accent);font-size:14px" id=btn-roll>寮€濮嬫祴鐏?/button>';
    h += ' <button class=btn style="padding:8px 16px;border-radius:4px;background:var(--surface2);border:1px solid var(--border);color:var(--text-dim);cursor:pointer;font-size:13px" id=btn-random-name>澶╄祼閬撳彿</button></p>';
    // 缁撴灉涓夊崱鐗?
    h += '<div style=display:flex;gap:12px;margin:12px 0>';
    var cards = [
      { label: '鐏垫牴', val: lg ? lg.id : '鈥?, cls: lg ? cls(lg) : 'c-gray', sub: lg ? '淇偧脳'+lg.cultRate+(lg.breakBonus!==0?' 绐佺牬'+(lg.breakBonus>0?'+':'')+Math.round(lg.breakBonus*100)+'%':'') : '' },
      { label: '浣撹川', val: cn ? cn.id : '鈥?, cls: cn ? cls(cn) : 'c-gray', sub: cn ? cn.desc : '' },
      { label: '鍑鸿韩', val: og ? og.id : '鈥?, cls: og ? cls(og) : 'c-gray', sub: og ? (og.desc||'') : '' }
    ];
    cards.forEach(function(c) {
      h += '<div style="flex:1;background:linear-gradient(180deg,#181d26,#0f131a);border:1px solid #2a2d36;border-radius:8px;padding:12px 8px;text-align:center"><div style="font-size:11px;color:var(--text-faint);letter-spacing:2px">'+c.label+'</div><div style="font-size:16px;font-weight:600;margin:4px 0" class='+c.cls+'>'+c.val+'</div><div style="font-size:11px;color:var(--text-dim);white-space:pre-line">'+c.sub+'</div></div>';
    });
    h += '</div>';
    // 閲嶆幏+纭
    h += '<p>閲嶆幏娆℃暟: <b>' + cd.rerolls + '</b>';
    if (cd.rerolls > 0) h += ' <button class=btn id=btn-reroll style="padding:6px 14px;border-radius:4px;background:var(--surface2);border:1px solid var(--border);color:var(--text-dim);cursor:pointer;font-size:12px">鍐嶆幏澶╂満</button>';
    h += ' <button class=btn-gold id=btn-confirm style="padding:6px 14px;border-radius:4px;background:linear-gradient(135deg,rgba(201,179,126,.15),rgba(168,137,76,.1));border:1px solid var(--accent);color:var(--accent);cursor:pointer;font-size:12px">纭鍛芥暟</button></p>';
    // 纭鍚庤笍鍏?
    if (cd.confirmed) {
      h += '<p style=margin-top:12px><button class=btn-path id=btn-start style="padding:12px 40px;font-size:16px;letter-spacing:6px;background:linear-gradient(135deg,rgba(201,179,126,.12),rgba(168,137,76,.08));border:1px solid var(--accent);color:var(--accent);border-radius:8px;cursor:pointer">'+cd.name+'銆€韪忓叆浠欓€?/button></p>';
    }
    h += '</div>';
    panel.innerHTML = h;

    // bind events
    var self = this;
    var nameEl = document.getElementById('nameInput');
    var names = { g: ['鏋?,'鍙?,'钀?,'浜?,'鑻?,'娌?,'闄?,'妤?,'绉?,'鐧?], f: ['灏?,'閫?,'椋?,'瀵?,'鐜?,'缇?,'闇?,'娓?,'娓?,'澧?] };
    var doRoll = function() {
      cd.name = nameEl ? nameEl.value.trim() : '';
      if (!cd.name) { cd.name = names.g[Math.floor(Math.random()*10)] + names.f[Math.floor(Math.random()*10)]; if (nameEl) nameEl.value = cd.name; }
      var lgTable = [{id:'澶╃伒鏍?,rate:.05,cultRate:2.0,breakBonus:.15,cls:'c-myth'},{id:'鍦扮伒鏍?,rate:.10,cultRate:1.5,breakBonus:.10,cls:'c-gold'},{id:'鐪熺伒鏍?,rate:.30,cultRate:1.2,breakBonus:.05,cls:'c-blue'},{id:'浼伒鏍?,rate:.40,cultRate:0.8,breakBonus:.00,cls:'c-gray'},{id:'鍑′綋',rate:.15,cultRate:0.5,breakBonus:-.05,cls:'c-gray'}];
      var cnTable = [{id:'鏃?,rate:.80,desc:'鍑′汉鑲夎韩',tier:0,cls:'c-gray'},{id:'鐏典綋',rate:.10,desc:'淇偧鐏靛姏+1/娆?绐佺牬鐜?10%',tier:1,cls:'c-blue'},{id:'姝﹂',rate:.07,desc:'姘旇+10 鏀诲嚮+3',tier:1,cls:'c-blue'},{id:'閬撹儙',rate:.03,desc:'淇偧鏁堢巼+0.5',tier:2,cls:'c-myth'}];
      var ogTable = [{id:'淇粰涓栧',rate:.05,desc:'闀胯緢鐨嗘槸淇＋',items:['yinqijue'],initAttrs:{鎮熸€?2},initStones:10,cls:'c-gold'},{id:'鐚庢埛涔嬪瓙',rate:.20,desc:'闅忕埗鎵撶寧',items:['tiejian'],initAttrs:{鍕囨皵:2,鏀诲嚮:1},cls:'c-blue'},{id:'鍐滃瀛愬紵',rate:.50,desc:'鐢熶簬鐢板瀯',items:['ganliang','buyi'],initAttrs:{姘旇:5},cls:'c-gray'},{id:'娴佹氮瀛ゅ効',rate:.25,desc:'鏃犵埗鏃犳瘝',items:[],initAttrs:{鎮熸€?1,鍕囨皵:1,姘旇:-3},cls:'c-gray'}];
      var pick = function(t) { var r=Math.random(); for (var i=0;i<t.length;i++){ r-=t[i].rate; if(r<=0) return t[i]; } return t[t.length-1]; };
      for (var a=0;a<100;a++){ var r={linggen:pick(lgTable),constitution:pick(cnTable),origin:pick(ogTable)}; var worst=(r.linggen.id==='鍑′綋'||r.linggen.id==='浼伒鏍?)&&r.constitution.tier===0&&(r.origin.id==='鍐滃瀛愬紵'||r.origin.id==='娴佹氮瀛ゅ効'); if(!worst||a>=99){cd.linggen=r.linggen;cd.constitution=r.constitution;cd.origin=r.origin;break;} }
      cd.confirmed = false;
      self._renderCreateTab(panel);
    };
    var btnRoll = document.getElementById('btn-roll'); if (btnRoll) btnRoll.onclick = doRoll;
    var btnRN = document.getElementById('btn-random-name'); if (btnRN) btnRN.onclick = function() { cd.name = names.g[Math.floor(Math.random()*10)] + names.f[Math.floor(Math.random()*10)]; if (nameEl) nameEl.value = cd.name; self._renderCreateTab(panel); };
    var btnReroll = document.getElementById('btn-reroll'); if (btnReroll) btnReroll.onclick = function() { if (cd.rerolls<=0) return; cd.rerolls--; doRoll(); };
    var btnConfirm = document.getElementById('btn-confirm'); if (btnConfirm) btnConfirm.onclick = function() { cd.confirmed = true; self._renderCreateTab(panel); };
    var btnStart = document.getElementById('btn-start'); if (btnStart) btnStart.onclick = function() { self._startWithChar(cd); };
  },

  async _startWithChar(cd) {
    var res = await API.newGame({ name: cd.name, linggen: cd.linggen, constitution: cd.constitution, origin: cd.origin });
    if (res.ok) {
      this._createData = null;
      var sb = document.getElementById('btn-save'); if (sb) sb.style.display = '';
      this.switchTab('play');
      this.render(res.scene, res.state);
      var ct = document.getElementById('tab-create'); if (ct) ct.innerHTML = '';
    } else {
      alert('韪忓叆浠欓€斿け璐? ' + (res.error || '鍒涘缓澶辫触'));
    }
  },

  _renderCharTab(panel) {
    var d=this.state; if(!d) return;
    var h='<div class="tab-content"><h3>'+d.name+' <span class="realm-badge">'+d.realm+'</span></h3>';
    h+='<div class="attr-row"><span>鐏垫牴</span><span>'+d.linggen+'</span></div>';
    h+='<div class="attr-row"><span>浣撹川</span><span>'+d.constitution+'</span></div>';
    h+='<div class="attr-row"><span>鐏电煶</span><span>'+(d.stones||0)+'</span></div>';
    h+='<div class="attr-row"><span>鏃舵棩</span><span>绗?'+(d.day||1)+' 鏃?/span></div>';
    if(d.realmInfo&&d.realmInfo.toNext){
      var mp=d.attrs['鐏靛姏']||0,tn=d.realmInfo.toNext,pct=Math.min(100,Math.round(mp/tn*100));
      h+='<div class="attr-row"><span>淇负杩涘害</span><span>'+pct+'%</span></div>';
      h+='<div class="stage-bar-wrap"><div class="stage-bar"><div class="stage-fill" style="width:'+pct+'%"></div></div></div>';
    }
    h+='<h4>灞炴€?/h4><div class="attr-grid">';
    var keys=['姘旇','鐏靛姏','鏀诲嚮','闃插尽','绁炶瘑','鏍归','榄呭姏','鎮熸€?,'鍕囨皵','鏈虹紭'];
    for(var i=0;i<keys.length;i++){var k=keys[i];if(d.attrs[k]!=null)h+='<div class="attr-cell"><div class="attr-cell-name">'+k+'</div><div class="attr-cell-val">'+d.attrs[k]+'</div></div>';}
    h+='</div><h4>瑁呭</h4><div class="attr-grid">';
    for(var s in d.equipment){var eq=d.equipment[s],nm=eq?(eq.name||eq.id||eq):null;h+='<div class="attr-cell"><div class="attr-cell-name">'+s+'</div><div class="attr-cell-val">'+(nm||'鈥?)+'</div></div>';}
    h+='</div><h4>鍔熸硶</h4>';
    if(!d.gongfa.learned.length)h+='<p class="empty">鏈範寰楀姛娉?/p>';
    else d.gongfa.learned.forEach(function(gf){var nm=(gf&&gf.name)||gf,gid=(gf&&gf.id)||gf,aid=d.gongfa.active?(d.gongfa.active.id||d.gongfa.active):null;h+='<div class="attr-row"><span>'+nm+'</span><span>'+(aid===gid?'<i class="attr-bonus">涓讳慨</i>':'')+'</span></div>';});
    if(this._buildStatsContent) h+=this._buildStatsContent();
    h+='</div>'; panel.innerHTML=h;
  },

  _renderBagTab(panel) {
    var d=this.state; if(!d) return;
    var stacks=this._stackItems(d.items);
    var h='<div class="tab-content"><h3>鑳屽寘</h3>';
    if(!stacks.length) h+='<p class="empty">绌虹┖濡備篃</p>';
    else { stacks.forEach(function(s){var it=s.item;h+='<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px dashed var(--border);padding:6px 0"><span>'+it.name+(s.n>1?' 脳'+s.n:'')+(it.type?' <span class=item-type>'+it.type+'</span>':'')+'</span><span>';if(it.usable)h+=' <button class=mini-btn data-op=use data-id='+it.id+'>浣跨敤</button>';if(it.slot)h+=' <button class=mini-btn data-op=equip data-id='+it.id+'>瑁呭</button>';h+=' <button class="mini-btn mini-danger" data-op=drop data-id='+it.id+'>涓㈠純</button></span></div>';}); }
    h+='</div>';
    if(UI._buildBagManageContent) h+=UI._buildBagManageContent();
    panel.innerHTML=h;
  },

  _renderLogTab(panel) {
    var d=this.state; if(!d) return;
    var log=d.log||[],lh='<div class="tab-content"><h3>浜嬩欢鏃ュ織</h3><div class="log-list">';
    if(!log.length) lh+='<p class="empty">鏆傛棤璁板綍</p>';
    else log.forEach(function(line){lh+='<div class="'+(line.charAt(0)==='銆??'log-choice':'log-scene')+'">'+line+'</div>';});
    lh+='</div></div>'; panel.innerHTML=lh; var lst=panel.querySelector('.log-list'); if(lst) lst.scrollTop=lst.scrollHeight;
  },


    _renderSectTab(panel) {
    var d = this.state; if (!d) return;
    var h = '';
    var si = d.sectInfo;  // from state.py sect_info() ? full sect data with culture/specialty
    
    if (!d.sect || !si) {
      // === NO SECT: show sect selection (cards for each sect) ===
      var sects = (d.allSects && d.allSects.length) ? d.allSects : [
        {id:"qingyun_zong", name:"???", alignment:"??", desc:"????????????????????????",
         culture:{mountain:"???", discipleTitle:"??", color:"#7ec9a0"},
         specialty:{cultBonus:1.1, battleBonus:1.0, craftBonus:{"??":0.1}},
         entry_cond:{flags:["????"], attrs:{"??":{"gte":5}}}},
        {id:"chisha_jiao", name:"???", alignment:"??", desc:"????????????????????????",
         culture:{mountain:"???", discipleTitle:"??", color:"#c96a5e"},
         specialty:{cultBonus:0.9, battleBonus:1.15, craftBonus:{"??":0.15}},
         entry_cond:{flags:["????"], attrs:{"??":{"gte":5}}}},
        {id:"danxia_men", name:"???", alignment:"??", desc:"??????????????????????????????",
         culture:{mountain:"???", discipleTitle:"??", color:"#e8c97a"},
         specialty:{cultBonus:1.0, battleBonus:1.0, craftBonus:{"??":0.2,"??":0.05}},
         entry_cond:{flags:["????"], attrs:{"??":{"gte":3}}}}
      ];
      h += '<div class="sect-select-header"><h3>????</h3><p class="empty">???????????????????????????????</p></div>';
      h += '<div class="sect-grid">';
      for (var i = 0; i < sects.length; i++) {
        var s = sects[i];
        var alCls = s.alignment === "??" ? "al-good" : s.alignment === "??" ? "al-evil" : "al-neutral";
        var spec = s.specialty || {};
        var cultPct = spec.cultBonus ? Math.round((spec.cultBonus - 1) * 100) : 0;
        var battlePct = spec.battleBonus ? Math.round((spec.battleBonus - 1) * 100) : 0;
        var cultSign = cultPct >= 0 ? "+" : ""; var battleSign = battlePct >= 0 ? "+" : "";
        var craftParts = [];
        if (spec.craftBonus) { for (var ck in spec.craftBonus) { if (spec.craftBonus[ck] > 0) craftParts.push(ck + "+" + Math.round(spec.craftBonus[ck]*100) + "%"); } }
        h += '<div class="sect-join-card" style="border-top:3px solid ' + (s.culture && s.culture.color || "var(--accent)") + '">';
        h += '<div class="sect-join-header"><span class="sect-join-name">' + s.name + '</span><span class="align-badge ' + alCls + '">' + s.alignment + '</span></div>';
        h += '<div class="sect-join-desc">' + (s.desc || "") + '</div>';
        h += '<div class="sect-join-specs">';
        h += '<span class="spec-chip" title="????">?' + cultSign + cultPct + "%</span>";
        h += '<span class="spec-chip" title="????">?' + battleSign + battlePct + "%</span>";
        if (craftParts.length) h += '<span class="spec-chip" title="????">' + craftParts.join(" ") + "</span>";
        h += '</div>';
        h += '<div class="sect-join-meta">' + (s.culture && s.culture.mountain ? "??: " + s.culture.mountain + " ? " : "") + "???: " + (s.culture && s.culture.discipleTitle || "??") + '</div>';
        h += '</div>';
      }
      h += '</div>';
    } else {
      // === IN SECT: dashboard ===
      var sc = si.culture || {};
      var spec = si.specialty || {};
      var econ = si.economy || {};
      var color = sc.color || "var(--accent)";
      var alCls = si.alignment === "??" ? "al-good" : si.alignment === "??" ? "al-evil" : "al-neutral";
      
      // Header
      h += '<div class="sect-header" style="border-left:4px solid ' + color + '">';
      h += '<div class="sect-header-top"><span class="sect-header-name">' + si.name + '</span><span class="align-badge ' + alCls + '">' + (si.alignment || "") + '</span></div>';
      h += '<div class="sect-header-sub">' + (sc.mountain || "") + ' ? ' + (sc.discipleTitle || "??");
      if (d.sect.joined_at) h += ' ? ???' + (d.day - d.sect.joined_at + 1) + '?';
      h += '</div>';
      h += '</div>';
      
      // Specialty panel
      h += '<div class="sect-spec-panel">';
      var cultPct = spec.cultBonus ? Math.round((spec.cultBonus - 1) * 100) : 0;
      var battlePct = spec.battleBonus ? Math.round((spec.battleBonus - 1) * 100) : 0;
      var cultSign = cultPct >= 0 ? "+" : "", battleSign = battlePct >= 0 ? "+" : "";
      h += '<div class="spec-box"><div class="spec-box-icon">?</div><div class="spec-box-val">' + cultSign + cultPct + '%</div><div class="spec-box-label">????</div></div>';
      h += '<div class="spec-box"><div class="spec-box-icon">?</div><div class="spec-box-val">' + battleSign + battlePct + '%</div><div class="spec-box-label">????</div></div>';
      if (spec.craftBonus) {
        for (var ck in spec.craftBonus) {
          var cv = Math.round(spec.craftBonus[ck] * 100);
          if (cv > 0) h += '<div class="spec-box"><div class="spec-box-icon">' + ck.charAt(0) + '</div><div class="spec-box-val">+' + cv + '%</div><div class="spec-box-label">' + ck + '</div></div>';
        }
      }
      h += '</div>';
      
      // Contribution placeholder
      h += '<div class="sect-contrib-bar"><div class="sect-contrib-label">????</div>';
      var gx = (d.sect && d.sect.contribution) || 0;
      h += '<div class="attr-row"><span>???</span><span style="color:' + color + '">' + gx + '</span></div>';
      h += '<div class="attr-row"><span>??</span><span>' + (d.stones || 0) + '</span></div>';
      h += '</div>';
      
      // Actions
      h += '<div class="sect-actions-title">????</div>';
      h += '<div class="sect-actions">';
      var actions = [
        {scene:'zongmen_renwu', icon:'?', label:'???', desc:'????????'},
        {scene:'zongmen_cangjing', icon:'?', label:'???', desc:'??????'},
        {scene:'zongmen_danfang', icon:'?', label:'??', desc:'??????'},
        {scene:'zongmen_yanwu', icon:'?', label:'???', desc:'????'}
      ];
      for (var j = 0; j < actions.length; j++) {
        var a = actions[j];
        h += '<div class="sect-action-card" onclick="UI.switchTab('play');UI._sectGo('' + a.scene + '')">';
        h += '<div class="sect-action-icon" style="background:' + color + '22;color:' + color + '">' + a.icon + '</div>';
        h += '<div class="sect-action-body"><div class="sect-action-label">' + a.label + '</div><div class="sect-action-desc">' + a.desc + '</div></div>';
        h += '</div>';
      }
      h += '</div>';
      
      // Leave
      h += '<div style="text-align:center;margin-top:20px"><button class="more-btn more-danger" onclick="UI._sectLeave()">????</button></div>';
    }
    panel.innerHTML = h;
  },

  async _sectGo(sceneId) {
    var res = await API.action({text:"??", next:sceneId});
    if (res.ok) { this.state = res.state; this._renderScene(res.scene); this._renderHUD(); }
    else this.toast(res.error || "????");
  },

  async _sectLeave() {
    if (!confirm("?????????????????????")) return;
    var res = await API.action({text:"??", effect:{clearSect:true}});
    if (res.ok) { this.state = res.state; this._renderHUD(); this.switchTab("sect"); this._renderSectTab(document.getElementById("tab-sect")); }
    else this.toast(res.error || "????");
  },


  // ---- 鍔熸硶 Tab ----
  _renderGongfaTab(panel) {
    var d = this.state; if (!d) return;
    var gf = d.gongfa; if (!gf) return;
    var self = this;
    var h = '<div class="tab-content">';

    // 蹇冩硶妲?
    h += '<h4>蹇冩硶妲?/h4>';
    h += '<div class="gf-slots-row">';
    for (var i = 0; i < (gf.heartSlots || 0); i++) {
      var eq = gf.equipped_heart && gf.equipped_heart[i];
      if (eq) {
        h += '<div class="gf-slot gf-slot-filled" onclick="UI._gongfaUnequip(\'heart\',' + i + ')">';
        h += '<span class="gf-slot-kind">蹇?/span>';
        h += '<span class="gf-grade-' + self._gradeCls(eq.grade) + '">' + (eq.name || '') + '</span>';
        h += '<span class="gf-slot-grade">' + (eq.grade || '') + '</span>';
        if (eq.passive) h += '<span class="gf-slot-passive">' + fmtAttrs(eq.passive) + '</span>';
        h += '</div>';
      } else {
        h += '<div class="gf-slot gf-slot-empty" onclick="UI._gongfaSelect(\'heart\',' + i + ')">';
        h += '<span class="gf-slot-kind">蹇?/span>';
        h += '<span class="gf-slot-num">妲? + (i + 1) + '</span>';
        h += '</div>';
      }
    }
    h += '</div>';

    // 鏈硶妲?
    h += '<h4>鏈硶妲?/h4>';
    h += '<div class="gf-slots-row">';
    for (var j = 0; j < (gf.skillSlots || 0); j++) {
      var eq2 = gf.equipped_skill && gf.equipped_skill[j];
      if (eq2) {
        h += '<div class="gf-slot gf-slot-filled" onclick="UI._gongfaUnequip(\'skill\',' + j + ')">';
        h += '<span class="gf-slot-kind">鏈?/span>';
        h += '<span class="gf-grade-' + self._gradeCls(eq2.grade) + '">' + (eq2.name || '') + '</span>';
        h += '<span class="gf-slot-grade">' + (eq2.grade || '') + '</span>';
        if (eq2.battle) {
          var bInfo = '';
          if (eq2.battle.qiCost != null) bInfo += '姘? + eq2.battle.qiCost;
          if (eq2.battle.affix) bInfo += (bInfo ? ' ' : '') + eq2.battle.affix;
          if (bInfo) h += '<span class="gf-slot-battle">' + bInfo + '</span>';
        }
        h += '</div>';
      } else {
        h += '<div class="gf-slot gf-slot-empty" onclick="UI._gongfaSelect(\'skill\',' + j + ')">';
        h += '<span class="gf-slot-kind">鏈?/span>';
        h += '<span class="gf-slot-num">妲? + (j + 1) + '</span>';
        h += '</div>';
      }
    }
    h += '</div>';

    // 閫夋嫨闈㈡澘锛堢偣鍑荤┖妲藉悗寮瑰嚭锛?
    if (this._gongfaSelectKind) {
      var selKind = this._gongfaSelectKind;
      var targetKind = selKind === 'heart' ? '蹇冩硶' : '鏈硶';
      var equippedIds = [];
      if (gf.equipped_heart) gf.equipped_heart.forEach(function(e) { if (e) equippedIds.push(e.id); });
      if (gf.equipped_skill) gf.equipped_skill.forEach(function(e) { if (e) equippedIds.push(e.id); });
      var available = (gf.learned || []).filter(function(g) {
        return g.kind === targetKind && equippedIds.indexOf(g.id) < 0;
      });
      h += '<div class="gf-select-panel">';
      h += '<h4>閫夋嫨' + targetKind + '瑁呴厤鍒版Ы' + (self._gongfaSelectSlot + 1) + '</h4>';
      if (!available.length) {
        h += '<p class="empty">娌℃湁鍙閰嶇殑' + targetKind + '</p>';
      } else {
        available.forEach(function(g) {
          h += '<div class="gf-learned-item" onclick="UI._gongfaEquipTo(\'' + g.id + '\',' + self._gongfaSelectSlot + ')">';
          h += '<div class="gf-learned-info">';
          h += '<span class="gf-grade-' + self._gradeCls(g.grade) + '">' + g.name + '</span>';
          h += '<span class="gf-learned-meta">' + (g.kind || '') + ' 路 ' + (g.grade || '') + '</span>';
          h += '</div>';
          h += '<button class="mini-btn">瑁呴厤</button>';
          h += '</div>';
        });
      }
      h += '<button class="mini-btn" style="margin-top:8px" onclick="UI._gongfaCancelSelect()">鍙栨秷</button>';
      h += '</div>';
    }

    // 宸插鍔熸硶鍒楄〃
    h += '<h4>宸插鍔熸硶</h4>';
    h += '<div class="gf-learned-list">';
    if (!gf.learned || !gf.learned.length) {
      h += '<p class="empty">鏈範寰楀姛娉?/p>';
    } else {
      var eqIds = {};
      (gf.equipped_heart || []).forEach(function(e) { if (e) eqIds[e.id] = true; });
      (gf.equipped_skill || []).forEach(function(e) { if (e) eqIds[e.id] = true; });
      gf.learned.forEach(function(g) {
        var isEq = eqIds[g.id];
        h += '<div class="gf-learned-item">';
        h += '<div class="gf-learned-info">';
        h += '<span class="gf-grade-' + self._gradeCls(g.grade) + '">' + g.name + '</span>';
        h += '<span class="gf-learned-meta">' + (g.kind || '') + ' 路 ' + (g.grade || '') + '</span>';
        if (g.desc) h += '<span class="gf-learned-desc">' + g.desc + '</span>';
        h += '</div>';
        h += '<div class="gf-learned-actions">';
        if (isEq) {
          h += '<span class="gf-equipped-badge">宸茶澶?/span>';
        } else {
          h += '<button class="mini-btn" onclick="event.stopPropagation();UI._gongfaEquip(\'' + g.id + '\')">瑁呭</button>';
        }
        h += '</div>';
        h += '</div>';
      });
    }
    h += '</div>';

    h += '</div>';
    panel.innerHTML = h;
  },

  _gradeCls(g) {
    return {'鍑￠樁':'gray','鐏甸樁':'ling','鐜勯樁':'xuan','浠欓樁':'xian'}[g] || 'gray';
  },

  async _gongfaEquip(gfId) {
    var res = await API.item({op:'gongfa_equip', id:gfId, slot:0});
    if (res.ok) { this.state = res.state; this._renderGongfaTab(document.getElementById('tab-gongfa')); this._renderHUD(); this._gongfaCancelSelect(); }
    else this.toast(res.error || '瑁呭澶辫触', 3000, true);
  },

  async _gongfaEquipTo(gfId, slot) {
    var res = await API.item({op:'gongfa_equip', id:gfId, slot:slot});
    if (res.ok) { this.state = res.state; this._renderGongfaTab(document.getElementById('tab-gongfa')); this._renderHUD(); this._gongfaCancelSelect(); }
    else this.toast(res.error || '瑁呭澶辫触', 3000, true);
  },

  async _gongfaUnequip(kind, slot) {
    var res = await API.item({op:'gongfa_unequip', kind:kind, slot:slot});
    if (res.ok) { this.state = res.state; this._renderGongfaTab(document.getElementById('tab-gongfa')); this._renderHUD(); }
    else this.toast(res.error || '鍗镐笅澶辫触', 3000, true);
  },

  _gongfaSelect(kind, slot) {
    this._gongfaSelectKind = kind;
    this._gongfaSelectSlot = slot;
    this._renderGongfaTab(document.getElementById('tab-gongfa'));
  },

  _gongfaCancelSelect() {
    this._gongfaSelectKind = null;
    this._gongfaSelectSlot = null;
    this._renderGongfaTab(document.getElementById('tab-gongfa'));
  },

  _renderMoreTab(panel) {
    var h='<div class="tab-content"><h3>鏇村</h3><div class="more-actions">';
    h+='<button class="more-btn" onclick="UI._doExport()">瀵煎嚭杩涘害</button>';
    h+='<button class="more-btn" onclick="UI._doImport()">瀵煎叆杩涘害</button>';
    h+='<button class="more-btn more-danger more-actions-wide" onclick="UI._doRestart()">閲嶆柊寮€濮?/button>';
    h+='</div></div>'; panel.innerHTML=h;
  },

  _doExport(){fetch('/api/export').then(function(r){return r.blob();}).then(function(b){var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='xiuxian_export.json';a.click();UI.toast('瀵煎嚭鎴愬姛');}).catch(function(e){UI.toast('瀵煎嚭澶辫触: '+e.message);});},
  _doImport(){var inp=document.createElement('input');inp.type='file';inp.accept='.json';inp.onchange=function(e){var f=e.target.files[0];if(!f)return;var fd=new FormData();fd.append('file',f);fetch('/api/import',{method:'POST',body:f}).then(function(r){return r.json();}).then(function(r){if(r.ok){UI.state=r.state;UI._renderScene(r.scene);UI._renderHUD();UI.toast('瀵煎叆鎴愬姛');}else UI.toast(r.error||'瀵煎叆澶辫触');}).catch(function(e){UI.toast('瀵煎叆澶辫触: '+e.message);});};inp.click();},
  _doRestart(){if(confirm('纭畾閲嶆柊寮€濮嬶紵褰撳墠杩涘害灏嗕涪澶便€?))location.reload();},

  _computeAttrBonus() {
    const d = this.state;
    const base = d.attrsBase || {};
    const cur = d.attrs || {};
    const keys = ['姘旇','鐏靛姏','鏀诲嚮','闃插尽','绁炶瘑','鏍归','榄呭姏','鎮熸€?,'鍕囨皵','鏈虹紭'];
    const map = {};
    for (const k of keys) {
      map[k] = {total:(cur[k]||0)-(base[k]||0), equip:{}, faqi:{}, gongfa:{}, equipSum:0, faqiSum:0, gongfaSum:0};
    }
    const eq = d.equipment || {};
    for (const s in eq) {
      const it = eq[s];
      if (it && it.stats) {
        for (const st in it.stats) {
          if (map[st]) { map[st].equip[it.name] = (map[st].equip[it.name]||0) + it.stats[st]; map[st].equipSum += it.stats[st]; }
        }
      }
    }
    const fq = d.faqi;
    if (fq && fq.array) {
      fq.array.forEach(it => {
        if (it && it.stats) {
          for (const st in it.stats) {
            if (map[st]) { map[st].faqi[it.name] = (map[st].faqi[it.name]||0) + it.stats[st]; map[st].faqiSum += it.stats[st]; }
          }
        }
      });
    }
    const gf = d.gongfa;
    if (gf && gf.learned && gf.learned.length) {
      for (const k of keys) {
        const rem = map[k].total - map[k].equipSum - map[k].faqiSum;
        if (rem > 0) {
          const agf = gf.active || gf.learned[0];
          map[k].gongfa[agf.name] = (map[k].gongfa[agf.name]||0) + rem;
          map[k].gongfaSum += rem;
        }
      }
    }
    return map;
  },

  openStats() {
    this._charStatsExpanded = true;
    if (this.activeTab !== 'char') {
      this.switchTab('char');
    } else {
      this._renderCharTab();
    }
  },

  closeStats() {
    if (this.activeTab === 'char' && this._charStatsExpanded) {
      this._charStatsExpanded = false;
      this._renderCharTab();
    }
  },
// ---- 缁熶竴鍏ュ彛 ----
  _delegated: false,
  render(scene, state) {
    this.state = state;
    this._renderScene(scene);
    this._renderHUD();
    if (!this._delegated) { this._delegated = true; this._setupDelegation(); }
  },

  _setupDelegation() {
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-op]');
      if (btn) { var op = btn.dataset.op, id = btn.dataset.id; if (op && id) UI.itemOp(op, id); return; }

    });
  },

  _lock(v, clickedEl) {
    this._busy = v;
    document.querySelectorAll(".choice-btn").forEach(b => { b.disabled = v; b.classList.toggle("loading", v && b === clickedEl); });
  },

  async act(choice) {
    if (this._busy) return;
    // 鏌ユ壘瀵瑰簲鎸夐挳鐢ㄤ簬 loading 鎸囩ず
    var clickedBtn = null;
    document.querySelectorAll(".choice-btn").forEach(function(b) {
      if (b.textContent === choice.text && !clickedBtn) clickedBtn = b;
    });
    this._lock(true, clickedBtn);
    const res = await API.action(choice);
    this._lock(false);
    if (res.ok) {
      this.state = res.state;
      if (res.battle) this._renderBattle(res.battle, res.scene.choices);
      else this._renderScene(res.scene);
      this._renderHUD();
    } else { this.toast(res.error || "鎿嶄綔澶辫触"); }
  },

  // ---- 鍦烘櫙娓叉煋 ----
  _renderScene(scene) {
    var st = $("scene-title"), sx = $("scene-text");
    if (!st || !sx) return;
    st.style.color = "";
    st.textContent = scene.title || "";
    sx.textContent = scene.text || "";
    sx.classList.remove("fade-in"); void sx.offsetWidth; sx.classList.add("fade-in");
    this._renderChoices(scene.choices);
  },

  _renderBattle(battle, choices) {
    var st = $("scene-title"), sx = $("scene-text");
    if (!st || !sx) return;
    const pct = (c,m) => Math.round(c/m*100);
    st.textContent = "绗?" + battle.round + " 鍥炲悎";
    st.style.color = "var(--danger)";
    const bar = (l,c,m,p) => l + "  " + c + "/" + m + "\n[" + "鈻?.repeat(Math.max(1,Math.round(p/5))) + "鈻?.repeat(20-Math.max(1,Math.round(p/5))) + "] " + p + "%";
    let text = bar((this.state||{}).name||"鎴戞柟", battle.player.hp, battle.player.maxHp, pct(battle.player.hp, battle.player.maxHp)) + "\n";
    text += bar(battle.enemy.name + "銆? + battle.enemy.realm + "銆?, battle.enemy.hp, battle.enemy.maxHp, pct(battle.enemy.hp, battle.enemy.maxHp)) + "\n\n";
    text += (battle.log || []).join("\n");
    sx.innerHTML = text.replace(/\n/g, "<br>");
    this._renderChoices(choices);
  },

  _renderChoices(choices) {
    const el = document.getElementById("choices"); if (!el) return; el.innerHTML = "";
    (choices || []).forEach(c => {
      const b = document.createElement("button");
      b.className = "choice-btn"; b.textContent = c.text;
      b.onclick = () => this.act(c);
      el.appendChild(b);
    });
  },

  // ---- HUD ----
  _renderHUD() {
    const d = this.state; if (!d) return;
    let h = "<h3>"+d.name+'</h3><div class="realm-badge">'+d.realm+'</div>';
    h += '<div class="attr-row"><span>鐏垫牴</span><span>'+d.linggen+'</span></div>';
    h += '<div class="attr-row"><span>浣撹川</span><span>'+d.constitution+'</span></div>';
    h += '<div class="attr-row"><span>鐏电煶</span><span>'+(d.stones||0)+'</span></div>';
    h += '<div class="attr-row"><span>鏃舵棩</span><span>绗?'+(d.day||1)+' 鏃?/span></div>';
    if (d.realmInfo && d.realmInfo.toNext) {
      const mp = d.attrs['鐏靛姏']||0, tn = d.realmInfo.toNext;
      const pct = Math.min(100, Math.round(mp / tn * 100));
      h += '<div class="attr-row"><span>淇负杩涘害</span><span>'+pct+'%</span></div>';
      h += '<div class="stage-bar-wrap"><div class="stage-bar"><div class="stage-fill" style="width:'+pct+'%"></div></div></div>';
    }
    h += '<h4>灞炴€?/h4><div class=attr-grid>';
    for (const k in d.attrs) h += '<div class="attr-cell"><div class="attr-cell-name">'+k+'</div><div class="attr-cell-val">'+d.attrs[k]+'</div></div>';
    h += '</div>';
    h += '<h4>瑁呭</h4><div class="attr-grid">';
    for (const s in d.equipment) { const eq = d.equipment[s]; const nm = eq ? (eq.name||eq.id||eq) : null; h += '<div class="attr-cell"><div class="attr-cell-name">'+s+'</div><div class="attr-cell-val">'+(nm||'鈥?)+'</div></div>'; }
    h += '</div>';
    h += '<h4>鍔熸硶</h4>';
    if (!d.gongfa.learned.length) h += '<p class="empty">鏈範寰楀姛娉?/p>';
    else d.gongfa.learned.forEach(gf => { const nm = (gf&&gf.name)||gf; const gid = (gf&&gf.id)||gf; const aid = d.gongfa.active ? (d.gongfa.active.id||d.gongfa.active) : null; h += '<div class="attr-row"><span>'+nm+'</span><span>'+(aid===gid?'<i class="attr-bonus">涓讳慨</i>':'')+'</span></div>'; });
    const cp = document.getElementById("char-panel");
    if (cp) cp.innerHTML = h;

    // Tab 鍐呭鍒锋柊
    const sectBtn = document.querySelector('[data-tab="sect"]');
    if (sectBtn) sectBtn.style.display = (d.sect) ? '' : 'none';
    if (this.activeTab && this.activeTab !== 'play') this._renderTab(this.activeTab);
  },


  // ---- Toast锛堝睆骞曢槄璇诲櫒鍙嬪ソ锛?----
  toast(msg, ms, isError) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.toggle("toast-error", !!isError);
    t.classList.add("show");
    clearTimeout(this._tt);
    this._tt = setTimeout(function() { t.classList.remove("show"); }, ms || 3000);
  },
};

// ===== 鍏ㄥ眬閿欒鍏滃簳 =====
window.addEventListener("error", e => {
  UI.toast("鍑洪敊浜嗭細" + (e.message || "鏈煡閿欒"));
  console.error(e);
});


