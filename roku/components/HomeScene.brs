' HomeScene.brs — agora é só um loader.
' Espelha o Android: depois do login carrega tudo e abre direto o PlayerScene
' no canal de menor número. A lista de canais e os favoritos ficam dentro do
' player (OK 2x abre a lista). Não há mais coluna de categorias.

sub init()
    m.status = m.top.findNode("status")
    m.updateBanner = m.top.findNode("updateBanner")
    m.hbTimer = m.top.findNode("hbTimer")
    m.categories = []
    m.channels = []
    m.allowed = {}
    m.trialMap = {}
    m.favorites = []
    m.favIndex = {}
    m.allowedChannels = []
    m.currentPlayingCh = invalid
    m.sessionId = ""
    m.adultPin = "1234"
    m.pinOkUntil = 0
    m.unlockedAdult = {}
    m.pinCategoryIds = {}
    m.hbTimer.observeField("fire", "OnHeartbeat")
    LoadAll()
    StartSession()
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
    m.status.visible = true
    task = createObject("roSGNode", "HomeLoadTask")
    task.observeField("result", "OnHomeLoaded")
    m.loadTask = task
    task.control = "RUN"
end sub

sub CheckUpdate(info as Object)
    if info = invalid then return
    if info.hasUpdate = true
        m.updateBanner.text = "⚠ Nova versão (v" + info.remote.toStr() + ") — peça atualização ao provedor"
        m.updateBanner.visible = true
    end if
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
        ' Token provavelmente expirou e refresh falhou → volta pro login.
        if cats.status = 401 or chs.status = 401 or cats.status = 0 or chs.status = 0
            SbLogout()
            m.top.logoutRequested = true
            return
        end if
        m.status.text = "Erro ao carregar dados (" + cats.status.toStr() + "/" + chs.status.toStr() + ")"
        return
    end if

    m.categories = cats.body
    m.channels = chs.body
    m.allowed = ResolveAllowedCategories(access.body, incs.body)

    ' categorias que exigem PIN (igual ao Android: pinCategoryIds)
    for each c in m.categories
        if c.requires_pin = true then m.pinCategoryIds[c.id] = true
    end for

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
        nowSec = CreateObject("roDateTime").AsSeconds()
        m.global.addFields({ epgBundle: bundle, epgFetchedAt: nowSec })
        m.global.epgBundle = bundle
        m.global.epgFetchedAt = nowSec
    end if

    ' monta lista única, só com canais permitidos (categorias acessíveis)
    m.allowedChannels = []
    for each ch in m.channels
        if ch.category_id <> invalid and m.allowed[ch.category_id] = true
            m.allowedChannels.push(ch)
        end if
    end for

    if m.allowedChannels.count() = 0
        m.status.text = "Nenhum canal disponível. Procure o suporte."
        return
    end if

    ' lista já vem ordenada por channel_number ASC do REST — começa no menor
    LaunchPlayer(0)
end sub

sub LaunchPlayer(startIdx as Integer)
    m.status.visible = false
    ch = m.allowedChannels[startIdx]
    if ch = invalid then return
    if IsRestricted(ch) and not IsUnlocked(ch.id)
        AskPin(ch, startIdx)
        return
    end if
    OpenPlayerAt(startIdx)
end sub

function IsRestricted(ch as Object) as Boolean
    if ch = invalid then return false
    if ch.is_adult = true then return true
    if ch.category_id <> invalid and m.pinCategoryIds[ch.category_id] = true then return true
    return false
end function

function IsUnlocked(id as String) as Boolean
    return m.unlockedAdult[id] = true
end function

sub AskPin(ch as Object, idx as Integer)
    dlg = createObject("roSGNode", "PinDialog")
    dlg.expectedPin = m.adultPin
    dlg.observeField("pinResult", "OnPinResult")
    m.pendingChannel = ch
    m.pendingIndex = idx
    m.pinDialog = dlg
    m.top.appendChild(dlg)
    dlg.setFocus(true)
end sub

