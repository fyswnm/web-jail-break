#!/usr/bin/env python3
"""
越狱大逃亡 (Prison Break) - 本地局域网快速启动服务器
自动侦测本机局域网 IP，方便在 iPad Safari 浏览器上直接输入网址体验！
"""

import http.server
import socket
import socketserver
import os
import sys

PORT = 8080

def get_local_ip():
    """获取本机局域网 IP 地址"""
    # 优先在 macOS 上调用系统命令获取真实 Wi-Fi IP
    for iface in ['en0', 'en1', 'en2']:
        try:
            import subprocess
            out = subprocess.check_output(['ipconfig', 'getifaddr', iface], stderr=subprocess.DEVNULL).decode().strip()
            if out:
                return out
        except Exception:
            pass

    # 兜底通过 socket 获取
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def run_server():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    handler = http.server.SimpleHTTPRequestHandler
    # 增加 MIME 类型兼容
    handler.extensions_map.update({
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.json': 'application/json',
    })

    try:
        with socketserver.TCPServer(("", PORT), handler) as httpd:
            local_ip = get_local_ip()
            print("=" * 60)
            print("🚀 【越狱大逃亡 - 游戏服务器已就绪】")
            print("=" * 60)
            print(f"👉 Mac 本地测试网址:  http://localhost:{PORT}")
            print(f"👉 iPad 局域网游戏网址: http://{local_ip}:{PORT}")
            print("=" * 60)
            print("💡 在 iPad 上游玩小贴士：")
            print(f"  1. 请确保 iPad 和这台 Mac 连接在同一个 Wi-Fi 网络下。")
            print(f"  2. 在 iPad 的 Safari 浏览器中输入上面的局域网网址。")
            print(f"  3. 点击 Safari 分享按钮 -> 选择「添加到主屏幕」，即可享受真正的全屏 App 级流畅体验！")
            print("=" * 60)
            print("按 Ctrl+C 可停止服务器。\n")
            httpd.serve_forever()
    except OSError as e:
        if e.errno == 48:
            print(f"⚠️ 端口 {PORT} 已被占用，尝试使用 8081 启动...")
            # 自动切换到备用端口
            with socketserver.TCPServer(("", 8081), handler) as httpd:
                local_ip = get_local_ip()
                print(f"👉 iPad 游戏网址: http://{local_ip}:8081")
                httpd.serve_forever()
        else:
            raise e

if __name__ == '__main__':
    run_server()
