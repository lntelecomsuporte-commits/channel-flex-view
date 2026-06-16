/* LN TV — EPG (XMLTV parser) */
window.LNTV = window.LNTV || {};

LNTV.epg = {
  _cache: null,
  _expiresAt: 0,
  _ttl: 10 * 60 * 1000,

  load: function () {
    var self = this;
    if (self._cache && Date.now() < self._expiresAt) return Promise.resolve(self._cache);
    return fetch(LNTV.EPG_URL).then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (xml) {
        var byChan = {};
        if (!xml) { self._cache = byChan; self._expiresAt = Date.now() + 60000; return byChan; }
        try {
          var doc = new DOMParser().parseFromString(xml, "text/xml");
          var progs = doc.getElementsByTagName("programme");
          for (var i = 0; i < progs.length; i++) {
            var p = progs[i];
            var ch = p.getAttribute("channel") || "";
            var start = self._parse(p.getAttribute("start"));
            var stop = self._parse(p.getAttribute("stop"));
            var title = "";
            var t = p.getElementsByTagName("title")[0];
            if (t) title = (t.textContent || "").trim();
            if (!ch || !start || !stop) continue;
            if (!byChan[ch]) byChan[ch] = [];
            byChan[ch].push({ start: start, stop: stop, title: title });
          }
        } catch (e) {}
        self._cache = byChan;
        self._expiresAt = Date.now() + self._ttl;
        return byChan;
      }).catch(function () { return {}; });
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
