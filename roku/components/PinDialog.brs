' PinDialog — entrada numérica simples sem teclado virtual (mais rápida no controle).
' 4 posições; ◀▶ muda posição, ▲▼ muda dígito (0-9), OK confirma.

sub init()
    m.digits = [0, 0, 0, 0]
    m.pos = 0
    m.display = m.top.findNode("pinDisplay")
    m.errLabel = m.top.findNode("pinErr")
    Render()
end sub

sub Render()
    s = ""
    for i = 0 to 3
        if i = m.pos
            s = s + "[" + m.digits[i].toStr() + "]"
        else
            s = s + " " + m.digits[i].toStr() + " "
        end if
    end for
    m.display.text = s
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "left"
        if m.pos > 0 then m.pos = m.pos - 1
        Render()
        return true
    end if
    if key = "right"
        if m.pos < 3 then m.pos = m.pos + 1
        Render()
        return true
    end if
    if key = "up"
        m.digits[m.pos] = (m.digits[m.pos] + 1) mod 10
        Render()
        return true
    end if
    if key = "down"
        d = m.digits[m.pos] - 1
        if d < 0 then d = 9
        m.digits[m.pos] = d
        Render()
        return true
    end if
    if key = "OK"
        entered = ""
        for i = 0 to 3
            entered = entered + m.digits[i].toStr()
        end for
        if entered = m.top.expectedPin
            m.top.pinResult = "ok"
        else
            m.errLabel.text = "PIN incorreto"
            m.digits = [0, 0, 0, 0]
            m.pos = 0
            Render()
        end if
        return true
    end if
    if key = "back"
        m.top.pinResult = "cancel"
        return true
    end if
    return false
end function
