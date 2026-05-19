' PlayerScene.brs — espelha o Android.
'
' Atalhos:
'   ▲/▼          : zap (sem barra de favoritos)
'   ◀/▶          : pré-visualiza canal anterior/próximo (não troca o stream)
'   OK (1x)      : se nada na tela → abre OSD + barra de favoritos
'                  se OSD aberto → abre lista de canais
'                  se em preview → confirma o canal previewado
'                  se foco em favoritos → toca o canal favorito focado
'   OK (segurar) : favorita/desfavorita o canal em foco
'   Voltar       : fecha overlay/lista/OSD; se nada aberto, fecha o app
'   channel ▲/▼  : zap direto (botões dedicados do controle)

sub init()
    m.video = m.top.findNode("video")
    m.osdBg = m.top.findNode("osdBg")
    m.osdName = m.top.findNode("osdName")
    m.osdNum = m.top.findNode("osdNum")
    m.osdNow = m.top.findNode("osdNow")
    m.osdNext = m.top.findNode("osdNext")
    m.osdHint = m.top.findNode("osdHint")
    m.favBg = m.top.findNode("favBg")
    m.favTitle = m.top.findNode("favTitle")
    m.favBar = m.top.findNode("favBar")
    m.listBg = m.top.findNode("listBg")
    m.listTitle = m.top.findNode("listTitle")
    m.chOverlay = m.top.findNode("chOverlay")
    m.toastBg = m.top.findNode("toastBg")
    m.toastLabel = m.top.findNode("toastLabel")
    m.errLabel = m.top.findNode("errLabel")
    m.osdTimer = m.top.findNode("osdTimer")
    m.longPressTimer = m.top.findNode("longPressTimer")
    m.toastTimer = m.top.findNode("toastTimer")

    m.osdVisible = false
    m.osdFromOk = false
    m.focusZone = "main"       ' main | favorites | list
    m.favFocusIdx = 0
    m.previewIdx = -1
    m.okHeld = false
    m.longPressFired = false
    m.favoritesResolved = []
    m.favIcons = []
    m.lastIndex = m.top.channelIndex

    m.top.observeField("channelData", "OnChannelData")
    m.top.observeField("favorites", "OnFavoritesField")
    m.top.observeField("unlockedIds", "OnUnlockedChanged")
    m.top.observeField("revertRestricted", "OnRevertRestricted")
    m.video.observeField("state", "OnState")
    m.osdTimer.observeField("fire", "HideOsdAll")
    m.longPressTimer.observeField("fire", "OnLongPress")
    m.toastTimer.observeField("fire", "HideToast")
    m.chOverlay.observeField("itemSelected", "OnOverlaySelected")
end sub

' ==================== STREAM ====================

sub OnChannelData()
    ch = m.top.channelData
    if ch = invalid then return

    ' bloqueio de canais restritos
    if IsRestricted(ch) and not IsUnlocked(ch.id)
        ' avisa o HomeScene pra abrir o PIN
        m.video.control = "stop"
        m.video.content = invalid
        m.top.unlockRequest = { channelId: ch.id }
        return
    end if

    fmt = "hls"
    if ch.stream_format = "mp4" then fmt = "mp4"
    if ch.stream_format = "youtube"
        m.errLabel.text = "Canais YouTube não são suportados no Roku ainda."
        m.errLabel.visible = true
        return
    end if

    urls = [ch.stream_url]
    if ch.backup_stream_urls <> invalid
        for each u in ch.backup_stream_urls
            urls.push(u)
        end for
    end if

    content = createObject("roSGNode", "ContentNode")
    content.streamFormat = fmt
    content.url = urls[0]
    if urls.count() > 1 then content.streamUrls = urls
    content.title = ch.name

    m.video.control = "stop"
    m.video.content = invalid
    m.video.content = content
    m.video.control = "play"
    m.previewIdx = -1
    HideFavBar()
    if m.focusZone = "favorites" then m.focusZone = "main"
    m.lastIndex = m.top.channelIndex
    ShowOsd(ch)
end sub

function IsRestricted(ch as Object) as Boolean
    if ch = invalid then return false
    if ch.is_adult = true then return true
    pinCats = m.top.pinCategoryIds
    if pinCats <> invalid and ch.category_id <> invalid and pinCats[ch.category_id] = true
        return true
    end if
    return false
end function

function IsUnlocked(id as String) as Boolean
    unl = m.top.unlockedIds
    if unl = invalid then return false
    return unl[id] = true
end function

sub OnUnlockedChanged()
    ' Se acabou de liberar o canal atual, reinicia o stream.
    ch = m.top.channelData
    if ch = invalid then return
    if IsRestricted(ch) and IsUnlocked(ch.id) and m.video.content = invalid
        OnChannelData()
    end if
