sub init()
    m.email = ""
    m.password = ""
    m.activeField = "email"  ' or "password"
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
        ShowKeyboard()
        return true
    end if
    if key = "down" or key = "up"
        if m.activeField = "email"
            m.activeField = "password"
        else
            m.activeField = "email"
        end if
        UpdateActive()
        return true
    end if
    if key = "rewind"
        if m.activeField = "email"
            m.email = ""
        else
            m.password = ""
        end if
        UpdateValues()
        return true
    end if
    if key = "play" or key = "fastforward"
        DoLogin()
        return true
    end if
    if key = "back"
        ' fecha o app
        return false
    end if
    return false
end function

sub ShowKeyboard()
    dlg = createObject("roSGNode", "KeyboardDialog")
    dlg.title = "Digite seu " + m.activeField
    if m.activeField = "password" then dlg.textEditBox.secureMode = true
    if m.activeField = "email"
        dlg.textEditBox.text = m.email
    else
        dlg.textEditBox.text = m.password
    end if
    dlg.buttons = ["OK", "Cancelar"]
    dlg.observeField("buttonSelected", "OnKbButton")
    m.kbDialog = dlg
    m.top.getScene().dialog = dlg
end sub

sub OnKbButton(evt as Object)
    idx = evt.getData()
    dlg = m.kbDialog
    if idx = 0 and dlg <> invalid
        txt = dlg.textEditBox.text
        if m.activeField = "email"
            m.email = txt
        else
            m.password = txt
        end if
        UpdateValues()
    end if
    if dlg <> invalid then dlg.close = true
    m.kbDialog = invalid
end sub

sub DoLogin()
    if m.email = "" or m.password = ""
        m.status.text = "Preencha e-mail e senha"
        return
    end if
    m.status.text = "Entrando..."
    res = SbLogin(m.email, m.password)
    if res.ok
        m.status.text = ""
        m.top.loginOk = true
    else
        m.status.text = res.error
    end if
end sub
