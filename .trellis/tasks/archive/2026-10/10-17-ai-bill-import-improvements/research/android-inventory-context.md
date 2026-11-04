# Android import inventory context

Planning-time source excerpt from `clients/android/README.md`, not implementation evidence for this task. Explicitly read affected README sections and Kotlin before editing; update the source inventory with implementation. This excerpt avoids truncated full-document injection.

Source line 502:
| A015 | 系统选单附件并显示文件名/KB；上传完成核对picker generation、会话、草稿是否改变/是否发送或归档；取消不改草稿；字节不保存 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|

Source line 503:
| A016 | 客户端和服务端只接受非空CSV/XLSX、≤5MiB；微信XLSX/支付宝CSV由服务端解析；Android source固定auto；无来源选择UI |[DocumentFiles.kt](app/src/main/java/com/yansuu1/jizhang/ui/DocumentFiles.kt)；[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)；[assistant.ts](../../packages/server/src/routes/assistant.ts)|

Source line 504:
| A017 | 每次只附一个文件；无相机、照片、音频、PDF、通用文档 AI 分析入口 |AssistantComposerDraft；[assistant.ts](../../packages/server/src/routes/assistant.ts)|

Source line 505:
| A018 | 消息区显示用户/助理/工具的内容，文本、progress、error、attachment、result、tool-card；文本按普通 Text 显示 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|

Source line 506:
| A019 | 无正文的历史 complete 进度不再占卡（结束不等于入账）；running/failed/未知状态紧凑提示，失败只按安全错误码显示一次说明，不渲染原始错误正文；附件显示文件名 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|

Source line 507:
| A020 | 结果卡显示服务端 summary 和最多 6 个白名单摘要字段，递归对象最多深度 2；金额明确带 ¥，类型 0/1 展示支出/收入，日期按有效 ISO 或毫秒时间戳格式化；不渲染任意 JSON |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|

Source line 508:
| A021 | 工具卡保留操作名/toolName/摘要/影响数/warnings；values与非导入preview可展开完整递归操作详情（含before/after、公开引用ID与数组，格式化日期/金额，排除秘密/附件摘要字段）；导入卡紧凑按钮打开全屏工作区 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|

Source line 509:
| A022 | 操作状态有 pending / confirmed / cancelled / expired，未知状态提示刷新；终态关闭执行按钮 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)、1402–1409|

Source line 510:
| A023 | 全屏二次核对所选收支合计、退款标签、每行现有分类与审核备注（空值明确）；返回不写账，0选择禁止确认。 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|

Source line 511:
| A024 | 普通工具保持可选字段语义；平台导入始终传非空显式selectedIds（1–100），不会null/省略全文件；仅传所选行覆盖；未知结果提示并刷新，无自动重发，需显式刷新核对才重新开放确认 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)；[AssistantRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/AssistantRepository.kt)|

Source line 512:
| A025 | 待确认操作可取消；请求中锁单个 action；失败刷新核对；对话发送/执行中禁止归档 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|

Source line 513:
| A026 | 全屏最多前200行预览，本地搜索/筛选（全部/已选入/未选/疑似重复）；分别显示来源备注、审核备注、AI建议/理由、来源状态、退款提醒与规则说明状态；疑似重复行可在工作区内打开只读对比，返回保留筛选/搜索/滚动与审核草稿；未展示行不会导入。 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)；[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|

Source line 514:
| A027 | 初始选择来自完成的AI建议，最多100；AI失败初始不选。用户自主选择/取消任意有效未导入账单（正金额且未入账），可逆转建议、手动选疑似重复及规则行；仅已存在/非正金额锁定。 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|

Source line 515:
| A028 | 编辑页仅选择现有活跃同类型可记账分类ID（有子分类的支出父类不可选），不创建/恢复分类；独立审核备注≤200字符可明确清空，未编辑保留完整来源备注。缺分类必须用户处理。 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)；[AssistantRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/AssistantRepository.kt)|

Source line 516:
| A029 | 显式选择及发送覆盖最多100，预览200；审核草稿可保留当前预览内已编辑但未选中的分类，不静默丢弃后续编辑；上限、请求中及关闭操作有解释；0禁继续，缺分类禁继续；仅发送所选分类ID/备注覆盖。 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)、876|

Source line 517:
| A030 | 原件仍在进程需长度+SHA-256匹配本action才绑定/确认；上传晚结果检查当前pending卡，终态不复活；离开页面/进程丢附件重新选原件 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)、858–873、1204–1222|

