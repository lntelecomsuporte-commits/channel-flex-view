/* LN TV — heartbeat (session-heartbeat edge fn) */
window.LNTV = window.LNTV || {};

LNTV.hb = {
  _timer: null,
  _token: null,
  _id: null,
  _starting: null,
  _busy: false,
  _channel: null,
  _watching: false,

  _payload: function (action) {
    return {
      action: action,
      sessionToken: this._token,
      sessionId: this._id,
      userAgent: navigator.userAgent,
      channelId: this._channel ? this._channel.id : null,
      channelName: this._channel ? this._channel.name : null,
      isWatching: this._watching,
      deviceId: LNTV.device.id(),
      platform: LNTV.PLATFORM,
      deviceName: LNTV.device.name(),
      appVersion: LNTV.APP_VERSION
    };
  },

  _uuid: function () {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; var v = c === "x" ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },

  start: function () {
    var self = this;
    if (self._starting) return self._starting;
    self._token = self._uuid();
    if (self._timer) clearInterval(self._timer);
    self._timer = setInterval(function () { self.beat(); }, 30000);
    self._starting = LNTV.sb.fn("session-heartbeat", self._payload("start")).then(function (r) {
      return self._read(r);
    }).then(function (j) {
      if (!j || !j.id || !self._token) return false;
      self._id = j.id;
      return true;
    }).catch(function () { return false; }).then(function (ok) {
      self._starting = null;
      return ok;
    });
    return self._starting;
  },

  _read: function (response) {
    var self = this;
    if (response.status === 401 || response.status === 403) { self._signout(); return Promise.resolve(null); }
    if (!response.ok) return Promise.resolve(null);
    return response.json().then(function (j) {
      if (j.forceSignout || j.command === "force_close") { self._signout(); return null; }
      if (j.command === "reload_channels") {
        LNTV.channels.load().then(function (chs) {
          if (!self._token) return;
          LNTV.player.stop();
          if (chs.length) LNTV.player.tuneByIndex(0);
          else { self.setChannel(null); LNTV.toast.show("Nenhum canal liberado para este usuário", 0); }
        }).catch(function () { LNTV.toast.show("Erro ao atualizar canais", 0); });
      }
      return j;
    });
  },

  _signout: function () {
    this.stop();
    LNTV.player.stop();
    LNTV.player._unlocked = {};
    LNTV.modal.close();
    LNTV.auth.logout();
    LNTV.app.showLogin();
  },

  setChannel: function (ch) {
    this._channel = ch;
    this._watching = !!ch;
    this.beat();
  },

  beat: function () {
    if (!this._token || this._starting || this._busy) return;
    var self = this;
    if (!self._id) {
      self.start().then(function (ok) {
        if (ok && !LNTV.player.current && LNTV.channels.list.length) LNTV.player.tuneByIndex(0);
      });
      return;
    }
    self._busy = true;
    LNTV.sb.fn("session-heartbeat", self._payload("heartbeat")).then(function (r) {
      if (r.status === 404) { self._id = null; return self.start(); }
      return self._read(r);
    }).catch(function () {}).then(function () { self._busy = false; });
  },

  stop: function () {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    if (this._id) LNTV.sb.fn("session-heartbeat", this._payload("end")).catch(function () {});
    this._token = null;
    this._id = null;
    this._channel = null;
    this._watching = false;
  }
};
