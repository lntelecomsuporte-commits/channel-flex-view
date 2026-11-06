' Off-device regression tests: no network or real credentials.
sub Main()
    device = { device_id: RokuNormalizeDeviceId("ab-cd_12.ef"), device_name: "Test Roku", app_version: "1.0.1" }
    payload = HbStartPayload(device, "test-session", "rpc-id", "RPC", true)
    Assert(payload.deviceId = "ABCD12EF" and payload.platform = "roku", "heartbeat uses canonical full login identity")
    Assert(payload.channelId = "rpc-id" and payload.channelName = "RPC" and payload.isWatching, "start includes the current playing channel")

    SetResponses([{ ok: false, status: 400, body: { error: "rejected" } }])
    failed = HbRequestStart(payload)
    Assert(failed.ok = false and failed.status = 400 and failed.id = invalid, "failed start returns diagnostic status")
    state = HbNewState()
    action = HbNextAction(state)
    Assert(action = "start", "first request creates the session")
    flush = HbAcceptResult(state, action, failed)
    Assert(flush = false and HbNextAction(state) = "start", "failed session creation retries on next tick")

    SetResponses([{ ok: true, status: 200, body: { id: "session-123" } }])
    result = HbRequestStart(payload)
    Assert(m.calls[0].url = "https://tv2.lntelecom.net/functions/v1/session-heartbeat" and m.calls[0].body.deviceId = "ABCD12EF", "session request stays self-hosted with matching device ID")
    Assert(HbNextAction(state) = "" and state.pending, "overlapping requests queue instead of starting a second task")
    Assert(HbAcceptResult(state, "start", result) and state.sessionId = "session-123", "channel change during start flushes immediately after success")
    Assert(HbNextAction(state) = "heartbeat", "accepted session sends heartbeat instead of duplicate start")
    Assert(HbAcceptResult(state, "heartbeat", { ok: true, status: 200 }) = false, "successful beat does not loop without pending change")

    action = HbNextAction(state)
    flush = HbAcceptResult(state, action, { ok: false, status: 404 })
    Assert(flush = false and HbNextAction(state) = "start", "missing session is recreated on next tick")
    queued = HbNextAction(state)
    flush = HbAcceptResult(state, "start", { forceSignout: true })
    Assert(flush = false and state.pending = false and state.busy = false, "remote logout cancels queued presence")

    SetResponses([{ ok: false, status: 401, body: invalid }, { ok: true, status: 200, body: { id: "refreshed-session" } }])
    result = HbRequestStart(payload)
    Assert(result.id = "refreshed-session" and m.refreshCount = 1 and m.calls.Count() = 2, "expired access retries after refresh")
    SetResponses([{ ok: true, status: 200, body: {} }])
    result = HbRequestStart(payload)
    Assert(result.ok = false and result.id = invalid, "response without session ID remains retryable")
    print "ROKU_TESTS_COMPLETE"
end sub

sub SetResponses(responses as Object)
    m.responses = responses
    m.calls = []
    m.refreshCount = 0
end sub

function HttpJson(url as String, method as String, body as Dynamic, token as Dynamic) as Object
    m.calls.Push({ url: url, body: body })
    return m.responses.Shift()
end function

function LNTV_Config() as Object
    return { baseUrl: "https://tv2.lntelecom.net" }
end function

function SbAccessToken() as String
    return "test-access"
end function

function SbRefresh() as Boolean
    m.refreshCount = m.refreshCount + 1
    return true
end function

sub Assert(condition as Boolean, name as String)
    if condition then print "PASS: " + name else print "FAIL: " + name
end sub