end sub

sub OnRevertRestricted()
    ' Volta pro último canal sem restrição.
    list = m.top.channelList
    if list = invalid then return
    idx = m.lastIndex
    if idx < 0 or idx >= list.count() then idx = 0
    m.top.channelIndex = idx
    m.top.channelData = list[idx]
end sub

sub OnState(evt as Object)
    s = m.video.state
    if s = "error"
        err = m.video.errorMsg
        if err = invalid then err = "erro desconhecido"
        m.errLabel.text = "Erro no stream: " + err
        m.errLabel.visible = true
    else
        m.errLabel.visible = false
    end if
end sub

' ==================== OSD ====================

sub ShowOsd(ch as Object)
    if ch = invalid then return
    m.osdBg.visible = true
    m.osdName.visible = true
    m.osdNum.visible = true
    m.osdNow.visible = true
    m.osdNext.visible = true
    m.osdHint.visible = true
    m.osdName.text = ch.name
    if ch.channel_number <> invalid
        m.osdNum.text = "Canal " + ch.channel_number.toStr()
    else
        m.osdNum.text = ""
    end if
    epgId = invalid
    if ch.epg_channel_id <> invalid then epgId = ch.epg_channel_id
    info = EpgCurrentAndNext(epgId)
    if info.current <> invalid
        m.osdNow.text = "▶ " + FormatHHMM(info.current.start_date) + "  " + info.current.title
    else
        m.osdNow.text = ""
    end if
    if info.nextProg <> invalid
        m.osdNext.text = "↳ " + FormatHHMM(info.nextProg.start_date) + "  " + info.nextProg.title
    else
        m.osdNext.text = ""
    end if
    m.osdVisible = true
    m.osdTimer.control = "stop"
    m.osdTimer.control = "start"
end sub

sub HideOsdAll()
    m.osdBg.visible = false
    m.osdName.visible = false
    m.osdNum.visible = false
    m.osdNow.visible = false
    m.osdNext.visible = false
    m.osdHint.visible = false
    HideFavBar()
    m.osdVisible = false
    m.osdFromOk = false
    m.previewIdx = -1
    m.focusZone = "main"
end sub

sub RestartOsdTimer()
    m.osdTimer.control = "stop"
    m.osdTimer.control = "start"
end sub

' ==================== FAVORITOS ====================

sub OnFavoritesField()
    BuildFavoritesResolved()
end sub

sub BuildFavoritesResolved()
    favs = m.top.favorites
    list = m.top.channelList
    out = []
    if favs = invalid or list = invalid
        m.favoritesResolved = out
        return
    end if
    for each f in favs
        cid = invalid
        if f.channel_id <> invalid then cid = f.channel_id
        if cid <> invalid
            for each ch in list
                if ch.id = cid
                    out.push(ch)
                    exit for
                end if
            end for
        end if
    end for
    m.favoritesResolved = out
end sub

sub ShowFavBar()
    if m.favoritesResolved = invalid or m.favoritesResolved.count() = 0
        BuildFavoritesResolved()
    end if
    while m.favBar.getChildCount() > 0
        m.favBar.removeChildIndex(0)
    end while
    m.favIcons = []
    x = 0
    cellW = 200
    n = m.favoritesResolved.count()
    maxCells = 9
    if n > maxCells then n = maxCells
    for i = 0 to n - 1
        ch = m.favoritesResolved[i]
        cell = m.favBar.createChild("Group")
        cell.translation = [x, 0]
        bg = cell.createChild("Rectangle")
        bg.width = 180
        bg.height = 130
        bg.color = "0x1f2937ff"
        if ch.logo_url <> invalid and ch.logo_url <> ""
            poster = cell.createChild("Poster")
            poster.uri = ch.logo_url
            poster.width = 160
            poster.height = 110
            poster.translation = [10, 10]
            poster.loadDisplayMode = "scaleToFit"
        end if
        lbl = cell.createChild("Label")
        lbl.text = ch.name
        lbl.font = "font:SmallSystemFont"
        lbl.color = "0xffffffff"
        lbl.width = 180
        lbl.height = 50
        lbl.horizAlign = "center"
        lbl.translation = [0, 140]
        m.favIcons.push(bg)
        x = x + cellW
    end for
    m.favBg.visible = true
    m.favTitle.visible = true
    m.favBar.visible = true
    if m.favFocusIdx >= n then m.favFocusIdx = 0
    HighlightFavFocus()
end sub

sub HideFavBar()
    m.favBg.visible = false
    m.favTitle.visible = false
    m.favBar.visible = false
end sub

