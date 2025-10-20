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
