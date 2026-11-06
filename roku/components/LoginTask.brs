sub init()
    m.top.functionName = "RunTask"
end sub

sub RunTask()
    payload = m.top.payload
    payload.email = m.top.email
    payload.password = m.top.password
    res = RokuDeviceRequest("device-login", payload)
    m.top.result = RokuDeviceLoginResult(res)
end sub