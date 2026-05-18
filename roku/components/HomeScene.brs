sub init()
    m.catList = m.top.findNode("catList")
    m.chList = m.top.findNode("chList")
    m.status = m.top.findNode("status")
    m.epgNow = m.top.findNode("epgNow")
    m.epgNext = m.top.findNode("epgNext")
    m.trialBadge = m.top.findNode("trialBadge")
    m.hbTimer = m.top.findNode("hbTimer")
    m.activeCol = "cat"
    m.categories = []
    m.channels = []
    m.allowed = {}
    m.trialMap = {}      ' category_id -> trial_expires_at iso
    m.favorites = []
    m.favIndex = {}
    m.currentChannels = []
    m.adultPin = "1234"
    m.pinOkUntil = 0     ' epoch sec
    m.sessionId = ""
    m.catList.observeField("itemSelected", "OnCatSelected")
    m.catList.observeField("itemFocused", "OnCatFocused")
    m.chList.observeField("itemSelected", "OnChSelected")
    m.chList.observeField("itemFocused", "OnChFocused")
    m.hbTimer.observeField("fire", "OnHeartbeat")
    LoadAll()
    StartSession()
end sub

sub CheckUpdate(info as Object)
    if info = invalid then return
    if info.hasUpdate = true
        banner = m.top.findNode("updateBanner")
        banner.text = "⚠ Nova versão do app disponível (v" + info.remote.toStr() + ") — peça pro provedor atualizar"
        banner.visible = true
    end if
end sub

sub StartSession()
    task = createObject("roSGNode", "HeartbeatTask")
    task.action = "start"
    task.isWatching = false
    task.observeField("result", "OnSessionStarted")
    task.control = "RUN"
    m.startTask = task
end sub

sub OnSessionStarted(evt as Object)
    res = evt.getData()
    if res = invalid then return
    if res.forceSignout = true
        m.top.forceSignout = true
        return
    end if
    if res.id <> invalid then m.sessionId = res.id
    m.hbTimer.control = "start"
end sub

sub OnHeartbeat(evt as Object)
    if m.sessionId = "" then return
    task = createObject("roSGNode", "HeartbeatTask")
    task.action = "heartbeat"
    task.sessionId = m.sessionId
    task.isWatching = (m.player <> invalid)
    if m.currentPlayingCh <> invalid
        if m.currentPlayingCh.id <> invalid then task.channelId = m.currentPlayingCh.id
        if m.currentPlayingCh.name <> invalid then task.channelName = m.currentPlayingCh.name
    end if
    task.observeField("result", "OnHeartbeatDone")
    task.control = "RUN"
end sub

sub OnHeartbeatDone(evt as Object)
    res = evt.getData()
    if res <> invalid and res.forceSignout = true
        m.top.forceSignout = true
    end if
end sub

sub LoadAll()
    m.status.text = "Carregando canais..."
    task = createObject("roSGNode", "HomeLoadTask")
    task.observeField("result", "OnHomeLoaded")
    m.loadTask = task
    task.control = "RUN"
end sub

sub OnHomeLoaded(evt as Object)
    data = evt.getData()
    if data = invalid
        m.status.text = "Erro ao carregar dados"
        return
    end if
    cats = data.cats
    chs = data.chs
    incs = data.incs
    access = data.access
    favs = data.favs
    prof = data.prof
    epg = data.epg
    CheckUpdate(data.update)

    if not cats.ok or not chs.ok
        m.status.text = "Erro ao carregar dados (status " + cats.status.toStr() + "/" + chs.status.toStr() + ")"
        return
    end if

    m.categories = cats.body
    m.channels = chs.body
    m.allowed = ResolveAllowedCategories(access.body, incs.body)

    if access.ok and access.body <> invalid
        for each row in access.body
            if row.is_trial = true and row.trial_expires_at <> invalid
                m.trialMap[row.category_id] = row.trial_expires_at
            end if
        end for
    end if

    if prof.ok and prof.body <> invalid and prof.body.count() > 0
        if prof.body[0].adult_pin <> invalid and prof.body[0].adult_pin <> ""
            m.adultPin = prof.body[0].adult_pin
        end if
    end if

    if favs.ok and favs.body <> invalid
        m.favorites = favs.body
        for each f in favs.body
            m.favIndex[f.channel_id] = f.id
        end for
    end if

    if epg <> invalid and epg.ok and epg.body <> invalid
        bundle = epg.body.byChannel
        if bundle = invalid then bundle = epg.body
        m.global.epgBundle = bundle
        m.global.epgFetchedAt = CreateObject("roDateTime").AsSeconds()
    end if

    BuildCategoryList()
    m.status.text = ""
    m.catList.setFocus(true)
