/* LN TV — side menu + modals + stats (LG webOS) */
window.LNTV = window.LNTV || {};

LNTV.menu = {
  _open: false,
  _focused: 0,
  _items: [],

  open: function () {
    LNTV.list.close();
    var ul = document.getElementById("menu-ul");
    this._items = ul.getElementsByTagName("li");
    this._open = true;
    this._setFocus(0);
    document.getElementById("menu").classList.remove("hidden");
  },

  close: function () {
    this._open = false;
    document.getElementById("menu").classList.add("hidden");
  },

  isOpen: function () { return this._open; },

  move: function (d) {
    var n = this._focused + d;
    if (n < 0) n = 0;
    if (n >= this._items.length) n = this._items.length - 1;
    this._setFocus(n);
  },

  focusItem: function (i) { if (i >= 0 && i < this._items.length) this._setFocus(i); },

  _setFocus: function (i) {
    this._focused = i;
    for (var k = 0; k < this._items.length; k++) this._items[k].classList.remove("focused");
    if (this._items[i]) this._items[i].classList.add("focused");
  },

  select: function () {
    var item = this._items[this._focused];
    if (!item) return;
    var id = item.getAttribute("data-id");
    this.close();
    switch (id) {
      case "channels": LNTV.osd.hide(); LNTV.list.open(LNTV.player.index); break;
      case "change-password": LNTV.menu.changePassword(); break;
      case "change-pin": LNTV.menu.changePin(); break;
      case "stats": LNTV.stats.toggle(); break;
      case "help": LNTV.menu.showHelp(); break;
      case "about": LNTV.menu.showAbout(); break;
      case "logout": LNTV.menu.logout(); break;
    }
  },

  changePassword: function () {
    LNTV.modal.prompt("Trocar senha de login", "Digite a nova senha (mínimo 6):", "password", function (val) {
      if (!val || val.length < 6) { LNTV.toast.show("Senha muito curta"); return; }
      LNTV.sb.updatePassword(val).then(function (ok) {
        LNTV.toast.show(ok ? "Senha alterada" : "Falha ao alterar senha");
      });
    });
  },

  changePin: function () {
    var uid = LNTV.session.userId();
    LNTV.sb.get("profiles?user_id=eq." + uid + "&select=adult_pin").then(function (rows) {
      var current = (rows[0] && rows[0].adult_pin) || "";
      var doSet = function () {
        LNTV.modal.prompt("Novo PIN", "Digite 4 dígitos para os canais adultos:", "pin", function (val) {
          if (!/^\d{4}$/.test(val || "")) { LNTV.toast.show("PIN inválido"); return; }
          LNTV.sb.patch("profiles?user_id=eq." + uid, { adult_pin: val }).then(function (ok) {
            if (ok) LNTV.player._unlocked = {};
            LNTV.toast.show(ok ? "PIN atualizado" : "Falha ao salvar PIN");
          });
        });
      };
      if (current) {
        LNTV.modal.prompt("PIN atual", "Confirme o PIN atual:", "pin", function (val) {
          if (val !== current) { LNTV.toast.show("PIN incorreto"); return; }
          doSet();
        });
      } else { doSet(); }
    });
  },

  showHelp: function () {
    LNTV.modal.alert("Como usar",
      "▲ ▼ ou CH+ / CH−: trocar de canal<br>" +
      "◀ ▶: ver o canal anterior/seguinte antes de trocar<br>" +
      "OK: informações do canal · OK 2x: lista de canais<br>" +
      "Números: ir direto ao canal<br>" +
      "Botão VERDE: menu · VERMELHO: favorito<br>" +
      "AMARELO: áudio · AZUL: legenda<br>" +
      "Ponteiro do Magic Remote: use os botões no rodapé da tela");
  },

  showAbout: function () {
    var os = LNTV.device.osVersion();
    LNTV.modal.alert("Sobre o LN TV",
      "Versão: " + LNTV.APP_VERSION + "<br>" +
      "Plataforma: LG webOS" + (os ? " " + os : "") + "<br>" +
      "Modelo: " + LNTV.device.model() + "<br>" +
      "Código do aparelho: " + LNTV.device.prettyId() + "<br>" +
      "Servidor: " + LNTV.BACKEND);
  },

  logout: function () {
    LNTV.modal.confirm("Sair da conta", "Deseja sair e voltar à tela de login?", function () {
      LNTV.hb.stop();
      try { LNTV.player.stop(); } catch (e) {}
      LNTV.player._unlocked = {};
      LNTV.auth.logout();
      LNTV.app.showLogin();
    });
  }
};

