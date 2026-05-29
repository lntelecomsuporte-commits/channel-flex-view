package tv.lntelecom.nativo.data

import tv.lntelecom.nativo.data.model.Channel

/**
 * Holder estático em memória pra compartilhar a lista de canais
 * entre o loader e o PlayerActivity (que mostra a lista como overlay
 * mantendo o vídeo rodando).
 */
object ChannelStore {
    @Volatile var channels: List<Channel> = emptyList()
}
