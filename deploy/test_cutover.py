"""Run the real helper against isolated fake Docker/HTTP commands, never a daemon."""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
BASH = shutil.which("bash") or "C:/Program Files/Git/bin/bash.exe"
FAKE = r'''
import json, os, pathlib, sys
sys.stdout.reconfigure(newline="\n")
STATE = pathlib.Path(os.environ["CUTOVER_FAKE_STATE"])
def execute(args):
    state = json.loads(STATE.read_text())
    state["calls"].append(args)
    scenario = state["scenario"]
    def finish(code=0, output=""):
        STATE.write_text(json.dumps(state))
        return code, output
    env = {"JIZHANG_USERNAME": "fake-user", "JIZHANG_PASSWORD_HASH": "$argon2id$fake-hash", "JIZHANG_AI_ENCRYPTION_KEY": "a" * 64,
           "SESSION_TTL_DAYS": "30", "HOST": "0.0.0.0", "PORT": "8081", "DATA_DIR": "/data", "TZ": "Asia/Shanghai", "NODE_ENV": "production",
           "TRUST_PROXY": "true", "LOG_LEVEL": "info", "JIZHANG_ITEM_CUTOUT_SERVICE_URL": "http://jizhang-cutout:8090"}
    env['NODE_OPTIONS'] = '--max-old-space-size=768 --trace-warnings' if scenario == 'node_options_changed' else '--max-old-space-size=256'
    if scenario == 'node_options_dollar': env['NODE_OPTIONS'] = '--max-old-space-size=768 --require=/opt/$literal/preload.cjs'
    if scenario in ('node_options_raw_dollar', 'node_options_canonical_double'): env['NODE_OPTIONS'] = '--max-old-space-size=768 --require=/opt/$$literal/preload.cjs'
    if scenario == "added_ai_key": env.pop("JIZHANG_AI_ENCRYPTION_KEY")
    def container(name):
        if name in ("jizhang", "old-id"):
            return {"Id": "new-id" if state["new"] else "old-id", "Image": "new-image" if state["new"] else "old-image",
                    "Config": {"Image": "jizhang:api-2026-10-09" if state["new"] else "jizhang:64be4b1", "Env": [k + "=" + v for k,v in env.items()],
                    "Labels": {"com.docker.compose.project": "jizhang", "com.docker.compose.service": "jizhang", "com.docker.compose.project.working_dir": state["original"]}},
                    "State": {"Running": True}, "Mounts": [{"Destination": "/data", "Type": "volume", "Name": "wrong" if scenario == "wrong_volume" else "jizhang_jizhang-data"}],
                    "HostConfig": {"PortBindings": {"8081/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8081"}]}},
                    "NetworkSettings": {"Networks": {"jizhang_default": {"NetworkID": "default-network"}, "jizhang_cutout-internal": {"NetworkID": "private-network"}}}}
        if name in ("jizhang-cutout", "worker-id"):
            return {"Id": "worker-id", "Image": "worker-image", "Config": {"Image": "jizhang-cutout:64be4b1"}, "State": {"Running": True}, "Mounts": [], "NetworkSettings": {"Networks": {"jizhang_cutout-internal": {"NetworkID": "private-network"}}}}
        if name in ("caddy", "caddy-id"):
            return {"Id": "caddy-id", "Image": "caddy-image", "Config": {"Image": "caddy:2"}, "State": {"Running": True}, "HostConfig": {"NetworkMode": "host"}, "Mounts": [{"Source": state["caddy_dir"], "Destination": "/etc/caddy", "RW": False}]}
        if name in ("jizhang-api-check", "trial-id"):
            return {"Id": "trial-id", "Image": "new-image", "State": {"Running": True}, "Mounts": [{"Destination": "/data", "Name": "jizhang-api-check-20261009-163820"}]}
        raise AssertionError("Unexpected fake container " + name)
    if args[0] == "inspect":
        c = container(args[-1])
        if "--format" not in args: return finish(output=json.dumps([c]))
        fmt = args[args.index("--format") + 1]
        if fmt == '{{json .NetworkSettings.Networks}}': return finish(output=json.dumps(c['NetworkSettings']['Networks']) + '\n\n')
        if "State.Running" in fmt: return finish(output=c["Id"] + "|true\n")
        if "NetworkSettings.Networks" in fmt: return finish(output="jizhang_default\njizhang_cutout-internal\n\n")
        if "Mounts" in fmt: return finish(output="volume|jizhang_jizhang-data\n")
        return finish(output=c["Image" if "Image" in fmt else "Id"] + "\n")
    if args[:2] == ["image", "inspect"]:
        image = "new-image" if args[-1] == "jizhang:api-2026-10-09" else "old-image"
        return finish(output=image + "\n" if "--format" in args else json.dumps([{"Id": image, "Config": {"User": "node"}}]))
    if args[:2] == ["volume", "inspect"]: return finish(output="[]")
    if args[:2] == ["network", "inspect"]: return finish(output=json.dumps([{"Labels": {"com.docker.compose.project": "jizhang"}, "Internal": args[-1].endswith("internal")}]))
    if args[0] == "ps": return finish(output="old-id worker-id caddy-id trial-id")
    if args[0] == "tag": return finish()
    if args[0] in ("stop", "start"):
        if args[0] == "stop" and args[-1] == "old-id" and scenario == "stop_failure": return finish(1)
        return finish()
    if args[0] == "cp":
        pathlib.Path(args[-1], "jizhang.db").write_bytes(b"fake cold archive")
        return finish(1 if scenario == "archive_failure" else 0)
    manifest = json.dumps({"integrity": "ok", "tables": {"transactions": {"rows": 1, "sha256": "fake-digest"}}}) + "\n"
    if args[0] == "run":
        if "backup" in args:
            assert args[-1] == "0", "Pruning must remain disabled"
            assert pathlib.Path(args[args.index("--env-file") + 1]).name == "effective.env"
            return finish(1 if scenario == "backup_failure" else 0, "[jizhang] Backup ok: /data/backups/pre-api/jizhang-2026-10-09T09-00-00-000.db\n")
        if "deploy/db-manifest.mjs" in args: return finish(output=manifest)
    if args[0] == "exec":
        if args[-1] == "whoami": return finish(output="node\n")
        if "deploy/db-manifest.mjs" in args:
            return finish(output=manifest if scenario != "ledger_failure" else manifest.replace("fake-digest", "changed"))
    if args[0] == "compose":
        if "version" in args: return finish(output="Docker Compose version v2.40.3")
        if "config" in args:
            if "--format" not in args: return finish()
            if any(pathlib.Path(value).name == 'serialization-probe.yml' for value in args):
                pair = ('one$two', 'one$$two') if scenario == 'node_options_raw_dollar' else ('one$$two', 'one$$$$two')
                if scenario == 'unknown_serialization': pair = ('unexpected', 'unexpected')
                return finish(output=json.dumps({'services': {'probe': {'environment': {'PROBE_ONE': pair[0], 'PROBE_TWO': pair[1]}}}}))
            model_env = dict(env)
            # Real base Compose forces256 regardless of inspected old options.
            model_env['NODE_OPTIONS'] = '--max-old-space-size=256'
            for index, arg in enumerate(args[:-1]):
                if arg == '-f' and pathlib.Path(args[index + 1]).name == 'runtime.override.yml':
                    runtime = json.loads(pathlib.Path(args[index + 1]).read_text())
                    for key, value in runtime['services']['jizhang']['environment'].items():
                        model_env[key] = value.replace('$$', '$')
            if scenario == "credential_failure": model_env["JIZHANG_PASSWORD_HASH"] = "different"
            if scenario == "added_ai_key": model_env["JIZHANG_AI_ENCRYPTION_KEY"] = "b" * 64
            if scenario == "ttl_failure": model_env["SESSION_TTL_DAYS"] = "90"
            # Compose config exports a reusable canonical file; literal dollars
            # are re-escaped in JSON even after loader interpolation resolves.
            if scenario != 'node_options_raw_dollar':
                model_env = {key: value.replace('$', '$$') for key, value in model_env.items()}
            model = {"services": {"jizhang": {"image": "jizhang:api-2026-10-09", "environment": model_env,
                "ports": [{"host_ip": "127.0.0.1", "target": 8081, "published": "8081", "protocol": "tcp", "harmless_extra_field": "accepted"}]},
                "jizhang-cutout": {"image": "jizhang-cutout:64be4b1"}},
                "volumes": {"jizhang-data": {"external": True, "name": "jizhang_jizhang-data"}},
                "networks": {"default": {"name": "jizhang_default"}, "cutout-internal": {"name": "jizhang_cutout-internal"}}}
            return finish(output=json.dumps(model))
        if "up" in args:
            assert args[-1] == "jizhang" and "--no-build" in args and "--no-deps" in args
            state["new"] = True
            return finish(1 if scenario == "recreate_failure" else 0)
    raise AssertionError("Unexpected fake Docker command " + repr(args))
if __name__ == "__main__":
    code, output = execute(sys.argv[1:]); sys.stdout.write(output); sys.exit(code)
'''
RUNNER = r'''
import os, stat, subprocess, sys
sys.stdout.reconfigure(newline="\n")
sys.path.insert(0, os.environ["CUTOVER_FAKE_BIN"])
from fake_docker import execute
real_run = subprocess.run
def fake_run(args, **kwargs):
    if args[0] == "docker":
        code, output = execute(list(args[1:]))
        return subprocess.CompletedProcess(args, code, output, "")
    return real_run(args, **kwargs)
subprocess.run = fake_run
# Windows cannot represent POSIX mode600. Other guards still execute unchanged.
if os.name == "nt": stat.S_IMODE = lambda mode: 0o600
args = sys.argv[1:]
if args[0] == "-": code = sys.stdin.read(); sys.argv = args
elif args[0] == "-c": code = args[1]; sys.argv = ["-c", *args[2:]]
else: raise AssertionError("Unexpected Python invocation")
exec(compile(code, "<helper-embedded-python>", "exec"), {"__name__": "__main__"})
'''
CURL = r'''
import json, os, pathlib, sys
sys.stdout.reconfigure(newline="\n")
args = sys.argv[1:]
state_path = pathlib.Path(os.environ["CUTOVER_FAKE_STATE"])
state = json.loads(state_path.read_text()); state["calls"].append(["fake-http", *args]); state_path.write_text(json.dumps(state))
if "-o" in args:
    pathlib.Path(args[args.index("-o") + 1]).write_text(json.dumps({"error": {"code": "NOT_FOUND"}}))
    print("404", end="")
else: print(json.dumps({"status": "ok", "version": "0.1.0"}))
'''


