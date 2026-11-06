' Scheduling state shared by HomeScene and off-device regression tests.
function HbNewState() as Object
    return { sessionId: "", busy: false, pending: false }
end function

function HbNextAction(state as Object) as String
    if state.busy
        state.pending = true
        return ""
    end if
    state.busy = true
    state.pending = false
    if state.sessionId = "" then return "start"
    return "heartbeat"
end function

function HbAcceptResult(state as Object, action as String, result as Dynamic) as Boolean
    state.busy = false
    if result = invalid then return false
    if HbHasForceSignout(result)
        state.pending = false
        return false
    end if
    if action = "start" and result.id <> invalid
        if result.id <> "" then state.sessionId = result.id
    else if action = "heartbeat" and result.status = 404
        state.sessionId = ""
    end if
    ' A queued channel change is sent immediately only after a successful request.
    ' Failures retry on the timer instead of spinning in a tight network loop.
    return result.ok = true and state.pending
end function