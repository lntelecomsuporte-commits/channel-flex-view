sub init()
    m.top.functionName = "RunTask"
end sub

sub RunTask()
    cfg = LNTV_Config()
    epg = HttpJson(cfg.baseUrl + "/epg/lntv.json", "GET", invalid, invalid)
    m.top.result = {
        cats: FetchCategories()
        chs: FetchChannels()
        incs: FetchCategoryIncludes()
        access: FetchUserAccess()
        favs: FetchFavorites()
        prof: FetchProfile()
        epg: epg
        update: CheckForRokuUpdate()
    }
end sub