/* LN TV — OSD, channel list, toast, num buffer */
window.LNTV = window.LNTV || {};

LNTV.osd = {
  _osdTimer: null,

  show: function (ch) {
    document.getElementById("osd-num").textContent = ch.channel_number != null ? ch.channel_number : "";
    document.getElementById("osd-name").textContent = ch.name || "";
    var img = document.getElementById("osd-logo");
    img.src = LNTV.logos.url(ch);
    img.onerror = function () { img.style.visibility = "hidden"; };
    img.onload = function () { img.style.visibility = "visible"; };
    document.getElementById("osd").classList.remove("hidden");

    document.getElementById("osd-now").textContent = "Carregando…";
    document.getElementById("osd-next").textContent = "Carregando…";
    if (ch.epg_channel_id) {
      LNTV.epg.nowNext(ch.epg_channel_id).then(function (r) {
        document.getElementById("osd-now").textContent = LNTV.epg.fmt(r.now);
        document.getElementById("osd-next").textContent = LNTV.epg.fmt(r.next);
      });
    } else {
      document.getElementById("osd-now").textContent = "—";
      document.getElementById("osd-next").textContent = "—";
    }

    if (this._osdTimer) clearTimeout(this._osdTimer);
    this._osdTimer = setTimeout(function () {
      document.getElementById("osd").classList.add("hidden");
    }, 4000);
  },

  hide: function () {
    document.getElementById("osd").classList.add("hidden");
    if (this._osdTimer) clearTimeout(this._osdTimer);
  }
};

LNTV.toast = {
  _t: null,
  show: function (msg, ms) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    if (this._t) clearTimeout(this._t);
    this._t = setTimeout(function () { el.classList.add("hidden"); }, ms || 2500);
  }
};

LNTV.numBuf = {
  _b: "",
  _t: null,
  push: function (digit, onCommit) {
    var self = this;
    self._b += digit;
    if (self._b.length > 4) self._b = self._b.substr(-4);
    var el = document.getElementById("num-buffer");
    el.textContent = self._b;
    el.classList.remove("hidden");
    if (self._t) clearTimeout(self._t);
    self._t = setTimeout(function () { self.commit(onCommit); }, 2000);
  },
  commit: function (onCommit) {
    if (!this._b) return;
    var n = parseInt(this._b, 10);
    this._b = "";
    document.getElementById("num-buffer").classList.add("hidden");
    if (this._t) { clearTimeout(this._t); this._t = null; }
    if (!isNaN(n) && onCommit) onCommit(n);
  },
  hasPending: function () { return this._b.length > 0; }
};

LNTV.list = {
  _open: false,
  _focused: 0,

  open: function (currentIndex) {
    this._open = true;
    this._focused = currentIndex || 0;
    var ul = document.getElementById("cl-ul");
    ul.innerHTML = "";
    var chs = LNTV.channels.list;
    for (var i = 0; i < chs.length; i++) {
      var ch = chs[i];
      var li = document.createElement("li");
      li.setAttribute("data-idx", i);
      var fav = LNTV.channels.isFavorite(ch.id) ? "★ " : "";
      li.innerHTML = '<span class="num">' + (ch.channel_number != null ? ch.channel_number : "") + '</span>'
                   + '<img src="' + LNTV.logos.url(ch) + '" onerror="this.style.visibility=\'hidden\'">'
                   + '<span>' + fav + (ch.name || "") + '</span>';
      ul.appendChild(li);
    }
    this._setFocus(this._focused);
    document.getElementById("channel-list").classList.remove("hidden");
  },

  close: function () {
    this._open = false;
    document.getElementById("channel-list").classList.add("hidden");
  },

  isOpen: function () { return this._open; },

  move: function (delta) {
    var max = LNTV.channels.list.length - 1;
    var n = this._focused + delta;
    if (n < 0) n = 0;
    if (n > max) n = max;
    this._setFocus(n);
  },

  selected: function () { return this._focused; },

  _setFocus: function (i) {
    this._focused = i;
    var ul = document.getElementById("cl-ul");
    var lis = ul.getElementsByTagName("li");
    for (var k = 0; k < lis.length; k++) lis[k].classList.remove("focused");
    var el = lis[i];
    if (el) { el.classList.add("focused"); el.scrollIntoView({ block: "nearest" }); }
  }
};
