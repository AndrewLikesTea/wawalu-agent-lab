#!/usr/bin/env python3
"""Provision the isolated Wawalu simulation organization and persona tokens."""
import argparse
import datetime as dt
import hashlib
import json
import pathlib
import secrets
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
RUNTIME_ENV = ROOT / ".secrets" / "runtime.env"


def runtime_env():
    if not RUNTIME_ENV.exists():
        raise SystemExit("missing ignored runtime configuration: .secrets/runtime.env")
    values = {}
    for raw_line in RUNTIME_ENV.read_text().splitlines():
        line = raw_line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


RUNTIME = runtime_env()
INFRA = pathlib.Path(RUNTIME["WAWALU_INFRA_DIR"])
ORG_ID = RUNTIME["WAWALU_SIM_ORG_ID"]
ORG_NAME = RUNTIME["WAWALU_SIM_ORG_NAME"]


def compose(service, command, input_text=""):
    return subprocess.run(["docker", "compose", "exec", "-T", service, *command],
                          cwd=INFRA, input=input_text, text=True, check=True,
                          capture_output=True)


def env_file():
    values = {}
    for line in (INFRA / ".env").read_text().splitlines():
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1); values[key] = value
    return values


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.apply: raise SystemExit("pass --apply to create synthetic users and tokens")
    template = json.loads((ROOT / "config/personas.example.json").read_text())
    personas = template["personas"]
    organizations = RUNTIME["WAWALU_POSTGRES_ORGANIZATIONS_TABLE"]
    users = RUNTIME["WAWALU_POSTGRES_USERS_TABLE"]
    org_memberships = RUNTIME["WAWALU_POSTGRES_ORG_MEMBERSHIPS_TABLE"]
    sql = ["BEGIN;", f"INSERT INTO {organizations}(id,name,is_personal) VALUES ('{ORG_ID}','{ORG_NAME}',false) ON CONFLICT(id) DO UPDATE SET name=excluded.name;"]
    for name, persona in personas.items():
        email = RUNTIME[f"WAWALU_PERSONA_{name.upper()}_EMAIL"]
        persona["email"] = email
        role = "owner" if name == "manager" else "admin" if name in ("staff", "infrastructure") else "member"
        sql += [
            f"INSERT INTO {users}(email,status) VALUES ('{email}','approved') ON CONFLICT(email) DO UPDATE SET status='approved',updated_at=now();",
            f"INSERT INTO {org_memberships}(organization_id,user_id,role,active) SELECT '{ORG_ID}',id,'{role}',true FROM {users} WHERE email='{email}' ON CONFLICT(organization_id,user_id) DO UPDATE SET role=excluded.role,active=true,updated_at=now();",
            f"UPDATE {users} SET active_organization_id='{ORG_ID}',updated_at=now() WHERE email='{email}';",
        ]
    sql.append("COMMIT;")
    compose(RUNTIME["WAWALU_POSTGRES_SERVICE"], [
        "psql", "-v", "ON_ERROR_STOP=1",
        "-U", RUNTIME["WAWALU_POSTGRES_USER"],
        "-d", RUNTIME["WAWALU_POSTGRES_DATABASE"],
    ], "\n".join(sql))
    now = dt.datetime.now(dt.UTC).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    membership_rows, token_rows = [], []
    for name, persona in personas.items():
        token = "wtok_" + secrets.token_hex(24)
        persona["wawalu_token"] = token
        role = "owner" if name == "manager" else "admin" if name in ("staff", "infrastructure") else "member"
        membership_rows.append({"org_id": ORG_ID, "user_email": persona["email"], "role": role,
                                "revoked": 0, "created_at": now, "updated_at": now})
        token_rows.append({"token_hash": hashlib.sha256(token.encode()).hexdigest(),
                           "user_email": persona["email"], "org_id": ORG_ID,
                           "kind": "user", "created_at": now, "revoked": 0})
    password = env_file()["CH_ADMIN_PASSWORD"]
    clickhouse_tables = (
        (RUNTIME["WAWALU_CLICKHOUSE_MEMBERSHIPS_TABLE"], membership_rows),
        (RUNTIME["WAWALU_CLICKHOUSE_TOKENS_TABLE"], token_rows),
    )
    for table, rows in clickhouse_tables:
        compose(RUNTIME["WAWALU_CLICKHOUSE_SERVICE"], [
                "clickhouse-client", "--password", password,
                "--query", f"INSERT INTO {RUNTIME['WAWALU_CLICKHOUSE_DATABASE']}.{table} FORMAT JSONEachRow"],
                "\n".join(json.dumps(row) for row in rows))
    destination = ROOT / ".secrets/personas.json"
    destination.parent.mkdir(mode=0o700, exist_ok=True)
    destination.write_text(json.dumps(template, indent=2) + "\n")
    destination.chmod(0o600)
    print(f"provisioned {len(personas)} personas in {ORG_NAME}; secrets stored locally")


if __name__ == "__main__": main()
