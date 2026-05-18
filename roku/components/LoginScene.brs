sub init()
    m.email = ""
    m.password = ""
    m.activeField = "email"
    m.keyboardField = ""
    m.openPasswordAfterClose = false
    m.loginAfterClose = false
    m.loginBusy = false
    m.kbDialog = invalid
    m.loginTask = invalid
    m.emailValue = m.top.findNode("emailValue")
    m.passValue = m.top.findNode("passValue")
    m.emailBox = m.top.findNode("emailBox")
    m.passBox = m.top.findNode("passBox")
    m.status = m.top.findNode("status")
    UpdateActive()
end sub

sub UpdateActive()
    if m.activeField = "email"
        m.emailBox.color = "0x374151ff"
        m.passBox.color = "0x1f2937ff"
    else
        m.emailBox.color = "0x1f2937ff"
        m.passBox.color = "0x374151ff"
    end if
end sub

sub UpdateValues()
    m.emailValue.text = m.email
    masked = ""
    for i = 0 to Len(m.password) - 1
        masked = masked + "•"
    end for
    m.passValue.text = masked
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false

    if key = "OK"
        if m.email <> "" and m.password <> ""
            DoLogin()
        else
            ShowKeyboard()
        end if
        return true
    end if
    if key = "select"
        if m.email <> "" and m.password <> ""
            DoLogin()
            return true
        end if
        ShowKeyboard()
        return true
    end if
    if key = "down" or key = "up"
        if m.activeField = "email" then m.activeField = "password" else m.activeField = "email"
        UpdateActive()
        return true
    end if
    if key = "rewind"
        if m.activeField = "email" then m.email = "" else m.password = ""
        UpdateValues()
        return true
    end if
    if key = "play" or key = "fastforward"
        DoLogin()
        return true
    end if
    return false
end function


sub ShowKeyboard()
    if m.kbDialog <> invalid then return
    if m.loginBusy then return
    dlg = createObject("roSGNode", "StandardKeyboardDialog")
    m.keyboardField = m.activeField
    m.openPasswordAfterClose = false
    m.loginAfterClose = false
    if m.activeField = "email"
        if m.mode = "cpf" then dlg.title = "Digite seu CPF" else dlg.title = "Digite seu e-mail"
        dlg.text = m.email
    else
        dlg.title = "Digite sua senha"
        dlg.text = m.password
    end if
    dlg.buttons = ["OK", "Cancelar"]
    dlg.observeField("buttonSelected", "OnKbButton")
    dlg.observeField("wasClosed", "OnKbClosed")
    m.kbDialog = dlg
    m.top.getScene().dialog = dlg
end sub

sub OnKbButton(evt as Object)
    idx = evt.getData()
    dlg = m.kbDialog
    print "[LOGIN] keyboard button idx="; idx; " field="; m.keyboardField
    if idx = 0 and dlg <> invalid
        txt = dlg.text
        if m.keyboardField = "email" then m.email = txt else m.password = txt
        UpdateValues()
        if m.keyboardField = "email"
            m.activeField = "password"
            UpdateActive()
            m.openPasswordAfterClose = false
            if m.email <> "" then m.status.text = "Agora pressione OK na senha"
        else
            m.loginAfterClose = m.email <> "" and m.password <> ""
        end if
    end if
    if dlg <> invalid then dlg.close = true
end sub

sub OnKbClosed(evt as Object)
    print "[LOGIN] keyboard closed field="; m.keyboardField; " emailLen="; Len(m.email); " passLen="; Len(m.password)
    m.kbDialog = invalid
    m.top.setFocus(true)
    if m.openPasswordAfterClose
        m.openPasswordAfterClose = false
        ShowKeyboard()
        return
    end if
    if m.loginAfterClose
        m.loginAfterClose = false
        DoLogin()
    end if
end sub

sub DoLogin()
    if m.loginBusy then return
    if m.email = "" or m.password = ""
        m.status.text = "Preencha os dois campos"
        return
    end if
    m.loginBusy = true
    m.status.text = "Entrando..."
    print "[LOGIN] attempting email="; m.email; " passLen="; Len(m.password)
    task = createObject("roSGNode", "LoginTask")
    task.email = m.email
    task.password = m.password
    task.observeField("result", "OnLoginResult")
    m.loginTask = task
    task.control = "RUN"
end sub

sub OnLoginResult(evt as Object)
    res = evt.getData()
    if res = invalid
        m.status.text = "Falha no login"
        m.loginBusy = false
        m.loginTask = invalid
        return
    end if
    if res.ok
        m.status.text = ""
        m.loginBusy = false
        m.loginTask = invalid
        print "[LOGIN] success"
        m.top.loginOk = true
    else
        err = res.error
        if res.status <> invalid then err = err + " [HTTP " + res.status.toStr() + "]"
        m.status.text = err
        m.loginBusy = false
        m.loginTask = invalid
        print "[LOGIN] fail: status="; res.status; " body="; res.raw
    end if
end sub
