import base64
import json
import pathlib
import subprocess
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SECRETS = ROOT / ".secrets"


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def app_jwt() -> str:
    app = json.loads((SECRETS / "github-app.json").read_text())
    now = int(time.time())
    header = b64url(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64url(json.dumps({"iat": now - 30, "exp": now + 540, "iss": app["id"]}, separators=(",", ":")).encode())
    message = f"{header}.{payload}"
    signature = subprocess.check_output(
        ["openssl", "dgst", "-sha256", "-sign", str(SECRETS / "github-app.pem")],
        input=message.encode(),
    )
    return f"{message}.{b64url(signature)}"


def api(path: str, token: str, data=None):
    request = urllib.request.Request(
        "https://api.github.com" + path,
        data=json.dumps(data).encode() if data is not None else None,
        method="POST" if data is not None else "GET",
        headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "wawalu-agent-lab"},
    )
    with urllib.request.urlopen(request, timeout=20) as response: return json.load(response)


def installation_token(repository="wawalu-agent-lab") -> str:
    jwt = app_jwt()
    installations = api("/app/installations", jwt)
    installation = next((item for item in installations if item["account"]["login"] == "AndrewLikesTea"), None)
    if not installation:
        raise RuntimeError("GitHub App is not installed for AndrewLikesTea")
    result = api(f"/app/installations/{installation['id']}/access_tokens", jwt,
                 {"repositories": [repository]})
    return result["token"]

