# AI provider protocol research

## Question

How should the first provider adapter cover OpenAI, DeepSeek, and user-defined endpoints without making the accounting feature depend on one vendor's SDK or response shape?

## Findings

- DeepSeek documents an OpenAI-compatible `POST /chat/completions` endpoint with `messages`, `model`, optional JSON output via `response_format: { type: "json_object" }`, and a response body containing `choices[].message.content`. It uses Bearer authentication. See [DeepSeek Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/), [DeepSeek authentication](https://api-docs.deepseek.com/api/deepseek-api/), and [DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/).
- DeepSeek also documents compatibility with the OpenAI Responses API at its configurable base URL, but streaming event and response details differ from Chat Completions. See [DeepSeek Responses API](https://api-docs.deepseek.com/guides/responses_api/).
- OpenAI's current Responses API is a `POST /responses` endpoint with text input and structured JSON output controls, and its default response storage behavior is a provider-level concern. See [OpenAI Create a model response](https://developers.openai.com/api/reference/cli/resources/responses/methods/create) and [OpenAI data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint).

## Design implication

Use a server-owned adapter contract with three modes:

1. `chat-completions`: a preset for OpenAI-compatible providers, including DeepSeek. The server builds the stable request envelope and parses the common `choices[0].message.content` path.
2. `responses`: an optional preset for providers exposing the Responses shape. The server parses the configured text/JSON output path rather than assuming Chat Completions fields.
3. `custom`: the user supplies an HTTP method, URL template, headers, JSON body template, and response extraction path. Templates receive only an explicit allowlist of request variables such as `input`, `categories`, `accounts`, `model`, and `responseSchema`; secrets are injected by the server and are not template variables.

For the first natural-language bookkeeping slice, prefer non-streaming JSON output. Streaming adds SSE parsing, cancellation, partial JSON handling, and a larger failure surface without improving the first acceptance criterion.

## Deferred questions

- Whether the API key is stored encrypted in SQLite using a separate server secret, or stored as a server-only value with the project's existing single-user database protection.
- Whether a future provider profile can be selected per feature; the first slice can use one active profile.
