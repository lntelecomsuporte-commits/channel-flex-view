sub init()
    m.catList = m.top.findNode("catList")
    m.chList = m.top.findNode("chList")
    m.status = m.top.findNode("status")
    m.activeCol = "cat"  ' or "ch"
    m.categories = []
    m.channels = []
    m.allowed = {}
    m.favorites = []
    m.favIndex = {}     ' channel_id -> favorite_id
    m.currentChannels = []
    m.catList.observeField("itemSelected", "OnCatSelected")
    m.catList.observeField("itemFocused", "OnCatFocused")
    m.chList.observeField("itemSelected", "OnChSelected")
    LoadAll()
end sub

sub LoadAll()
    cats = FetchCategories()
    chs = FetchChannels()
    incs = FetchCategoryIncludes()
    access = FetchUserAccess()
    favs = FetchFavorites()

    if not cats.ok or not chs.ok
        m.status.text = "Erro ao carregar dados (status " + cats.status.toStr() + "/" + chs.status.toStr() + ")"
        return
    end if

    m.categories = cats.body
    m.channels = chs.body
    m.allowed = ResolveAllowedCategories(access.body, incs.body)
    if favs.ok and favs.body <> invalid
        m.favorites = favs.body
        for each f in favs.body
            m.favIndex[f.channel_id] = f.id
        end for
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
            items.push({ title: c.name })
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
    end if
end sub

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
        num = ""
        if ch.channel_number <> invalid then num = ch.channel_number.toStr() + "  "
        items.push({ title: prefix + num + ch.name })
    end for
    if items.count() = 0
        items.push({ title: "(vazio)" })
    end if
    m.chList.content = BuildContentNode(items)
end sub

sub OnChSelected(evt as Object)
    idx = evt.getData()
    if idx < 0 or idx >= m.currentChannels.count() then return
    ch = m.currentChannels[idx]
    PlayChannel(ch)
end sub

sub PlayChannel(ch as Object)
    p = createObject("roSGNode", "PlayerScene")
    p.channelData = ch
    m.top.appendChild(p)
    p.observeField("playerClosed", "OnPlayerClosed")
    p.setFocus(true)
    m.player = p
end sub

sub OnPlayerClosed(evt as Object)
    if m.player <> invalid
        m.top.removeChild(m.player)
        m.player = invalid
    end if
    if m.activeCol = "ch"
        m.chList.setFocus(true)
    else
        m.catList.setFocus(true)
    end if
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
    if key = "back"
        m.top.logoutRequested = true
        return true
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
    ' refresh visual
    UpdateChannelsFor(m.catRefs[m.catList.itemFocused])
    m.chList.jumpToItem = idx
end sub
