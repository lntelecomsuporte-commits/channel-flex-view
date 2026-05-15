sub init()
    m.top.functionName = "RunTask"
end sub

sub RunTask()
    action = m.top.action
    chId = invalid
    if m.top.channelId <> "" then chId = m.top.channelId
    chName = invalid
    if m.top.channelName <> "" then chName = m.top.channelName
    isWatch = m.top.isWatching
    sid = m.top.sessionId

    if action = "start"
        m.top.result = HbStart(chId, chName, isWatch)
    else if action = "heartbeat"
        m.top.result = HbBeat(sid, chId, chName, isWatch)
    else if action = "end"
        HbEnd(sid)
        m.top.result = { ok: true }
    end if
end sub
