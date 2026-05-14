sub init()
    m.video = m.top.findNode("video")
    m.osdBg = m.top.findNode("osdBg")
    m.osdName = m.top.findNode("osdName")
    m.osdNum = m.top.findNode("osdNum")
    m.errLabel = m.top.findNode("errLabel")
    m.osdTimer = m.top.findNode("osdTimer")
    m.top.observeField("channelData", "OnChannelData")
    m.video.observeField("state", "OnState")
    m.osdTimer.observeField("fire", "HideOsd")
end sub

sub OnChannelData()
    ch = m.top.channelData
    if ch = invalid then return
    urls = [ch.stream_url]
    if ch.backup_stream_urls <> invalid
        for each u in ch.backup_stream_urls
            urls.push(u)
        end for
    end if
    fmt = "hls"
    if ch.stream_format = "mp4" then fmt = "mp4"

    content = createObject("roSGNode", "ContentNode")
    content.streamFormat = fmt
    content.url = urls[0]
    if urls.count() > 1
        content.streamUrls = urls
    end if
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
    m.osdName.text = ch.name
    if ch.channel_number <> invalid
        m.osdNum.text = "Canal " + ch.channel_number.toStr()
    else
        m.osdNum.text = ""
    end if
    m.osdTimer.control = "stop"
    m.osdTimer.control = "start"
end sub

sub HideOsd()
    m.osdBg.visible = false
    m.osdName.visible = false
    m.osdNum.visible = false
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