end sub

sub BuildCategoryList()
    items = [{ title: "★ Favoritos" }]
    m.catRefs = ["__fav__"]
    for each c in m.categories
        if m.allowed[c.id] = true
            label = c.name
            if m.trialMap[c.id] <> invalid then label = label + "  (degustação)"
            items.push({ title: label })
            m.catRefs.push(c.id)
        end if
    end for
    m.catList.content = BuildContentNode(items)
    if items.count() > 0
        m.catList.jumpToItem = 0
        UpdateChannelsFor(m.catRefs[0])
    end if
end sub

function BuildContentNode(items as Object) as Object
    root = createObject("roSGNode", "ContentNode")
    for each it in items
        n = root.createChild("ContentNode")
        n.title = it.title
    end for
    return root
end function

sub OnCatFocused(evt as Object)
    idx = evt.getData()
    if idx >= 0 and idx < m.catRefs.count()
        UpdateChannelsFor(m.catRefs[idx])
        UpdateTrialBadge(m.catRefs[idx])
    end if
end sub

sub UpdateTrialBadge(catRef as String)
    if m.trialMap[catRef] <> invalid
        m.trialBadge.text = "Degustação até " + FmtTrialDate(m.trialMap[catRef])
        m.trialBadge.visible = true
    else
        m.trialBadge.visible = false
    end if
end sub

function FmtTrialDate(iso as String) as String
    dt = CreateObject("roDateTime")
    dt.FromISO8601String(iso)
    dt.ToLocalTime()
    return Pad2(dt.GetDayOfMonth()) + "/" + Pad2(dt.GetMonth()) + "/" + dt.GetYear().toStr()
end function

sub OnCatSelected(evt as Object)
    m.activeCol = "ch"
    m.chList.setFocus(true)
end sub

sub UpdateChannelsFor(catRef as String)
    list = []
    if catRef = "__fav__"
        for each f in m.favorites
            for each ch in m.channels
                if ch.id = f.channel_id
                    list.push(ch)
                    exit for
                end if
            end for
        end for
    else
        for each ch in m.channels
            if ch.category_id = catRef and m.allowed[ch.category_id] = true
                list.push(ch)
            end if
        end for
    end if
    m.currentChannels = list
    items = []
    for each ch in list
        prefix = ""
        if m.favIndex[ch.id] <> invalid then prefix = "★ "
        adult = ""
        if ch.is_adult = true then adult = " 🔞"
        num = ""
        if ch.channel_number <> invalid then num = ch.channel_number.toStr() + "  "
        items.push({ title: prefix + num + ch.name + adult })
    end for
    if items.count() = 0
        items.push({ title: "(vazio)" })
    end if
    m.chList.content = BuildContentNode(items)
    UpdateEpgPreview()
end sub

sub OnChFocused(evt as Object)
    UpdateEpgPreview()
end sub

sub UpdateEpgPreview()
    idx = m.chList.itemFocused
    if idx < 0 or idx >= m.currentChannels.count()
        m.epgNow.text = ""
        m.epgNext.text = ""
        return
    end if
    ch = m.currentChannels[idx]
    epgId = invalid
    if ch.epg_channel_id <> invalid then epgId = ch.epg_channel_id
    info = EpgCurrentAndNext(epgId)
    if info.current <> invalid
        m.epgNow.text = "▶ " + FormatHHMM(info.current.start_date) + "  " + info.current.title
    else
        m.epgNow.text = ""
    end if
    if info.nextProg <> invalid
        m.epgNext.text = "↳ " + FormatHHMM(info.nextProg.start_date) + "  " + info.nextProg.title
    else
        m.epgNext.text = ""
    end if
end sub

sub OnChSelected(evt as Object)
    idx = evt.getData()
    if idx < 0 or idx >= m.currentChannels.count() then return
    ch = m.currentChannels[idx]
    if ch.is_adult = true and not PinValid()
        AskPin(ch)
        return
    end if
    PlayChannel(ch)
end sub

function PinValid() as Boolean
    nowSec = CreateObject("roDateTime").AsSeconds()
    return m.pinOkUntil > nowSec
end function