sub OnPinResult(evt as Object)
    r = evt.getData()
    if m.pinDialog <> invalid then m.top.removeChild(m.pinDialog)
    m.pinDialog = invalid
    ch = m.pendingChannel
    idx = m.pendingIndex
    m.pendingChannel = invalid
    if r = "ok" and ch <> invalid
        m.unlockedAdult[ch.id] = true
        OpenPlayerAt(idx)
    else
        ' usuário cancelou — fecha app
        m.top.logoutRequested = true
    end if
end sub

sub OpenPlayerAt(idx as Integer)
    if m.player <> invalid
        m.player.channelIndex = idx
        m.player.channelData = m.allowedChannels[idx]
        m.player.setFocus(true)
        return
    end if
    p = createObject("roSGNode", "PlayerScene")
    p.channelList = m.allowedChannels
    p.channelIndex = idx
    p.favorites = m.favorites
    p.adultPin = m.adultPin
    p.unlockedIds = m.unlockedAdult
    p.pinCategoryIds = m.pinCategoryIds
    p.channelData = m.allowedChannels[idx]
    m.top.appendChild(p)
    p.observeField("playerClosed", "OnPlayerClosed")
    p.observeField("channelData", "OnPlayerChannelChanged")
    p.observeField("favoritesChanged", "OnPlayerFavoritesChanged")
    p.observeField("unlockRequest", "OnUnlockRequest")
    p.setFocus(true)
    m.player = p
    m.currentPlayingCh = m.allowedChannels[idx]
    OnHeartbeat(invalid)
end sub

sub OnUnlockRequest(evt as Object)
    info = evt.getData()
    if info = invalid or info.channelId = invalid then return
    ch = invalid
    for each c in m.allowedChannels
        if c.id = info.channelId
            ch = c
            exit for
        end if
    end for
    if ch = invalid then return
    dlg = createObject("roSGNode", "PinDialog")
    dlg.expectedPin = m.adultPin
    dlg.observeField("pinResult", "OnInPlayerPinResult")
    m.pendingUnlockCh = ch
    m.pinDialog = dlg
    m.top.appendChild(dlg)
    dlg.setFocus(true)
end sub

sub OnInPlayerPinResult(evt as Object)
    r = evt.getData()
    if m.pinDialog <> invalid then m.top.removeChild(m.pinDialog)
    m.pinDialog = invalid
    ch = m.pendingUnlockCh
    m.pendingUnlockCh = invalid
    if ch = invalid then return
    if r = "ok"
        m.unlockedAdult[ch.id] = true
        if m.player <> invalid
            m.player.unlockedIds = m.unlockedAdult
            m.player.setFocus(true)
        end if
    else
        if m.player <> invalid
            ' volta pro canal anterior ainda no player
            m.player.revertRestricted = true
            m.player.setFocus(true)
        end if
    end if
end sub

sub OnPlayerFavoritesChanged(evt as Object)
    info = evt.getData()
    if info = invalid then return
    if info.action = "added" and info.fav <> invalid
        m.favorites.push(info.fav)
        m.favIndex[info.fav.channel_id] = info.fav.id
    else if info.action = "removed"
        newFavs = []
        for each f in m.favorites
            if f.channel_id <> info.channelId then newFavs.push(f)
        end for
        m.favorites = newFavs
        m.favIndex.Delete(info.channelId)
    end if
end sub

sub OnPlayerChannelChanged(evt as Object)
    ch = evt.getData()
    if ch = invalid then return
    m.currentPlayingCh = ch
    OnHeartbeat(invalid)
end sub

sub OnPlayerClosed(evt as Object)
    ' Voltar do player → fecha app preservando a sessão.
    if m.player <> invalid
        m.top.removeChild(m.player)
        m.player = invalid
    end if
    m.currentPlayingCh = invalid
    OnHeartbeat(invalid)
    ' IMPORTANTE: NÃO mexer em logoutRequested aqui — o campo tem alwaysNotify
    ' e dispararia OnLogout no RootScene, limpando o token e forçando relogin.
    m.top.exitRequested = true
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "back"
        return false
    end if
    return false
end function
