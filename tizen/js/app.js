/* LN TV — bootstrap, screens, key router */
window.LNTV = window.LNTV || {};

LNTV.app = {
  _beacon: null,
  _backCount: 0,
  _backT: null,
  _lastOk: 0,
  _konami: [],

  init: function () {
    LNTV.registerKeys();
    try { tizen.tvaudiocontrol && tizen.tvaudiocontrol.setVolumeChangeListener(function () {}); } catch (e) {}
    try { tizen.power && tizen.power.request("SCREEN", "SCREEN_NORMAL"); } catch (e) {}

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { try { LNTV.app.exit(); } catch (e) {} }
    });

    document.addEventListener("keydown", function (e) { LNTV.app.onKey(e); });

    document.getElementById("login-btn").addEventListener("click", function () { LNTV.app.doManualLogin(); });

    if (LNTV.session.accessToken()) {
      this.enterApp();
    } else {
      this.showLogin();
    }
  },

  /* ---------------- Login screen ---------------- */
  showLogin: function () {
    document.getElementById("screen-login").classList.remove("hidden");
    document.getElementById("screen-player").classList.add("hidden");
    document.getElementById("pair-code").textContent = LNTV.device.prettyId();
    document.getElementById("login-status").textContent = "Aguardando pareamento…";
    document.getElementById("dev-line").textContent = "DUID " + LNTV.device.prettyId() + "  |  v" + LNTV.APP_VERSION;
    this._startBeacon();
  },

  _startBeacon: function () {
    var self = this;
    if (self._beacon) clearInterval(self._beacon);
    var tick = function () {
      LNTV.auth.autoLogin().then(function (ok) {
        if (ok) { self._stopBeacon(); self.enterApp(); return; }
        LNTV.auth.announce().then(function (reg) {
          if (reg) {
            document.getElementById("login-status").textContent = "Pareado — entrando…";
            LNTV.auth.autoLogin().then(function (ok2) {
              if (ok2) { self._stopBeacon(); self.enterApp(); }
            });
          }
        });
      });
    };
    tick();
    self._beacon = setInterval(tick, 10000);
  },

  _stopBeacon: function () { if (this._beacon) { clearInterval(this._beacon); this._beacon = null; } },

  doManualLogin: function () {
    var u = document.getElementById("login-user").value.trim();
    var p = document.getElementById("login-pass").value;
    if (!u || !p) return;
    document.getElementById("login-err").textContent = "";
    document.getElementById("login-status").textContent = "Autenticando…";
    var self = this;
    LNTV.auth.manualLogin(u, p).then(function (r) {
      if (r.ok) { self._stopBeacon(); self.enterApp(); }
      else { document.getElementById("login-err").textContent = r.error || "Falha no login"; }
    });
  },

  /* ---------------- Enter app ---------------- */
  enterApp: function () {
    var self = this;
    document.getElementById("screen-login").classList.add("hidden");
    document.getElementById("screen-player").classList.remove("hidden");
    LNTV.channels.load().then(function (chs) {
      if (!chs || !chs.length) { LNTV.toast.show("Nenhum canal disponível"); return; }
      LNTV.hb.start();
      LNTV.player.tuneByIndex(0);
      setTimeout(function () { LNTV.update.check(); }, 5000);
    }).catch(function (e) {
      LNTV.toast.show("Erro ao carregar canais");
    });
  },

  exit: function () {
    try { LNTV.hb.stop(); } catch (e) {}
    try { LNTV.player.stop(); } catch (e) {}
    try { tizen.application.getCurrentApplication().exit(); } catch (e) {}
  },

  /* ---------------- Key router ---------------- */
  onKey: function (e) {
    var K = LNTV.KEYS;
    var code = e.keyCode;

    // Modal aberto
    if (LNTV.modal.isOpen()) {
      if (code === K.ENTER) { LNTV.modal.ok(); e.preventDefault(); return; }
      if (code === K.BACK)  { LNTV.modal.cancel(); e.preventDefault(); return; }
      return;
    }

    // Login screen
    if (!document.getElementById("screen-login").classList.contains("hidden")) {
      if (code === K.ENTER) { this.doManualLogin(); e.preventDefault(); return; }
      if (code === K.BACK)  { try { tizen.application.getCurrentApplication().exit(); } catch (e2) {} return; }
      return;
    }

    // Voice overlay aberto: BACK fecha
    if (LNTV.voice._on) {
      if (code === K.BACK) { LNTV.voice.stop(); e.preventDefault(); }
      return;
    }

    // Menu aberto
    if (LNTV.menu.isOpen()) {
      if (code === K.UP)   { LNTV.menu.move(-1); e.preventDefault(); return; }
      if (code === K.DOWN) { LNTV.menu.move(+1); e.preventDefault(); return; }
      if (code === K.ENTER){ LNTV.menu.select(); e.preventDefault(); return; }
      if (code === K.BACK || code === K.MENU) { LNTV.menu.close(); e.preventDefault(); return; }
      return;
    }

    // Lista aberta
    if (LNTV.list.isOpen()) {
      if (code === K.UP)   { LNTV.list.move(-1); e.preventDefault(); return; }
      if (code === K.DOWN) { LNTV.list.move(+1); e.preventDefault(); return; }
      if (code === K.ENTER){ LNTV.player.tuneByIndex(LNTV.list.selected()); LNTV.list.close(); e.preventDefault(); return; }
      if (code === K.BACK) { LNTV.list.close(); e.preventDefault(); return; }
      return;
    }

    // Player principal
    switch (code) {
      case K.UP:
      case K.CH_UP:
        LNTV.player.step(+1); e.preventDefault(); break;
      case K.DOWN:
      case K.CH_DOWN:
        LNTV.player.step(-1); e.preventDefault(); break;
      case K.RIGHT:
      case K.NEXT:
      case K.FF:
        LNTV.player.preview(+1); this._konamiPush("R"); e.preventDefault(); break;
      case K.LEFT:
      case K.PREV:
      case K.REW:
        LNTV.player.preview(-1); this._konamiPush("L"); e.preventDefault(); break;
      case K.ENTER:
        this._konamiPush("OK");
        if (LNTV.player.hasPreviewPending()) { LNTV.player.commitPreview(); }
        else if (LNTV.numBuf.hasPending()) { LNTV.numBuf.commit(function (n) { LNTV.player.tuneByNumber(n); }); }
        else { this._handleOk(); }
        e.preventDefault();
        break;
      case K.BACK:
        this._handleBack(); e.preventDefault(); break;
      case K.MENU:
      case K.TOOLS:
      case K.INFO:
        LNTV.menu.open(); e.preventDefault(); break;
      case K.RED:
        LNTV.player.toggleFavorite(); e.preventDefault(); break;
      case K.YELLOW:
      case K.AUDIO:
        LNTV.player.cycleAudio(); e.preventDefault(); break;
      case K.BLUE:
      case K.CC:
        LNTV.player.cycleSubtitle(); e.preventDefault(); break;
      case K.GREEN:
        // reservado pra EPG grid futura
        LNTV.toast.show("EPG em breve"); e.preventDefault(); break;
      case K.VOICE:
        LNTV.voice.start(); e.preventDefault(); break;
      case K.EXIT:
        this.exit(); e.preventDefault(); break;
      default:
        // dígitos
        if (code >= K.N0 && code <= K.N9) {
          var d = code - K.N0;
          LNTV.numBuf.push(d, function (n) { LNTV.player.tuneByNumber(n); });
          e.preventDefault();
        }
    }
  },

  _handleOk: function () {
    var now = Date.now();
    if (now - this._lastOk < 400) {
      LNTV.osd.hide();
      LNTV.list.open(LNTV.player.index);
    } else {
      LNTV.osd.show(LNTV.player.current);
    }
    this._lastOk = now;
  },

  _handleBack: function () {
    var self = this;
    self._backCount++;
    if (self._backT) clearTimeout(self._backT);
    self._backT = setTimeout(function () { self._backCount = 0; }, 1800);
    if (self._backCount >= 3) self.exit();
    else LNTV.toast.show("Pressione VOLTAR " + (3 - self._backCount) + "x para sair");
  },

  _konamiPush: function (s) {
    this._konami.push({ t: Date.now(), k: s });
    if (this._konami.length > 7) this._konami.shift();
    var pattern = ["R","R","R","L","L","R","OK"];
    if (this._konami.length < 7) return;
    var ok = true;
    for (var i = 0; i < 7; i++) if (this._konami[i].k !== pattern[i]) { ok = false; break; }
    if (!ok) return;
    if (Date.now() - this._konami[0].t > 4000) return;
    this._konami = [];
    LNTV.stats.toggle();
  }
};

window.onload = function () { LNTV.app.init(); };
