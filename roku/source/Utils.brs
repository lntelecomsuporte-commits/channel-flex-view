' Utils.brs — helpers genéricos

function NewHttp(url as String, method as String) as Object
    req = CreateObject("roUrlTransfer")
    req.setUrl(url)
    req.setRequest(method)
    req.setCertificatesFile("common:/certs/ca-bundle.crt")
    req.initClientCertificates()
    req.addHeader("Content-Type", "application/json")
    req.addHeader("Accept", "application/json")
    cfg = LNTV_Config()
    req.addHeader("apikey", cfg.anonKey)
    return req
end function

function HttpJson(url as String, method as String, body as Dynamic, accessToken as Dynamic) as Object
    req = NewHttp(url, method)
    if accessToken <> invalid and accessToken <> ""
        req.addHeader("Authorization", "Bearer " + accessToken)
    end if
    port = CreateObject("roMessagePort")
    req.setMessagePort(port)
    bodyStr = ""
    if body <> invalid then bodyStr = FormatJson(body)
    if method = "GET"
        ok = req.AsyncGetToString()
    else
        ok = req.AsyncPostFromString(bodyStr)
    end if
    if not ok then return { ok: false, status: 0, body: invalid }
    msg = wait(20000, port)
    if type(msg) = "roUrlEvent"
        code = msg.getResponseCode()
        text = msg.getString()
        parsed = invalid
        if text <> invalid and text <> ""
            parsed = ParseJson(text)
        end if
        return { ok: code >= 200 and code < 300, status: code, body: parsed, raw: text }
    end if
    req.AsyncCancel()
    return { ok: false, status: 0, body: invalid }
end function

sub RegistrySet(key as String, value as String)
    cfg = LNTV_Config()
    sec = CreateObject("roRegistrySection", cfg.registrySection)
    sec.Write(key, value)
    sec.Flush()
end sub

function RegistryGet(key as String) as String
    cfg = LNTV_Config()
    sec = CreateObject("roRegistrySection", cfg.registrySection)
    if sec.Exists(key) then return sec.Read(key)
    return ""
end function

sub RegistryClear()
    cfg = LNTV_Config()
    sec = CreateObject("roRegistrySection", cfg.registrySection)
    for each k in sec.GetKeyList()
        sec.Delete(k)
    end for
    sec.Flush()
end sub
