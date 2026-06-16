/* LN TV — device pairing & login */
window.LNTV = window.LNTV || {};

LNTV.auth = {
  _payload: function () {
    return {
      device_id: LNTV.device.id(),
      platform: LNTV.PLATFORM,
      device_name: LNTV.device.name(),
      app_version: LNTV.APP_VERSION
    };
  },

  announce: function () {
    return fetch(LNTV.FN_URL + "/device-announce", {
      method: "POST",
      headers: { "apikey": LNTV.ANON_KEY, "Authorization": "Bearer " + LNTV.ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(this._payload())
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return !!(j && j.registered); })
      .catch(function () { return false; });
  },

  autoLogin: function () {
    return fetch(LNTV.FN_URL + "/device-auto-login", {
      method: "POST",
      headers: { "apikey": LNTV.ANON_KEY, "Authorization": "Bearer " + LNTV.ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(this._payload())
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.access_token) return false;
        LNTV.session.save(j.access_token, j.refresh_token, j.user && j.user.id, j.expires_in);
        return true;
      }).catch(function () { return false; });
  },

  _cpfToEmail: function (login) {
    var raw = (login || "").trim().toLowerCase();
    if (raw.indexOf("@") >= 0) return raw;
    var digits = raw.replace(/\D/g, "");
    if (digits.length === 11 || digits.length === 14) return digits + "@tvln.local";
    return raw;
  },

  manualLogin: function (login, password) {
    var self = this;
    var email = this._cpfToEmail(login);
    var payload = Object.assign({}, this._payload(), { email: email, password: password });
    return fetch(LNTV.FN_URL + "/device-login", {
      method: "POST",
      headers: { "apikey": LNTV.ANON_KEY, "Authorization": "Bearer " + LNTV.ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j && res.j.access_token) {
          LNTV.session.save(res.j.access_token, res.j.refresh_token, res.j.user && res.j.user.id, res.j.expires_in);
          return { ok: true };
        }
        // fallback: device-auto-login (caso o backend já tenha vinculado)
        return self.autoLogin().then(function (ok) {
          if (ok) return { ok: true };
          // fallback final: senha direta via Auth
          return fetch(LNTV.AUTH_URL + "/token?grant_type=password", {
            method: "POST",
            headers: { "apikey": LNTV.ANON_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ email: email, password: password })
          }).then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
              if (j && j.access_token) {
                LNTV.session.save(j.access_token, j.refresh_token, j.user && j.user.id, j.expires_in);
                return { ok: true };
              }
              return { ok: false, error: (res.j && res.j.error) || "Credenciais inválidas" };
            });
        });
      }).catch(function (e) { return { ok: false, error: e.message || "Erro de rede" }; });
  },

  logout: function () { LNTV.session.clear(); }
};
