/* LN TV — device id + name (LG webOS) */
window.LNTV = window.LNTV || {};

LNTV.device = {
  // 16 caracteres: o código exibido na TV é o identificador completo,
  // então o cadastro manual no painel usa exatamente o que o técnico lê na tela.
  ID_LENGTH: 16,
  _bridge: null,

  _clean: function (raw) {
    return String(raw || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().substr(0, this.ID_LENGTH);
  },

  _random: function () {
    var arr = new Uint8Array(8);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    return Array.prototype.map.call(arr, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("").toUpperCase();
  },

  _save: function (raw) {
    var id = this._clean(raw);
    if (id.length < this.ID_LENGTH) id = this._random();
    LNTV.store.set("device_id", id);
    return id;
  },

  /* Lê o LGUDID pelo serviço do sistema; se a TV não responder, gera um ID estável. */
  init: function () {
    var self = this;
    if (LNTV.store.get("device_id")) return Promise.resolve(self.id());
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (raw) {
        if (done) return;
        done = true;
        resolve(self._save(raw));
      };
      try {
        if (typeof PalmServiceBridge === "undefined") { finish(""); return; }
        var bridge = new PalmServiceBridge();
        self._bridge = bridge;
        bridge.onservicecallback = function (msg) {
          var value = "";
          try {
            var j = typeof msg === "string" ? JSON.parse(msg) : msg;
            var ids = (j && j.idList) || [];
            for (var i = 0; i < ids.length; i++) if (ids[i].idType === "LGUDID" && ids[i].idValue) { value = ids[i].idValue; break; }
          } catch (e) {}
          finish(value);
        };
        bridge.call("luna://com.webos.service.sm/deviceid/getIDs", JSON.stringify({ idType: ["LGUDID"] }));
      } catch (e) { finish(""); }
      setTimeout(function () { finish(""); }, 3000);
    });
  },

  id: function () {
    var cached = LNTV.store.get("device_id");
    if (cached) return cached;
    return this._save("");
  },

  prettyId: function () {
    var id = this.id();
    var out = [];
    for (var i = 0; i < id.length; i += 4) out.push(id.substr(i, 4));
    return out.join("-");
  },

  info: function () {
    try {
      if (window.PalmSystem && window.PalmSystem.deviceInfo) {
        var info = window.PalmSystem.deviceInfo;
        return typeof info === "string" ? JSON.parse(info) : info;
      }
    } catch (e) {}
    return {};
  },

  model: function () { return this.info().modelName || "TV"; },

  osVersion: function () {
    var i = this.info();
    return i.platformVersion || i.sdkVersion || "";
  },

  name: function () {
    var model = this.info().modelName;
    return "LG " + (model || "TV") + " (webOS)";
  }
};
