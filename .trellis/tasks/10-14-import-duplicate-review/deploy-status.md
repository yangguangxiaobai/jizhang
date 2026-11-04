# Production deployment evidence

User approved deployment, APK installation and device acceptance. API-only image jizhang:api-duplicate-review-20261014T081611Z, sha256:2fc314896e88f15c2b72875bd11594e9cce6755a7ec0e3d8091fba41ba9f2d9d, running since 2026-10-14T08:20:40Z. Main session independently queried actual running container and public health OK. Existing delivery verification.json reports integrity ok, all20 table manifests unchanged across switch, dependency IDs/config/topology unchanged. Original volume and unrelated services preserved.

Consistent backup retained at /opt/jizhang-backups/duplicate-review-20261014T081611Z/database/ with local matching copy artifacts/backups/duplicate-review-20261014T081611Z/. Local backup SHA256 e8f242111be050ac818d2b0175f59728b25ff23955dae84cb751ba0f3a08f348. Recovery script retained locally artifacts/rollback-duplicate-review-20261014T081611Z.sh; inspect before executing, never automatically restore DB.

Device-after manifest check reports only assistant_conversations/messages/pending_actions changed during preview acceptance, ledger tables unchanged. No final confirmation, import, merge/delete or cleanup/timer activation. Independent live subagent audit failed before executing due upstream timeout/502/503; main-session checks above are distinct from that failed dispatch.
