package com.shadow3aaa.truidide

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Note: proot 和 rootfs 现在从 GitHub Release 按需下载
    // 不再需要从 libassets.so 解压，大幅减小 APK 体积
    
    // System bars (status bar, navigation bar) safe area insets are handled by
    // tauri-plugin-safe-area-insets-css plugin which exposes CSS variables.
    // Here we only handle IME (keyboard) insets to add padding when the soft
    // keyboard appears, preventing it from covering the webview content.
    WindowCompat.setDecorFitsSystemWindows(window, false)

    val content: View? = findViewById(android.R.id.content)
    content?.let { root ->
      ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
        // Only apply IME inset bottom as padding
        val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
        
        v.updatePadding(
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
