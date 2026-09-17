#!/usr/bin/env python3
"""Serve the real popup with isolated sample data for documentation screenshots.
Run: python3 tools/preview-extension.py
Open: http://127.0.0.1:3200/popup.html?lang=zh&view=tabs
Views: ops, tabs, fav. Languages: zh, en, ja, ko, la.
Diagnosis/navigation/search and ungrouping operate only on isolated sample data.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / 'extension'


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(EXT), **kwargs)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/popup.html':
            content = (EXT / 'popup.html').read_text().replace(
                '<script src="i18n.js"></script>',
                '<script src="/fixture.js"></script><script src="i18n.js"></script>')
            kind = 'text/html; charset=utf-8'
        elif path == '/fixture.js':
            content = 'window.previewManifest = ' + (EXT / 'manifest.json').read_text() + ';\n'
            content += (ROOT / 'tools/preview/fixture.js').read_text()
            kind = 'application/javascript; charset=utf-8'
        elif path == '/popup.css':
            # Select the shipped light theme regardless of the screenshot browser's OS theme.
            content = (EXT / 'popup.css').read_text().replace('@media (prefers-color-scheme: dark)', '@media not all')
            kind = 'text/css; charset=utf-8'
        else:
            return super().do_GET()
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.end_headers()
        self.wfile.write(content.encode())


if __name__ == '__main__':
    print('Preview: http://127.0.0.1:3200/popup.html?lang=zh&view=tabs', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 3200), Handler).serve_forever()
