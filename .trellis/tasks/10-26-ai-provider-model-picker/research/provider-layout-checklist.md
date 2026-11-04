# Provider layout regression checklist

## Source and JVM gate

- Saved-state badge uses saved config, never draft switch as proof of availability; no claim that enabled implies tested connectivity.
- Test feedback belongs to the tested saved version and is cleared/invalidated when saved config changes; dirty draft remains visibly separate.
- Retain fields: enabled/name/url/model/mode/method/auth kind/headerName/timeout/headers/bodyTemplate/responsePath, secret only nonempty and clearSecret flag.
- Keep unavailable preset bodyTemplate omitted unless explicitly edited; do not turn unreadable into clear.
- Save/test/fetch remain synchronous mutual exclusion; no new automatic test/discovery; old config may bootstrap disabled with blank model.
- Connection edits invalidate list and require saving; model-only edit remains discoverable; service/session late-result guards remain.
- Manual model input and popular presets always reachable, including custom/no fetched list; presets not described as available upstream models.
- Preserve server model DTO/caps/search behavior and safe code-based errors.
- Fixed footer is outside weighted scroll. IME and navigation inset applied once, no obscured last advanced field; selected model list is bounded/scrollable under search keyboard.
- Token-based notice colors and motion-reduced behavior; interactive targets >=48dp where possible, avoid squeezed chip labels at big fonts.

## Device acceptance (not inferred from compilation)

1. Open settings and verify saved summary with collapsed advanced; footer stays visible while scrolling.
2. Toggle draft and inspect pending-save copy; close without save must not change server config (perform only with explicit authorization).
3. Open model picker before fetching: presets visible and manual field available; choose only edits draft.
4. Search fetched items, clear filter, current marker; no implicit save/test calls.
5. Keyboard in URL/key/model and advanced JSON; final field/button accessible, no horizontal clipping; small screen/landscape/large fonts/dark themes.
6. Header auth empty-name save shows local error at visible field; bad timeout/headers expands advanced with visible feedback; no request on validation failure.
7. Initial load failure prevents blank save; retry independent. Save/test/fetch error keeps draft.
8. Actual paid tests, config save changes, secret removal, or live upstream discovery are separate explicit actions, not part of layout inspection.

Current turn is approved for source implementation/tests/APK only; do not mark device steps complete without executing them.
