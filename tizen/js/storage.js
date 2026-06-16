/* LN TV — storage wrapper */
window.LNTV = window.LNTV || {};
LNTV.store = {
  _k: function (k) { return "lntv." + k; },
  get: function (k) { try { return localStorage.getItem(this._k(k)); } catch (e) { return null; } },
  set: function (k, v) { try { localStorage.setItem(this._k(k), v); } catch (e) {} },
  del: function (k) { try { localStorage.removeItem(this._k(k)); } catch (e) {} },
  getJSON: function (k) { var v = this.get(k); if (!v) return null; try { return JSON.parse(v); } catch (e) { return null; } },
  setJSON: function (k, v) { this.set(k, JSON.stringify(v)); }
};

LNTV.session = {
  save: function (accessToken, refreshToken, userId, expiresIn) {
    LNTV.store.set("access_token", accessToken || "");
    if (refreshToken) LNTV.store.set("refresh_token", refreshToken);
    if (userId) LNTV.store.set("user_id", userId);
    var exp = Date.now() + ((expiresIn || 3600) * 1000);
    LNTV.store.set("expires_at", String(exp));
  },
  clear: function () {
    LNTV.store.del("access_token");
    LNTV.store.del("refresh_token");
    LNTV.store.del("user_id");
    LNTV.store.del("expires_at");
  },
  accessToken: function () { return LNTV.store.get("access_token"); },
  refreshToken: function () { return LNTV.store.get("refresh_token"); },
  userId: function () { return LNTV.store.get("user_id"); },
  expiresAt: function () { return parseInt(LNTV.store.get("expires_at") || "0", 10); }
};
