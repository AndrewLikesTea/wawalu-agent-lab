#!/usr/bin/env python3
"""One-click local GitHub App manifest registration and credential capture."""
import http.server
import argparse
import json
import os
import pathlib
import urllib.parse
import urllib.request
import webbrowser

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / ".secrets"

parser = argparse.ArgumentParser()
parser.add_argument("--reviewer", action="store_true")
args = parser.parse_args()
ROLE = "reviewer" if args.reviewer else "worker"
MANIFEST = (ROOT / ("github-reviewer-app-manifest.json" if args.reviewer else "github-app-manifest.json")).read_text()
PORT = 8790 if args.reviewer else 8789
STEM = "github-reviewer-app" if args.reviewer else "github-app"


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        code = query.get("code", [""])[0]
        if code:
            request = urllib.request.Request(
                f"https://api.github.com/app-manifests/{code}/conversions",
                data=b"{}", method="POST",
                headers={"Accept": "application/vnd.github+json", "User-Agent": "wawalu-agent-lab"},
            )
            with urllib.request.urlopen(request, timeout=20) as response:
                credentials = json.load(response)
            DEST.mkdir(mode=0o700, exist_ok=True)
            private_key = credentials.pop("pem")
            (DEST / f"{STEM}.json").write_text(json.dumps(credentials, indent=2) + "\n")
            (DEST / f"{STEM}.pem").write_text(private_key)
            os.chmod(DEST / f"{STEM}.json", 0o600)
            os.chmod(DEST / f"{STEM}.pem", 0o600)
            self.respond("GitHub App created. Credentials were stored locally in .secrets. You can close this tab.")
            self.server.complete = True
            return
        html = f'''<!doctype html><title>Register Wawalu Synthetic Engineering</title>
<style>body{{font:16px system-ui;max-width:620px;margin:80px auto;padding:20px}}button{{padding:12px 18px}}</style>
<h1>Register the isolated {ROLE} GitHub App</h1>
<p>GitHub will show the exact permissions before creation. Install it only on <b>wawalu-agent-lab</b>.</p>
<form method="post" action="https://github.com/settings/apps/new?state=wawalu-agent-lab">
<input type="hidden" name="manifest" value='{MANIFEST.replace("'", "&#39;")}' />
<button>Create GitHub App</button></form>'''
        self.respond(html, "text/html")

    def respond(self, body, content_type="text/plain"):
        data = body.encode()
        self.send_response(200); self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def log_message(self, *_args): pass


server = http.server.HTTPServer(("127.0.0.1", PORT), Handler)
server.complete = False
webbrowser.open(f"http://127.0.0.1:{PORT}/")
print("Complete GitHub's confirmation in the opened browser window…", flush=True)
while not server.complete: server.handle_request()
print("GitHub App credentials saved under .secrets/", flush=True)
