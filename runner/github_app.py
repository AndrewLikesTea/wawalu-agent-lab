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


def app_jwt(stem="github-app") -> str:
    app = json.loads((SECRETS / f"{stem}.json").read_text())
    now = int(time.time())
    header = b64url(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64url(json.dumps({"iat": now - 30, "exp": now + 540, "iss": app["id"]}, separators=(",", ":")).encode())
    message = f"{header}.{payload}"
    signature = subprocess.check_output(
        ["openssl", "dgst", "-sha256", "-sign", str(SECRETS / f"{stem}.pem")],
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


def _product_repo_name() -> str:
    """Short name of the configured product repository (token scoping)."""
    env_file = SECRETS / "runtime.env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.strip().startswith("WAWALU_PRODUCT_REPOSITORY="):
                return line.split("=", 1)[1].strip().split("/")[-1]
    return "wawalu-agent-lab"


# GitHub installation tokens expire one hour after minting, but a tick that runs a
# worker can easily outlive that, so the token it captured at the start is dead by
# the time the run is recorded. These maps let an expired token be traded in for a
# fresh one with the same scope: _SCOPES remembers how each token was minted and
# _REPLACED points a token every caller still holds at its live successor.
_SCOPES: dict[str, tuple] = {}
_REPLACED: dict[str, str] = {}
_REMEMBERED = 32


def _remember(token: str, scope: tuple) -> None:
    _SCOPES[token] = scope
    while len(_SCOPES) > _REMEMBERED:
        stale, _ = next(iter(_SCOPES.items()))
        del _SCOPES[stale]
        _REPLACED.pop(stale, None)


def current_token(token: str) -> str:
    """Follow refresh chains so a caller holding an expired token uses its successor."""
    seen = {token}
    while (successor := _REPLACED.get(token)) and successor not in seen:
        token = successor
        seen.add(token)
    return token


def refresh_token(stale: str) -> str:
    """Mint a replacement for an expired token, preserving the scope it was minted with."""
    live = current_token(stale)
    if live != stale:
        return live
    fresh = installation_token(*_SCOPES.get(stale, ()))
    _REPLACED[stale] = fresh
    return fresh


def installation_token(repository=None, stem="github-app",
                       permissions=None) -> str:
    repository = repository or _product_repo_name()
    jwt = app_jwt(stem)
    installations = api("/app/installations", jwt)
    installation = next((item for item in installations if item["account"]["login"] == "AndrewLikesTea"), None)
    if not installation:
        raise RuntimeError("GitHub App is not installed for AndrewLikesTea")
    data = {"repositories": [repository]}
    if permissions is not None:
        data["permissions"] = permissions
    result = api(f"/app/installations/{installation['id']}/access_tokens", jwt, data)
    _remember(result["token"], (repository, stem, permissions))
    return result["token"]


def reviewer_token(repository=None) -> str:
    return installation_token(repository or _product_repo_name(), "github-reviewer-app",
                              {"contents": "read", "pull_requests": "write"})
