# Independent check results — 2026-10-14

Status: PASS for task-owned local implementation and maintenance-only read-only
rollout preparation. No remaining blocking findings within the documented trust
boundary. Production rollout/actual-candidate approval remain separate gates.
Reviewed as delegated trellis-check; no recursive agent dispatch or commits.

## Finding fixed
Protected JSON previously used Python's permissive last-key-wins parser and
accepted NaN/Infinity. A corrupted registry/receipt/plan could therefore have an
ambiguous interpretation (including protection flags). retention.py now rejects
duplicate keys recursively and nonfinite constants before interpreting data.
Added regression tests and documented the strict protected JSON boundary.
This is corruption hardening, not protection against a malicious root operator:
root controls scripts, registry, lock and off-server attestations.

## Files changed by this check
- deploy/api-production-tools/retention.py
- deploy/api-production-tools/test_retention.py
- deploy/api-production-tools/RETENTION.md
- Task check-todo.md and check-status.md (this evidence)
Unrelated existing working-tree changes were preserved. manage.sh was reviewed
and tested but not modified by this check.

## Reviewed contracts
- Apply is explicit, digest-bound, 900-second bounded and recomputes the exact
  preview. It rechecks registry, all remaining recovery points, topology/health,
  container references and lock before each candidate unlink.
- Only explicitly enrolled direct-child regular private .db files in the new
  allowlisted root can be deleted. Symlinks, hardlinks, sidecars, corrupt or future
  points fail verification. Invalid enrolled points block all deletion; unknown
  files stay individually unmanaged/pinned. No historical-tree or volume pruning.
- UTC 7/30/180 boundaries, ISO year/week and month grouping, minimum three distinct
  hashes, duplicate preservation, pins and all release associations are covered.
- Off-server receipt is explicitly root-private OPERATOR ATTESTATION bound to the
  hash/time, not remote cryptographic proof. Invalid/missing retained evidence
  blocks apply. Tool cannot assess full application compatibility or secret recovery.
- Wrapper's five operation signatures and retain-days=0 remain unchanged. up and
  backup lock exclusively; status/config/logs work without the lock. Direct/manual
  writers must cooperate for the whole deployment window; nested wrapper locking
  is explicitly unsupported. Root external writers can race final checks.
- Current/two usable rollback image/config preservation is an operator requirement;
  the tool conservatively retains ALL release-associated snapshots and does not
  claim to classify image usability. Legacy material remains outside apply.
- Timer files are source templates only; destructive service runs false. No timer
  was installed/enabled. Newly enrolled root requires manual completed-snapshot
  transfer/enrollment; old directories and existing app backup policy do not change.

## Verification
- Windows Python 3.13: maintenance unittest discovery 34 tests, 31 passed and
  3 Linux-specific tests skipped; compile and bash -n passed.
- Existing source bundle mock tests: 2 passed.
- Linux server Python 3.14.4: all 34 maintenance tests passed in a distinct disposable
  /tmp/jizhang-retention-check.* directory. Docker replaced by fixture executable;
  no live Docker command, production DB read/write, production apply/install/config
  change/restart or schedule activation. Tests exercised real flock conflicts/inode
  replacement, unsafe /tmp ancestor rejection and real root wrapper operations.
- Linux py_compile and bash -n passed. systemd-analyze verify report service/timer
  returned success; emitted only unrelated existing xfs CPUAccounting/tat_agent
  legacy PIDFile warnings. No systemctl enable/start operation was run.
- First remote harness run passed all tests but hit root-owned __pycache__ compile/
  cleanup permissions. Removed only that exact disposable fixture using sudo and
  reran with privileged compile/cleanup: success. Fixtures removed, not deployed.
- Scoped git diff --check passed (autocrlf warnings only). Maintenance files and
  templates checked exact LF bytes. Application TS lint/typecheck not applicable:
  no API/application code changed by this task/check.

## Reviewed source hashes
- retention.py: 4e0db235b0984f8efb233461f4f471f2de4e94c2457f98e551a68baae6000339
- test_retention.py: dccc0c938741550f757402c9876c30b05ee4df82b8dbde96dec4763c56c3ff1c
- manage.sh: 954520b1a8da003eb881ee1643673c7ff840e6fbc06a31469aa89c7066c93838
- archive.py: 555dd329e036b6e2cb760d28f39dafc10deaee489fa5189eff3088c362f2767d

## Main-session handoff
Main session may now review this evidence and authorize maintenance-only checksummed
read-only rollout. Provision/validate canonical private roots and shared lock BEFORE
replacing the wrapper; preserve old files. Validate permissions/checksums and capture
before/after production container identity/health. Empty enrollment may yield zero
candidates, honestly. Obtain actual-candidate approval separately before any production
unlink or destructive scheduling. No deployment/production acceptance is claimed here.
