#!/usr/bin/env python3
"""Safe migration runner for GEDL PostgreSQL applications.

Designed for server-side execution. It fetches a migration manifest and SQL files
from one exact GitHub commit, verifies Git blob SHAs, maintains a migration ledger,
creates/validates a PostgreSQL custom-format backup before live writes, applies only
pending migrations, runs per-migration verification, and writes a JSON deployment
report. The only intended human gate is the final production-write confirmation.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request

DEFAULT_REPO = os.environ.get("GEDL_MIGRATION_REPO", "allanhewitt/b1141-confidence-verdict")
DEFAULT_BRANCH = os.environ.get("GEDL_MIGRATION_BRANCH", "main")
DEFAULT_MANIFEST = os.environ.get("GEDL_MIGRATION_MANIFEST", "backend/migrations/manifest.json")
DEFAULT_CONTAINER = os.environ.get("GEDL_DB_CONTAINER", "ki9h0hu506g0habrpxupucji")
DEFAULT_DB = os.environ.get("GEDL_DB_NAME", "b1141_confidence_verdict")
DEFAULT_DB_USER = os.environ.get("GEDL_DB_USER", "postgres")
DEFAULT_BACKUP_DIR = Path(os.environ.get("GEDL_BACKUP_DIR", "/root/gedl-db-backups"))
DEFAULT_MIGRATION_DIR = Path(os.environ.get("GEDL_MIGRATION_DIR", "/root/gedl-migrations"))
DEFAULT_REPORT_DIR = Path(os.environ.get("GEDL_MIGRATION_REPORT_DIR", "/root/gedl-migration-reports"))
LEDGER_TABLE = "gedl_schema_migrations"


class MigrationError(RuntimeError):
    pass


def run(cmd, *, input_bytes=None, capture=True, check=True):
    return subprocess.run(
        cmd,
        input=input_bytes,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
        check=check,
    )


def raw_url(repo: str, ref: str, path: str) -> str:
    return f"https://raw.githubusercontent.com/{repo}/{ref}/{path}"


def api_branch_url(repo: str, branch: str) -> str:
    return f"https://api.github.com/repos/{repo}/branches/{branch}"


def fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "gedl-migrate/1"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read()


def resolve_commit(repo: str, branch: str) -> str:
    payload = json.loads(fetch_bytes(api_branch_url(repo, branch)))
    return payload["commit"]["sha"]


def git_blob_sha(data: bytes) -> str:
    header = f"blob {len(data)}\0".encode()
    return hashlib.sha1(header + data).hexdigest()


def load_manifest(repo: str, commit: str, manifest_path: str) -> dict:
    data = fetch_bytes(raw_url(repo, commit, manifest_path))
    manifest = json.loads(data)
    if manifest.get("schema_version") != 1:
        raise MigrationError("Unsupported manifest schema_version")
    migrations = manifest.get("migrations")
    if not isinstance(migrations, list) or not migrations:
        raise MigrationError("Manifest contains no migrations")
    ids = [m.get("id") for m in migrations]
    if ids != sorted(ids):
        raise MigrationError("Migration ids must be lexically ordered")
    if len(ids) != len(set(ids)):
        raise MigrationError("Duplicate migration ids")
    return manifest


def db_cmd(container: str, db_user: str, db_name: str, *psql_args: str):
    return ["docker", "exec", "-i", container, "psql", "-U", db_user, "-d", db_name, *psql_args]


def scalar_sql(container: str, db_user: str, db_name: str, sql: str) -> str:
    proc = run(db_cmd(container, db_user, db_name, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql))
    return proc.stdout.decode().strip()


def ledger_exists(container: str, db_user: str, db_name: str) -> bool:
    return scalar_sql(container, db_user, db_name, f"SELECT to_regclass('public.{LEDGER_TABLE}') IS NOT NULL;") == "t"


def ensure_ledger(container: str, db_user: str, db_name: str):
    sql = f"""
