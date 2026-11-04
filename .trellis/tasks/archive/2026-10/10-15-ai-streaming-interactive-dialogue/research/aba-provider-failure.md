# ABA 手机验收中的失败代次诊断（10-15 / conversation-aba）

状态：**COMPLETE — 只读文件与只读元数据诊断**（对应失败项仍为 **FAILED，未转 PASS**）
范围（严格按授权）：仅读任务 artifacts、只读 SSH 元数据（长度/偏移/状态，不取原始文本、不取凭据）、本地纯 parser 探针、现有 target 测试。
未做：新增 provider 调用、改产品/配置/模型/timeout、部署/重启、记账或 confirm、stage/commit、安装依赖、嵌套 sub-agent。

## 1. 被诊断的对象

| 项 | 值 |
|---|---|
| generation | `3da7ef99-f728-40cd-ac6d-cb8824bf7d2b` |
| conversation | `d76d9014-a6c8-4e61-a83c-5286d30e63e1`（ABA 用例中的会话 A） |
| status / outcome | `failed` / `null` |
| error_code | `ASSISTANT_STREAM_BOUNDS` |
| error_message | `AI 返回内容无法识别，本次生成未产生结果。`（= `assistant-stream-types.ts` 的 `INVALID_ENVELOPE` 文案） |
| last_seq | 13（state×2 + text-delta×10 + terminal） |
| created_at → updated_at | 1792162844615 → 1792162850959（Δ 6344 ms） |
| 首条 delta → 末条 delta | 1792162850277 → 1792162850945（跨 668 ms；首字延迟 ≈ 5.66 s） |
| 末条 delta → terminal | 14 ms |

元数据证据：
- 既有（只读复用）：`artifacts/phone-verifier-lifecycle/conversation-aba/12-server-evidence.json`
- 本次只读复核：`artifacts/aba-provider-failure/aba-generation-metadata.json`

## 2. 结论：是「语法/结构无法识别」，**不是** 4000 字符上限

1. **判据一（长度铁证）**：所有 text-delta 的 `text_len` 之和 = **219**，与 `partials_json[0].text` 长度 **219** 完全一致，不存在截断或缺口；`appendDecoded` 的 4000 上限（`MAX_PROVIDER_MESSAGE_CHARS`，`assistant-stream-tokenizer.ts` L149-152）触发时抛出的是**另一条**固定文案 `AI 回复超出长度上限，本次生成未产生结果。`（`OVERSIZE_MESSAGE`），而库里记录的是 `INVALID_ENVELOPE`。219 ≪ 4000，**上限分支从未进入**。
2. **判据二（本地探针）**：`aba-tokenizer-probe.ts`（纯本地、无网络）在同一 tokenizer 上复现两种形状：截断/非 JSON → `INVALID_ENVELOPE`；完整 envelope 且 message = 4001 → `OVERSIZE_MESSAGE`；4000 → 通过。探针输出与线上记录一致，证明 4000 上限是一个**独立的、可区分的**失败形状。
3. **判据三（runner 映射）**：`assistant-generation-runner.ts` L675-681 中，运行期把 `stream.envelope` 重新 `JSON.parse` 失败时抛的也是同一句 `INVALID_ENVELOPE`；因此该代次的失败可能来自**两处之一**（见 §3），但两者都属于“envelope 字节无法被识别为有界 JSON 对象”，与长度上限无关。
4. **排除超时路径**：terminal 距末条 delta 仅 14 ms，且 `error_code` 不是超时文案（`AI 响应超时…`/`本次生成超出时限…`/`未正常结束…`），可排除 provider 总超时与 generation 180 s 死线。
5. **排除上游终止/空回复/不支持字段**：`failed` 且 `outcome=null`、`message_ids_json=[]`，错误码转入 `toStreamError()` 的 `default` 分支 → 文案只能是 `本次生成未能完成，请稍后重试。`；实际记录是 `ASSISTANT_STREAM_BOUNDS` + `INVALID_ENVELOPE`，说明错误体本身就是 `AssistantStreamError`，来自 transport/tokenizer 的“无法识别”判定。

