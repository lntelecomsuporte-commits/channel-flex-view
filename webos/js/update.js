/* LN TV — update check (version-webos.json) */
window.LNTV = window.LNTV || {};

LNTV.update = {
  check: function () {
    return fetch(LNTV.VERSION_URL, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return;
        var remote = parseInt(j.webosVersionCode || 0, 10);
        var remoteName = (j.webosVersionName || "").replace(/^v/, "");
        if (remoteName && remoteName === LNTV.APP_VERSION) return;
        if (remote && remote <= LNTV.APP_VERSION_CODE) return;
        if (!j.webosVersionName) return;
        LNTV.toast.show("Nova versão disponível: " + j.webosVersionName, 4000);
      }).catch(function () {});
  }
};
