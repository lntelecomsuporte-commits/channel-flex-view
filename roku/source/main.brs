' main.brs — entrypoint do channel LN TV Roku
sub Main(args as Dynamic)
    screen = CreateObject("roSGScreen")
    m.port = CreateObject("roMessagePort")
    screen.setMessagePort(m.port)

    ' ── Monitoramento de memória (exigido pela certificação Roku RSG 1.3) ──
    di = CreateObject("roDeviceInfo")
    di.SetMessagePort(m.port)
    di.EnableLowGeneralMemoryEvent(true)
    di.EnableMemoryWarningEvent(true)

    ' Log inicial dos limites/uso (ajuda em diagnóstico de OOM)
    if di.GetOsVersion <> invalid then
        os = di.GetOsVersion()
        print "[LNTV] Roku OS "; os.major; "."; os.minor; "."; os.revision; " build "; os.build
    end if
    print "[LNTV] MemoryLimitPercent="; di.GetMemoryLimitPercent()
    print "[LNTV] ChannelMemoryLimit="; di.GetChannelMemoryLimit()
    print "[LNTV] ChannelAvailableMemory="; di.GetChannelAvailableMemory()

    scene = screen.CreateScene("RootScene")
    screen.show()

    while true
        msg = wait(0, m.port)
        msgType = type(msg)
        if msgType = "roSGScreenEvent"
            if msg.isScreenClosed() then return
        else if msgType = "roDeviceInfoEvent"
            info = msg.GetInfo()
            if info <> invalid and info.LowMemory <> invalid then
                print "[LNTV] LowMemory event: "; info.LowMemory
                ' Em caso de aviso/crítico, libera caches voláteis
                if scene <> invalid and scene.hasField("memoryWarning") then
                    scene.memoryWarning = info.LowMemory
                end if
                print "[LNTV] AvailableMemory now="; di.GetChannelAvailableMemory()
            end if
        end if
    end while
end sub