@unittest.skipUnless(Path(BASH).exists(), "Bash is required")
class CutoverTests(unittest.TestCase):
    def run_helper(self, scenario="success", preflight=False):
        temporary = tempfile.TemporaryDirectory(prefix="cutover-fake-")
        self.addCleanup(temporary.cleanup)
        folder = Path(temporary.name).resolve()
        source, original, caddy, backups = (folder / n for n in ("source", "original", "caddy", "backups"))
        for directory in (source, original, caddy, backups): directory.mkdir()
        for directory in (source, original):
            (directory / ".env").write_text("SESSION_TTL_DAYS='30'\nJIZHANG_PASSWORD_HASH='$argon2id$fake-hash'\n", newline="\n")
            (directory / ".env").chmod(0o600)
            (directory / "docker-compose.yml").write_text("services: {}\n", newline="\n")
        (source / "docker-compose.migration.yml").write_text("volumes: {}\n", newline="\n")
        # Empty checksum input is rejected by sha256sum; hash an actual fixture.
        import hashlib
        (source / "SHA256SUMS").write_text(hashlib.sha256((source / "docker-compose.yml").read_bytes()).hexdigest() + "  docker-compose.yml\n", newline="\n")
        (caddy / "Caddyfile").write_text("fake config\n")
        binary = folder / "bin"; binary.mkdir()
        (binary / "fake_docker.py").write_text(FAKE, newline="\n")
        (binary / "runner.py").write_text(RUNNER, newline="\n")
        (binary / "fake_curl.py").write_text(CURL, newline="\n")
        for name, target in (("docker", "fake_docker.py"), ("python3", "runner.py"), ("curl", "fake_curl.py")):
            shim = binary / name
            shim.write_text("#!/usr/bin/env bash\nexec " + shlex.quote(Path(sys.executable).as_posix()) + " " + shlex.quote((binary / target).as_posix()) + ' "$@"\n', newline="\n")
            shim.chmod(0o755)
        helper = (ROOT / "cutover-known-server.sh").read_text()
        # Git Bash may reorder the inherited Windows PATH. Pin every shell-side
        # external service command to the fake directory before running guards.
        shell_bin = binary.as_posix()
        if os.name == "nt": shell_bin = "/" + shell_bin[0].lower() + shell_bin[2:]
        helper = helper.replace("set +x\n", "set +x\nexport PATH=" + shlex.quote(shell_bin) + ':"$PATH"\n')
        for before, after in (("/opt/jizhang-api-2026-10-09/jizhang-api-source", source), ("/opt/jizhang", original), ("/opt/caddy/etc", caddy), ("/opt/jizhang-backups", backups)):
            # Replace longer backup path before the common /opt/jizhang prefix.
            if before == "/opt/jizhang": continue
            helper = helper.replace(before, after.as_posix())
        helper = helper.replace("/opt/jizhang", original.as_posix())
        script = folder / "helper.sh"; script.write_text(helper, newline="\n")
        state_path = folder / "state.json"
        state_path.write_text(json.dumps({"scenario": scenario, "calls": [], "new": False, "original": original.as_posix(), "caddy_dir": caddy.as_posix()}))
        env = dict(os.environ, CUTOVER_FAKE_STATE=str(state_path), CUTOVER_FAKE_BIN=str(binary), MSYS_NO_PATHCONV="1", MSYS_ARG_CONV_EXCL="*")
        env["PATH"] = str(binary) + os.pathsep + env["PATH"]
        result = subprocess.run([BASH, str(script), *(["--preflight-only"] if preflight else [])], env=env, capture_output=True, text=True, timeout=45)
        self.assertNotIn("$argon2id$fake-hash", result.stdout + result.stderr)
        return result, json.loads(state_path.read_text())["calls"], backups

    def test_success_recreates_only_app_and_preserves_exact_environment(self):
        result, calls, backups = self.run_helper()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("CUTOVER_OK", result.stdout)
        self.assertEqual([c for c in calls if c[0] == "stop"], [["stop", "trial-id"], ["stop", "old-id"]])
        directory = next(backups.iterdir())
        override = json.loads((directory / "rollback.override.yml").read_text())["services"]["jizhang"]
        self.assertEqual(override["environment"]["JIZHANG_PASSWORD_HASH"], "$$argon2id$$fake-hash")
        self.assertEqual(override["environment"]["WEB_DIST_DIR"], "/app/public")
        self.assertIn("SESSION_TTL_DAYS=30", (directory / "effective.env").read_text())
        self.assertTrue((directory / "data" / "jizhang.db").is_file())
        self.assertFalse(any("restore" in call for call in calls))

    def test_preflight_checks_credentials_without_stopping(self):
        for scenario in ("success", "credential_failure", "added_ai_key", "ttl_failure", "wrong_volume", "unknown_serialization"):
            with self.subTest(scenario=scenario):
                result, calls, _ = self.run_helper(scenario, preflight=True)
                self.assertEqual(result.returncode == 0, scenario == "success", result.stderr)
                self.assertFalse(any(c[0] in ("stop", "start", "run", "cp") or "up" in c for c in calls))

    def test_node_options_override_preserves_runtime_and_dollar_literals(self):
        for scenario in ('node_options_changed', 'node_options_dollar', 'node_options_raw_dollar', 'node_options_canonical_double'):
            with self.subTest(scenario=scenario):
                result, calls, backups = self.run_helper(scenario)
                self.assertEqual(result.returncode, 0, result.stderr)
                directory = next(backups.iterdir())
                override = directory / 'runtime.override.yml'
                actual = dict(line.split('=', 1) for line in (directory / 'effective.env').read_text().splitlines())['NODE_OPTIONS']
                rendered = json.loads((directory / 'prepared-model.json').read_text())['services']['jizhang']['environment']['NODE_OPTIONS']
                if scenario != 'node_options_raw_dollar': rendered = rendered.replace('$$', '$')
                self.assertEqual(rendered, actual)
                runtime = json.loads(override.read_text())['services']['jizhang']['environment']
                self.assertEqual(set(runtime), {'NODE_OPTIONS'})
                self.assertEqual(runtime['NODE_OPTIONS'], actual.replace('$', '$$'))
                self.assertIn(override.as_posix(), (directory / 'ROLLBACK.txt').read_text())
                for call in calls:
                    if call[0] == 'compose' and ('config' in call or 'up' in call) and not any(Path(value).name == 'serialization-probe.yml' for value in call):
                        self.assertIn(str(override).replace('\\', '/'), call)

    def test_failures_before_recreation_restart_old_app(self):
        for scenario in ("stop_failure", "backup_failure", "archive_failure"):
            with self.subTest(scenario=scenario):
                result, calls, _ = self.run_helper(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(["start", "old-id"], calls)
                self.assertFalse(any("up" in c or "restore" in c for c in calls))

    def test_failures_after_recreation_stop_new_without_database_restore(self):
        for scenario in ("recreate_failure", "ledger_failure"):
            with self.subTest(scenario=scenario):
                result, calls, _ = self.run_helper(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(["stop", "jizhang"], calls)
                self.assertNotIn(["start", "old-id"], calls)
                self.assertFalse(any("restore" in c for c in calls))

    def test_network_json_guard_tolerates_real_formatter_blank_line_and_rejects_changes(self):
        # Go println emits line endings, then Docker inspect adds a final one.
        text = 'jizhang_default\njizhang_cutout-internal\n\n'
        legacy = ''.join(sorted(text.splitlines(keepends=True))).replace('\n', ' ')
        self.assertNotEqual(legacy, 'jizhang_cutout-internal jizhang_default ')
        helper = (ROOT / 'cutover-known-server.sh').read_text()
        start = 'python3 - "$BACKUP_DIR/app-networks.json" "$BACKUP_DIR/worker-networks.json" <<\'PY\'\n'
        code = helper.split(start, 1)[1].split('\nPY', 1)[0]
        valid = {'jizhang_cutout-internal': {'NetworkID': 'private-id'}, 'jizhang_default': {'NetworkID': 'default-id'}}
        worker = {'jizhang_cutout-internal': {'NetworkID': 'private-id'}}
        cases = (
            (valid, worker, True),
            ({**valid, 'unexpected-network': {}}, worker, False),
            ({'jizhang_default': valid['jizhang_default']}, worker, False),
            (valid, {'jizhang_cutout-internal': {'NetworkID': 'different-private-id'}}, False),
        )
        with tempfile.TemporaryDirectory(prefix='cutover-network-json-') as directory:
            app_file, worker_file = (Path(directory) / name for name in ('app.json', 'worker.json'))
            for app, retained, expected in cases:
                with self.subTest(expected=expected, keys=list(app)):
                    app_file.write_text(json.dumps(app) + '\n\n', newline='\n')
                    worker_file.write_text(json.dumps(retained) + '\n\n', newline='\n')
                    result = subprocess.run([sys.executable, '-c', code, str(app_file), str(worker_file)], capture_output=True, text=True, timeout=5)
                    self.assertEqual(result.returncode == 0, expected, result.stderr)


if __name__ == "__main__":
    unittest.main()
