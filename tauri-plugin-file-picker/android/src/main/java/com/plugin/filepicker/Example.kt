package com.plugin.filepicker

import android.content.Context
import android.net.Uri
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream

class Example {
    fun pong(value: String): String {
        Log.i("Pong", value)
        return value
    }

    /**
     * 从 Content URI 读取文件并保存到临时目录
     * @param context Android Context
     * @param contentUri Content URI (例如 content://...)
     * @param targetFile 目标文件路径
     * @return 成功返回 true
     */
    fun copyContentUriToFile(context: Context, contentUri: String, targetFile: File): Boolean {
        return try {
            val uri = Uri.parse(contentUri)
            val inputStream: InputStream? = context.contentResolver.openInputStream(uri)
            
            if (inputStream == null) {
                Log.e("FilePicker", "无法打开 Content URI: $contentUri")
                return false
            }

            FileOutputStream(targetFile).use { outputStream ->
                inputStream.use { input ->
                    input.copyTo(outputStream)
                }
            }
            
            Log.i("FilePicker", "成功从 Content URI 复制文件: $contentUri -> ${targetFile.absolutePath}")
            true
        } catch (e: Exception) {
            Log.e("FilePicker", "复制 Content URI 文件失败: ${e.message}", e)
            false
        }
    }

    /**
     * 从 Content URI 读取文件内容
     * @param context Android Context
     * @param contentUri Content URI
     * @return 文件内容的字节数组，失败返回 null
     */
    fun readContentUri(context: Context, contentUri: String): ByteArray? {
        return try {
            val uri = Uri.parse(contentUri)
            val inputStream: InputStream? = context.contentResolver.openInputStream(uri)
            
            if (inputStream == null) {
                Log.e("FilePicker", "无法打开 Content URI: $contentUri")
                return null
            }

            inputStream.use { it.readBytes() }
        } catch (e: Exception) {
            Log.e("FilePicker", "读取 Content URI 失败: ${e.message}", e)
            null
        }
    }
}
