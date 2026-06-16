/* LN TV — voice (Web Speech API se disponível) + parser pt-BR */
window.LNTV = window.LNTV || {};

LNTV.voice = {
  _rec: null,
  _on: false,

  available: function () {
    return typeof window.webkitSpeechRecognition !== "undefined" || typeof window.SpeechRecognition !== "undefined";
  },

  start: function () {
    if (this._on) return;
    if (!this.available()) {
      LNTV.toast.show("Reconhecimento de voz indisponível nesta TV");
      return;
    }
    var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    var rec = new Rec();
    rec.lang = "pt-BR";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    var self = this;
    var ov = document.getElementById("voice");
    ov.classList.remove("hidden");
    document.getElementById("voice-status").textContent = "Ouvindo…";
    document.getElementById("voice-text").textContent = "";

    rec.onresult = function (ev) {
      var t = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      document.getElementById("voice-text").textContent = t;
      if (ev.results[ev.results.length - 1].isFinal) self._dispatch(t);
    };
    rec.onerror = function () { self.stop(); };
    rec.onend = function () { self.stop(); };
    this._rec = rec;
    this._on = true;
    try { rec.start(); } catch (e) { this.stop(); }
  },

  stop: function () {
    this._on = false;
    document.getElementById("voice").classList.add("hidden");
    if (this._rec) { try { this._rec.stop(); } catch (e) {} this._rec = null; }
  },

  _dispatch: function (text) {
    this.stop();
    var cmd = this.parse(text);
    if (!cmd) { LNTV.toast.show("Não entendi: " + text); return; }
    switch (cmd.type) {
      case "tuneNumber": LNTV.player.tuneByNumber(cmd.value); break;
      case "tuneName":   LNTV.player.tuneByIndex(cmd.value); break;
      case "audio":      LNTV.player.cycleAudio(); break;
      case "subtitle":   LNTV.player.cycleSubtitle(); break;
      case "shutdown":   LNTV.app.exit(); break;
    }
  },

  parse: function (raw) {
    var t = (raw || "").toLowerCase().trim().replace(/[^\wáéíóúâêôãõç0-9\s-]/gi, " ").replace(/\s+/g, " ").trim();
    if (!t) return null;
    if (/^(desligar|sair|fechar|apagar|encerrar)\b/.test(t)) return { type: "shutdown" };
    if (/\b(audio|áudio|som|sap|trilha)\b/.test(t)) return { type: "audio" };
    if (/\b(legenda|legendas|caption|cc|subtitulo|subtítulo)\b/.test(t)) return { type: "subtitle" };

    // "canal NN" ou só número
    var mNum = t.match(/(?:canal\s+)?(\d{1,4})\b/);
    if (mNum) return { type: "tuneNumber", value: parseInt(mNum[1], 10) };

    var numEx = this._wordsToNumber(t);
    if (numEx != null) return { type: "tuneNumber", value: numEx };

    // fuzzy match por nome
    var q = t.replace(/^(coloca|colocar|por|p[oõ]e|abrir|abre|ver|assistir|sintonizar|trocar para|ir para|canal)\s+/, "").trim();
    if (!q) return null;
    var idx = this._fuzzyChannel(q);
    if (idx >= 0) return { type: "tuneName", value: idx };
    return null;
  },

  _wordsToNumber: function (t) {
    var map = {
      "zero":0,"um":1,"uma":1,"dois":2,"duas":2,"tres":3,"três":3,"quatro":4,"cinco":5,
      "seis":6,"sete":7,"oito":8,"nove":9,"dez":10,"onze":11,"doze":12,"treze":13,
      "quatorze":14,"catorze":14,"quinze":15,"dezesseis":16,"dezessete":17,"dezoito":18,"dezenove":19,
      "vinte":20,"trinta":30,"quarenta":40,"cinquenta":50,"sessenta":60,"setenta":70,"oitenta":80,"noventa":90,"cem":100
    };
    var tokens = t.replace(/^canal\s+/, "").split(/\s+/).filter(Boolean);
    var total = 0, found = false;
    for (var i = 0; i < tokens.length; i++) {
      var w = tokens[i];
      if (map[w] != null) { total += map[w]; found = true; }
      else if (w === "e") continue;
      else if (found) break;
    }
    return found ? total : null;
  },

  _fuzzyChannel: function (q) {
    var chs = LNTV.channels.list;
    var best = -1, bestScore = 99;
    for (var i = 0; i < chs.length; i++) {
      var n = (chs[i].name || "").toLowerCase();
      if (!n) continue;
      if (n.indexOf(q) >= 0) return i;
      var d = this._lev(n, q);
      if (d < bestScore) { bestScore = d; best = i; }
    }
    return bestScore <= 2 ? best : -1;
  },

  _lev: function (a, b) {
    var m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    var v = []; for (var j = 0; j <= n; j++) v[j] = j;
    for (var i = 1; i <= m; i++) {
      var prev = i, tmp;
      for (var k = 1; k <= n; k++) {
        var cost = a.charAt(i-1) === b.charAt(k-1) ? 0 : 1;
        tmp = Math.min(v[k] + 1, prev + 1, v[k-1] + cost);
        v[k-1] = prev; prev = tmp;
      }
      v[n] = prev;
    }
    return v[n];
  }
};
