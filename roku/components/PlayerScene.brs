sub init()
    m.video = m.top.findNode("video")
    m.osdBg = m.top.findNode("osdBg")
    m.osdName = m.top.findNode("osdName")
    m.osdNum = m.top.findNode("osdNum")
    m.osdNow = m.top.findNode("osdNow")
    m.osdNext = m.top.findNode("osdNext")
    m.errLabel = m.top.findNode("errLabel")
    m.osdTimer = m.top.findNode("osdTimer")
    m.top.observeField("channelData", "OnChannelData")
    m.video.observeField("state", "OnState")
    m.osdTimer.observeField("fire", "HideOsd")
end sub

sub OnChannelData()
    ch = m.top.channelData
    if ch = invalid then return
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

    m.video.content = content
    m.video.control = "play"
    ShowOsd()
end sub

sub ShowOsd()
    ch = m.top.channelData
    m.osdBg.visible = true
    m.osdName.visible = true
    m.osdNum.visible = true
    m.osdNow.visible = true
    m.osdNext.visible = true
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
    m.osdTimer.control = "stop"
    m.osdTimer.control = "start"
end sub

sub HideOsd()
    m.osdBg.visible = false
    m.osdName.visible = false
    m.osdNum.visible = false
    m.osdNow.visible = false
    m.osdNext.visible = false
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

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "back"
        m.video.control = "stop"
        m.top.playerClosed = true
        return true
    end if
    if key = "OK" or key = "info"
        ShowOsd()
        return true
    end if
    return false
end function
