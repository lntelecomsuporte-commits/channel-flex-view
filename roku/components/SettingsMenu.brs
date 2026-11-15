' SettingsMenu — aberto pela tecla * (Opções) no player.
sub init()
    m.list = m.top.findNode("menuList")
    m.list.observeField("itemSelected", "OnSelected")
    m.top.observeField("focusedChild", "OnFocusChanged")
end sub

sub OnFocusChanged()
    if m.top.hasFocus() then m.list.setFocus(true)
end sub

sub OnSelected()
    item = m.list.content.getChild(m.list.itemSelected)
    if item <> invalid then m.top.selected = item.id
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "back" or key = "options"
        m.top.selected = "close"
        return true
    end if
    return false
end function
