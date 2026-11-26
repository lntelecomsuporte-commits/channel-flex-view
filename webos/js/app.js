/* LN TV — bootstrap, screens, key router (LG webOS) */
window.LNTV = window.LNTV || {};

LNTV.app = {
  _beacon: null,
  _lastOk: 0,
  _konami: [],
  _paused: false,

  init: function () {
    var self = this;
    LNTV.registerKeys();
    document.addEventListener("keydown", function (e) { self.onKey(e); });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) self.pause(); else self.resume();
    });
    // Ponteiro do Magic Remote: mostra os botões na tela enquanto o cursor estiver visível.
    document.addEventListener("cursorStateChange", function (e) {
      var visible = !!(e && e.detail && e.detail.visibility);
      document.body.classList.toggle("pointer-on", visible);
    });
    document.addEventListener("mousemove", function () { document.body.classList.add("pointer-on"); });
    this._bindClicks();

    LNTV.device.init().then(function () {
      if (LNTV.session.accessToken()) self.enterApp();
      else self.showLogin();
    });
  },

  _bindClicks: function () {
    var self = this;
    var on = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
    on("login-btn", function () { self.doManualLogin(); });
    on("modal-ok", function () { LNTV.modal.ok(); });
    on("modal-cancel", function () { LNTV.modal.cancel(); });
    on("channel-lock", function () { LNTV.player.unlock(); });
    on("pb-up", function () { LNTV.player.step(+1); });
    on("pb-down", function () { LNTV.player.step(-1); });
    on("pb-list", function () { self.toggleList(); });
    on("pb-menu", function () { LNTV.menu.isOpen() ? LNTV.menu.close() : LNTV.menu.open(); });
    on("pb-back", function () { self.goBack(); });

    var ul = document.getElementById("cl-ul");
    ul.addEventListener("click", function (e) {
      var li = self._closestLi(e.target);
      if (!li) return;
      LNTV.player.tuneByIndex(parseInt(li.getAttribute("data-idx"), 10));
      LNTV.list.close();
    });
    ul.addEventListener("mouseover", function (e) {
      var li = self._closestLi(e.target);
      if (li) LNTV.list._setFocus(parseInt(li.getAttribute("data-idx"), 10));
    });

    var mul = document.getElementById("menu-ul");
    var menuIndex = function (li) { return Array.prototype.indexOf.call(mul.getElementsByTagName("li"), li); };
    mul.addEventListener("click", function (e) {
      var li = self._closestLi(e.target);
      if (!li) return;
      LNTV.menu.focusItem(menuIndex(li));
      LNTV.menu.select();
    });
    mul.addEventListener("mouseover", function (e) {
      var li = self._closestLi(e.target);
      if (li) LNTV.menu.focusItem(menuIndex(li));
    });
  },

  _closestLi: function (el) {
    while (el && el.tagName !== "LI") el = el.parentNode;
    return el && el.tagName === "LI" ? el : null;
  },

  _isLoginVisible: function () { return !document.getElementById("screen-login").classList.contains("hidden"); },

  /* ---------------- Login screen ---------------- */
  _loginControls: function () {
    return [
      document.getElementById("login-user"),
      document.getElementById("login-pass"),
      document.getElementById("login-btn")
    ];
  },

  _focusLoginControl: function (index) {
    var control = this._loginControls()[index];
    if (control) control.focus();
  },

  _moveLoginFocus: function (step) {
    var controls = this._loginControls();
    var current = controls.indexOf(document.activeElement);
    if (current < 0) current = step > 0 ? 0 : controls.length - 1;
    else current = Math.max(0, Math.min(controls.length - 1, current + step));
    controls[current].focus();
  },

  showLogin: function () {
    document.getElementById("screen-login").classList.remove("hidden");
    document.getElementById("screen-player").classList.add("hidden");
    LNTV.menu.close();
    LNTV.list.close();
    document.getElementById("pair-code").textContent = LNTV.device.prettyId();
    document.getElementById("login-status").textContent = "Aguardando pareamento…";
    document.getElementById("login-err").textContent = "";
    document.getElementById("login-pass").value = "";
    document.getElementById("dev-line").textContent = "Aparelho " + LNTV.device.prettyId() + "  |  v" + LNTV.APP_VERSION;
    this._focusLoginControl(0);
    this._startBeacon();
  },

  _startBeacon: function () {
    var self = this;
    if (self._beacon) clearInterval(self._beacon);
    var tick = function () {
      if (!self._isLoginVisible()) return;
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

  _loggingIn: false,

  doManualLogin: function () {
    var u = document.getElementById("login-user").value.trim();
    var p = document.getElementById("login-pass").value;
    var err = document.getElementById("login-err");
    if (!u) { err.textContent = "Informe o CPF ou e-mail"; this._focusLoginControl(0); return; }
    if (!p) { err.textContent = "Informe a senha"; this._focusLoginControl(1); return; }
    if (this._loggingIn) return;
    this._loggingIn = true;
    err.textContent = "";
    document.getElementById("login-status").textContent = "Autenticando…";
    var self = this;
    LNTV.auth.manualLogin(u, p).then(function (r) {
      self._loggingIn = false;
      if (r.ok) { self._stopBeacon(); self.enterApp(); }
      else {
        err.textContent = r.error || "Falha no login";
        document.getElementById("login-status").textContent = "Aguardando pareamento…";
      }
    });
  },

  /* ---------------- Enter app ---------------- */
  enterApp: function () {
    var self = this;
    this._stopBeacon();
    document.getElementById("screen-login").classList.add("hidden");
    document.getElementById("screen-player").classList.remove("hidden");
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
    LNTV.channels.load().then(function (chs) {
      if (!chs || !chs.length) { LNTV.toast.show("Nenhum canal liberado para este usuário", 0); return; }
      setTimeout(function () { LNTV.update.check(); }, 5000);
      LNTV.player.tuneByIndex(0);
      if (!LNTV.store.get("help_seen")) {
        LNTV.store.set("help_seen", "1");
        setTimeout(function () { LNTV.toast.show("Dica: OK 2x abre a lista de canais · botão VERDE abre o menu", 6000); }, 4500);
      }
      LNTV.hb.start().then(function (ok) {
        if (!ok && !self._isLoginVisible()) {
          LNTV.toast.show("Sessão não confirmada pelo servidor — tentando novamente…", 6000);
        }
      });
    }).catch(function () {
      LNTV.toast.show("Erro ao carregar canais. Verifique a conexão e abra o app novamente.", 0);
    });
  },

  /* App foi para segundo plano (Home/troca de entrada): para vídeo e encerra a presença. */
  pause: function () {
    if (this._paused) return;
    this._paused = true;
    try { LNTV.hb.stop(); } catch (e) {}
    try { LNTV.player.stop(); } catch (e) {}
  },

  resume: function () {
    if (!this._paused) return;
    this._paused = false;
    if (this._isLoginVisible() || !LNTV.session.accessToken()) return;
    if (!LNTV.channels.list.length) { this.enterApp(); return; }
    LNTV.player.tuneByIndex(LNTV.player.index || 0);
    LNTV.hb.start();
  },

  exit: function () {
    try { LNTV.hb.stop(); } catch (e) {}
    try { LNTV.player.stop(); } catch (e) {}
    try { window.close(); } catch (e) {}
  },

  confirmExit: function () {
    var self = this;
    LNTV.modal.confirm("Sair do LN TV", "Deseja fechar o aplicativo?", function () { self.exit(); }, "Sair");
  },

  toggleList: function () {
    if (LNTV.list.isOpen()) { LNTV.list.close(); return; }
    LNTV.menu.close();
    LNTV.osd.hide();
    LNTV.list.open(LNTV.player.index);
  },

  /* VOLTAR: fecha o que estiver aberto; na tela principal pergunta se quer sair. */
  goBack: function () {
    if (LNTV.modal.isOpen()) { LNTV.modal.cancel(); return; }
    if (LNTV.stats._on) { LNTV.stats.toggle(); return; }
    if (LNTV.menu.isOpen()) { LNTV.menu.close(); return; }
    if (LNTV.list.isOpen()) { LNTV.list.close(); return; }
    if (LNTV.player.hasPreviewPending()) { LNTV.player._previewIdx = -1; if (LNTV.player._previewT) clearTimeout(LNTV.player._previewT); LNTV.osd.show(LNTV.player.current); return; }
    if (!document.getElementById("osd").classList.contains("hidden")) { LNTV.osd.hide(); return; }
    this.confirmExit();
  },

  /* ---------------- Key router ---------------- */
  _modalKey: function (e, code) {
    var K = LNTV.KEYS;
    var controls = LNTV.modal.controls();
    var active = document.activeElement;
    var pos = controls.indexOf(active);
    var input = document.getElementById("modal-input");
    if (LNTV.isBackKey(code, active)) { LNTV.modal.cancel(); e.preventDefault(); return; }
    if (code >= K.N0 && code <= K.N9 && LNTV.modal.typeDigit(code - K.N0)) { e.preventDefault(); return; }
    if (code === K.ENTER) {
      if (input && active === input) {
        // Campo vazio: deixa o OK abrir o teclado virtual da LG; com texto, confirma.
        if (input.value) { LNTV.modal.ok(); e.preventDefault(); }
        return;
      }
      LNTV.modal.ok(); e.preventDefault(); return;
    }
    if (code === K.UP && input && active !== input) { input.focus(); e.preventDefault(); return; }
    if (code === K.DOWN && input && active === input) { document.getElementById("modal-ok").focus(); e.preventDefault(); return; }
    if ((code === K.LEFT || code === K.RIGHT) && active !== input) {
      var buttons = controls.filter(function (c) { return c.tagName === "BUTTON"; });
      var bi = buttons.indexOf(active);
      bi = bi < 0 ? 0 : Math.max(0, Math.min(buttons.length - 1, bi + (code === K.RIGHT ? 1 : -1)));
      buttons[bi].focus();
      e.preventDefault(); return;
    }
    if (pos < 0 && controls.length) { controls[0].focus(); }
  },

  onKey: function (e) {
    var K = LNTV.KEYS;
    var code = e.keyCode;
    LNTV.player.unmute();
    if (code === K.UP || code === K.DOWN || code === K.LEFT || code === K.RIGHT || code === K.ENTER) {
      document.body.classList.remove("pointer-on");
    }

    if (LNTV.modal.isOpen()) { this._modalKey(e, code); return; }

    // Login: setas navegam; OK nos campos mantém o evento nativo para abrir o teclado da LG.
    if (this._isLoginVisible()) {
      if (code === K.UP || code === K.DOWN) {
        this._moveLoginFocus(code === K.UP ? -1 : 1);
        e.preventDefault();
        return;
      }
      if (code === K.ENTER) {
        var active = document.activeElement;
        if (active && active.id === "login-btn") {
          this.doManualLogin();
          e.preventDefault();
        } else if (active && active.id === "login-user" && active.value) {
          // Enter do teclado virtual no usuário pula para a senha
          this._focusLoginControl(1);
          e.preventDefault();
        } else if (active && active.id === "login-pass" && active.value) {
          // Enter do teclado virtual na senha leva ao botão Entrar (o envio fica no botão).
          this._focusLoginControl(2);
          e.preventDefault();
        } else if (!active || (active.id !== "login-user" && active.id !== "login-pass")) {
          this._focusLoginControl(0);
          e.preventDefault();
        }
        return;
      }
      if (LNTV.isBackKey(code, document.activeElement)) { this.confirmExit(); e.preventDefault(); return; }
      return;
    }

    if (LNTV.isBackKey(code, document.activeElement)) { this.goBack(); e.preventDefault(); return; }

    // Menu aberto
    if (LNTV.menu.isOpen()) {
      if (code === K.UP)   { LNTV.menu.move(-1); e.preventDefault(); return; }
      if (code === K.DOWN) { LNTV.menu.move(+1); e.preventDefault(); return; }
      if (code === K.ENTER){ LNTV.menu.select(); e.preventDefault(); return; }
      if (code === K.GREEN || code === K.INFO || code === K.LEFT) { LNTV.menu.close(); e.preventDefault(); return; }
      return;
    }

    // Lista aberta
    if (LNTV.list.isOpen()) {
      if (code === K.UP)   { LNTV.list.move(-1); e.preventDefault(); return; }
      if (code === K.DOWN) { LNTV.list.move(+1); e.preventDefault(); return; }
      if (code === K.CH_UP)   { LNTV.list.move(-10); e.preventDefault(); return; }
      if (code === K.CH_DOWN) { LNTV.list.move(+10); e.preventDefault(); return; }
      if (code === K.ENTER){ LNTV.player.tuneByIndex(LNTV.list.selected()); LNTV.list.close(); e.preventDefault(); return; }
      if (code === K.RIGHT) { LNTV.list.close(); e.preventDefault(); return; }
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
      case K.FF:
        LNTV.player.preview(+1); this._konamiPush("R"); e.preventDefault(); break;
      case K.LEFT:
      case K.REW:
        LNTV.player.preview(-1); this._konamiPush("L"); e.preventDefault(); break;
      case K.ENTER:
        this._konamiPush("OK");
        if (LNTV.player.hasPreviewPending()) { LNTV.player.commitPreview(); }
        else if (LNTV.numBuf.hasPending()) { LNTV.numBuf.commit(function (n) { LNTV.player.tuneByNumber(n); }); }
        else { this._handleOk(); }
        e.preventDefault();
        break;
      case K.GREEN:
      case K.INFO:
        LNTV.menu.open(); e.preventDefault(); break;
      case K.GUIDE:
        this.toggleList(); e.preventDefault(); break;
      case K.RED:
        LNTV.player.toggleFavorite(); e.preventDefault(); break;
      case K.YELLOW:
        LNTV.player.cycleAudio(); e.preventDefault(); break;
      case K.BLUE:
        LNTV.player.cycleSubtitle(); e.preventDefault(); break;
      default:
        if (code >= K.N0 && code <= K.N9) {
          LNTV.numBuf.push(code - K.N0, function (n) { LNTV.player.tuneByNumber(n); });
          e.preventDefault();
        }
    }
  },

  _handleOk: function () {
    if (LNTV.player._locked) { LNTV.player.unlock(); return; }
    var now = Date.now();
    if (now - this._lastOk < 400) {
      LNTV.osd.hide();
      LNTV.list.open(LNTV.player.index);
    } else {
      LNTV.osd.show(LNTV.player.current);
    }
    this._lastOk = now;
  },

  _konamiPush: function (s) {
    this._konami.push({ t: Date.now(), k: s });
    if (this._konami.length > 7) this._konami.shift();
    var pattern = ["R","R","R","L","L","R","OK"];
    if (this._konami.length < 7) return;
    for (var i = 0; i < 7; i++) if (this._konami[i].k !== pattern[i]) return;
    if (Date.now() - this._konami[0].t > 4000) return;
    this._konami = [];
    LNTV.stats.toggle();
  }
};

window.onload = function () { LNTV.app.init(); };
