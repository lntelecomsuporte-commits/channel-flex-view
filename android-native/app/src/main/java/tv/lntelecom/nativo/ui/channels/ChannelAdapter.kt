package tv.lntelecom.nativo.ui.channels

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import coil.load
import tv.lntelecom.nativo.R
import tv.lntelecom.nativo.data.EpgRepository
import tv.lntelecom.nativo.data.StreamUrl
import tv.lntelecom.nativo.data.model.Channel
import tv.lntelecom.nativo.databinding.ItemChannelBinding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class ChannelAdapter(
    private var items: List<Channel> = emptyList(),
    private val epg: EpgRepository? = null,
    private val onClick: (Channel) -> Unit
) : RecyclerView.Adapter<ChannelAdapter.VH>() {

    private val timeFmt = SimpleDateFormat("HH:mm", Locale.getDefault())

    fun submit(list: List<Channel>) {
        items = list
        notifyDataSetChanged()
    }

    class VH(val b: ItemChannelBinding) : RecyclerView.ViewHolder(b.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val b = ItemChannelBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return VH(b)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val c = items[position]
        holder.b.channelNumber.text = c.channelNumber.toString()
        holder.b.channelName.text = c.name
        holder.b.channelCategory.text = c.categoryName ?: ""

        val now = epg?.currentProgram(c.epgChannelId)
        if (now != null) {
            holder.b.channelEpg.text = "${timeFmt.format(Date(now.startMs))} • ${now.title}"
            holder.b.channelEpg.visibility = android.view.View.VISIBLE
        } else {
            holder.b.channelEpg.text = ""
            holder.b.channelEpg.visibility = android.view.View.GONE
        }

        val logoUrl = StreamUrl.resolveLogo(c.logoUrl, c.logoSourceUrl)
        if (logoUrl != null) {
            holder.b.logo.load(logoUrl) {
                placeholder(R.mipmap.ic_launcher)
                error(R.mipmap.ic_launcher)
                crossfade(false)
            }
        } else {
            holder.b.logo.setImageResource(R.mipmap.ic_launcher)
        }
        holder.b.root.setOnClickListener { onClick(c) }
    }

    override fun getItemCount() = items.size
}