Source line 518:
| A031 | 原件不一致不执行；可重新核对原文件；操作终态后清理本地行选择/附件/分类覆盖 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|

Source line 607:
| A101 | 疑似重复行 → 对比现有账单：来源日期/整数分金额/类型/独立退款/账户/来源分类/审核分类/完整来源及审核备注，单号/状态/交易对方按可用事实显示；服务端当前候选完整备注/历史账户分类名称/退款身份；同平台账户、服务端本地同日同类型同金额是线索而非证明。 |[AssistantImportWorkspace.kt](app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportWorkspace.kt)；[assistant-import-comparison-service.ts](../../packages/server/src/services/assistant-import-comparison-service.ts)|

Source line 608:
| A102 | 对比候选按ID分页（手机20/页，服务端limit 1–50）和总数/读取时间展示；加载、空结果、刷新/失败重试、下一页；打开/关闭不改选择，显式保留/排除只改来源ID，遵守有效未导入（正金额且未入账）/忙碌/未知结果/100行上限；父列表保持挂载，action+row及请求代次隔离晚响应；已关闭操作关闭对比；当前有效对比请求401返回登录，失效请求不触发导航；整数事实拒绝小数/溢出而非截断。 |[AssistantDuplicateState.kt](app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantDuplicateState.kt)；[AssistantImportWorkspace.kt](app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportWorkspace.kt)|

Source line 615:
| GET /assistant/conversations/:conversationId/actions/:id/rows/:rowId/duplicates | 导入工作区疑似重复行→对比现有账单；A101–A103 | 源码接入/自动测试与构建；设备待验 |

Source line 952:
| [app/src/main/java/com/yansuu1/jizhang/ui/DocumentFiles.kt](app/src/main/java/com/yansuu1/jizhang/ui/DocumentFiles.kt) | SAF名称/CSV校验/受限读取；D007/I013/A016 |

Source line 975:
| [app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantDuplicateState.kt](app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantDuplicateState.kt) | 导入疑似重复账单就地对比状态与行级锁定；A101–A103 |

Source line 976:
| [app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportState.kt](app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportState.kt) | AI导入有界解码/选择/筛选/request gate；A005/A026–A029 |

Source line 977:
| [app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportWorkspace.kt](app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportWorkspace.kt) | 全屏导入/分类/确认、操作详情与附件限制；A016/A021/A023/A026–A030 |

Source line 979:
| [app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantStreamingComponents.kt](app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantStreamingComponents.kt) | 流式卡片组件、状态徽章、单选追问卡与停止生成按钮；A011/A018–A022 |

Source line 1045:
| 2026-10-16（AI流式对话与交互式追问协议v1） | A005/A010–A014/A018–A025/A033/A035：纯文本 POST /generations 流式对话与 POST /cancel 显式停止；streamSse 接收 state/text-delta/message/terminal 事件增量显示成长气泡；单选追问卡（2–6项，>=48dp，点击锁定并支持相同 clientRequestId 重试，409并发保护，不记账）与自由输入；状态徽章区分8种状态；断流转 GET snapshot 核对不盲目重发；历史卡终态优先于快照 pending；A->B->A 与旧 GET 代次隔离；几何边界阅读滚动保护；附件保持 legacy 流程；Section 11.0 补齐 7 个 generation/duplicate/analyse 端点（共 115 个服务端 API），Section 11.1 收录全部 49 个 main Kotlin 文件目录条目 | Android 源码及 87 项本地单元测试通过（测试项数字来自 Gradle Test XML 报告 build/test-results/testDebugUnitTest/*.xml；artifacts/android-stream-check.log 记录 BUILD SUCCESSFUL 全局构建通过但日志文本不含 87 汇总字样）、lintDebug/assembleDebug 编译通过；后端先后经 F1/F2 修复（571 passed）及 tokenizer 空容器/尾随逗号缺陷修复，达到 580 tests/lint/typecheck/build 全通过（artifacts/server-tokenizer-fix-*-20261016-131148.log）；未进行物理设备/真实 Provider/生产部署验收，整体端到端实机验收 pending |

Source line 1046:
| 2026-10-13（AI功能重设计） | A001/A003/A005/A007/A013/A015–A016/A021/A023–A030/A033/A035/A098：独立会话、紧凑卡、全屏导入/分类/二次核对；200展示/100显式选择/零禁确认；dateLabel、hash匹配、请求代次/上传晚完成隔离；既有Provider/工具合同保留 | 源码与7项新增helper测试；Gradle检查记录见任务ai-assistant-implementation-status.md；无设备/真实AI/生产写入证据 |
