/* LN TV — device id + name */
window.LNTV = window.LNTV || {};

LNTV.device = {
  id: function () {
    var cached = LNTV.store.get("device_id");
    if (cached) return cached;
    var id = "";
    try {
      if (typeof webapis !== "undefined" && webapis.productinfo && webapis.productinfo.getDuid) {
        id = webapis.productinfo.getDuid() || "";
      }
    } catch (e) {}
    if (!id) {
      // fallback: gera estável e persiste
      var arr = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(arr);
      id = Array.prototype.map.call(arr, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    }
    id = (id + "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    LNTV.store.set("device_id", id);
    return id;
  },

  prettyId: function () {
    var id = this.id();
    var out = [];
    for (var i = 0; i < id.length; i += 4) out.push(id.substr(i, 4));
    return out.slice(0, 4).join("-");
  },

  name: function () {
    try {
      if (typeof webapis !== "undefined" && webapis.productinfo) {
        var model = webapis.productinfo.getModel ? webapis.productinfo.getModel() : "";
        return "Samsung " + (model || "TV") + " (Tizen)";
      }
    } catch (e) {}
    return "Samsung TV (Tizen)";
  }
};
