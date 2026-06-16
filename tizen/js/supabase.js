/* LN TV — Supabase REST/Auth via fetch */
window.LNTV = window.LNTV || {};

LNTV.sb = {
  _headers: function (auth) {
    var h = { "apikey": LNTV.ANON_KEY, "Content-Type": "application/json" };
    if (auth) {
      var tok = LNTV.session.accessToken();
      h["Authorization"] = "Bearer " + (tok || LNTV.ANON_KEY);
    }
    return h;
  },

  ensureFresh: function () {
    var exp = LNTV.session.expiresAt();
    if (!exp || !LNTV.session.accessToken()) return Promise.resolve();
    if (Date.now() < exp - 60000) return Promise.resolve();
    var rt = LNTV.session.refreshToken();
    if (!rt) return Promise.resolve();
    return fetch(LNTV.AUTH_URL + "/token?grant_type=refresh_token", {
      method: "POST",
      headers: { "apikey": LNTV.ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt })
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.access_token) { LNTV.session.clear(); return; }
        LNTV.session.save(j.access_token, j.refresh_token, (j.user && j.user.id) || LNTV.session.userId(), j.expires_in);
      }).catch(function () {});
  },

  get: function (path) {
    var self = this;
    return self.ensureFresh().then(function () {
      return fetch(LNTV.REST_URL + "/" + path, { headers: self._headers(true) })
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; });
    });
  },

  post: function (table, row, prefer) {
    var self = this;
    return self.ensureFresh().then(function () {
      var h = self._headers(true);
      if (prefer) h["Prefer"] = prefer;
      return fetch(LNTV.REST_URL + "/" + table, {
        method: "POST", headers: h, body: JSON.stringify(row)
      }).then(function (r) { return r.ok; });
    });
  },

  patch: function (path, row) {
    var self = this;
    return self.ensureFresh().then(function () {
      return fetch(LNTV.REST_URL + "/" + path, {
        method: "PATCH", headers: self._headers(true), body: JSON.stringify(row)
      }).then(function (r) { return r.ok; });
    });
  },

  del: function (path) {
    var self = this;
    return self.ensureFresh().then(function () {
      return fetch(LNTV.REST_URL + "/" + path, {
        method: "DELETE", headers: self._headers(true)
      }).then(function (r) { return r.ok; });
    });
  },

  fn: function (name, body) {
    var self = this;
    return self.ensureFresh().then(function () {
      return fetch(LNTV.FN_URL + "/" + name, {
        method: "POST", headers: self._headers(true), body: JSON.stringify(body || {})
      });
    });
  },

  /** AUTH: change password */
  updatePassword: function (newPassword) {
    var tok = LNTV.session.accessToken();
    return fetch(LNTV.AUTH_URL + "/user", {
      method: "PUT",
      headers: { "apikey": LNTV.ANON_KEY, "Authorization": "Bearer " + tok, "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword })
    }).then(function (r) { return r.ok; });
  }
};
