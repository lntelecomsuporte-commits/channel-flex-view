package tv.lntelecom.nativo.ui.channels

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import coil.load
import tv.lntelecom.nativo.R
import tv.lntelecom.nativo.data.StreamUrl
import tv.lntelecom.nativo.data.model.Channel
import tv.lntelecom.nativo.databinding.ItemChannelBinding

class ChannelAdapter(
    private var items: List<Channel> = emptyList(),
    private val onClick: (Channel) -> Unit
) : RecyclerView.Adapter<ChannelAdapter.VH>() {

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
        val logoUrl = StreamUrl.resolveLogo(c.logoUrl)
        if (logoUrl != null) {
            holder.b.logo.load(logoUrl) {
                placeholder(R.drawable.ic_launcher_foreground)
                error(R.drawable.ic_launcher_foreground)
                crossfade(false)
            }
        } else {
            holder.b.logo.setImageResource(R.drawable.ic_launcher_foreground)
        }
        holder.b.root.setOnClickListener { onClick(c) }
    }

    override fun getItemCount() = items.size
}
