' DeviceAuth.brs — identidade e ativação pelo backend self-hosted.
function RokuNormalizeDeviceId(value as String) as String
    clean = ""
    value = UCase(value)
    for i = 1 to Len(value)
        c = Mid(value, i, 1)
        n = Asc(c)
        if (n >= 48 and n <= 57) or (n >= 65 and n <= 90) then clean = clean + c
    end for
    return clean
end function

function RokuDevicePayload() as Object
    di = CreateObject("roDeviceInfo")
    ai = CreateObject("roAppInfo")
    return {
        device_id: RokuNormalizeDeviceId(di.GetChannelClientId())
        platform: "roku"
        device_name: di.GetModelDisplayName()
        app_version: ai.GetVersion()
    }
end function

function RokuDeviceRequest(endpoint as String, payload as Object) as Object
    if Len(payload.device_id) < 6 then return { ok: false, status: 0, body: invalid }
    cfg = LNTV_Config()
    return HttpJson(cfg.baseUrl + "/functions/v1/" + endpoint, "POST", payload, cfg.anonKey)
end function

function RokuDevicePoll(payload as Object) as Object
    res = RokuDeviceRequest("device-announce", payload)
    if not res.ok then return { ok: false, status: res.status }
    if res.body = invalid then return { ok: false, status: res.status }
    if res.body.registered <> true then return { ok: false, pending: true }
    if res.body.is_active <> true then return { ok: false, error: "Dispositivo bloqueado pelo administrador." }
    res = RokuDeviceRequest("device-auto-login", payload)
    return RokuDeviceLoginResult(res)
end function

function RokuDeviceLoginResult(res as Object) as Object
    if res.ok and res.body <> invalid
        body = res.body
        uid = body.user_id
        if body.user <> invalid then uid = body.user.id
        if body.success = true and body.access_token <> invalid and body.refresh_token <> invalid and uid <> invalid
            if body.access_token <> "" and body.refresh_token <> "" and uid <> ""
                return { ok: true, access_token: body.access_token, refresh_token: body.refresh_token, user_id: uid }
            end if
        end if
    end if
    msg = "Não foi possível conectar. Tente novamente."
    if res.body <> invalid and res.body.error <> invalid then msg = res.body.error
    return { ok: false, error: msg, status: res.status }
end function

sub RokuSaveDeviceSession(res as Object)
    RegistrySet("refresh_token", res.refresh_token)
    RegistrySet("user_id", res.user_id)
    RegistrySet("access_token", res.access_token)
end sub