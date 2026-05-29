package tv.lntelecom.nativo.data.model

data class Channel(
    val id: String,
    val name: String,
    val channelNumber: Int,
    val streamUrl: String,
    val streamType: String, // "hls" | "mp4"
    val logoUrl: String?,
    val logoSourceUrl: String?,
    val categoryId: String?,
    val categoryName: String?,
    val epgChannelId: String?,
    val isActive: Boolean,
    val updatedAt: String?
)

data class Category(
    val id: String,
    val name: String,
    val sortOrder: Int
)

data class EpgProgram(
    val title: String,
    val description: String?,
    val startMs: Long,
    val endMs: Long
)
