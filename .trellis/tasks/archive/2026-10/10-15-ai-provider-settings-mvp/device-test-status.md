# Installed-build live acceptance — 2026-10-15

Device: Huawei nova7Pro TNL0220A15028072, direct USB. Installed APK exact-byte verified in deploy-status.md. Current server is deployed follow-up image. Private screenshots/manifests stay ignored under artifacts/ai-chat-acceptance.

## Verified
- Opened AI tab. Historical empty complete progress cards absent (visible completed-label count 0). Previous timeout displays one safe timeout guidance, no duplicate generic error.
- Created new test conversation through UI. Sent one synthetic read-only hello request: actual model replied hello. Server timestamps indicate approximately 3,003 ms user-to-response.
- Sent one explicitly synthetic bananas CNY13.50 draft-only request mentioning today/WeChat, no confirmation. Actual model returned “What is today’s date?” in approximately 6,543 ms. No tool card created. This request did not time out, but does NOT pass full draft-generation acceptance.
- Before/after table manifests: only assistant_conversations and assistant_messages changed. All ledger/reference/settings/pending-action tables unchanged. No final confirmation, configuration/model/timeout change, ledger insert or deletion.

## Open issue / limits
- Assistant branch receives today in AiPromptContext, but systemPrompt(feature=assistant) does not serialize today and orchestrator facts/input omit it. This explains why current prompt provides no authoritative server-local date for “today”; adding date context needs a source/test fix, not invented device date. Model may still choose clarification, so no claim it is the only cause.
- Old 20-second timeout did not reproduce in these two new-conversation calls; not proven fixed, particularly with old/longer history.
- Did not generate a new failed-progress state in this live test; server failed-state has mock coverage. Did not exercise transaction date card rendering because no pending card was generated.
- No code changes in this test.
