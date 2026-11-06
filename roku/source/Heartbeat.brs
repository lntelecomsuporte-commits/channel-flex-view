' Heartbeat.brs — chamadas síncronas para session-heartbeat. Usado via Task node.

function HbInvoke(action as String, payload as Object) as Object
    cfg = LNTV_Config()
    url = cfg.baseUrl + "/functions/v1/session-heartbeat"
    body = { action: action }
    for each k in payload
        body[k] = payload[k]
    end for
    res = HttpJson(url, "POST", body, SbAccessToken())
    if res.status = 401
        if SbRefresh()
            res = HttpJson(url, "POST", body, SbAccessToken())
        end if
    end if
    return res
end function

function HbStart(channelId as Dynamic, channelName as Dynamic, isWatching as Boolean) as Object
    payload = HbStartPayload(RokuDevicePayload(), NewSessionToken(), channelId, channelName, isWatching)
    return HbRequestStart(payload)
end function

function HbStartPayload(device as Object, token as String, channelId as Dynamic, channelName as Dynamic, isWatching as Boolean) as Object
    payload = { sessionToken: token, userAgent: "Roku/" + device.device_name, isWatching: isWatching, platform: "roku", deviceId: device.device_id, deviceName: device.device_name, appVersion: device.app_version }
    if channelId <> invalid then payload.channelId = channelId
    if channelName <> invalid then payload.channelName = channelName
    return payload
end function

function HbHasForceSignout(value as Dynamic) as Boolean
    if value = invalid then return false
    ' ParseJson/Task assocarrays podem normalizar as chaves para minúsculas.
    return value.forceSignout = true or value.forcesignout = true
end function

function HbRequestStart(payload as Object) as Object
    res = HbInvoke("start", payload)
    if res.ok and res.body <> invalid
        if HbHasForceSignout(res.body) then return { ok: false, forceSignout: true, status: res.status }
        if res.body.id <> invalid and res.body.id <> "" then return { ok: true, id: res.body.id, status: res.status }
    end if
    HbLogFailure("start", res)
    return { ok: false, id: invalid, status: res.status }
end function

function HbBeat(sessionId as String, channelId as Dynamic, channelName as Dynamic, isWatching as Boolean) as Object
    if sessionId = invalid or sessionId = "" then return { ok: false }
    device = RokuDevicePayload()
    payload = { sessionId: sessionId, isWatching: isWatching, platform: "roku", deviceId: device.device_id }
    if channelId <> invalid then payload.channelId = channelId
    if channelName <> invalid then payload.channelName = channelName
    res = HbInvoke("heartbeat", payload)
    if res.ok and HbHasForceSignout(res.body)
        return { ok: false, forceSignout: true, status: res.status }
    end if
    if not res.ok then HbLogFailure("heartbeat", res)
    return { ok: res.ok, status: res.status }
end function

sub HbLogFailure(action as String, res as Object)
    ' Never print response bodies, tokens, user IDs or device IDs.
    print "[LNTV][heartbeat] action="; action; " status="; res.status
end sub

sub HbEnd(sessionId as String)
    if sessionId = invalid or sessionId = "" then return
    HbInvoke("end", { sessionId: sessionId })
end sub

function NewSessionToken() as String
    dt = CreateObject("roDateTime")
    return "roku-" + dt.AsSeconds().toStr() + "-" + Rnd(100000).toStr()
end function

function GetRokuModel() as String
    di = CreateObject("roDeviceInfo")
    os = di.GetOsVersion()
    osStr = os.major.toStr() + "." + os.minor.toStr() + "." + os.revision.toStr() + "." + os.build.toStr()
    return di.GetModel() + "/" + osStr
end function