/* Modal singleton — navegável pelo controle (setas) e pelo ponteiro */
LNTV.modal = {
  _onOk: null, _onCancel: null,

  _open: function (title, html, showCancel) {
    document.getElementById("modal-title").textContent = title;
    document.getElementById("modal-body").innerHTML = html;
    document.getElementById("modal-cancel").style.display = showCancel ? "" : "none";
    document.getElementById("modal").classList.remove("hidden");
  },

  alert: function (title, html) {
    this._open(title, html, false);
    this._onOk = function () { LNTV.modal.close(); };
    this._onCancel = null;
    this._focusLater("modal-ok");
  },

  confirm: function (title, html, onOk, okLabel) {
    this._open(title, html, true);
    document.getElementById("modal-ok").textContent = okLabel || "OK";
    this._onOk = function () { LNTV.modal.close(); if (onOk) onOk(); };
    this._onCancel = function () { LNTV.modal.close(); };
    this._focusLater("modal-cancel");
  },

  /* type "pin" = 4 dígitos numéricos, confirma sozinho ao completar. */
  prompt: function (title, html, type, onOk) {
    var isPin = type === "pin";
    var attrs = isPin
      ? 'type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4"'
      : 'type="' + (type || "text") + '"';
    this._open(title, html + '<input id="modal-input" ' + attrs + ' autocomplete="off">', true);
    this._onOk = function () {
      var v = (document.getElementById("modal-input") || {}).value || "";
      LNTV.modal.close();
      if (onOk) onOk(v);
    };
    this._onCancel = function () { LNTV.modal.close(); };
    var input = document.getElementById("modal-input");
    if (isPin) {
      input.addEventListener("input", function () {
        input.value = input.value.replace(/\D/g, "").substr(0, 4);
        if (input.value.length === 4 && LNTV.modal._onOk) LNTV.modal._onOk();
      });
    }
    this._focusLater("modal-input");
  },

  _focusLater: function (id) {
    setTimeout(function () { var el = document.getElementById(id); if (el && LNTV.modal.isOpen()) el.focus(); }, 50);
  },

  controls: function () {
    var list = [];
    var input = document.getElementById("modal-input");
    if (input) list.push(input);
    list.push(document.getElementById("modal-ok"));
    var cancel = document.getElementById("modal-cancel");
    if (cancel.style.display !== "none") list.push(cancel);
    return list;
  },

  /* Dígitos do controle preenchem o PIN mesmo se o foco estiver nos botões. */
  typeDigit: function (d) {
    var input = document.getElementById("modal-input");
    if (!input || document.activeElement === input) return false;
    if (input.maxLength > 0 && input.value.length >= input.maxLength) return true;
    input.value += String(d);
    var ev;
    try { ev = new Event("input"); } catch (e) { ev = document.createEvent("Event"); ev.initEvent("input", true, true); }
    input.dispatchEvent(ev);
    return true;
  },

  close: function () {
    document.getElementById("modal").classList.add("hidden");
    document.getElementById("modal-ok").textContent = "OK";
    document.getElementById("modal-body").innerHTML = "";
    this._onOk = null; this._onCancel = null;
  },

  isOpen: function () { return !document.getElementById("modal").classList.contains("hidden"); },

  ok: function () {
    if (document.activeElement && document.activeElement.id === "modal-cancel") { this.cancel(); return; }
    if (this._onOk) this._onOk();
  },
  cancel: function () { if (this._onCancel) this._onCancel(); else this.close(); }
};

/* Stats overlay */
LNTV.stats = {
  _t: null,
  _on: false,
  toggle: function () {
    this._on = !this._on;
    var el = document.getElementById("stats");
    if (!this._on) { el.classList.add("hidden"); if (this._t) clearInterval(this._t); return; }
    el.classList.remove("hidden");
    var tick = function () {
      var info = LNTV.player.info();
      el.innerHTML =
        "Estado: " + info.state + "<br>" +
        "Motor: " + (info.engine || "") + "<br>" +
        "Resolução: " + info.width + "x" + info.height + "<br>" +
        "Bitrate: " + info.bitrate + "<br>" +
        "Codec V: " + info.vcodec + "<br>" +
        "Codec A: " + info.acodec + "<br>" +
        "Buffer: " + info.buffer + "s<br>" +
        "Canal: " + info.channelName + " (" + info.channelNum + ")<br>" +
        "Aparelho: " + LNTV.device.prettyId() + "<br>" +
        "Versão: " + LNTV.APP_VERSION;
    };
    tick();
    this._t = setInterval(tick, 1000);
  }
};
