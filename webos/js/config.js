/* LN TV — config (LG webOS) */
window.LNTV = window.LNTV || {};
LNTV.BACKEND = "https://tv2.lntelecom.net";
LNTV.ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzc3MDA0OTQwLCJleHAiOjIwOTIzNjQ5NDB9.9BCUjjQPaZLLhZnJnpor4cfq7kO6IbjFpt78hPBGyow";
LNTV.AUTH_URL = LNTV.BACKEND + "/auth/v1";
LNTV.REST_URL = LNTV.BACKEND + "/rest/v1";
LNTV.FN_URL = LNTV.BACKEND + "/functions/v1";
LNTV.EPG_URL = LNTV.BACKEND + "/epg/lntv.json";
LNTV.VERSION_URL = LNTV.BACKEND + "/version-webos.json";
LNTV.APP_VERSION = "1.0.1";
LNTV.APP_VERSION_CODE = 2;
LNTV.PLATFORM = "webos";
