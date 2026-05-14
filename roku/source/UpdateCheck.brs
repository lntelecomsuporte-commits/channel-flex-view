' UpdateCheck.brs — verifica se há nova versão do channel disponível.
'
' Roku NÃO permite que o app se auto-instale (limitação da plataforma —
' apps sideloaded só atualizam via Channel Store ou re-upload manual no
' dev server). Então só notificamos o usuário.

function CheckForRokuUpdate() as Object
    info = CreateObject("roAppInfo")
    currentStr = info.GetVersion()  ' lê build_version do manifest
    currentCode = currentStr.toInt()
    if currentCode = 0 then return { hasUpdate: false }

    cfg = LNTV_Config()
    res = HttpJson(cfg.baseUrl + "/version.json", "GET", invalid, invalid)
    if not res.ok or res.body = invalid then return { hasUpdate: false, current: currentCode }

    remote = res.body.rokuVersionCode
    if remote = invalid then return { hasUpdate: false, current: currentCode }

    remoteCode = 0
    if type(remote) = "Integer" or type(remote) = "roInt" or type(remote) = "LongInteger"
        remoteCode = remote
    else
        remoteCode = remote.toStr().toInt()
    end if

    return {
        hasUpdate: remoteCode > currentCode
        current: currentCode
        remote: remoteCode
        url: res.body.rokuUrl
        notes: res.body.rokuNotes
    }
end function
