sub init()
    m.top.functionName = "RunTask"
end sub

sub RunTask()
    m.top.result = {
        cats: FetchCategories()
        chs: FetchChannels()
        incs: FetchCategoryIncludes()
        access: FetchUserAccess()
        favs: FetchFavorites()
        prof: FetchProfile()
        update: CheckForRokuUpdate()
    }
end sub