sub HighlightFavFocus()
    for i = 0 to m.favIcons.count() - 1
        if i = m.favFocusIdx
            m.favIcons[i].color = "0xdc2626ff"
        else
            m.favIcons[i].color = "0x1f2937ff"
        end if
    end for
end sub

' ==================== LISTA OVERLAY (OK 2x) ====================

sub ShowChannelOverlay()
    list = m.top.channelList
    if list = invalid or list.count() = 0 then return
    favIdx = {}
    if m.top.favorites <> invalid
        for each f in m.top.favorites
            if f.channel_id <> invalid then favIdx[f.channel_id] = true
        end for
    end if
    root = createObject("roSGNode", "ContentNode")
    for each ch in list
        n = root.createChild("ContentNode")
        prefix = ""
        if favIdx[ch.id] = true then prefix = "★ "
        if ch.channel_number <> invalid then prefix = prefix + ch.channel_number.toStr() + "  "
        n.title = prefix + ch.name
    end for
    m.chOverlay.content = root
    m.chOverlay.jumpToItem = m.top.channelIndex
    m.listBg.visible = true
    m.listTitle.visible = true
    m.chOverlay.visible = true
    m.focusZone = "list"
    m.chOverlay.setFocus(true)
end sub

sub HideChannelOverlay()
    m.listBg.visible = false
    m.listTitle.visible = false
    m.chOverlay.visible = false
    m.chOverlay.setFocus(false)
    m.top.setFocus(true)
    m.focusZone = "main"
end sub

sub OnOverlaySelected(evt as Object)
    idx = evt.getData()
    list = m.top.channelList
    if list = invalid or idx < 0 or idx >= list.count() then return
    ch = list[idx]
    if ch = invalid then return
    HideChannelOverlay()
    m.top.channelIndex = idx
    m.top.channelData = ch
end sub

' ==================== TROCA / PREVIEW ====================

sub SwitchChannel(delta as Integer)
    list = m.top.channelList
    if list = invalid or list.count() <= 1 then return
    idx = m.top.channelIndex + delta
    if idx < 0 then idx = list.count() - 1
    if idx >= list.count() then idx = 0
    m.top.channelIndex = idx
    m.top.channelData = list[idx]
end sub

sub PreviewChannel(delta as Integer)
    list = m.top.channelList
    if list = invalid or list.count() <= 1 then return
    base = m.top.channelIndex
    if m.previewIdx >= 0 then base = m.previewIdx
    idx = base + delta
    if idx < 0 then idx = list.count() - 1
    if idx >= list.count() then idx = 0
    m.previewIdx = idx
    ch = list[idx]
    if ch = invalid then return
    ShowOsd(ch)
end sub

sub PlayPreviewed()
    if m.previewIdx < 0 then return
    list = m.top.channelList
    if list = invalid or m.previewIdx >= list.count() then return
    ch = list[m.previewIdx]
    m.top.channelIndex = m.previewIdx
    m.previewIdx = -1
    m.top.channelData = ch
end sub

sub PlayFavoriteFocused()
    if m.favoritesResolved = invalid or m.favFocusIdx < 0 then return
    if m.favFocusIdx >= m.favoritesResolved.count() then return
    ch = m.favoritesResolved[m.favFocusIdx]
    list = m.top.channelList
    newIdx = m.top.channelIndex
    if list <> invalid
        for i = 0 to list.count() - 1
            if list[i].id = ch.id
                newIdx = i
                exit for
            end if
        end for
    end if
    m.top.channelIndex = newIdx
    HideOsdAll()
    m.top.channelData = ch
end sub

' ==================== TOAST ====================

sub ShowToast(msg as String)
    m.toastLabel.text = msg
    m.toastBg.visible = true
    m.toastLabel.visible = true
    m.toastTimer.control = "stop"
    m.toastTimer.control = "start"
end sub

sub HideToast()
    m.toastBg.visible = false
    m.toastLabel.visible = false
end sub

' ==================== FAVORITAR (long-press) ====================

sub OnLongPress()
    if not m.okHeld then return
    m.longPressFired = true
    ch = m.top.channelData
    if ch = invalid then return
    favs = m.top.favorites
    if favs = invalid then favs = []
    existingId = invalid
    for each f in favs
        if f.channel_id = ch.id
            existingId = f.id
            exit for
        end if
    end for
    if existingId <> invalid
        res = RemoveFavorite(existingId)
        if res.ok
            newList = []
            for each f in favs
                if f.id <> existingId then newList.push(f)
            end for
            m.top.favorites = newList
            BuildFavoritesResolved()
            m.top.favoritesChanged = { action: "removed", channelId: ch.id }
            ShowToast("✖ Removido dos favoritos")
        else
            ShowToast("Erro ao remover favorito")
        end if
    else
        res = AddFavorite(ch.id)
        if res.ok and res.body <> invalid and res.body.count() > 0
            newList = []
            for each f in favs
                newList.push(f)
            end for
            newList.push(res.body[0])
            m.top.favorites = newList
            BuildFavoritesResolved()
            m.top.favoritesChanged = { action: "added", channelId: ch.id, fav: res.body[0] }
            ShowToast("★ Favoritado")
        else
            ShowToast("Erro ao favoritar")
        end if
    end if
