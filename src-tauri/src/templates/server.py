#!/usr/bin/env python3
"""
TruidIDE 简单 HTTP 服务器
用于预览 Web 项目
"""

import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

# 配置
PORT = 5173
HOST = '127.0.0.1'

class CustomHandler(SimpleHTTPRequestHandler):
    """自定义请求处理器，添加更好的 MIME 类型支持"""
    
    def __init__(self, *args, **kwargs):
        # 设置当前目录为服务根目录
        super().__init__(*args, directory=os.getcwd(), **kwargs)
    
    def end_headers(self):
        # 添加 CORS 头，方便开发调试
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()
    
    def log_message(self, format, *args):
        """自定义日志格式"""
        print(f"[{self.log_date_time_string()}] {format % args}")


def find_free_port(start_port=8000, max_attempts=10):
    """查找可用端口"""
    import socket
    for port in range(start_port, start_port + max_attempts):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind((HOST, port))
                return port
        except OSError:
            continue
    return None


def main():
    # 检查 index.html 是否存在
    if not Path('index.html').exists():
        print("❌ 错误: 当前目录下未找到 index.html")
        print("   请确保在项目根目录运行此脚本")
        sys.exit(1)
    
    # 查找可用端口
    port = find_free_port(PORT)
    if port is None:
        print(f"❌ 错误: 无法找到可用端口 (尝试范围: {PORT}-{PORT+9})")
        sys.exit(1)
    
    # 创建服务器
    server = HTTPServer((HOST, port), CustomHandler)
    url = f'http://{HOST}:{port}'
    
    print("=" * 60)
    print("🚀 TruidIDE Web 开发服务器")
    print("=" * 60)
    print(f"📁 服务目录: {os.getcwd()}")
    print(f"🌐 访问地址: {url}")
    print("💡 提示: 按 Ctrl+C 停止服务器")
    print("=" * 60)
    
    print("\n服务器运行中...\n")
    
    # 启动服务器
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n\n👋 服务器已停止")
        server.shutdown()
        sys.exit(0)


if __name__ == '__main__':
    main()
