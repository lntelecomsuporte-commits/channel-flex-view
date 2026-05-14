sub init()
    m.top.backgroundURI = ""
    m.top.backgroundColor = "0x0a0a0aff"
    m.top.setFocus(true)
    if SbAccessToken() <> ""
        ShowHome()
    else
        ShowLogin()
    end if
end sub

sub ShowLogin()
    if m.home <> invalid then m.top.removeChild(m.home)
    m.home = invalid
    m.login = createObject("roSGNode", "LoginScene")
    m.top.appendChild(m.login)
    m.login.observeField("loginOk", "OnLoginOk")
    m.login.setFocus(true)
end sub

sub ShowHome()
    if m.login <> invalid then m.top.removeChild(m.login)
    m.login = invalid
    m.home = createObject("roSGNode", "HomeScene")
    m.top.appendChild(m.home)
    m.home.observeField("logoutRequested", "OnLogout")
    m.home.setFocus(true)
end sub

sub OnLoginOk(evt as Object)
    ShowHome()
end sub

sub OnLogout(evt as Object)
    SbLogout()
    ShowLogin()
end sub
