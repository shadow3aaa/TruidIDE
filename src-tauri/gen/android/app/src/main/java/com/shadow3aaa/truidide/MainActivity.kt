package com.shadow3aaa.truidide

import android.os.Bundle
import android.content.res.AssetManager
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.util.zip.GZIPInputStream
import kotlin.concurrent.thread
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding

import java.util.zip.ZipInputStream

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // On app start, attempt to extract assets/proot from libassets.so into the app files directory
    try {
      thread {
        try {
          val baseOut = File(filesDir, "proot")
          if (!baseOut.exists()) baseOut.mkdirs()

          val libSo = File(applicationInfo.nativeLibraryDir, "libassets.so")
          if (!libSo.exists()) {
            throw Exception("libassets.so not found")
          }

          ZipInputStream(libSo.inputStream()).use { zis ->
            var entry = zis.nextEntry
            while (entry != null) {
              val outFile = File(baseOut, entry.name)
              if (entry.isDirectory) {
                outFile.mkdirs()
              } else {
                outFile.parentFile?.mkdirs()
                FileOutputStream(outFile).use { fos ->
                  zis.copyTo(fos)
                }
              }
              zis.closeEntry()
              entry = zis.nextEntry
            }
          }
          
          // ensure executables in any bin/ are executable
          baseOut.walkTopDown().forEach { f ->
            if (f.isFile && (f.name.startsWith("proot") || f.parentFile?.name == "bin")) {
              f.setExecutable(true)
            }
          }

          Log.i("TruidIDE", "proot assets extracted to ${baseOut.absolutePath}")
        } catch (e: Exception) {
          Log.e("TruidIDE", "failed to extract proot assets: ${e}")
        }
      }
    } catch (e: Exception) {
      Log.e("TruidIDE", "asset extraction setup failed: ${e}")
    }

    // Let us handle window insets (including IME) so we can add padding when the soft
    // keyboard (IME) appears. This prevents the keyboard from covering the webview/editor.
    WindowCompat.setDecorFitsSystemWindows(window, false)

    // Apply IME inset bottom as padding to the activity's content view.
    val content: View? = findViewById(android.R.id.content)
    content?.let { root ->
      ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
        // Get system bars (status/nav) and IME insets
        val systemInsets = insets.getInsets(WindowInsetsCompat.Type.systemBars())
        val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())

        // Apply top padding for status bar, left/right for any system inset, and bottom from IME
        v.updatePadding(
          top = systemInsets.top,
          left = systemInsets.left,
          right = systemInsets.right,
          bottom = imeInsets.bottom,
        )

        // Return the insets unchanged
        insets
      }
      // Request apply insets once to initialize
      ViewCompat.requestApplyInsets(root)
    }
  }
}
