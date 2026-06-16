/* LN TV — heartbeat (session-heartbeat edge fn) */
window.LNTV = window.LNTV || {};

LNTV.hb = {
  _timer: null,
  _token: null,
  _channel: null,
  _watching: false,

  _payload: function (action) {
    return {
      action: action,
      sessionToken: this._token,
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
    self._token = self._uuid();
    LNTV.sb.fn("session-heartbeat", self._payload("start")).catch(function () {});
    if (self._timer) clearInterval(self._timer);
    self._timer = setInterval(function () { self.beat(); }, 30000);
  },

  setChannel: function (ch) {
    this._channel = ch;
    this._watching = !!ch;
    this.beat();
  },

  beat: function () {
    if (!this._token) return;
    var self = this;
    LNTV.sb.fn("session-heartbeat", self._payload("heartbeat")).then(function (r) {
      if (r && r.status === 404) { self.start(); }
    }).catch(function () {});
  },

  stop: function () {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    if (this._token) LNTV.sb.fn("session-heartbeat", this._payload("end")).catch(function () {});
    this._token = null;
  }
};