CREATE TABLE IF NOT EXISTS {LEDGER_TABLE} (
  migration_id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  git_blob_sha TEXT NOT NULL,
  repository_commit TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""
    run(db_cmd(container, db_user, db_name, "-v", "ON_ERROR_STOP=1"), input_bytes=sql.encode(), capture=False)


def ledger_rows(container: str, db_user: str, db_name: str) -> dict[str, dict]:
    if not ledger_exists(container, db_user, db_name):
        return {}
    sql = f"SELECT migration_id, filename, git_blob_sha, repository_commit, applied_at::text FROM {LEDGER_TABLE} ORDER BY migration_id;"
    proc = run(db_cmd(container, db_user, db_name, "-At", "-F", "\t", "-c", sql))
    rows = {}
    for line in proc.stdout.decode().splitlines():
        if not line.strip():
            continue
        mid, filename, blob, commit, applied_at = line.split("\t", 4)
        rows[mid] = {"filename": filename, "git_blob_sha": blob, "repository_commit": commit, "applied_at": applied_at}
    return rows


def verify_migration(container: str, db_user: str, db_name: str, migration: dict) -> bool:
    sql = migration.get("verify_sql")
    expected = str(migration.get("verify_expected", "t"))
    if not sql:
        raise MigrationError(f"Migration {migration['id']} has no verify_sql")
    return scalar_sql(container, db_user, db_name, sql) == expected


def validate_ledger_against_manifest(ledger: dict, manifest: dict):
    by_id = {m["id"]: m for m in manifest["migrations"]}
    for mid, row in ledger.items():
        if mid not in by_id:
            raise MigrationError(f"Ledger contains unknown migration {mid}")
        expected = by_id[mid]
        if row["filename"] != expected["filename"] or row["git_blob_sha"] != expected["git_blob_sha"]:
            raise MigrationError(f"Ledger drift detected for migration {mid}")


def make_backup(container: str, db_user: str, db_name: str, backup_dir: Path, label: str) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    ts = dt.datetime.now().astimezone().strftime("%Y-%m-%d_%H%M%S")
    path = backup_dir / f"{db_name}_pre_{label}_{ts}.dump"
    with path.open("wb") as handle:
        proc = subprocess.run(
            ["docker", "exec", container, "pg_dump", "-U", db_user, "-d", db_name, "-Fc"],
            stdout=handle,
            stderr=subprocess.PIPE,
        )
    if proc.returncode != 0 or path.stat().st_size == 0:
        raise MigrationError(f"Backup failed: {proc.stderr.decode(errors='replace')}")
    with path.open("rb") as handle:
        verify = subprocess.run(
            ["docker", "exec", "-i", container, "pg_restore", "-l"],
            stdin=handle,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    if verify.returncode != 0 or b"TABLE" not in verify.stdout:
        raise MigrationError(f"Backup catalogue verification failed: {verify.stderr.decode(errors='replace')}")
    return path


def download_and_verify(repo: str, commit: str, migration: dict, target_dir: Path) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    data = fetch_bytes(raw_url(repo, commit, migration["path"]))
    actual = git_blob_sha(data)
    expected = migration["git_blob_sha"]
    if actual != expected:
        raise MigrationError(f"Hash mismatch for {migration['filename']}: expected {expected}, got {actual}")
    path = target_dir / migration["filename"]
    path.write_bytes(data)
    return path


def apply_sql(container: str, db_user: str, db_name: str, path: Path):
    with path.open("rb") as handle:
        proc = subprocess.run(
            db_cmd(container, db_user, db_name, "-v", "ON_ERROR_STOP=1"),
            stdin=handle,
        )
    if proc.returncode != 0:
        raise MigrationError(f"Migration failed: {path.name}")


def record_ledger(container: str, db_user: str, db_name: str, migration: dict, commit: str):
    sql = f"""
INSERT INTO {LEDGER_TABLE}(migration_id, filename, git_blob_sha, repository_commit)
VALUES ($${migration['id']}$$, $${migration['filename']}$$, $${migration['git_blob_sha']}$$, $${commit}$$)
ON CONFLICT (migration_id) DO NOTHING;
"""
    run(db_cmd(container, db_user, db_name, "-v", "ON_ERROR_STOP=1"), input_bytes=sql.encode(), capture=False)


def postflight(container: str, db_user: str, db_name: str, manifest: dict) -> dict:
    result = {}
    for item in manifest.get("postflight", []):
        result[item["name"]] = scalar_sql(container, db_user, db_name, item["sql"])
    return result


def print_status(manifest: dict, ledger: dict):
    print("Migration status")
    print("----------------")
    for m in manifest["migrations"]:
        state = "APPLIED" if m["id"] in ledger else "PENDING"
        print(f"{m['id']:>4}  {state:<7}  {m['description']}")


def prompt_yes(message: str) -> bool:
    if not sys.stdin.isatty():
        return False
    answer = input(f"{message} [y/N] ").strip().lower()
    return answer in {"y", "yes"}


def command_status(args, manifest, commit):
    ledger = ledger_rows(args.container, args.db_user, args.db_name)
    if not ledger_exists(args.container, args.db_user, args.db_name):
        print("Ledger: UNINITIALISED")
        print_status(manifest, {})
        print("\nRun: gedl-migrate baseline --through <last already-applied id>")
        return 2
    validate_ledger_against_manifest(ledger, manifest)
    print(f"Repository: {args.repo}@{commit}")
    print(f"Database:   {args.db_name}")
    print_status(manifest, ledger)
    return 0


def command_baseline(args, manifest, commit):
    migrations = manifest["migrations"]
    through = args.through
    selected = [m for m in migrations if m["id"] <= through]
    if not selected or selected[-1]["id"] != through:
        raise MigrationError(f"Unknown --through migration id {through}")
    existing = ledger_rows(args.container, args.db_user, args.db_name)
    if existing:
        raise MigrationError("Ledger already contains records; baseline is only for one-time adoption")

    print(f"Database: {args.db_name}")
    print(f"Repository commit: {commit}")
    print("Baseline candidates:")
    for m in selected:
        ok = verify_migration(args.container, args.db_user, args.db_name, m)
        print(f"  {m['id']} {'VERIFIED' if ok else 'FAILED'}  {m['description']}")
        if not ok:
            raise MigrationError(f"Cannot baseline {m['id']}: live verification failed")

    backup = make_backup(args.container, args.db_user, args.db_name, args.backup_dir, f"baseline_{through}")
    print(f"Backup: VERIFIED {backup}")
    print("\nThis will create the migration ledger and record only the verified historical migrations above.")
    if not args.yes and not prompt_yes("Create ledger baseline?"):
        print("Cancelled; no database ledger changes made.")
        return 1

    ensure_ledger(args.container, args.db_user, args.db_name)
    for m in selected:
        record_ledger(args.container, args.db_user, args.db_name, m, commit)
    ledger = ledger_rows(args.container, args.db_user, args.db_name)
    validate_ledger_against_manifest(ledger, manifest)
    print("Baseline complete.")
    print_status(manifest, ledger)
    return 0


def command_apply(args, manifest, commit):
    if not ledger_exists(args.container, args.db_user, args.db_name):
        raise MigrationError("Migration ledger is not initialised; run baseline first")
    ledger = ledger_rows(args.container, args.db_user, args.db_name)
    validate_ledger_against_manifest(ledger, manifest)
    pending = [m for m in manifest["migrations"] if m["id"] not in ledger]
    if not pending:
        print("No pending migrations.")
        return 0

    target_dir = args.migration_dir / commit
    downloaded = [(m, download_and_verify(args.repo, commit, m, target_dir)) for m in pending]
    label = f"{pending[0]['id']}_{pending[-1]['id']}"
    backup = make_backup(args.container, args.db_user, args.db_name, args.backup_dir, label)

    print(f"Database:   {args.db_name}")
    print(f"Repository: {args.repo}@{commit}")
    print(f"Backup:     VERIFIED {backup}")
    print("Pending:")
    for m, _ in downloaded:
        print(f"  {m['id']} {m['description']} [{m['git_blob_sha']}]")
    print("\nNo migration is applied until the confirmation below.")
    if not args.yes and not prompt_yes("Apply pending migrations?"):
        print("Cancelled; no migrations applied.")
        return 1

    applied = []
    for m, path in downloaded:
        print(f"\nApplying {m['id']} — {m['description']}")
        apply_sql(args.container, args.db_user, args.db_name, path)
        if not verify_migration(args.container, args.db_user, args.db_name, m):
            raise MigrationError(f"Post-migration verification failed for {m['id']}; rollback assessment required")
        record_ledger(args.container, args.db_user, args.db_name, m, commit)
        applied.append(m)

    ledger = ledger_rows(args.container, args.db_user, args.db_name)
    validate_ledger_against_manifest(ledger, manifest)
    report_values = postflight(args.container, args.db_user, args.db_name, manifest)
    args.report_dir.mkdir(parents=True, exist_ok=True)
    report_path = args.report_dir / f"{dt.datetime.now().astimezone().strftime('%Y-%m-%d_%H%M%S')}_{args.db_name}.json"
    report = {
        "recorded_at": dt.datetime.now().astimezone().isoformat(),
        "repository": args.repo,
        "repository_commit": commit,
        "database": args.db_name,
        "backup": str(backup),
        "applied_migrations": [
            {"id": m["id"], "filename": m["filename"], "git_blob_sha": m["git_blob_sha"], "description": m["description"]}
            for m in applied
        ],
        "postflight": report_values,
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n")

    print("\nSUCCESS")
    for key, value in report_values.items():
        print(f"{key}: {value}")
    print(f"Report: {report_path}")
    print(f"Backup: {backup}")
    return 0


def command_validate_manifest(args, manifest, commit):
    root = Path(args.repo_root)
    for m in manifest["migrations"]:
        path = root / m["path"]
        if not path.is_file():
            raise MigrationError(f"Missing migration file {path}")
        actual = git_blob_sha(path.read_bytes())
        if actual != m["git_blob_sha"]:
            raise MigrationError(f"Manifest hash mismatch for {m['id']}: expected {m['git_blob_sha']}, got {actual}")
    print(f"Manifest valid: {len(manifest['migrations'])} migrations")
    return 0


def build_parser():
    parser = argparse.ArgumentParser(prog="gedl-migrate")
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--branch", default=DEFAULT_BRANCH)
    parser.add_argument("--manifest", default=DEFAULT_MANIFEST)
    parser.add_argument("--container", default=DEFAULT_CONTAINER)
    parser.add_argument("--db-name", default=DEFAULT_DB)
    parser.add_argument("--db-user", default=DEFAULT_DB_USER)
    parser.add_argument("--backup-dir", type=Path, default=DEFAULT_BACKUP_DIR)
    parser.add_argument("--migration-dir", type=Path, default=DEFAULT_MIGRATION_DIR)
    parser.add_argument("--report-dir", type=Path, default=DEFAULT_REPORT_DIR)
    parser.add_argument("--yes", action="store_true", help="non-interactive approval; use only in a controlled environment")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    baseline = sub.add_parser("baseline")
    baseline.add_argument("--through", required=True)
    sub.add_parser("apply")
    validate = sub.add_parser("validate-manifest")
    validate.add_argument("--repo-root", default=".")
    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    try:
        commit = resolve_commit(args.repo, args.branch)
        manifest = load_manifest(args.repo, commit, args.manifest)
        if args.command == "status":
            return command_status(args, manifest, commit)
        if args.command == "baseline":
            return command_baseline(args, manifest, commit)
        if args.command == "apply":
            return command_apply(args, manifest, commit)
        if args.command == "validate-manifest":
            return command_validate_manifest(args, manifest, commit)
        parser.error("unknown command")
    except (MigrationError, urllib.error.URLError, subprocess.SubprocessError, OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
