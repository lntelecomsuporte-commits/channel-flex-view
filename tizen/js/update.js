/* LN TV — update check (version-tizen.json) */
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
      }).catch(function () {});
  }
};
