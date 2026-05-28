package tv.lntelecom.nativo.update

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File

/**
 * Recebe o APK baixado e dispara o instalador do sistema.
 * Em Android 8+ é o usuário que precisa ter habilitado "Instalar de fontes desconhecidas"
 * (ou conceder REQUEST_INSTALL_PACKAGES).
 */
class UpdateInstallActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val path = intent.getStringExtra("apkPath")
        if (path == null) { finish(); return }
        val file = File(path)
        if (!file.exists()) { finish(); return }

        val uri: Uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
        val install = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            startActivity(install)
        } catch (e: Exception) {
            Toast.makeText(this, "Falha ao iniciar instalador", Toast.LENGTH_LONG).show()
        }
        finish()
    }
}
