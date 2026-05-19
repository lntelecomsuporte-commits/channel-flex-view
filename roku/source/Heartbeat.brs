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
    payload = {
        sessionToken: NewSessionToken()
        userAgent: "Roku/" + GetRokuModel()
        isWatching: isWatching
    }
    if channelId <> invalid then payload.channelId = channelId
    if channelName <> invalid then payload.channelName = channelName
    res = HbInvoke("start", payload)
    if res.ok and res.body <> invalid
        if res.body.forceSignout = true then return { forceSignout: true }
        if res.body.id <> invalid then return { id: res.body.id }
    end if
    return { id: invalid }
end function

function HbBeat(sessionId as String, channelId as Dynamic, channelName as Dynamic, isWatching as Boolean) as Object
    if sessionId = invalid or sessionId = "" then return { ok: false }
    payload = { sessionId: sessionId, isWatching: isWatching }
    if channelId <> invalid then payload.channelId = channelId
    if channelName <> invalid then payload.channelName = channelName
    res = HbInvoke("heartbeat", payload)
    if res.ok and res.body <> invalid and res.body.forceSignout = true
        return { forceSignout: true }
    end if
    return { ok: res.ok }
end function

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
    osStr = os.major + "." + os.minor + "." + os.revision + "." + os.build
    return di.GetModel() + "/" + osStr
end function
