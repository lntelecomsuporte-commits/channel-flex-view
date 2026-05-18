sub init()
    m.email = ""
    m.password = ""
    m.mode = "email"   ' or "cpf"
    m.activeField = "email"
    m.emailValue = m.top.findNode("emailValue")
    m.passValue = m.top.findNode("passValue")
    m.emailBox = m.top.findNode("emailBox")
    m.passBox = m.top.findNode("passBox")
    m.emailLabel = m.top.findNode("emailLabel")
    m.modeLabel = m.top.findNode("modeLabel")
    m.status = m.top.findNode("status")
    UpdateMode()
    UpdateActive()
end sub

sub UpdateMode()
    if m.mode = "cpf"
        m.modeLabel.text = "Login por: CPF  (◀▶ trocar)"
        m.emailLabel.text = "CPF (só números):"
    else
        m.modeLabel.text = "Login por: E-MAIL  (◀▶ trocar)"
        m.emailLabel.text = "E-mail:"
    end if
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
        ShowKeyboard()
        return true
    end if
    if key = "down" or key = "up"
        if m.activeField = "email" then m.activeField = "password" else m.activeField = "email"
        UpdateActive()
        return true
    end if
    if key = "left" or key = "right"
        if m.mode = "email" then m.mode = "cpf" else m.mode = "email"
        m.email = ""
        UpdateValues()
        UpdateMode()
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
    dlg = createObject("roSGNode", "StandardKeyboardDialog")
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
    if idx = 0 and dlg <> invalid
        txt = dlg.text
        if m.activeField = "email" then m.email = txt else m.password = txt
        UpdateValues()
    end if
    if dlg <> invalid then dlg.close = true
end sub

sub OnKbClosed(evt as Object)
    m.kbDialog = invalid
    m.top.setFocus(true)
end sub

sub DoLogin()
    if m.email = "" or m.password = ""
        m.status.text = "Preencha os dois campos"
        return
    end if
    m.status.text = "Entrando..."
    if m.mode = "cpf"
        res = SbLoginCpf(m.email, m.password)
    else
        res = SbLogin(m.email, m.password)
    end if
    if res.ok
        m.status.text = ""
        m.top.loginOk = true
    else
        m.status.text = res.error
    end if
end sub
