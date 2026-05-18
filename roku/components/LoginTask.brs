sub init()
    m.top.functionName = "RunTask"
end sub

sub RunTask()
    m.top.result = SbLogin(m.top.email, m.top.password)
end sub