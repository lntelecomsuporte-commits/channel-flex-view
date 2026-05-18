' SupabaseAuth.brs — login, refresh, logout

function SbLogin(email as String, password as String) as Object
    cfg = LNTV_Config()
    url = cfg.baseUrl + "/auth/v1/token?grant_type=password"
    res = HttpJson(url, "POST", { email: email, password: password }, invalid)
    if res.ok and res.body <> invalid and res.body.access_token <> invalid
        RegistrySet("access_token", res.body.access_token)
        RegistrySet("refresh_token", res.body.refresh_token)
        if res.body.user <> invalid and res.body.user.id <> invalid
            RegistrySet("user_id", res.body.user.id)
        end if
        return { ok: true, user: res.body.user }
    end if
    msg = "Falha no login"
    if res.body <> invalid and res.body.error_description <> invalid then msg = res.body.error_description
    if res.body <> invalid and res.body.msg <> invalid then msg = res.body.msg
    return { ok: false, error: msg, status: res.status, raw: res.raw }
end function

function SbRefresh() as Boolean
    rt = RegistryGet("refresh_token")
    if rt = "" then return false
    cfg = LNTV_Config()
    url = cfg.baseUrl + "/auth/v1/token?grant_type=refresh_token"
    res = HttpJson(url, "POST", { refresh_token: rt }, invalid)
    if res.ok and res.body <> invalid and res.body.access_token <> invalid
        RegistrySet("access_token", res.body.access_token)
        RegistrySet("refresh_token", res.body.refresh_token)
        return true
    end if
    return false
end function

function SbAccessToken() as String
    return RegistryGet("access_token")
end function

function SbUserId() as String
    return RegistryGet("user_id")
end function

' Login por CPF (Hubsoft) — gera o e-mail interno {digitos}@tvln.local,
' mesma regra usada pelo webhook do Hubsoft.
function SbLoginCpf(cpf as String, password as String) as Object
    digits = ""
    for i = 0 to Len(cpf) - 1
        c = Mid(cpf, i + 1, 1)
        if Asc(c) >= 48 and Asc(c) <= 57 then digits = digits + c
    end for
    if Len(digits) < 11
        return { ok: false, error: "CPF inválido" }
    end if
    return SbLogin(digits + "@tvln.local", password)
end function

sub SbLogout()
    RegistryClear()
end sub
