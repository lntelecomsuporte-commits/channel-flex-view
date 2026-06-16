/* LN TV — side menu + modals */
window.LNTV = window.LNTV || {};

LNTV.menu = {
  _open: false,
  _focused: 0,
  _items: [],

  open: function () {
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

  _setFocus: function (i) {
    this._focused = i;
    for (var k = 0; k < this._items.length; k++) this._items[k].classList.remove("focused");
    if (this._items[i]) this._items[i].classList.add("focused");
  },

  select: function () {
    var id = this._items[this._focused].getAttribute("data-id");
    this.close();
    switch (id) {
      case "change-password": LNTV.menu.changePassword(); break;
      case "change-pin": LNTV.menu.changePin(); break;
      case "stats": LNTV.stats.toggle(); break;
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
        LNTV.modal.prompt("Novo PIN (4 dígitos)", "Use 4 dígitos:", "password", function (val) {
          if (!/^\d{4}$/.test(val || "")) { LNTV.toast.show("PIN inválido"); return; }
          LNTV.sb.patch("profiles?user_id=eq." + uid, { adult_pin: val }).then(function (ok) {
            LNTV.toast.show(ok ? "PIN atualizado" : "Falha ao salvar PIN");
          });
        });
      };
      if (current) {
        LNTV.modal.prompt("PIN atual", "Confirme o PIN atual:", "password", function (val) {
          if (val !== current) { LNTV.toast.show("PIN incorreto"); return; }
          doSet();
        });
      } else { doSet(); }
    });
  },

  showAbout: function () {
    var model = "TV";
    try { if (webapis && webapis.productinfo) {
      model = webapis.productinfo.getModel ? webapis.productinfo.getModel() : "TV";
    } } catch (e) {}
    LNTV.modal.alert("Sobre o LN TV",
      "Versão: " + LNTV.APP_VERSION + "<br>" +
      "Plataforma: Samsung Tizen<br>" +
      "Modelo: " + model + "<br>" +
      "DUID: " + LNTV.device.prettyId() + "<br>" +
      "Servidor: " + LNTV.BACKEND);
  },

  logout: function () {
    LNTV.modal.confirm("Sair", "Deseja sair e voltar ao pareamento?", function () {
      LNTV.auth.logout();
      LNTV.hb.stop();
      try { LNTV.player.stop(); } catch (e) {}
      LNTV.app.showLogin();
    });
  }
};

/* Modal singleton */
LNTV.modal = {
  _onOk: null, _onCancel: null,

  alert: function (title, html) {
    document.getElementById("modal-title").textContent = title;
    document.getElementById("modal-body").innerHTML = html;
    document.getElementById("modal-cancel").style.display = "none";
    document.getElementById("modal").classList.remove("hidden");
    this._onOk = function () { LNTV.modal.close(); };
  },

  confirm: function (title, html, onOk) {
    document.getElementById("modal-title").textContent = title;
    document.getElementById("modal-body").innerHTML = html;
    document.getElementById("modal-cancel").style.display = "";
    document.getElementById("modal").classList.remove("hidden");
    this._onOk = function () { LNTV.modal.close(); if (onOk) onOk(); };
    this._onCancel = function () { LNTV.modal.close(); };
  },

  prompt: function (title, html, type, onOk) {
    document.getElementById("modal-title").textContent = title;
    document.getElementById("modal-body").innerHTML = html + '<input id="modal-input" type="' + (type || "text") + '">';
    document.getElementById("modal-cancel").style.display = "";
    document.getElementById("modal").classList.remove("hidden");
    setTimeout(function () { try { document.getElementById("modal-input").focus(); } catch (e) {} }, 50);
    this._onOk = function () {
      var v = (document.getElementById("modal-input") || {}).value || "";
      LNTV.modal.close();
      if (onOk) onOk(v);
    };
    this._onCancel = function () { LNTV.modal.close(); };
  },

  close: function () {
    document.getElementById("modal").classList.add("hidden");
    this._onOk = null; this._onCancel = null;
  },

  isOpen: function () { return !document.getElementById("modal").classList.contains("hidden"); },

  ok: function () { if (this._onOk) this._onOk(); },
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
    var self = this;
    var tick = function () {
      var info = LNTV.player.info();
      el.innerHTML =
        "Estado: " + info.state + "<br>" +
        "Resolução: " + info.width + "x" + info.height + "<br>" +
        "Bitrate: " + info.bitrate + "<br>" +
        "Codec V: " + info.vcodec + "<br>" +
        "Codec A: " + info.acodec + "<br>" +
        "Buffer: " + info.buffer + "%<br>" +
        "Canal: " + info.channelName + " (" + info.channelNum + ")<br>" +
        "DUID: " + LNTV.device.prettyId() + "<br>" +
        "Versão: " + LNTV.APP_VERSION;
    };
    tick();
    this._t = setInterval(tick, 1000);
  }
};
