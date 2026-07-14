#!/usr/bin/env python3
"""Install, remove, and inspect the local macOS autonomous-team service."""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import plistlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
LABEL = "org.wawalu.agent-lab"
PLIST = pathlib.Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
DOMAIN = f"gui/{os.getuid()}"


def launch_path(home: pathlib.Path | None = None) -> str:
    """Return the fixed executable search path required by the local toolchain."""
    return ":".join((str((home or pathlib.Path.home()) / ".local" / "bin"),
                     "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
                     "/usr/sbin", "/sbin"))


def run(*command: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(command, check=check, text=True)


def install() -> None:
    config = ROOT / ".secrets" / "autonomy.json"
    config.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not config.exists():
        shutil.copy2(ROOT / "config" / "autonomy.example.json", config)
        config.chmod(0o600)
    logs = ROOT / ".agent" / "autonomy"
    logs.mkdir(parents=True, exist_ok=True, mode=0o700)
    (logs / "STOP").unlink(missing_ok=True)
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    caffeinate = shutil.which("caffeinate")
    program = [sys.executable, "-m", "runner.autonomous", "loop"]
    if caffeinate:
        program = [caffeinate, "-dimsu", *program]
    payload = {
        "Label": LABEL,
        "ProgramArguments": program,
        "WorkingDirectory": str(ROOT),
        "RunAtLoad": True,
        "KeepAlive": {"SuccessfulExit": False},
        "ThrottleInterval": 30,
        "ProcessType": "Background",
        "StandardOutPath": str(logs / "stdout.log"),
        "StandardErrorPath": str(logs / "stderr.log"),
        "EnvironmentVariables": {"PATH": launch_path()},
    }
    PLIST.write_bytes(plistlib.dumps(payload))
    run("launchctl", "bootout", DOMAIN, str(PLIST), check=False)
    run("launchctl", "bootstrap", DOMAIN, str(PLIST))
    run("launchctl", "kickstart", "-k", f"{DOMAIN}/{LABEL}")
    print(f"installed and started {LABEL}")


def uninstall() -> None:
    run("launchctl", "bootout", DOMAIN, str(PLIST), check=False)
    PLIST.unlink(missing_ok=True)
    print(f"removed {LABEL}")


def status() -> None:
    result = subprocess.run(["launchctl", "print", f"{DOMAIN}/{LABEL}"], text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    print(json.dumps({"installed": PLIST.exists(), "loaded": result.returncode == 0,
                      "plist": str(PLIST)}, indent=2))
    if result.returncode == 0:
        for line in result.stdout.splitlines():
            if "state =" in line or "pid =" in line or "last exit code" in line:
                print(line.strip())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["install", "uninstall", "status"])
    command = parser.parse_args().command
    {"install": install, "uninstall": uninstall, "status": status}[command]()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
