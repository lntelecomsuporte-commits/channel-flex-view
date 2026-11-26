/* LN TV — EPG (JSON pré-processado) */
window.LNTV = window.LNTV || {};

LNTV.epg = {
  _cache: null,
  _expiresAt: 0,
  _ttl: 60 * 60 * 1000,
  _pending: null,

  // Lê o JSON pré-processado pelo servidor (sem DOMParser, que travava a TV).
  load: function () {
    var self = this;
    if (self._cache && Date.now() < self._expiresAt) return Promise.resolve(self._cache);
    if (self._pending) return self._pending;
    self._pending = fetch(LNTV.EPG_URL).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var src = (data && data.byChannel) || {};
        var byChan = {};
        for (var ch in src) {
          if (!src.hasOwnProperty(ch)) continue;
          var arr = src[ch] || [], out = [];
          for (var i = 0; i < arr.length; i++) {
            var st = Date.parse(arr[i].start_date);
            if (!isNaN(st)) out.push({ start: st, title: arr[i].title || "" });
          }
          out.sort(function (x, y) { return x.start - y.start; });
          for (var j = 0; j < out.length; j++) out[j].stop = out[j + 1] ? out[j + 1].start : out[j].start + 2 * 3600000;
          byChan[ch] = out;
        }
        self._cache = byChan;
        self._expiresAt = Date.now() + (data ? self._ttl : 60000);
        self._pending = null;
        return byChan;
      }).catch(function () {
        self._pending = null;
        self._cache = self._cache || {};
        self._expiresAt = Date.now() + 60000;
        return self._cache;
      });
    return self._pending;
  },

  // "20260616120000 +0000" → ms
  _parse: function (s) {
    if (!s) return 0;
    var m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/);
    if (!m) return 0;
    var iso = m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":" + m[6] + (m[7] ? (m[7].slice(0,3) + ":" + m[7].slice(3)) : "Z");
    var d = new Date(iso);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  },

  nowNext: function (epgChannelId) {
    var self = this;
    return self.load().then(function (byChan) {
      var list = byChan[epgChannelId] || [];
      var now = Date.now();
      var cur = null, nxt = null;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (p.start <= now && p.stop > now) { cur = p; nxt = list[i + 1] || null; break; }
        if (p.start > now && !nxt) { nxt = p; }
      }
      return { now: cur, next: nxt };
    });
  },

  fmt: function (p) {
    if (!p) return "—";
    var d = new Date(p.start);
    var hh = ("0" + d.getHours()).slice(-2);
    var mm = ("0" + d.getMinutes()).slice(-2);
    return hh + ":" + mm + "  " + (p.title || "Sem informação");
  }
};