**determined**：失败形状 = envelope 语法/结构解析被拒（tokenizer/parse 级），行程已产出 219 个已解码字符后失败。
**unknown（诚实未知）**：原始 `choices[0].delta.content` 未落库、且不允许新开 provider 调用，因此**无法确定**具体是哪一种 malformation（例如：envelope 在流中被打断/截断后没有闭合、非 JSON/被 ``` 包裹、字段漂移、字符串内出现未转义控制字符等）。**不臆测 provider 根因。**

## 3. 两个可能的失败落点（均与 4000 上限无关）

| 落点 | 触发条件 | 代码 | 可区分性 |
|---|---|---|---|
| A. 增量 tokenizer 拒收 | `AiProviderStream.dispatchEvent()` 把 `delta.content` 推入 `AssistantMessageJsonTokenizer` 时抛 `TokenizerFailure` | `ai-provider-service.ts` L608-613 → `assistant-stream-tokenizer.ts` L124-140 | 失败发生在流中，已产出文本仍保持在 219 |
| B. 终态 envelope 复检 | `[DONE]` 已到、`finish()` 通过，但 `stream.envelope` 重新 `JSON.parse` 失败 | `assistant-generation-runner.ts` L675-681 | 文本已完整产出后失败 |

两者共用同一句安全文案，也共用同一个 `ASSISTANT_STREAM_BOUNDS` 码；线上证据无法区分（原始 envelope 不落库）。**这本身就是一个可观测性缺口**。

## 4. 与既有诊断的关系

- `research/live-stream-diagnosis.md` §2.2 早已记录过另一例同类失败：`ed63eb1c`，text-delta 143 条、**3989** 字符后 `ASSISTANT_STREAM_BOUNDS`、`outcome=null`、无 message，且备注“tokenizer 4000 上限与每轮显示预算 4000 互相作用”。
  - 本次复核给出**修正判据**：仅凭 3989/4000 的贴近不能断定为上限触发；须看 `error_message` 形状（`OVERSIZE_MESSAGE` vs `INVALID_ENVELOPE`）。本次 ABA 用例确认是**后者**（即 envelope 无法识别，非长度上限）；`ed63eb1c` 的形状本次未重新核对，保留原诊断不翻案。
- `finalizeFailed` 不清除 provisional 快照：本代次 `partials_json` 长度 310、`partials_json[0].text` 长 219、`validated=0`，与代码注释（runner L499-500“由写入 terminal 的同一次写入丢弃”）存在**行为差异**——这个失败 partial 仍然留在库里。属于已记录缺陷，本次不改代码。

## 5. 与 ABA 验收报告的关系（防止误读）

- `conversation-aba/REPORT.md` 的 7 项 UI 验收项仍然成立（它们各自有截图/XML/只读证据），但该报告**未提及**会话 A 的这一次生成实际是 `failed`。本文件专门记录这一失败，**该失败项保持 FAILED/未验证，不得写成 completed PASS。**
- 该代次无 message 落库、账本零变动（本次只读复核：generations=29、`transactions=59`、`transfers=2`、`assistant_pending_actions=11`），因此对财务数据无影响。

## 6. 最小修复建议（未实施）

1. **区分文案/码**：给 `INVALID_ENVELOPE` 与 `OVERSIZE_MESSAGE` 之外的 envelope 形状再细分一个稳定子码（例如 `ASSISTANT_STREAM_BOUNDS` + `reason: 'envelope_syntax' | 'envelope_truncated' | 'message_oversize'`），让线上失败不再与长度上限混为一谈。
2. **可选的可观测性**：在服务端日志中记录 envelope 的**长度、首个非法字节偏移、失败阶段（增量/终态）**，绝不记录原文；这样无需新 provider 调用即可定位形状。
3. **产品侧（需父 agent 决策，本次不动）**：`delivery=stream` 下 envelope 语法失败是否应降级为“缓冲重试一次”而非直接 `failed`，以及 `finalizeFailed` 是否应清空 partial。

## 7. 复现命令（只读）

```bash
# 本地纯 parser 探针（无网络/无 provider/无 DB）
packages/server/node_modules/.bin/tsx \
  .trellis/tasks/10-15-ai-streaming-interactive-dialogue/artifacts/aba-provider-failure/aba-tokenizer-probe.ts

# 现有 target 测试（未改代码，作为行为基线）
cd packages/server && node_modules/.bin/vitest run test/assistant-stream.test.ts

# 线上只读元数据（长度/偏移/状态，无原文/凭据）
ssh -i ~/.ssh/jizhang_deploy ubuntu@jz.yansuu1.xyz \
  "sudo -n docker exec -i 0b5eb41efa7c node" < <probe>
```
