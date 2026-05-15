' EpgClient.brs — busca o EPG consolidado (JSON pré-parseado) servido pelo
' nginx em /epg/lntv.json. O servidor (sync-epg.mjs) atualiza esse arquivo
' a cada 3h. Cacheamos em m global por 1h para não baixar múltiplas vezes.

function EpgFetch() as Object
    if m.global = invalid then return invalid
    if m.global.epgBundle <> invalid and m.global.epgFetchedAt <> invalid
        ageSec = CreateObject("roDateTime").AsSeconds() - m.global.epgFetchedAt
        if ageSec < 3600 then return m.global.epgBundle
    end if

    cfg = LNTV_Config()
    res = HttpJson(cfg.baseUrl + "/epg/lntv.json", "GET", invalid, invalid)
    if not res.ok or res.body = invalid then return invalid

    bundle = res.body.byChannel
    if bundle = invalid then bundle = res.body  ' fallback se vier sem wrapper
    m.global.epgBundle = bundle
    m.global.epgFetchedAt = CreateObject("roDateTime").AsSeconds()
    return bundle
end function

' Devolve {current, next} para um epg_channel_id. Programs já vêm ordenados.
function EpgCurrentAndNext(epgChannelId as Dynamic) as Object
    out = { current: invalid, nextProg: invalid }
    if epgChannelId = invalid or epgChannelId = "" then return out
    bundle = EpgFetch()
    if bundle = invalid then return out
    programs = bundle[epgChannelId]
    if programs = invalid or programs.count() = 0 then return out

    nowSec = CreateObject("roDateTime").AsSeconds()
    for i = 0 to programs.count() - 1
        startSec = IsoToSec(programs[i].start_date)
        endSec = 0
        if i + 1 < programs.count() then endSec = IsoToSec(programs[i + 1].start_date)
        if startSec <= nowSec and (endSec = 0 or endSec > nowSec)
            out.current = programs[i]
            if i + 1 < programs.count() then out.nextProg = programs[i + 1]
            return out
        end if
    end for
    ' fallback: último que já começou
    for i = programs.count() - 1 to 0 step -1
        if IsoToSec(programs[i].start_date) <= nowSec
            out.current = programs[i]
            if i + 1 < programs.count() then out.nextProg = programs[i + 1]
            return out
        end if
    end for
    return out
end function

function IsoToSec(iso as Dynamic) as Integer
    if iso = invalid or iso = "" then return 0
    dt = CreateObject("roDateTime")
    dt.FromISO8601String(iso)
    return dt.AsSeconds()
end function

function FormatHHMM(iso as Dynamic) as String
    if iso = invalid or iso = "" then return ""
    dt = CreateObject("roDateTime")
    dt.FromISO8601String(iso)
    dt.ToLocalTime()
    h = dt.GetHours()
    m = dt.GetMinutes()
    return Pad2(h) + ":" + Pad2(m)
end function

function Pad2(n as Integer) as String
    s = n.toStr()
    if Len(s) = 1 then s = "0" + s
    return s
end function
