/* LN TV — player HTML5 (HLS nativo do webOS) + hls.js de reserva + faixas + retry */
window.LNTV = window.LNTV || {};

LNTV.player = {
  index: 0,
  current: null,
  _locked: false,
  _unlocked: {},
  _generation: 0,
  _retries: 0,
  _retryT: null,
  _stallT: null,
  _zapT: null,
  _previewIdx: -1,
  _previewT: null,
  _hls: null,
  _engine: "native",
  _preferHlsJs: {},     // canais em que o HLS nativo falhou e o hls.js funcionou
  _triedHlsJs: false,
  _subIdx: -1,
  _statsCache: { state:"idle", width:0, height:0, bitrate:0, vcodec:"", acodec:"", buffer:0, channelName:"", channelNum:"" },

  _video: function () { return document.getElementById("htmlplayer"); },

  /* ---------------- Public tune API ---------------- */

  tuneByIndex: function (idx, delayMs) {
    if (idx < 0 || idx >= LNTV.channels.list.length) return;
    if (this._zapT) { clearTimeout(this._zapT); this._zapT = null; }
    this.stop();
    this.index = idx;
    this.current = LNTV.channels.list[idx];
    this._locked = LNTV.channels.isRestricted(this.current) && !this._unlocked[this.current.id];
    document.getElementById("channel-lock").classList.toggle("hidden", !this._locked);
    this._retries = 0;
    this._triedHlsJs = false;
    LNTV.toast.hide();
    if (!this._locked) {
      if (delayMs) {
        var self = this, ch = this.current;
        this._zapT = setTimeout(function () { self._zapT = null; if (self.current === ch && !self._locked) self._play(); }, delayMs);
      } else this._play();
    }
    LNTV.osd.show(this.current);
    LNTV.hb.setChannel(this._locked ? null : this.current);
    this._statsCache.channelName = this.current.name || "";
    this._statsCache.channelNum = this.current.channel_number;
  },

  tuneByNumber: function (n) {
    var i = LNTV.channels.findByNumber(n);
    if (i >= 0) this.tuneByIndex(i);
    else LNTV.toast.show("Canal " + n + " não encontrado");
  },

  /* Canal adulto / categoria com PIN: só abre o pedido de PIN no OK; cancelar mantém o bloqueio. */
  unlock: function () {
    if (!this._locked || !this.current) return;
    var self = this;
    var channelId = this.current.id;
    var uid = LNTV.session.userId();
    if (!uid) return;
    LNTV.sb.get("profiles?user_id=eq." + uid + "&select=adult_pin").then(function (rows) {
      if (!self._locked || !self.current || self.current.id !== channelId) return;
      var pin = rows[0] && rows[0].adult_pin;
      if (!/^\d{4}$/.test(pin || "")) { LNTV.toast.show("Configure o PIN no menu"); return; }
      LNTV.modal.prompt("Canal protegido", "Digite o PIN de 4 dígitos:", "pin", function (value) {
        if (!self.current || self.current.id !== channelId) return;
        if (value !== pin) { LNTV.toast.show("PIN incorreto"); return; }
        self._unlocked[channelId] = true;
        self.tuneByIndex(self.index);
      });
    });
  },

  step: function (delta) {
    if (!LNTV.channels.list.length) return;
    var next = this.index + delta;
    var max = LNTV.channels.list.length - 1;
    if (next < 0) next = max;
    if (next > max) next = 0;
    this.tuneByIndex(next, 300);
  },

  preview: function (delta) {
    if (!LNTV.channels.list.length) return;
    var max = LNTV.channels.list.length - 1;
    if (this._previewIdx < 0) this._previewIdx = this.index;
    this._previewIdx += delta;
    if (this._previewIdx < 0) this._previewIdx = max;
    if (this._previewIdx > max) this._previewIdx = 0;
    LNTV.osd.show(LNTV.channels.list[this._previewIdx]);
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

  _isHls: function (ch, url) {
    return ch.stream_format === "hls" || /\.m3u8(\?|$)/i.test(url) || /hls-proxy/.test(url);
  },

  _canUseHlsJs: function () {
    return typeof Hls !== "undefined" && Hls.isSupported && Hls.isSupported();
  },

  _play: function () {
    var ch = this.current;
    if (!ch || this._locked) return;
    var url = this._resolveUrl(ch);
    if (!url) { LNTV.toast.show("Canal sem URL", 0); return; }
    this._statsCache.state = "loading";
    LNTV.toast.show("Carregando canal…", 0);
    this._armStall();
    if (this._preferHlsJs[ch.id] && this._isHls(ch, url) && this._canUseHlsJs()) this._playHlsJs(url);
    else this._playNative(url);
  },

  _bindVideo: function (v, generation) {
    var self = this;
    v.onplaying = function () { if (generation === self._generation) self._onPlaying(); };
    v.ontimeupdate = function () { if (generation === self._generation && v.currentTime > 0) self._onPlaying(); };
    v.onwaiting = function () { if (generation === self._generation) { self._statsCache.state = "buffering"; self._armStall(); } };
    v.onended = function () { if (generation === self._generation) self._onError("fim do stream"); };
  },

  _startVideo: function (v, generation) {
    var self = this;
    var p = v.play();
    if (p && p.catch) {
      p.catch(function (err) {
        if (generation !== self._generation) return;
        // Se a TV bloquear áudio automático, toca sem som; a próxima tecla devolve o áudio.
        if (err && err.name === "NotAllowedError" && !v.muted) {
          v.muted = true;
          v.play().catch(function () {});
          LNTV.toast.show("Pressione qualquer tecla para ativar o som", 4000);
        } else if (err && err.name !== "AbortError") self._onError(err);
      });
    }
  },

  _playNative: function (url) {
    this._engine = "native";
    var v = this._video();
    var generation = this._generation;
    var self = this;
    this._bindVideo(v, generation);
    v.onerror = function () {
      if (generation !== self._generation) return;
      var ch = self.current;
      // HLS nativo falhou: tenta o hls.js uma vez antes de contar como erro.
      if (ch && !self._triedHlsJs && self._isHls(ch, url) && self._canUseHlsJs()) {
        self._triedHlsJs = true;
        self._detach();
        self._playHlsJs(url);
        return;
      }
      self._onError("formato não suportado");
    };
    v.src = url;
    this._startVideo(v, generation);
  },

  _playHlsJs: function (url) {
    this._engine = "hls.js";
    var v = this._video();
    var generation = this._generation;
    var self = this;
    var chId = this.current && this.current.id;
    this._bindVideo(v, generation);
    v.onerror = null;
    var hls = new Hls({ startLevel: 0, maxBufferLength: 6, lowLatencyMode: true, enableWorker: true });
    this._hls = hls;
    hls.on(Hls.Events.MANIFEST_PARSED, function () {
      if (generation !== self._generation) return;
      if (chId) self._preferHlsJs[chId] = true;
      self._startVideo(v, generation);
    });
    hls.on(Hls.Events.ERROR, function (_e, data) {
      if (generation !== self._generation || !data || !data.fatal) return;
      self._onError("hls.js " + (data.details || data.type || ""));
    });
    hls.loadSource(url);
    hls.attachMedia(v);
  },

  /* ---------------- Tracks ---------------- */

  cycleAudio: function () {
    try {
      if (this._hls) {
        var ht = this._hls.audioTracks || [];
        if (ht.length < 2) { LNTV.toast.show("Áudio único"); return; }
        var next = (this._hls.audioTrack + 1) % ht.length;
        this._hls.audioTrack = next;
        LNTV.toast.show("Áudio: " + (ht[next].name || ht[next].lang || ("Faixa " + (next + 1))));
        return;
      }
      var at = this._video().audioTracks;
      if (!at || at.length < 2) { LNTV.toast.show("Áudio único"); return; }
      var cur = 0;
      for (var i = 0; i < at.length; i++) if (at[i].enabled) { cur = i; break; }
      var n = (cur + 1) % at.length;
      for (var k = 0; k < at.length; k++) at[k].enabled = (k === n);
      LNTV.toast.show("Áudio: " + (at[n].label || at[n].language || ("Faixa " + (n + 1))));
    } catch (e) { LNTV.toast.show("Falha ao trocar áudio"); }
  },

  cycleSubtitle: function () {
    try {
      if (this._hls) {
        var st = this._hls.subtitleTracks || [];
        if (!st.length) { LNTV.toast.show("Sem legendas disponíveis"); return; }
        var nx = this._hls.subtitleTrack + 1;
        if (nx >= st.length) nx = -1;
        this._hls.subtitleTrack = nx;
        this._hls.subtitleDisplay = nx >= 0;
        LNTV.toast.show(nx < 0 ? "Legenda: desligada" : "Legenda: " + (st[nx].name || st[nx].lang || ("Faixa " + (nx + 1))));
        return;
      }
      var tt = this._video().textTracks;
      if (!tt || !tt.length) { LNTV.toast.show("Sem legendas disponíveis"); return; }
      this._subIdx++;
      if (this._subIdx >= tt.length) this._subIdx = -1;
      for (var i = 0; i < tt.length; i++) tt[i].mode = (i === this._subIdx) ? "showing" : "disabled";
      var t = tt[this._subIdx];
      LNTV.toast.show(this._subIdx < 0 ? "Legenda: desligada" : "Legenda: " + (t.label || t.language || ("Faixa " + (this._subIdx + 1))));
    } catch (e) { LNTV.toast.show("Falha ao trocar legenda"); }
  },

  toggleFavorite: function () {
    if (!this.current) return;
    LNTV.channels.toggleFavorite(this.current.id).then(function (added) {
      LNTV.toast.show(added ? "★ Favoritado" : "Removido dos favoritos");
    });
  },

  unmute: function () {
    var v = this._video();
    if (v && v.muted) v.muted = false;
  },

  _detach: function () {
    if (this._hls) { try { this._hls.destroy(); } catch (e) {} this._hls = null; }
    try {
      var v = this._video();
      v.onerror = null; v.onplaying = null; v.ontimeupdate = null; v.onwaiting = null; v.onended = null;
      v.pause(); v.removeAttribute("src"); v.load();
    } catch (e) {}
  },

  stop: function () {
    this._generation++;
    if (this._retryT) clearTimeout(this._retryT);
    this._retryT = null;
    this._clearStall();
    if (this._previewT) clearTimeout(this._previewT);
    this._previewT = null;
    this._previewIdx = -1;
    this._subIdx = -1;
    this._detach();
  },

  /* ---------------- Retry / Stall ---------------- */

  _onPlaying: function () {
    if (this._locked) return;
    if (this._statsCache.state !== "playing") LNTV.toast.hide();
    this._statsCache.state = "playing";
    this._retries = 0;
    this._clearStall();
    if (this._retryT) clearTimeout(this._retryT);
    this._retryT = null;
  },

  _onError: function (e) {
    if (this._locked) return;
    var self = this;
    self._clearStall();
    if (self._retryT) clearTimeout(self._retryT);
    self._statsCache.state = "error";
    var why = "";
    try { why = typeof e === "string" ? e : (e && (e.name || e.message || e.type)) || ""; } catch (x) {}
    LNTV.toast.show("Não foi possível reproduzir este canal" + (why ? " (" + why + ")" : "") + ". Tentando novamente…", 0);
    var gen = ++self._generation;
    self._detach();
    if (self._retries >= 6) {
      self._retryT = setTimeout(function () { if (gen === self._generation) { self._retries = 0; self._play(); } }, 30000);
      return;
    }
    var delay = Math.min(8000, 1000 * Math.pow(2, self._retries));
    self._retries++;
    self._retryT = setTimeout(function () { if (gen === self._generation) self._play(); }, delay);
  },

  _armStall: function () {
    var self = this;
    var gen = self._generation;
    if (this._stallT) clearTimeout(this._stallT);
    this._stallT = setTimeout(function () { if (gen === self._generation) self._onError("sem sinal"); }, 10000);
  },

  _clearStall: function () { if (this._stallT) { clearTimeout(this._stallT); this._stallT = null; } },

  /* ---------------- Stats ---------------- */
  info: function () {
    var s = this._statsCache;
    try {
      var v = this._video();
      s.width = v.videoWidth || 0;
      s.height = v.videoHeight || 0;
      if (v.buffered && v.buffered.length) s.buffer = Math.max(0, Math.round((v.buffered.end(v.buffered.length - 1) - v.currentTime) * 10) / 10);
      if (this._hls && this._hls.levels && this._hls.currentLevel >= 0) {
        var lvl = this._hls.levels[this._hls.currentLevel];
        s.bitrate = lvl ? lvl.bitrate : s.bitrate;
        s.vcodec = (lvl && lvl.videoCodec) || s.vcodec;
        s.acodec = (lvl && lvl.audioCodec) || s.acodec;
      }
    } catch (e) {}
    s.engine = this._engine;
    return s;
  }
};
