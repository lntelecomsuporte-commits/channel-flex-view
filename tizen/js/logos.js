/* LN TV — logos (URL resolver) */
window.LNTV = window.LNTV || {};
LNTV.logos = {
  url: function (channel) {
    var u = channel.logo_url || channel.logo_source_url || "";
    if (!u) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf("http") === 0) return u;
    if (u.charAt(0) === "/") return LNTV.BACKEND + u;
    return LNTV.BACKEND + "/" + u;
  }
};
