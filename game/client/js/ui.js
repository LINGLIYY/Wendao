// ============================================================
// GameUI — data-driven controller for 修仙问道
// All display text from server state. No hardcoded Chinese in JS.
// ============================================================

// ---------- API Layer ----------

class GameAPI {
  constructor() {
    this.baseHeaders = { 'Content-Type': 'application/json' };
  }

  async call(method, path, body) {
    const opts = { method, headers: this.baseHeaders };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(path, opts);
    const data = await r.json();
    if (!r.ok && !data.error) data.error = 'HTTP ' + r.status;
    return data;
  }

  ping()       { return this.call('GET', '/api/ping'); }
  createData() { return this.call('GET', '/api/create-data'); }
  allSects()   { return this.call('GET', '/api/all-sects'); }
  newGame(cd)  { return this.call('POST', '/api/new-game', cd); }
  action(choice) { return this.call('POST', '/api/action', choice); }
  item(op, id, slot) { return this.call('POST', '/api/item', { op: op, id: id, slot: slot }); }
  save(slot)   { return this.call('POST', '/api/save', { slot: slot }); }
  load(slot)   { return this.call('POST', '/api/load', { slot: slot }); }
  saves()      { return this.call('GET', '/api/saves'); }
}

// ---------- UI Controller ----------

class GameUI {
  constructor() {
    this.state = null;
    this.charOptions = null;
    this.charLabels = {};
    this.allSects = [];
    this.activePage = 'create';
    this.api = new GameAPI();
    this._loading = false;
  }

  // ---- init ----

  async init() {
    const ping = await this.api.ping();
    if (!ping.ok) {
      this._fatal('无法连接到游戏服务器');
      return;
    }

    const [cd, sects] = await Promise.all([
      this.api.createData(),
      this.api.allSects()
    ]);

    if (cd && cd.ok) {
      this.charOptions = cd.data;
      this.charLabels = cd.labels || {};
    }
    if (sects && sects.ok) {
      this.allSects = sects.sects || [];
    }

    this._bindEvents();
    this.switchPage('create');
  }

  // ---- event binding ----

