/* LN TV — update check (version-tizen.json + tizen.package.install) */
window.LNTV = window.LNTV || {};

LNTV.update = {
  check: function () {
    var self = this;
    return fetch(LNTV.VERSION_URL, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return;
        var remote = parseInt(j.tizenVersionCode || 0, 10);
        var remoteName = (j.tizenVersionName || "").replace(/^v/, "");
        var localName = LNTV.APP_VERSION;
        if (remoteName && remoteName === localName) return;          // mesma versão
        if (remote && remote <= LNTV.APP_VERSION_CODE) return;       // já igual ou maior
        if (!j.tizenUrl) return;
        LNTV.toast.show("Nova versão disponível: " + (j.tizenVersionName || ""), 4000);
        self._download(j.tizenUrl);
      }).catch(function () {});
  },

  _download: function (url) {
    try {
      if (typeof tizen === "undefined" || !tizen.download) return;
      var req = new tizen.DownloadRequest(url, "wgt", "lntv-tizen-update.wgt");
      tizen.download.start(req, {
        oncompleted: function (id, path) {
          try {
            tizen.package.install(path, {
              onprogress: function () {},
              oncomplete: function () { LNTV.toast.show("Atualização concluída — abra o app novamente"); },
              onerror: function (e) { LNTV.toast.show("Falha ao instalar: " + (e.message || "")); }
            });
          } catch (e) { LNTV.toast.show("Update install indisponível"); }
        },
        onfailed: function () { LNTV.toast.show("Falha no download da atualização"); }
      });
    } catch (e) { /* ignore */ }
  }
};
