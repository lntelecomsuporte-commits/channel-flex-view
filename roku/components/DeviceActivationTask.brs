sub init()
    m.top.functionName = "RunTask"
end sub

sub RunTask()
    m.top.result = RokuDevicePoll(m.top.payload)
end sub