sub AskPin(ch as Object)
    dlg = createObject("roSGNode", "PinDialog")
    dlg.expectedPin = m.adultPin
    dlg.observeField("pinResult", "OnPinResult")
    m.pendingChannel = ch
    m.pinDialog = dlg
    m.top.appendChild(dlg)
    dlg.setFocus(true)
end sub

sub OnPinResult(evt as Object)
    r = evt.getData()
    if m.pinDialog <> invalid then m.top.removeChild(m.pinDialog)
    m.pinDialog = invalid
    if r = "ok"
        m.pinOkUntil = CreateObject("roDateTime").AsSeconds() + 1800
        ch = m.pendingChannel
        m.pendingChannel = invalid
        if ch <> invalid then PlayChannel(ch)
    else
        m.chList.setFocus(true)
    end if
end sub

sub PlayChannel(ch as Object)
    p = createObject("roSGNode", "PlayerScene")
    p.channelData = ch
    m.top.appendChild(p)
    p.observeField("playerClosed", "OnPlayerClosed")
    p.setFocus(true)
    m.player = p
    m.currentPlayingCh = ch
    OnHeartbeat(invalid)  ' notifica imediatamente que está assistindo
end sub

sub OnPlayerClosed(evt as Object)
    if m.player <> invalid
        m.top.removeChild(m.player)
        m.player = invalid
    end if
    m.currentPlayingCh = invalid
    OnHeartbeat(invalid)
    if m.activeCol = "ch" then m.chList.setFocus(true) else m.catList.setFocus(true)
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "left"
        m.activeCol = "cat"
        m.catList.setFocus(true)
        return true
    end if
    if key = "right"
        m.activeCol = "ch"
        m.chList.setFocus(true)
        return true
    end if
    if key = "info"
        ToggleFavorite()
        return true
    end if
    if key = "search"
        ShowSearch()
        return true
    end if
    if key = "back"
        ' Deixa o sistema fechar o app — NÃO faz logout aqui.
        return false
    end if
    return false
end function

sub ToggleFavorite()
    idx = m.chList.itemFocused
    if idx < 0 or idx >= m.currentChannels.count() then return
    ch = m.currentChannels[idx]
    favId = m.favIndex[ch.id]
    if favId <> invalid
        res = RemoveFavorite(favId)
        if res.ok
            m.favIndex.Delete(ch.id)
            newFavs = []
            for each f in m.favorites
                if f.id <> favId then newFavs.push(f)
            end for
            m.favorites = newFavs
        end if
    else
        res = AddFavorite(ch.id)
        if res.ok and res.body <> invalid and res.body.count() > 0
            m.favIndex[ch.id] = res.body[0].id
            m.favorites.push(res.body[0])
        end if
    end if
    UpdateChannelsFor(m.catRefs[m.catList.itemFocused])
    m.chList.jumpToItem = idx
end sub

sub ShowSearch()
    dlg = createObject("roSGNode", "KeyboardDialog")
    dlg.title = "Buscar canal (nome ou número)"
    dlg.buttons = ["Buscar", "Cancelar"]
    dlg.observeField("buttonSelected", "OnSearchButton")
    m.searchDlg = dlg
    m.top.getScene().dialog = dlg
end sub

sub OnSearchButton(evt as Object)
    idx = evt.getData()
    dlg = m.searchDlg
    q = ""
    if dlg <> invalid then q = LCase(dlg.textEditBox.text)
    if dlg <> invalid then dlg.close = true
    m.searchDlg = invalid
    if idx <> 0 or q = "" then return
    matches = []
    for each ch in m.channels
        if m.allowed[ch.category_id] = true
            hay = LCase(ch.name)
            num = ""
            if ch.channel_number <> invalid then num = ch.channel_number.toStr()
            if Instr(1, hay, q) > 0 or num = q
                matches.push(ch)
            end if
        end if
    end for
    if matches.count() = 0
        m.status.text = "Nenhum canal encontrado para: " + q
        return
    end if
    m.status.text = matches.count().toStr() + " resultado(s) para: " + q
    ' Sobrescreve a coluna direita com os resultados
    m.currentChannels = matches
    items = []
    for each ch in matches
        prefix = ""
        if m.favIndex[ch.id] <> invalid then prefix = "★ "
        num = ""
        if ch.channel_number <> invalid then num = ch.channel_number.toStr() + "  "
        items.push({ title: prefix + num + ch.name })
    end for
    m.chList.content = BuildContentNode(items)
    m.chList.jumpToItem = 0
    m.chList.setFocus(true)
    m.activeCol = "ch"
end sub
