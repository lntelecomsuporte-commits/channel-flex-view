/* LN TV — AVPlay + HTML5 fallback + tracks + retry */
window.LNTV = window.LNTV || {};

LNTV.player = {
  index: 0,
  current: null,
  _retries: 0,
  _retryT: null,
  _stallT: null,
  _previewIdx: -1,
  _previewT: null,
  _backendInUse: "avplay",
  _audioIdx: -1,
  _subIdx: -2,    // -2 = inicial, -1 = desligado, 0..N = faixa
  _statsCache: { state:"idle", width:0, height:0, bitrate:0, vcodec:"", acodec:"", buffer:0, channelName:"", channelNum:"" },

  init: function () {
    // configura listener AVPlay no primeiro tune
  },

  /* ---------------- Public tune API ---------------- */

  tuneByIndex: function (idx) {
    if (idx < 0 || idx >= LNTV.channels.list.length) return;
    this.index = idx;
    this.current = LNTV.channels.list[idx];
    this._retries = 0;
    this._play();
    LNTV.osd.show(this.current);
    LNTV.hb.setChannel(this.current);
    this._statsCache.channelName = this.current.name || "";
    this._statsCache.channelNum = this.current.channel_number;
  },

  tuneByNumber: function (n) {
    var i = LNTV.channels.findByNumber(n);
    if (i >= 0) this.tuneByIndex(i);
    else LNTV.toast.show("Canal " + n + " não encontrado");
  },

  step: function (delta) {
    var next = this.index + delta;
    var max = LNTV.channels.list.length - 1;
    if (next < 0) next = max;
    if (next > max) next = 0;
    this.tuneByIndex(next);
  },

  /* Preview canal (← / →): mostra OSD do canal seguinte, sintoniza após 1500ms */
  preview: function (delta) {
    var max = LNTV.channels.list.length - 1;
    if (this._previewIdx < 0) this._previewIdx = this.index;
    this._previewIdx += delta;
    if (this._previewIdx < 0) this._previewIdx = max;
    if (this._previewIdx > max) this._previewIdx = 0;
    var ch = LNTV.channels.list[this._previewIdx];
    LNTV.osd.show(ch);
    if (this._previewT) clearTimeout(this._previewT);
    var self = this;
    this._previewT = setTimeout(function () { self.commitPreview(); }, 1500);
  },

  commitPreview: function () {
    if (this._previewIdx < 0) return;
    var idx = this._previewIdx;
    this._previewIdx = -1;
    if (this._previewT) { clearTimeout(this._previewT); this._previewT = null; }
    if (idx !== this.index) this.tuneByIndex(idx);
  },

  hasPreviewPending: function () { return this._previewIdx >= 0; },

  /* ---------------- Playback ---------------- */

  _resolveUrl: function (ch) {
    var url = ch.stream_url || "";
    if (!url) return "";
    if (ch.force_proxy_native) {
      var tok = LNTV.session.accessToken();
      return LNTV.FN_URL + "/hls-proxy?url=" + encodeURIComponent(url) + (tok ? "&token=" + encodeURIComponent(tok) : "");
    }
    return url;
  },

  _useAvplay: function () { return typeof webapis !== "undefined" && webapis.avplay; },

  _play: function () {
    var ch = this.current;
    var url = this._resolveUrl(ch);
    if (!url) { LNTV.toast.show("Canal sem URL"); return; }
    this._statsCache.state = "loading";

    if (this._useAvplay()) {
      this._playAvplay(url, ch);
    } else {
      this._playHtml(url, ch);
    }
  },

  _playAvplay: function (url, ch) {
    this._backendInUse = "avplay";
    document.getElementById("avplay").classList.remove("hidden");
    document.getElementById("htmlplayer").classList.add("hidden");
    var self = this;
    try {
      try { webapis.avplay.stop(); } catch (e) {}
      try { webapis.avplay.close(); } catch (e) {}
      webapis.avplay.open(url);
      webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
      webapis.avplay.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX");
      webapis.avplay.setListener({
        onbufferingstart: function () { self._statsCache.state = "buffering"; self._armStall(); },
        onbufferingprogress: function (p) { self._statsCache.buffer = p; },
        onbufferingcomplete: function () { self._statsCache.state = "playing"; self._clearStall(); self._retries = 0; },
        oncurrentplaytime: function () { self._statsCache.state = "playing"; },
        onevent: function () {},
        onerror: function (e) { self._onError(e); },
        onstreamcompleted: function () { /* livestream end */ },
        ondrmevent: function () {},
        onsubtitlechange: function () {}
      });
      webapis.avplay.prepareAsync(function () {
        self._loadTracks();
        try { webapis.avplay.play(); } catch (e) { self._onError(e); }
      }, function (e) { self._onError(e); });
    } catch (e) { self._onError(e); }
  },

  _playHtml: function (url, ch) {
    this._backendInUse = "html5";
    var v = document.getElementById("htmlplayer");
    var av = document.getElementById("avplay");
    av.classList.add("hidden");
    v.classList.remove("hidden");
    v.src = url;
    v.play().catch(function () {});
    var self = this;
    v.onerror = function () { self._onError("html5-error"); };
    v.oncanplay = function () { self._statsCache.state = "playing"; };
  },

  _loadTracks: function () {
    try {
      var tracks = webapis.avplay.getTotalTrackInfo() || [];
      this._tracks = tracks;
      var aIdx = -1, sIdx = -1;
      for (var i = 0; i < tracks.length; i++) {
        if (tracks[i].type === "AUDIO" && aIdx < 0) aIdx = i;
        if (tracks[i].type === "TEXT" && sIdx < 0) sIdx = i;
      }
      this._audioIdx = aIdx;
      this._subIdx = -1; // legenda começa desligada
      this._statsCache.vcodec = ""; this._statsCache.acodec = "";
      for (var k = 0; k < tracks.length; k++) {
        if (tracks[k].type === "VIDEO" && tracks[k].extra_info) this._statsCache.vcodec = String(tracks[k].extra_info);
        if (tracks[k].type === "AUDIO" && tracks[k].extra_info) this._statsCache.acodec = String(tracks[k].extra_info);
      }
    } catch (e) {}
  },

  cycleAudio: function () {
    if (!this._useAvplay()) { LNTV.toast.show("Sem múltiplos áudios"); return; }
    try {
      var tracks = (webapis.avplay.getTotalTrackInfo() || []).filter(function (t) { return t.type === "AUDIO"; });
      if (!tracks.length) { LNTV.toast.show("Áudio único"); return; }
      var pos = -1;
      for (var i = 0; i < tracks.length; i++) if (tracks[i].index === this._audioIdx) { pos = i; break; }
      pos = (pos + 1) % tracks.length;
      this._audioIdx = tracks[pos].index;
      webapis.avplay.setSelectTrack("AUDIO", this._audioIdx);
      var name = tracks[pos].extra_info ? JSON.stringify(tracks[pos].extra_info) : ("Faixa " + (pos + 1));
      LNTV.toast.show("Áudio: " + name);
    } catch (e) { LNTV.toast.show("Falha ao trocar áudio"); }
  },

  cycleSubtitle: function () {
    if (!this._useAvplay()) { LNTV.toast.show("Sem legendas"); return; }
    try {
      var tracks = (webapis.avplay.getTotalTrackInfo() || []).filter(function (t) { return t.type === "TEXT"; });
      if (!tracks.length) { LNTV.toast.show("Sem legendas disponíveis"); return; }
      // ciclo: off → 0 → 1 → ... → off
      this._subIdx++;
      if (this._subIdx >= tracks.length) this._subIdx = -1;
      if (this._subIdx < 0) {
        try { webapis.avplay.setSilentSubtitle(true); } catch (e) {}
        LNTV.toast.show("Legenda: desligada");
      } else {
        try { webapis.avplay.setSilentSubtitle(false); } catch (e) {}
        webapis.avplay.setSelectTrack("TEXT", tracks[this._subIdx].index);
        var name = tracks[this._subIdx].extra_info ? JSON.stringify(tracks[this._subIdx].extra_info) : ("Faixa " + (this._subIdx + 1));
        LNTV.toast.show("Legenda: " + name);
      }
    } catch (e) { LNTV.toast.show("Falha ao trocar legenda"); }
  },

  toggleFavorite: function () {
    if (!this.current) return;
    var self = this;
    LNTV.channels.toggleFavorite(this.current.id).then(function (added) {
      LNTV.toast.show(added ? "★ Favoritado" : "Removido dos favoritos");
    });
  },

  stop: function () {
    if (this._useAvplay()) {
      try { webapis.avplay.stop(); webapis.avplay.close(); } catch (e) {}
    } else {
      try { document.getElementById("htmlplayer").pause(); } catch (e) {}
    }
  },

  /* ---------------- Retry / Stall ---------------- */

  _onError: function () {
    var self = this;
    self._statsCache.state = "error";
    if (this._retries >= 6) {
      // sonda lenta a cada 30s
      this._retryT = setTimeout(function () { self._retries = 0; self._play(); }, 30000);
      return;
    }
    var delay = Math.min(8000, 1000 * Math.pow(2, this._retries));
    this._retries++;
    if (this._retryT) clearTimeout(this._retryT);
    this._retryT = setTimeout(function () { self._play(); }, delay);
  },

  _armStall: function () {
    var self = this;
    if (this._stallT) clearTimeout(this._stallT);
    this._stallT = setTimeout(function () { self._onError("stall"); }, 8000);
  },

  _clearStall: function () { if (this._stallT) { clearTimeout(this._stallT); this._stallT = null; } },

  /* ---------------- Stats ---------------- */
  info: function () {
    var s = this._statsCache;
    try {
      if (this._useAvplay()) {
        var info = webapis.avplay.getCurrentStreamInfo() || [];
        for (var i = 0; i < info.length; i++) {
          if (info[i].type === "VIDEO" && info[i].extra_info) {
            try {
              var x = typeof info[i].extra_info === "string" ? JSON.parse(info[i].extra_info) : info[i].extra_info;
              s.width = x.Width || x.width || s.width;
              s.height = x.Height || x.height || s.height;
              s.bitrate = x.Bit_rate || x.bitrate || s.bitrate;
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
    return s;
  }
};