end sub

' ==================== OK ACTION (no release) ====================

sub HandleOkAction()
    if m.focusZone = "favorites"
        PlayFavoriteFocused()
        return
    end if
    if m.previewIdx >= 0
        PlayPreviewed()
        return
    end if
    if m.osdVisible
        ShowChannelOverlay()
        return
    end if
    ch = m.top.channelData
    ShowOsd(ch)
    ShowFavBar()
    m.osdFromOk = true
end sub

' ==================== KEYS ====================

function onKeyEvent(key as String, press as Boolean) as Boolean
    if key = "back"
        if not press then return false
        if m.focusZone = "list"
            HideChannelOverlay()
            return true
        end if
        if m.focusZone = "favorites"
            m.focusZone = "main"
            HideFavBar()
            RestartOsdTimer()
            return true
        end if
        if m.osdVisible
            HideOsdAll()
            return true
        end if
        m.video.control = "stop"
        m.top.playerClosed = true
        return true
    end if

    ' overlay de lista: left/right paginam; resto entrega pra LabelList
    if m.focusZone = "list"
        if press and (key = "left" or key = "right")
            list = m.top.channelList
            if list = invalid or list.count() = 0 then return true
            pageSize = 14
            cur = m.chOverlay.itemFocused
            if cur < 0 then cur = 0
            if key = "right"
                newIdx = cur + pageSize
                if newIdx >= list.count() then newIdx = list.count() - 1
            else
                newIdx = cur - pageSize
                if newIdx < 0 then newIdx = 0
            end if
            m.chOverlay.jumpToItem = newIdx
            return true
        end if
        return false
    end if

    if key = "OK"
        if press
            m.okHeld = true
            m.longPressFired = false
            m.longPressTimer.control = "stop"
            m.longPressTimer.control = "start"
            return true
        else
            m.okHeld = false
            m.longPressTimer.control = "stop"
            if m.longPressFired
                m.longPressFired = false
                return true
            end if
            HandleOkAction()
            return true
        end if
    end if

    ' RELEASE: ▲/▼ soltos depois de preview → toca o canal previewado
    if not press
        if (key = "up" or key = "down") and m.previewIdx >= 0 and m.focusZone <> "favorites"
            PlayPreviewed()
            return true
        end if
        return false
    end if

    if key = "up"
        if m.focusZone = "favorites"
            RestartOsdTimer()
            return true
        end if
        ' ▲ só abre favoritos se OSD foi aberto via OK e há favoritos
        if m.osdVisible and m.osdFromOk and m.previewIdx < 0 and m.favoritesResolved <> invalid and m.favoritesResolved.count() > 0
            ShowFavBar()
            m.focusZone = "favorites"
            m.favFocusIdx = 0
            HighlightFavFocus()
            RestartOsdTimer()
            return true
        end if
        ' zap direto pra cima (single tap não faz preview)
        ' ▲: preview pra cima (release toca o canal)
        PreviewChannel(1)
        return true
    end if

    if key = "down"
        if m.focusZone = "favorites"
            m.focusZone = "main"
            HideFavBar()
            RestartOsdTimer()
            return true
        end if
        ' ▼: preview pra baixo (release toca o canal)
        PreviewChannel(-1)
        return true
    end if

    if key = "left"
        if m.focusZone = "favorites"
            if m.favFocusIdx > 0
                m.favFocusIdx = m.favFocusIdx - 1
                HighlightFavFocus()
                RestartOsdTimer()
            end if
            return true
        end if
        PreviewChannel(-1)
        return true
    end if

    if key = "right"
        if m.focusZone = "favorites"
            if m.favFocusIdx < m.favoritesResolved.count() - 1
                m.favFocusIdx = m.favFocusIdx + 1
                HighlightFavFocus()
                RestartOsdTimer()
            end if
            return true
        end if
        PreviewChannel(1)
        return true
    end if

    if key = "info"
        ch = m.top.channelData
        if m.osdVisible
            HideOsdAll()
        else
            ShowOsd(ch)
            ShowFavBar()
            m.osdFromOk = true
        end if
        return true
    end if

    if key = "channelup" or key = "fastforward"
        SwitchChannel(1)
        return true
    end if

    if key = "channeldown" or key = "rewind"
        SwitchChannel(-1)
        return true
    end if

    return false
end function
