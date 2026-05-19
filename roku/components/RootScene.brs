sub init()
    m.top.backgroundURI = ""
    m.top.backgroundColor = "0x0a0a0aff"
    m.top.setFocus(true)
    if SbAccessToken() <> ""
        ShowHome()
    else
        ShowLogin()
    end if
    ' Memory monitoring é OS 10+. Roda DEPOIS de mostrar login pra não
    ' bloquear a UI em firmwares antigos onde essas APIs não existem.
    InitMemoryMonitoring()
end sub

sub InitMemoryMonitoring()
    try
        di = CreateObject("roDeviceInfo")
        if GetInterface(di, "ifDeviceInfo") <> invalid
            di.EnableLowGeneralMemoryEvent(true)
            di.EnableMemoryWarningEvent(true)
            print "[LNTV] Root MemoryLimitPercent="; di.GetMemoryLimitPercent()
            print "[LNTV] Root ChannelMemoryLimit="; di.GetChannelMemoryLimit()
            print "[LNTV] Root ChannelAvailableMemory="; di.GetChannelAvailableMemory()
        end if
    catch e
        print "[LNTV] InitMemoryMonitoring skipped (unsupported OS): "; e.message
    end try
end sub

sub OnMemoryWarning(evt as Object)
    print "[LNTV] Root memory warning="; evt.GetData()
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
    m.home.observeField("forceSignout", "OnForceSignout")
    m.home.observeField("exitRequested", "OnExit")
    m.home.setFocus(true)
end sub

sub OnExit(evt as Object)
    ' Sai do channel — sistema fecha a tela.
    end
end sub

sub OnLoginOk(evt as Object)
    ShowHome()
end sub

sub OnLogout(evt as Object)
    SbLogout()
    ShowLogin()
end sub

sub OnForceSignout(evt as Object)
    ' Sessão revogada pelo admin (ou usuário bloqueado).
    SbLogout()
    dlg = createObject("roSGNode", "Dialog")
    dlg.title = "Sessão encerrada"
    dlg.message = "Seu acesso foi encerrado pelo administrador. Faça login novamente."
    dlg.buttons = ["OK"]
    dlg.observeField("buttonSelected", "OnForceSignoutAck")
    m.signoutDlg = dlg
    m.top.dialog = dlg
end sub

sub OnForceSignoutAck(evt as Object)
    if m.signoutDlg <> invalid then m.signoutDlg.close = true
    m.signoutDlg = invalid
    ShowLogin()
end sub
