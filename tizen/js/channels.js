/* LN TV — channels + favorites */
window.LNTV = window.LNTV || {};

LNTV.channels = {
  list: [],
  favorites: {},

  load: function () {
    var self = this;
    // 1. categorias autorizadas
    return LNTV.sb.get("user_category_access?select=category_id&is_active=eq.true")
      .then(function (rows) {
        var directIds = (rows || []).map(function (r) { return r.category_id; });
        if (!directIds.length) return [];
        // 2. category_includes — pega derivadas
        return LNTV.sb.get("category_includes?category_id=in.(" + directIds.join(",") + ")&select=included_category_id")
          .then(function (incl) {
            var all = directIds.slice();
            (incl || []).forEach(function (r) {
              if (all.indexOf(r.included_category_id) < 0) all.push(r.included_category_id);
            });
            return all;
          });
      })
      .then(function (catIds) {
        if (!catIds.length) { self.list = []; return []; }
        var q = "channels?select=id,name,channel_number,stream_url,stream_type,logo_url,logo_source_url,category_id,epg_channel_id,is_active,force_proxy_native,is_adult"
              + "&is_active=eq.true"
              + "&category_id=in.(" + catIds.join(",") + ")"
              + "&order=channel_number.asc";
        return LNTV.sb.get(q);
      })
      .then(function (chs) {
        self.list = chs || [];
        return self.loadFavorites().then(function () { return self.list; });
      });
  },

  loadFavorites: function () {
    var self = this;
    return LNTV.sb.get("user_favorites?select=channel_id").then(function (rows) {
      self.favorites = {};
      (rows || []).forEach(function (r) { self.favorites[r.channel_id] = true; });
    });
  },

  isFavorite: function (id) { return !!this.favorites[id]; },

  toggleFavorite: function (id) {
    var self = this;
    var uid = LNTV.session.userId();
    if (!uid) return Promise.resolve(false);
    if (self.favorites[id]) {
      delete self.favorites[id];
      return LNTV.sb.del("user_favorites?user_id=eq." + uid + "&channel_id=eq." + id).then(function () { return false; });
    }
    self.favorites[id] = true;
    return LNTV.sb.post("user_favorites", { user_id: uid, channel_id: id, position: 0 }, "return=minimal").then(function () { return true; });
  },

  findByNumber: function (n) {
    for (var i = 0; i < this.list.length; i++) if (this.list[i].channel_number === n) return i;
    return -1;
  }
};
