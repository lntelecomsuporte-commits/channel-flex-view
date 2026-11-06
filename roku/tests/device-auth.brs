' Run off-device with scripts/test-roku.mjs. No real requests or credentials.
sub Main()
    Assert(RokuNormalizeDeviceId("ab-cd_12.ef") = "ABCD12EF", "canonical device ID")
    payload = { device_id: "ROKU123456", platform: "roku", device_name: "Test Roku", app_version: "1.0.1" }

    SetResponses([{ ok: true, status: 200, body: { registered: false } }])
    res = RokuDevicePoll(payload)
    Assert(res.pending = true and m.calls.Count() = 1, "unbound device announces without creating a session")
    Assert(m.calls[0].url = "https://tv2.lntelecom.net/functions/v1/device-announce" and m.calls[0].body.platform = "roku" and m.calls[0].body.device_id = "ROKU123456", "self-hosted Roku announcement")

    SetResponses([{ ok: true, status: 200, body: { registered: true, is_active: false } }])
    res = RokuDevicePoll(payload)
    Assert(res.ok = false and m.calls.Count() = 1, "blocked device never requests a session")

    session = { success: true, access_token: "test-access", refresh_token: "test-refresh", user_id: "test-user" }
    SetResponses([{ ok: true, status: 200, body: { registered: true, is_active: true } }, { ok: true, status: 200, body: session }])
    res = RokuDevicePoll(payload)
    Assert(res.ok = true and res.user_id = "test-user" and m.calls[1].url = "https://tv2.lntelecom.net/functions/v1/device-auto-login", "bound device signs in automatically")
    Assert(m.saved.Count() = 0, "background task does not persist sessions")
    RokuSaveDeviceSession(res)
    Assert(m.saved.access_token = "test-access" and m.saved.refresh_token = "test-refresh" and m.saved.user_id = "test-user", "accepted session persists all three fields")

    manual = { success: true, access_token: "manual-access", refresh_token: "manual-refresh", user: { id: "manual-user" } }
    res = RokuDeviceLoginResult({ ok: true, status: 200, body: manual })
    Assert(res.ok = true and res.user_id = "manual-user", "manual registration accepts user.id response")

    SetResponses([{ ok: true, status: 200, body: { registered: true, is_active: true } }, { ok: false, status: 403, body: { error: "Conta bloqueada" } }])
    res = RokuDevicePoll(payload)
    Assert(res.ok = false and res.error = "Conta bloqueada", "blocked account cannot complete automatic login")

    res = RokuDeviceLoginResult({ ok: true, status: 200, body: { success: true, access_token: "partial", user_id: "user" } })
    Assert(res.ok = false, "incomplete session is rejected")

    SetResponses([{ ok: false, status: 0, body: invalid }])
    res = RokuDevicePoll(payload)
    Assert(res.ok = false and m.calls.Count() = 1 and m.saved.Count() = 0, "network failure does not sign in or overwrite storage")
    print "ROKU_TESTS_COMPLETE"
end sub

sub SetResponses(responses as Object)
    m.responses = responses
    m.calls = []
    m.saved = {}
end sub

function HttpJson(url as String, method as String, body as Dynamic, token as Dynamic) as Object
    m.calls.Push({ url: url, method: method, body: body })
    return m.responses.Shift()
end function

function LNTV_Config() as Object
    return { baseUrl: "https://tv2.lntelecom.net", anonKey: "test-public-key" }
end function

sub RegistrySet(key as String, value as String)
    m.saved[key] = value
end sub

sub Assert(condition as Boolean, name as String)
    if condition then print "PASS: " + name else print "FAIL: " + name
end sub