' SupabaseRest.brs — wrappers REST do PostgREST

function SbGet(path as String) as Object
    cfg = LNTV_Config()
    url = cfg.baseUrl + "/rest/v1/" + path
    res = HttpJson(url, "GET", invalid, SbAccessToken())
    if res.status = 401
        if SbRefresh()
            res = HttpJson(url, "GET", invalid, SbAccessToken())
        end if
    end if
    return res
end function

function SbPost(path as String, body as Dynamic) as Object
    cfg = LNTV_Config()
    url = cfg.baseUrl + "/rest/v1/" + path
    req = NewHttp(url, "POST")
    req.addHeader("Authorization", "Bearer " + SbAccessToken())
    req.addHeader("Prefer", "return=representation")
    port = CreateObject("roMessagePort")
    req.setMessagePort(port)
    req.AsyncPostFromString(FormatJson(body))
    msg = wait(20000, port)
    if type(msg) = "roUrlEvent"
        code = msg.getResponseCode()
        text = msg.getString()
        parsed = invalid
        if text <> invalid and text <> "" then parsed = ParseJson(text)
        return { ok: code >= 200 and code < 300, status: code, body: parsed }
    end if
    return { ok: false, status: 0 }
end function

function SbDelete(path as String) as Object
    cfg = LNTV_Config()
    url = cfg.baseUrl + "/rest/v1/" + path
    req = NewHttp(url, "DELETE")
    req.addHeader("Authorization", "Bearer " + SbAccessToken())
    port = CreateObject("roMessagePort")
    req.setMessagePort(port)
    req.AsyncPostFromString("")
    msg = wait(20000, port)
    if type(msg) = "roUrlEvent"
        return { ok: msg.getResponseCode() >= 200 and msg.getResponseCode() < 300, status: msg.getResponseCode() }
    end if
    return { ok: false }
end function

' Domain helpers
function FetchChannels() as Object
    return SbGet("channels?is_active=eq.true&select=id,name,channel_number,stream_url,stream_format,backup_stream_urls,logo_url,category_id,is_adult,epg_url,epg_type,epg_channel_id&order=channel_number.asc")
end function

function FetchCategories() as Object
    return SbGet("categories?select=id,name,position,requires_pin&order=position.asc")
end function

function FetchCategoryIncludes() as Object
    return SbGet("category_includes?select=category_id,included_category_id")
end function

function FetchUserAccess() as Object
    uid = SbUserId()
    return SbGet("user_category_access?user_id=eq." + uid + "&is_active=eq.true&select=category_id,is_trial,trial_expires_at")
end function

function FetchFavorites() as Object
    uid = SbUserId()
    return SbGet("user_favorites?user_id=eq." + uid + "&select=id,channel_id,position&order=position.asc")
end function

function FetchProfile() as Object
    uid = SbUserId()
    return SbGet("profiles?user_id=eq." + uid + "&select=adult_pin,is_blocked,force_signout_at&limit=1")
end function

function AddFavorite(channelId as String) as Object
    uid = SbUserId()
    return SbPost("user_favorites", { user_id: uid, channel_id: channelId, position: 0 })
end function

function RemoveFavorite(favId as String) as Object
    return SbDelete("user_favorites?id=eq." + favId)
end function

' Resolve quais categorias o usuário tem acesso, incluindo hierarquia
function ResolveAllowedCategories(access as Object, includes as Object) as Object
    allowed = {}
    now = CreateObject("roDateTime")
    nowSec = now.AsSeconds()
    if access <> invalid
        for each row in access
            ok = true
            if row.is_trial = true and row.trial_expires_at <> invalid and row.trial_expires_at <> ""
                expDt = CreateObject("roDateTime")
                expDt.FromISO8601String(row.trial_expires_at)
                if expDt.AsSeconds() < nowSec then ok = false
            end if
            if ok then allowed[row.category_id] = true
        end for
    end if
    ' Expansão recursiva via category_includes
    changed = true
    while changed
        changed = false
        if includes <> invalid
            for each rel in includes
                if allowed[rel.category_id] = true and allowed[rel.included_category_id] <> true
                    allowed[rel.included_category_id] = true
                    changed = true
                end if
            end for
        end if
    end while
    return allowed
end function
