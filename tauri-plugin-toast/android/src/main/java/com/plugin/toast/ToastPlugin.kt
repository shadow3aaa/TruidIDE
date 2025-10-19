package com.plugin.toast

import android.app.Activity
import android.webkit.WebView
import android.widget.Toast
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class ToastArgs {
  var text: String? = null
}

@TauriPlugin
class ToastPlugin(private val activity: Activity): Plugin(activity) {
    @Command
    fun toast(invoke: Invoke) {
        val args = invoke.parseArgs(ToastArgs::class.java)
        val text = args.text ?: "No text provided"
        
        // 调用 Android 原生 Toast API
        Toast.makeText(activity, text, Toast.LENGTH_LONG).show()

        invoke.resolve() // 完成调用
    }
}