  _bindEvents() {
    // Tab switching
    document.querySelectorAll('#tab-bar .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        if (page) this.switchPage(page);
      });
    });

    // Save / Load toolbar buttons
    const btnSave = document.getElementById('btn-save');
    const btnLoad = document.getElementById('btn-load');
    if (btnSave) btnSave.addEventListener('click', () => this.handleSave());
    if (btnLoad) btnLoad.addEventListener('click', () => this.handleLoad());

    // Modal overlay click-to-close
    const overlay = document.getElementById('modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', () => { overlay.hidden = true; });
    }
  }

  // ---- tab visibility ----

  _updateTabVisibility() {
    // Sect tab
    const sectBtn = document.querySelector('#tab-bar .tab-btn[data-page="sect"]');
    if (sectBtn) {
      const inSect = this.state && this.state.sect && this.state.sect.name;
      sectBtn.style.display = inSect ? '' : 'none';
    }
    // Play tab — only visible when game started
    const playBtn = document.querySelector('#tab-bar .tab-btn[data-page="play"]');
    if (playBtn) {
      playBtn.style.display = this.state ? '' : 'none';
    }
    // Save button
    const saveBtn = document.getElementById('btn-save');
    if (saveBtn) {
      saveBtn.style.display = this.state ? '' : 'none';
    }
  }

  // ---- page switching ----

  switchPage(pageId) {
    this.activePage = pageId;

    // Update tab active states
    document.querySelectorAll('#tab-bar .tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.page === pageId);
    });

    // Show/hide pages
    document.querySelectorAll('.page-content').forEach(p => {
      p.style.display = 'none';
    });
    const page = document.getElementById('page-' + pageId);
    if (page) page.style.display = '';

    // Update visibility
    this._updateTabVisibility();

    // Dispatch render
    var method = 'render_' + pageId;
    if (typeof this[method] === 'function') {
      this[method]();
    }
  }

  // ==================== PAGE RENDERERS ====================

  // ---- CREATE ----

  render_create() {
    var el = document.getElementById('page-create');
    if (!el) return;

    var L = this.charLabels;

    // Already have a character — show summary + restart
    if (this.state) {
      var d = this.state;
      var parts = [d.name, d.realm, d.linggen];
      if (d.constitution) parts.push(d.constitution);
      var summary = parts.join(' · ');
      var meta = (L.summaryDay || 'Day') + ' ' + (d.day || 1) + ' | ' + (L.summaryStones || 'Stones') + ' ' + (d.stones || 0);
      el.innerHTML =
        '<div class="create-summary">' +
        '<h3>' + this._escHtml(summary) + '</h3>' +
        '<p class="empty">' + this._escHtml(meta) + '</p>' +
        '<p class="empty">' + this._escHtml(d.realmInfo ? d.realmInfo.name : d.realm) + '</p>' +
        '<button class="choice-btn" id="btn-restart" style="margin-top:16px">' + this._escHtml(L.restart || 'Restart') + '</button>' +
        '</div>';
      document.getElementById('btn-restart').addEventListener('click', this._doRestart.bind(this));
      return;
    }

    // No char options yet — loading
    if (!this.charOptions) {
      el.innerHTML = '<div class="loading-spinner">' + this._escHtml(L.loading || 'Loading...') + '</div>';
      return;
    }

    var cd = this.charOptions;
    var h = '';

    // Name input
    h += '<h3>' + this._escHtml(L.name || 'Name') + '</h3>';
    h += '<div class="form-row">';
    h += '<input id="char-name" class="name-input" value="' + this._escHtml(this._randomName(cd)) + '" maxlength="8">';
    h += '<button class="mini-btn" id="btn-random-name">' + this._escHtml(L.randomName || 'Random') + '</button>';
    h += '</div>';

    // Pick groups
    var pickGroups = [
      { key: 'linggen', list: cd.linggen, label: L.linggen || 'Spiritual Root' },
      { key: 'constitution', list: cd.constitution, label: L.constitution || 'Constitution' },
      { key: 'origin', list: cd.origin, label: L.origin || 'Origin' },
    ];

    pickGroups.forEach(function(pg) {
      h += '<h3 style="margin-top:16px">' + pg.label + '</h3>';
      h += '<div class="pick-group" data-key="' + pg.key + '">';
      (pg.list || []).forEach(function(item, idx) {
        var sel = idx === 0 ? ' sel' : '';
        var descHtml = item.desc ? '<div class="pick-desc">' + GameUI._esc(item.desc) + '</div>' : '';
        h += '<div class="pick-card' + sel + '" data-id="' + GameUI._esc(item.id) + '">' +
             '<div class="pick-name">' + GameUI._esc(item.name || item.id) + '</div>' +
             descHtml +
             '</div>';
      });
      h += '</div>';
    });

    h += '<button class="choice-btn" id="btn-start-game" style="margin-top:20px;width:100%">' +
         this._escHtml(L.startGame || 'Start Game') + '</button>';

    el.innerHTML = h;

    // Bind events
    var self = this;
    document.getElementById('btn-random-name').addEventListener('click', function() {
      var inp = document.getElementById('char-name');
      if (inp) inp.value = self._randomName(cd);
    });
    document.getElementById('btn-start-game').addEventListener('click', function() {
      self._doCreate();
    });

    // Pick card click
    el.querySelectorAll('.pick-card').forEach(function(card) {
      card.addEventListener('click', function() {
        var group = card.closest('.pick-group');
        group.querySelectorAll('.pick-card').forEach(function(c) { c.classList.remove('sel'); });
        card.classList.add('sel');
      });
    });
  }

  _randomName(cd) {
    var n = cd.names || {};
    var given = n.given || [];
    var family = n.family || [];
    var g = given[Math.floor(Math.random() * given.length)] || '';
    var f = family[Math.floor(Math.random() * family.length)] || '';
    return g + f;
  }

  async _doCreate() {
    if (this._loading) return;
    var nameEl = document.getElementById('char-name');
    var name = (nameEl && nameEl.value) ? nameEl.value.trim() : (this.charOptions && this.charOptions.names ? this._randomName(this.charOptions) : '无名修士');
    if (!name) name = '无名修士';

    // Get selected card for each pick group
    var getSelected = function(key) {
      var group = document.querySelector('.pick-group[data-key="' + key + '"]');
      if (!group) return (key === 'linggen' ? '伪灵根' : key === 'constitution' ? '无' : '农家子弟');
      var sel = group.querySelector('.pick-card.sel');
      return sel ? sel.dataset.id : null;
    };

    var cd = {
      name: name,
      linggen: getSelected('linggen') || '伪灵根',
      constitution: getSelected('constitution') || '无',
      origin: getSelected('origin') || '农家子弟',
    };

    this._setLoading(true);
    try {
      var r = await this.api.newGame(cd);
      if (!r.ok) {
        this.toast('创建失败: ' + (r.error || '未知错误'), 'error');
        return;
      }
      this.state = r.state;
      this.toast('踏入修仙之途!', 'success');
      this.switchPage('play');
    } catch (e) {
      this.toast('网络错误，请重试', 'error');
    } finally {
      this._setLoading(false);
    }
  }

  async _doRestart() {
    if (this._loading) return;
    if (!confirm('确定要重新开始吗？当前进度将会丢失。')) return;
    this._setLoading(true);
    try {
      var r = await this.api.newGame({});
      if (!r.ok) {
        this.toast('重新开始失败', 'error');
        return;
      }
      this.state = r.state;
      this.toast('已重新开始', 'info');
      this.switchPage('play');
    } catch (e) {
      this.toast('网络错误', 'error');
    } finally {
      this._setLoading(false);
    }
  }

  // ---- PLAY ----

  render_play() {
    if (!this.state) {
      var el = document.getElementById('page-play');
      if (el) el.innerHTML = '<div class="empty-state"><div class="empty-state-text">尚无游戏存档，请先创建角色</div></div>';
      return;
    }
    this._renderHUD();
  }

  _renderHUD() {
    var d = this.state;
    if (!d) return;
    var el = document.getElementById('side-hud');
    if (!el) return;

    var h = '';
    h += '<div class="hud-name">' + this._escHtml(d.name || '') + '</div>';
    h += '<div class="realm-badge">' + this._escHtml(d.realm || '') + '</div>';
    h += '<div class="hud-row"><span>天数</span><span>' + (d.day || 1) + '</span></div>';
    h += '<div class="hud-row"><span>灵石</span><span>' + (d.stones || 0) + '</span></div>';

    // Realm progress bar
    if (d.realmInfo && d.realmInfo.toNext) {
      var mp = (d.attrs && d.attrs['灵力']) ? d.attrs['灵力'] : 0;
      var tn = d.realmInfo.toNext;
      var pct = Math.min(100, Math.round(mp / tn * 100));
      var stageLabel = '';
      if (d.realmInfo.stageLabels && d.realmInfo.stage !== undefined) {
        stageLabel = d.realmInfo.stageLabels[d.realmInfo.stage] || '';
      }
      h += '<div class="hud-row"><span>修为 ' + this._escHtml(stageLabel) + '</span><span>' + pct + '%</span></div>';
      h += '<div class="stage-bar-wrap"><div class="stage-bar"><div class="stage-fill" style="width:' + pct + '%"></div></div></div>';
    }

    // Attribute grid
    h += '<h4 class="hud-section-title">属性</h4><div class="attr-grid">';
    if (d.attrs) {
      var self = this;
      Object.keys(d.attrs).forEach(function(k) {
        h += '<div class="attr-cell"><div class="attr-cell-name">' + self._escHtml(k) + '</div><div class="attr-cell-val">' + d.attrs[k] + '</div></div>';
      });
    }
    h += '</div>';

    el.innerHTML = h;
  }

  _renderScene(scene) {
    if (!scene) return;
    var st = document.getElementById('scene-title');
    var sx = document.getElementById('scene-text');
    var bu = document.getElementById('battle-ui');
    var ld = document.getElementById('scene-loading');

    if (st) st.textContent = scene.title || '';
    if (sx) {
      sx.textContent = scene.text || '';
      sx.classList.remove('fade-in');
      void sx.offsetWidth;
      sx.classList.add('fade-in');
    }
    if (bu) bu.style.display = 'none';
    if (ld) ld.style.display = 'none';

    this._renderChoices(scene.choices);
  }

  _renderChoices(choices) {
    var el = document.getElementById('choices');
    if (!el) return;
    el.innerHTML = '';

    if (!choices || !choices.length) {
      el.innerHTML = '<div class="empty">无可选行动</div>';
      return;
    }

    var self = this;
    choices.forEach(function(c) {
      var btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.textContent = c.text || '';
      if (c.action === 'battle') btn.classList.add('choice-battle');
      btn.addEventListener('click', function() { self.act(c); });
      el.appendChild(btn);
    });
  }

  _renderBattle(battleState) {
    var bs = battleState;
    if (!bs) return;

    var bu = document.getElementById('battle-ui');
    if (!bu) return;
    bu.style.display = '';

    // Round
    var roundEl = document.getElementById('battle-round');
    if (roundEl) roundEl.textContent = '回合 ' + (bs.round || 1);

    // Player HP
    var p = bs.player || {};
    var pPct = p.maxHp > 0 ? Math.max(0, Math.round(p.hp / p.maxHp * 100)) : 0;
    var pBar = document.getElementById('battle-player-bar');
    if (pBar) {
      var pLabel = pBar.querySelector('.battle-bar-label');
      if (pLabel) pLabel.textContent = '我方 ' + (p.hp || 0) + '/' + (p.maxHp || 0);
      var pFill = pBar.querySelector('.battle-hp-fill');
      if (pFill) pFill.style.width = pPct + '%';
    }

    // Enemy HP
    var e = bs.enemy || {};
    var ePct = e.maxHp > 0 ? Math.max(0, Math.round(e.hp / e.maxHp * 100)) : 0;
    var eBar = document.getElementById('battle-enemy-bar');
    if (eBar) {
      var eLabel = eBar.querySelector('.battle-bar-label');
      if (eLabel) eLabel.textContent = (e.name || '') + ' ' + (e.realm || '') + ' ' + (e.hp || 0) + '/' + (e.maxHp || 0);
      var eFill = eBar.querySelector('.battle-hp-fill');
      if (eFill) eFill.style.width = ePct + '%';
    }

    // Battle log
    var logEl = document.getElementById('battle-log');
    if (logEl) {
      var logLines = bs.log || [];
      logEl.innerHTML = logLines.slice(-8).map(function(l) {
        return '<div class="battle-log-line">' + GameUI._esc(l) + '</div>';
      }).join('');
    }
  }

  async act(choice) {
    if (this._loading) return;
    this._setLoading(true);
    try {
      var r = await this.api.action(choice);
      if (!r.ok) {
        this.toast('行动失败: ' + (r.error || '未知错误'), 'error');
        return;
      }
      if (r.state) this.state = r.state;
      if (r.scene) this._renderScene(r.scene);
      this._renderHUD();
      if (r.battle) this._renderBattle(r.battle);
      this._updateTabVisibility();
    } catch (e) {
      this.toast('网络错误，请重试', 'error');
    } finally {
      this._setLoading(false);
    }
  }

  // ---- CHAR ----

  render_char() {
    var el = document.getElementById('page-char');
    if (!el) return;
    if (!this.state) {
      el.innerHTML = '<div class="empty-state"><div class="empty-state-text">尚无角色</div></div>';
      return;
    }

    var d = this.state;
    var h = '';

    // Header
    h += '<h3>' + this._escHtml(d.name || '') + '</h3>';
    h += '<p class="char-tag-row">';
    h += '<span class="tag realm-tag">' + this._escHtml(d.realm || '') + '</span> ';
    h += '<span class="tag">' + this._escHtml(d.linggen || '') + '</span>';
    if (d.constitution) h += ' <span class="tag">' + this._escHtml(d.constitution) + '</span>';
    h += '</p>';
    h += '<p class="empty">第' + (d.day || 1) + '天 | 灵石 ' + (d.stones || 0) + '</p>';

    // All attributes
    h += '<h4>属性</h4>';
    if (d.attrsBase && d.attrs) {
      var self = this;
      h += '<table class="attr-table"><thead><tr><th>属性</th><th>基础</th><th>当前</th></tr></thead><tbody>';
      Object.keys(d.attrsBase).forEach(function(k) {
        h += '<tr><td>' + self._escHtml(k) + '</td><td>' + (d.attrsBase[k] || 0) + '</td><td>' + ((d.attrs && d.attrs[k]) || 0) + '</td></tr>';
      });
      h += '</tbody></table>';
    }

    // Equipment slots
    h += '<h4>装备</h4>';
    var slots = d.equipSlots || [];
    var eq = d.equipment || {};
    if (slots.length) {
      h += '<div class="char-eq-grid">';
      slots.forEach(function(s) {
        var item = eq[s];
        h += '<div class="char-eq-slot">';
        h += '<div class="char-eq-slot-name">' + GameUI._esc(s) + '</div>';
        if (item) {
          h += '<div class="char-eq-item"><span class="rarity-' + (item.rarity || '凡品') + '">' + GameUI._esc(item.name) + '</span></div>';
          if (item.stats) {
            Object.keys(item.stats).forEach(function(sk) {
              h += '<div class="char-eq-stat">' + GameUI._esc(sk) + ' +' + item.stats[sk] + '</div>';
            });
          }
        } else {
          h += '<div class="char-eq-empty">空</div>';
        }
        h += '</div>';
      });
      h += '</div>';
    }

    el.innerHTML = h;
  }

  // ---- BAG ----

  render_bag() {
    var el = document.getElementById('page-bag');
    if (!el) return;
    if (!this.state) {
      el.innerHTML = '<div class="empty-state"><div class="empty-state-text">尚无角色</div></div>';
      return;
    }

    var d = this.state;
    var h = '';

    // Equipment section
    h += '<h3>装备栏</h3>';
    var slots = d.equipSlots || [];
    var eq = d.equipment || {};
    if (slots.length) {
      h += '<div class="bag-eq-section">';
      slots.forEach(function(s) {
        var item = eq[s];
        h += '<div class="bag-eq-row">';
        h += '<span class="bag-eq-slot-label">' + GameUI._esc(s) + '</span>';
        if (item) {
          h += '<span class="rarity-' + (item.rarity || '凡品') + '">' + GameUI._esc(item.name) + '</span>';
          h += '<button class="mini-btn" data-op="unequip" data-slot="' + GameUI._esc(s) + '">卸下</button>';
        } else {
          h += '<span class="empty">空</span>';
        }
        h += '</div>';
      });
      h += '</div>';
    }

    // Items section
    h += '<h3 style="margin-top:16px">背包物品</h3>';
    var items = d.items || [];
    if (!items.length) {
      h += '<p class="empty">背包空空如也</p>';
    } else {
      h += '<div class="bag-items-section">';
      items.forEach(function(it) {
        var cls = 'rarity-' + (it.rarity || '凡品');
        h += '<div class="bag-item-row">';
        h += '<span class="' + cls + '">' + GameUI._esc(it.name) + '</span>';
        h += '<span class="tag">' + GameUI._esc(it.type || '') + '</span>';
        if (it.slot) {
          h += '<button class="mini-btn" data-op="equip" data-id="' + GameUI._esc(it.id) + '">装备</button>';
        }
        if (it.usable) {
          h += '<button class="mini-btn" data-op="use" data-id="' + GameUI._esc(it.id) + '">使用</button>';
        }
        h += '<button class="mini-btn mini-danger" data-op="drop" data-id="' + GameUI._esc(it.id) + '">丢弃</button>';
        if (it.desc) h += '<div class="bag-item-desc">' + GameUI._esc(it.desc) + '</div>';
        h += '</div>';
      });
      h += '</div>';
    }

    el.innerHTML = h;

    // Bind item buttons
    var self = this;
    el.querySelectorAll('.mini-btn[data-op]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var op = btn.dataset.op;
        var id = btn.dataset.id;
        var slot = btn.dataset.slot;
        self.handleItem(op, id || null, slot || null);
      });
    });
  }

  async handleItem(op, id, slot) {
    if (this._loading) return;
    if (op === 'drop' && !confirm('确定要丢弃该物品吗？')) return;

    this._setLoading(true);
    try {
      var r = await this.api.item(op, id, slot);
      if (!r.ok) {
        this.toast('操作失败: ' + (r.error || '未知错误'), 'error');
        return;
      }
      if (r.state) this.state = r.state;
      this.toast(r.message || '操作成功', 'success');
      this.render_bag();
      this._renderHUD();
    } catch (e) {
      this.toast('网络错误', 'error');
    } finally {
      this._setLoading(false);
    }
  }

  // ---- SECT ----

  render_sect() {
    var el = document.getElementById('page-sect');
    if (!el) return;

    // No game, no state
    if (!this.state) {
      el.innerHTML = '<div class="empty-state"><div class="empty-state-text">尚无角色</div></div>';
      return;
    }

    var d = this.state;

    // Not in a sect — show join cards
    if (!d.sect || !d.sect.name) {
      if (!this.allSects || !this.allSects.length) {
        el.innerHTML = '<div class="loading-spinner">加载宗门数据中...</div>';
        return;
      }

      var h = '<h3>加入宗门</h3>';
      h += '<p class="empty">选择一个宗门踏上你的修仙之路</p>';
      h += '<div class="sect-grid">';

      var self = this;
      this.allSects.forEach(function(s) {
        var color = (s.culture && s.culture.color) || '#c9a96e';
        var alCls = 'al-' + (s.alignment || '中立');
        h += '<div class="sect-join-card" style="border-left:3px solid ' + color + '">';
        h += '<div class="sect-join-header">';
        h += '<span class="sect-join-name">' + self._escHtml(s.name) + '</span>';
        h += '<span class="align-badge ' + alCls + '">' + self._escHtml(s.alignment) + '</span>';
        h += '</div>';
        h += '<div class="sect-join-desc">' + self._escHtml(s.desc) + '</div>';
        if (s.specialty) {
          h += '<div class="sect-join-specs">';
          if (s.specialty.cultBonus) {
            var cultPct = Math.round((s.specialty.cultBonus - 1) * 100);
            h += '<span class="spec-chip">修炼 ' + (cultPct >= 0 ? '+' : '') + cultPct + '%</span>';
          }
          if (s.specialty.battleBonus) {
            var batPct = Math.round((s.specialty.battleBonus - 1) * 100);
            h += '<span class="spec-chip">战斗 ' + (batPct >= 0 ? '+' : '') + batPct + '%</span>';
          }
          h += '</div>';
        }
        h += '</div>';
      });
      h += '</div>';
      el.innerHTML = h;
      return;
    }

    // In a sect — show dashboard
    var si = d.sectInfo;
    if (!si) { el.innerHTML = '<div class="loading-spinner">加载宗门信息中...</div>'; return; }

    var sc = si.culture || {};
    var spec = si.specialty || {};
    var color = sc.color || '#c9a96e';
    var alCls = 'al-' + (si.alignment || '中立');

    var h = '<div class="sect-header" style="border-left:4px solid ' + color + '">';
    h += '<div class="sect-header-top">';
    h += '<span class="sect-header-name">' + this._escHtml(si.name) + '</span>';
    h += '<span class="align-badge ' + alCls + '">' + this._escHtml(si.alignment || '') + '</span>';
    h += '</div>';
    if (sc.mountain || sc.discipleTitle) {
      h += '<div class="sect-header-sub">' + this._escHtml(sc.mountain || '') + ' · ' + this._escHtml(sc.discipleTitle || '') + '</div>';
    }
    h += '</div>';

    // Contribution
    if (d.sect.contribution !== undefined) {
      h += '<div class="sect-contrib"><span>贡献: ' + d.sect.contribution + '</span></div>';
    }

    // Specialty boxes
    h += '<div class="spec-grid">';
    if (spec.cultBonus) {
      var cultPct = Math.round((spec.cultBonus - 1) * 100);
      h += '<div class="spec-box"><div class="spec-box-label">修炼加成</div><div class="spec-box-val">' + (cultPct >= 0 ? '+' : '') + cultPct + '%</div></div>';
    }
    if (spec.battleBonus) {
      var batPct = Math.round((spec.battleBonus - 1) * 100);
      h += '<div class="spec-box"><div class="spec-box-label">战斗加成</div><div class="spec-box-val">' + (batPct >= 0 ? '+' : '') + batPct + '%</div></div>';
    }
    if (spec.craftBonus) {
      Object.keys(spec.craftBonus).forEach(function(ck) {
        var cb = Math.round(spec.craftBonus[ck] * 100);
        h += '<div class="spec-box"><div class="spec-box-label">' + GameUI._esc(ck) + '加成</div><div class="spec-box-val">' + (cb >= 0 ? '+' : '') + cb + '%</div></div>';
      });
    }
    h += '</div>';

    // Quick actions
    h += '<div class="sect-actions-title">宗门行动</div>';
    h += '<div class="sect-actions">';
    var actions = [
      { scene: 'zongmen_renwu', label: '任务殿' },
      { scene: 'zongmen_cangjing', label: '藏经阁' },
      { scene: 'zongmen_danfang', label: '炼丹房' },
      { scene: 'zongmen_yanwu', label: '演武场' },
    ];
    var self = this;
    actions.forEach(function(a) {
      h += '<button class="sect-action-card" data-scene="' + a.scene + '">' + a.label + '</button>';
    });
    h += '</div>';

    // Leave button
    h += '<div style="text-align:center;margin-top:20px">';
    h += '<button class="more-btn more-danger" id="btn-leave-sect">离开宗门</button>';
    h += '</div>';

    el.innerHTML = h;

    // Bind events
    el.querySelectorAll('.sect-action-card').forEach(function(card) {
      card.addEventListener('click', function() {
        self._sectGo(card.dataset.scene);
      });
    });
    var leaveBtn = document.getElementById('btn-leave-sect');
    if (leaveBtn) leaveBtn.addEventListener('click', function() { self._sectLeave(); });
  }

  async _sectGo(sceneId) {
    if (this._loading || !sceneId) return;
    this._setLoading(true);
    try {
      // Navigate to the sect scene by sending an action with the sceneId
      var r = await this.api.action({ next: sceneId });
      if (!r.ok) {
        this.toast('行动失败', 'error');
        return;
      }
      if (r.state) this.state = r.state;
      if (r.scene) this._renderScene(r.scene);
      this._renderHUD();
      this._updateTabVisibility();
      this.switchPage('play');
    } catch (e) {
      this.toast('网络错误', 'error');
    } finally {
      this._setLoading(false);
    }
  }

  async _sectLeave() {
    if (this._loading) return;
    if (!confirm('确定要离开宗门吗？')) return;
    this._setLoading(true);
    try {
      var r = await this.api.action({ action: 'leave_sect' });
      if (!r.ok) {
        this.toast('离开失败', 'error');
        return;
      }
      if (r.state) this.state = r.state;
      this.toast('已离开宗门', 'info');
      this._renderHUD();
      this._updateTabVisibility();
      this.render_sect();
    } catch (e) {
      this.toast('网络错误', 'error');
    } finally {
      this._setLoading(false);
    }
  }

  // ---- GONGFA ----

  render_gongfa() {
    var el = document.getElementById('page-gongfa');
    if (!el) return;
    if (!this.state) {
      el.innerHTML = '<div class="empty-state"><div class="empty-state-text">尚无角色</div></div>';
      return;
    }

    var d = this.state;
    var gf = d.gongfa || {};
    var learned = gf.learned || [];
    var heartSlots = gf.heartSlots || 0;
    var skillSlots = gf.skillSlots || 0;

    // Heart methods
    var equippedHeart = gf.equipped_heart || [];
    var heartMap = {};
    equippedHeart.forEach(function(g, i) { if (g) heartMap[g.id] = i; });
    var heart = learned.filter(function(g) { return g.kind === '心法'; });
    var skill = learned.filter(function(g) { return g.kind === '术法'; });

    var h = '';

    h += '<h3>已学功法</h3>';
    h += '<p class="empty">心法槽位: ' + heartSlots + ' | 术法槽位: ' + skillSlots + '</p>';

    if (!learned.length) {
      h += '<p class="empty">尚未习得任何功法</p>';
      el.innerHTML = h;
      return;
    }

    // Heart methods
    if (heart.length) {
      h += '<h4>心法</h4><div class="gf-learned-list">';
      var self = this;
      heart.forEach(function(g) {
        var equipped = heartMap[g.id] !== undefined;
        h += '<div class="gf-learned-item' + (equipped ? ' gf-equipped' : '') + '">';
        h += '<div class="gf-learned-info">';
        h += '<span class="gf-learned-name">' + self._escHtml(g.name) + '</span>';
        h += '<span class="gf-learned-meta">' + self._escHtml(g.grade || '') + '</span>';
        h += '</div>';
        if (g.desc) h += '<div class="gf-learned-desc">' + self._escHtml(g.desc) + '</div>';
        if (equipped) h += '<span class="gf-equipped-badge">已装备</span>';
        h += '</div>';
      });
      h += '</div>';
    }

    // Skill methods
    if (skill.length) {
      h += '<h4>术法</h4><div class="gf-learned-list">';
      var self = this;
      skill.forEach(function(g) {
        h += '<div class="gf-learned-item">';
        h += '<div class="gf-learned-info">';
        h += '<span class="gf-learned-name">' + self._escHtml(g.name) + '</span>';
        h += '<span class="gf-learned-meta">' + self._escHtml(g.grade || '') + '</span>';
        h += '</div>';
        if (g.desc) h += '<div class="gf-learned-desc">' + self._escHtml(g.desc) + '</div>';
        if (g.battle) {
          h += '<div class="gf-battle-info">';
          if (g.battle.damage) h += '伤害 ' + g.battle.damage;
          if (g.battle.qiCost) h += ' | 灵力消耗 ' + g.battle.qiCost;
          if (g.battle.affix) h += ' | ' + self._escHtml(g.battle.affix);
          h += '</div>';
        }
        h += '</div>';
      });
      h += '</div>';
    }

    el.innerHTML = h;
  }

  // ---- LOG ----

  render_log() {
    var el = document.getElementById('page-log');
    if (!el) return;
    if (!this.state) {
      el.innerHTML = '<div class="empty-state"><div class="empty-state-text">尚无角色</div></div>';
      return;
    }

    var log = this.state.log || [];
    if (!log.length) {
      el.innerHTML = '<h3>事件日志</h3><p class="empty">暂无事件记录</p>';
      return;
    }

    var self = this;
    var h = '<h3>事件日志</h3><div class="log-list">';
    log.slice().reverse().forEach(function(entry, i) {
      h += '<div class="log-entry"><span class="log-num">#' + (log.length - i) + '</span> ' + self._escHtml(entry) + '</div>';
    });
    h += '</div>';
    el.innerHTML = h;
  }

  // ---- SAVE / LOAD ----

  async handleSave() {
    var saves = await this.api.saves();
    if (!saves.ok) { this.toast('获取存档列表失败', 'error'); return; }
    var list = saves.saves || [];
    var self = this;
    var h = '<h3>选择存档槽位</h3><div class="save-grid">';
    list.forEach(function(s) {
      if (s.empty) {
        h += '<div class="save-slot" data-slot="' + s.slot + '"><div class="save-slot-num">槽位 ' + s.slot + '</div><div class="save-slot-empty">空</div></div>';
      } else {
        h += '<div class="save-slot" data-slot="' + s.slot + '"><div class="save-slot-num">槽位 ' + s.slot + '</div><div class="save-slot-name">' + self._escHtml(s.name || '') + '</div><div class="save-slot-meta">' + self._escHtml(s.realm || '') + ' · ' + self._escHtml(s.scene || '') + '</div></div>';
      }
    });
    h += '</div>';
    this._showModal(h);

    document.querySelectorAll('.save-slot').forEach(function(el) {
      el.addEventListener('click', function() {
        document.getElementById('modal-overlay').hidden = true;
        self._doSave(parseInt(el.dataset.slot));
      });
    });
  }

  async _doSave(slot) {
    if (this._loading) return;
    this._setLoading(true);
    try {
      var r = await this.api.save(slot);
      if (!r.ok) { this.toast('存档失败', 'error'); return; }
      this.toast('存档成功 — 槽位 ' + slot, 'success');
    } catch (e) {
      this.toast('网络错误', 'error');
    } finally {
      this._setLoading(false);
    }
  }

  async handleLoad() {
    var saves = await this.api.saves();
    if (!saves.ok) { this.toast('获取存档列表失败', 'error'); return; }
    var list = saves.saves || [];
    var h = '<h3>选择存档槽位</h3><div class="save-grid">';
    list.forEach(function(s) {
      if (s.empty) {
        h += '<div class="save-slot save-slot-empty-card" data-slot="' + s.slot + '"><div class="save-slot-num">槽位 ' + s.slot + '</div><div class="save-slot-empty">空</div></div>';
      } else {
        h += '<div class="save-slot" data-slot="' + s.slot + '"><div class="save-slot-num">槽位 ' + s.slot + '</div><div class="save-slot-name">' + GameUI._esc(s.name || '') + '</div><div class="save-slot-meta">' + GameUI._esc(s.realm || '') + ' · ' + GameUI._esc(s.scene || '') + '</div></div>';
      }
    });
    h += '</div>';
    this._showModal(h);
    var self = this;
    document.querySelectorAll('.save-slot:not(.save-slot-empty-card)').forEach(function(el) {
      el.addEventListener('click', function() {
        document.getElementById('modal-overlay').hidden = true;
        self._doLoad(parseInt(el.dataset.slot));
      });
    });
  }

  async _doLoad(slot) {
    if (this._loading) return;
    this._setLoading(true);
    try {
      var r = await this.api.load(slot);
      if (!r.ok) { this.toast('读档失败: ' + (r.error || ''), 'error'); return; }
      this.state = r.state;
      this.toast('读档成功', 'success');
      if (r.scene) this._renderScene(r.scene);
      this._renderHUD();
      this._updateTabVisibility();
      this.switchPage('play');
    } catch (e) {
      this.toast('网络错误', 'error');
    } finally {
      this._setLoading(false);
    }
  }

  // ---- HELPERS ----

  toast(msg, type) {
    type = type || 'info';
    var el = document.getElementById('toast-container');
    if (!el) return;
    var div = document.createElement('div');
    div.className = 'toast-' + type;
    div.textContent = msg;
    el.appendChild(div);
    setTimeout(function() {
      div.classList.add('toast-out');
      setTimeout(function() { if (div.parentNode) div.parentNode.removeChild(div); }, 300);
    }, 3000);
  }

  _escHtml(str) {
    if (str === null || str === undefined) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  _setLoading(loading) {
    this._loading = loading;
    var choices = document.getElementById('choices');
    if (choices) {
      choices.querySelectorAll('.choice-btn').forEach(function(btn) {
        btn.disabled = loading;
        if (loading) btn.classList.add('loading');
        else btn.classList.remove('loading');
      });
    }
    var loadEl = document.getElementById('scene-loading');
    if (loadEl) loadEl.style.display = loading ? '' : 'none';
  }

  _showModal(html) {
    var overlay = document.getElementById('modal-overlay');
    var content = document.getElementById('modal-content');
    if (!overlay || !content) return;
    content.innerHTML = html;
    overlay.hidden = false;
  }

  _fatal(msg) {
    document.body.innerHTML = '<div style="text-align:center;padding:80px 20px;color:#c96a5e;font-size:18px">' +
      '<h1>修仙问道</h1>' +
      '<p>' + this._escHtml(msg) + '</p>' +
      '<p style="font-size:14px;color:#8a8578">请确认服务已启动 (python server.py → http://localhost:3456)</p>' +
      '</div>';
  }

  // ---- static escape (for non-instance contexts) ----

  static _esc(str) {
    if (str === null || str === undefined) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }
}

// ---- Global boot ----

const ui = new GameUI();
ui.init();
