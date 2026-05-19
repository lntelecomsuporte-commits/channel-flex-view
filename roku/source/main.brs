' main.brs — entrypoint do channel LN TV Roku
sub Main(args as Dynamic)
    screen = CreateObject("roSGScreen")
    m.port = CreateObject("roMessagePort")
    screen.setMessagePort(m.port)

    scene = screen.CreateScene("RootScene")
    screen.show()

    ' ── Monitoramento de memória (RSG 1.3) ──
    ' Só inicializa depois da RootScene aparecer, para nunca travar a tela de login
    ' caso alguma API não exista no firmware/dispositivo.
    monitors = InitMemoryMonitoring(m.port)
    di = monitors.di
    appMemory = monitors.appMemory

    while true
        msg = wait(0, m.port)
        msgType = type(msg)
        if msgType = "roSGScreenEvent"
            if msg.isScreenClosed() then return
        else if msgType = "roDeviceInfoEvent"
            info = msg.GetInfo()
            if info <> invalid and info.generalMemoryLevel <> invalid then
                print "[LNTV] generalMemoryLevel event: "; info.generalMemoryLevel
                ' Em caso de aviso/crítico, libera caches voláteis
                if scene <> invalid and scene.hasField("memoryWarning") then
                    scene.memoryWarning = info.generalMemoryLevel
                end if
                if appMemory <> invalid then LogAvailableMemory(appMemory)
            end if
        else if msgType = "roAppMemoryMonitorEvent"
            info = msg.GetInfo()
            print "[LNTV] App memory warning: "; info
            if scene <> invalid and scene.hasField("memoryWarning") then
                scene.memoryWarning = info
            end if
        end if
    end while
end sub

function InitMemoryMonitoring(port as Object) as Object
    di = invalid
    appMemory = invalid
    try
        di = CreateObject("roDeviceInfo")
        di.SetMessagePort(port)
        di.EnableLowGeneralMemoryEvent(true)
        os = di.GetOsVersion()
        if os <> invalid then print "[LNTV] Roku OS "; os.major; "."; os.minor; "."; os.revision; " build "; os.build
    catch e
        print "[LNTV] roDeviceInfo memory monitoring skipped: "; e.message
        di = invalid
    end try

    try
        appMemory = CreateObject("roAppMemoryMonitor")
        appMemory.SetMessagePort(port)
        appMemory.EnableMemoryWarningEvent(true)
        print "[LNTV] MemoryLimitPercent="; appMemory.GetMemoryLimitPercent()
        print "[LNTV] ChannelMemoryLimit="; appMemory.GetChannelMemoryLimit()
        LogAvailableMemory(appMemory)
    catch e
        print "[LNTV] roAppMemoryMonitor skipped: "; e.message
        appMemory = invalid
    end try

    return { di: di, appMemory: appMemory }
end function

sub LogAvailableMemory(appMemory as Object)
    try
        print "[LNTV] ChannelAvailableMemory="; appMemory.GetChannelAvailableMemory()
    catch e
        print "[LNTV] ChannelAvailableMemory unavailable: "; e.message
    end try
end sub
