sub init()
    m.top.functionName = "RunTask"
end sub

sub RunTask()
    if m.top.action = "add"
        m.top.result = AddFavorite(m.top.channelId)
    else if m.top.action = "remove"
        res = RemoveFavorite(m.top.favoriteId)
        m.top.result = res
    end if
end sub
