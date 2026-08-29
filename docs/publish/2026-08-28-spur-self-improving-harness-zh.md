---
title: "从 Warp 的 Self-Improving Agents 到 Spur：真正需要持续进化的是 Harness"
topic: "Spur harness engineering build in public"
style_profile: "technical-founder-build-in-public"
platform: "x-article"
language: "zh-CN"
status: review
created_at: "2026-08-28"
confidence: HIGH
sources:
  - "https://claude.com/blog/how-warp-builds-self-improving-agents-on-claude"
  - "https://github.com/gobing-ai/spur"
  - "../report/2026-08-28-harness-engineering-playbook-vs-spur.md"
---

# 从 Warp 的 Self-Improving Agents 到 Spur：真正需要持续进化的是 Harness

Claude 新的一篇博文《[How Warp builds self-improving agents on Claude](https://claude.com/blog/how-warp-builds-self-improving-agents-on-claude)》提到：Warp 没有把“自我改进”做成一个神秘的模型能力，而是构建了一个很朴素的闭环——内部的 base skill 负责完成领域任务，外部的 improver skill 定期收集人类反馈、识别有效信号，并提出尽可能小的 skill 修改；修改仍然要经过正常的 PR、Review 和人工批准，合并后才会影响下一次执行。反馈不会随着 session 结束而消失，也不会被 Agent 不加判断地直接写进自己的行为规则。

这篇文章和我们构建 [Spur](https://github.com/gobing-ai/spur) 的出发点高度一致：Agent 的长期质量，不能依赖一次更长的 Prompt，也不能依赖模型“下次自己记住”。真正能够复利的是一套可检查、可回放、可约束、可演进的 Harness。Skill 是其中的重要载体，但只有当反馈、状态、验证、权限和运行证据形成闭环时，Skill 的更新才不是把偶然经验永久放大。

spur是以一款我们正在打造的harness toolkit,。 github地址是：[gobing-ai/spur/](https://github.com/gobing-ai/spur/) ， 相应的文档可以参见 [官网](https://gobing.ai/prod-spur) 。或直接运行如下命令行进行安装试用:

```bash
## install via bun
bun add -g @gobing-ai/superskill @gobing-ai/spur && superskill install sp

## or via bash script
curl -fsSL https://raw.githubusercontent.com/gobing-ai/spur/main/scripts/install.sh | sh

## After installed, you can use the following command in you projiect to initialize your project and run the web ui part
spur init && spur self  serve &
```


最近我们拿一份行业 Harness Engineering Playbook，与 Spur 当前的架构和真实代码做了一次[逐项对照](../report/2026-08-28-harness-engineering-playbook-vs-spur.md)。Playbook 把成熟 Harness 拆成六类能力：Guides、Sensors、Agentic Loop、Memory、Permissions 和 Observability。这个框架很适合做架构审视；而我们的核心发现是：Spur 并不缺少这些层，它已经把其中大部分从概念变成了可以执行和验证的工程系统。

这里简单总结下我们已经做对的部分：

**第一，Spur 从一开始就不是另一个 Coding Agent。** 它不接管模型账号，不保存 Agent 的 API Key，也不发明新的 BYOK 平台。Claude Code、Codex、Gemini CLI、pi 等 Agent 继续使用各自原生的认证、模型和执行环境；Spur 只负责在它们外面补上工程纪律。这个边界让我们能够保持 local-first，也避免为了“统一”而把所有 Agent 降级成最低公分母。

**第二，我们把任务状态和完成标准放在可审计的系统里，而不是留在对话里。** Task 和 Feature 以 Markdown 为权威来源，SQLite 保存派生的运行状态、事件和分析数据；Requirements、Acceptance Criteria、Review、Testing 和最终 Verdict 都可以被人和工具重新读取。Session 可以丢失，但项目为什么做、做到哪里、凭什么算完成，不应该随 Session 一起消失。

**第三，确定性 Sensor 永远排在模型判断之前。** Biome、TypeScript、测试与覆盖率、规则引擎、Task/Feature Gate、Corpus Sweep、兼容性清单和脚本契约检查，先回答机器能够确定回答的问题；只有功能语义、架构质量和上下文判断才交给 Reviewer/Verifier。我们不希望一个 LLM 用“看起来没问题”替代一个本来可以运行的检查。

**第四，Agentic Loop 是有边界的状态机，不是无限 Prompt 链。** Spur 的 Workflow 使用明确的状态、Guard、失败路径、有限重试、人工审批和 Terminal State。实现失败可以进入修复循环，但循环次数、退出条件和证据位置必须是可见的。长时间运行的 Agent 最危险的不是偶尔犯错，而是在没有预算、没有停止条件、没有恢复点的情况下持续犯错。

**第五，我们已经建立了自己的反馈 Ratchet。** 一次问题先成为可追溯的 Finding；重复出现后进入 Lesson 或 Guide；能够确定检测时升级为 Rule、Test 或 Gate；真正稳定后才成为环境约束。这个方向与 Warp 的 base skill / improver skill 非常接近，但 Spur 更强调“控制强度逐级提升”：能由确定性 Sensor 约束的问题，就不长期停留在提示词里。

**第六，Memory 在 Spur 里不是一个含混的向量库概念。** Task、Feature、Workflow State、Run Artifact、System Event、History Analytics 和 Indexed Context 各有明确用途。原始 Agent 历史保留在文件中，结构化数据经过验证和脱敏后才进入数据库。我们优先解决 Authority、Freshness、Retention 和 Recovery，再讨论是否真的需要更复杂的记忆基础设施。

**第七，多 Agent 协作已经进入控制平面，而不是靠终端技巧。** Spur 使用持久消息、明确角色、Run/Artifact 引用、占用者身份绑定和精确等待来协调 Agent；不抓取别人的 Terminal，不模拟按键，也不再发明一条隐形 IPC 通道。对我们来说，多 Agent 的难点不是“同时启动更多模型”，而是身份、状态、等待、替换和证据在并发下仍然可信。

这次对照也强化了一个判断：行业 Playbook 更适合作为紧凑的 Review Lens，Spur 更像它的可执行版本。Playbook 告诉我们应该检查哪些性质；Spur 必须进一步回答这些性质由哪个模块拥有、什么状态算通过、失败后如何恢复、证据保存在哪里，以及规则怎样在不破坏现有 Agent 原生能力的前提下跨平台工作。我们不会按照六个概念层复制六个新子系统，而会继续在已有的 Workflow、Rule、Artifact、Event、Role 和 History 边界上加深能力。

接下来我们只做一轮有明确证据目标的强化：让最终 PASS 绑定同一个不可变 Proof Digest，并移除文档流水线里的 synthetic PASS；给常驻 Guide 增加体积预算；在高风险或无人值守阶段声明并校验原生 Executor 的 Capability；把真实 Usage、硬预算、Trip Wire 和 Escalation Packet 接入现有运行链路；同时强制高风险任务使用新上下文和独立 Verifier，并为 Checkpoint、Indexed Context 以及“无人工返工的 Verified Result”补齐 Freshness、Retention 和度量。所有工作都已经拆成可独立验证的 Feature/Task，不增加第二套 Workflow Engine、Policy DSL、Sandbox 或 Memory Platform。

## 结语

Warp 的实践再次说明，Self-Improving Agent 的关键并不是让 Agent 随意改写自己，而是把反馈变成小而清晰、可验证、可 Review、可回滚的工程变更。Spur 想做的正是这层长期基础设施：不替代你已经选择的 Coding Agent，而是让它们在真实项目中更可靠地规划、执行、验证、协作和进化。模型能力会继续快速变化，但一个能够把失败沉淀为更强控制、把 PASS 绑定到真实证据的 Harness，才是可以持续复利的部分。#BuildInPublic #HarnessEngineering #CodingAgents
