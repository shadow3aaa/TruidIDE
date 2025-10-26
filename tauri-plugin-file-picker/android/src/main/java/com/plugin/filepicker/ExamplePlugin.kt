package com.plugin.filepicker

import android.app.Activity
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import java.io.File

@InvokeArg
class PingArgs {
  var value: String? = null
}

@InvokeArg
class ReadContentUriArgs {
  lateinit var contentUri: String
  var targetPath: String? = null
}

@TauriPlugin
class ExamplePlugin(private val activity: Activity): Plugin(activity) {
    private val implementation = Example()

    @Command
    fun ping(invoke: Invoke) {
        val args = invoke.parseArgs(PingArgs::class.java)

        val ret = JSObject()
        ret.put("value", implementation.pong(args.value ?: "default value :("))
        invoke.resolve(ret)
    }

    /**
     * 从 Content URI 读取文件并保存到指定路径
     * 如果未指定 targetPath，则返回 Base64 编码的文件内容
     */
    @Command
    fun readContentUri(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(ReadContentUriArgs::class.java)
            val contentUri = args.contentUri

            if (!contentUri.startsWith("content://")) {
                invoke.reject("无效的 Content URI: $contentUri")
                return
            }

            val targetPath = args.targetPath
            val ret = JSObject()

            if (targetPath != null) {
                // 复制到指定路径
                val targetFile = File(targetPath)
                val parentDir = targetFile.parentFile
                
                if (parentDir != null && !parentDir.exists()) {
                    parentDir.mkdirs()
                }

                val success = implementation.copyContentUriToFile(activity, contentUri, targetFile)
                
                if (success) {
                    ret.put("path", targetFile.absolutePath)
                    ret.put("success", true)
                    invoke.resolve(ret)
                } else {
                    invoke.reject("复制 Content URI 文件失败")
                }
            } else {
                // 读取内容并返回 Base64
                val content = implementation.readContentUri(activity, contentUri)
                
                if (content != null) {
                    val base64 = Base64.encodeToString(content, Base64.DEFAULT)
                    ret.put("content", base64)
                    ret.put("size", content.size)
                    ret.put("success", true)
                    invoke.resolve(ret)
                } else {
                    invoke.reject("读取 Content URI 失败")
                }
            }
        } catch (e: Exception) {
            invoke.reject("读取 Content URI 时出错: ${e.message}")
        }
    }
}

