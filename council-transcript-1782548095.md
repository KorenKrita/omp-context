# Council Transcript — omp-context Compact Benefit Formula

**Date:** 2026-06-27
**Question:** 设计 omp-context 的 compact 收益指标公式，给 agent 作为定量参考（非自动决策）。

---

## Framed Question

omp-context 是 OMP 插件，3 个工具：acm_checkpoint（label 锚点，零成本）、acm_timeline（对话树+token HUD）、acm_compact（从任意 anchor 创建带手写 summary 的续接分支，旧路径 off-path 可回溯——回到过去/前往未来）。

**与 bash-agent DP 压缩的机制差异：**
- bash-agent：每轮自动检查，`NetBenefit(k)=①后续节省-②缓存失效-③压缩成本-④信息失真+⑤质量改善`，自动选 k，summary LLM 生成（有成本）
- omp-context：agent 主动调，summary 手写（零 LLM 成本），compact 是 SessionManager 内部操作（无 LLM 请求、无缓存失效），off-path 可回溯（信息可逆）

**可用数据：** getContextUsage(tokens/window/percent)、getBranch(active path)、getTree(含 off-path)、per-entry token 估算 (len+3)/4+1、getLabel、branch_summary 数 = 压缩次数 c
**不可用：** 剩余轮数 E、每轮 LLM 调用数 L、缓存价格

**要求：** 充分利用可用数据；可解释；合理（零成本/无缓存/可逆）；与 bash-agent 收益性指标相反（信息失真趋零，鼓励更激进 compact）。

**草稿：** `CompactScore(a) = H × P(p) / (C × D + S)`

---

## Advisor Responses

### The Contrarian
草稿三硬伤：(1) S 在分母→极性反转，抑制 compact；(2) D 不可计算（无 summary quality 信号，自指）；(3) H 当"丢失收益"前提崩塌（可逆=moved not lost，无价格无法定价）。P(p)=p²/(100-p) 爆炸迫使无脑 compact。真实成本（切回摩擦、summary 纠错）公式失明。诚实结论：承认数据不足，退回 2-3 维粗指标，比凑五变量公式更负责。

### The First Principles Thinker
第一问题：omp-context 真的需要公式吗？手动+手写已把判断权交还 agent。S 不可量化、D≈0 让分数爆炸、recoverability 是机制常数零区分度。bash-agent 需要复杂公式因五维成本真实；omp-context 把 ②③④ 归零，只剩"agent 写 summary 的认知成本"——系统不可量化。可量化+可解释+有锚点区分度的只有 H 和 P。`Score=H×P` 足矣。"opposite polarity"不是改公式符号，是改决策默认值：bash-agent"证明值得才压"，omp-context"证明不值得才不压"。公式是 bash-agent 范式，硬塞是范式错配。

### The Expansionist
草稿低估自己。S 应压倒性大项让 score 几乎全正。真问题是"哪个 anchor 释放的未来余量最大"，目标应 `maximize future capacity` 非 `minimize current loss`。H 应升级为 `H×density`（被后续引用次数/区间长度）。最大 upside：这不是参考指标，是 context OS 雏形——agent 主动维护稀疏高信号树，有效 context window 趋向无限。数据缺口用历史均值估进去。

### The Outsider
三个卡点：(1) 问错了问题——免费+可逆+不丢信息，"值不值得"默认就是"值"，该给排序分非阈值分；草稿分母塞满惩罚项劝退近免费操作，与"push toward MORE"自相矛盾。(2) recoverability_bonus 放分母是反的——可恢复性好=风险低=更该 compact，放分母变小=惩罚可恢复性；它是常量不参与排序，该删。(3) 三个量里两个看不见——summary_weakness 无来源，anchor_distance 和 dropped_size 本质同物却分子分母打架。能稳定观测的只有上下文 % 和归档后省下的 size。建议：`score = freed_space × current_pressure`，两项乘积。可逆性是公理不是变量。

### The Executor
落地方案：`CompactBenefit(a) = Δtokens(a) × p/(100-p) / (Span(a)+1)`。Δtokens=anchor→HEAD 的 entry token 估算和；p=percent；Span=entry 数；+1 防除零。opposite polarity：p→100 飙升鼓励激进，Δtokens 正向，仅 Span 反向。零成本/可逆由"积极倾向"本身表达，不引入 S（常数对相对判断无贡献）。Monday step：在 acm_timeline 的 stepsSinceCheckpoint 循环旁加 computeCompactBenefit，O(n) 单次遍历，零外部依赖。acm_compact details 复用同函数。

---

## Peer Reviews（匿名 A-E，映射：A=Expansionist, B=Contrarian, C=Executor, D=First Principles, E=Outsider）

### Reviewer 1
**最强 C**：唯一可直接实现，与代码库严格对齐。Δtokens 可由 getContextUsage 前后差值或 entry 求和得，p=percent 直接来自 API，Span=stepsSinceCheckpoint 已计算。P 从分母提分子纠正极性，剔除 S 与 pendingCompactCounts 实际定位一致。HUD O(n) 有据。
**最大盲点 D**：把"reference not auto-decision"拉成"不需要公式"，范式误读。"manual+handwritten"推不出"不需要公式"，只推出"不自动触发"。Score=H×P 丢距离维度。
**全员漏**：(a) 未区分候选 target 集合——必须对每个候选分别算；(b) reversibility 应作公理前提移出公式非数值化；(c) 没引用 firstKeptEntryId（compaction 节点自带的被丢首保留 id），是 summary_weakness 唯一可观测代理。

### Reviewer 2
**最强 E**：free+reversible 使"值得"默认 yes、应排名非阈值，"reversibility is axiom"最锐利，收敛到 freed×pressure 两可观测量。C 的 Span 无物理论证。
**盲点**：B/D 只破不立；A 历史平均抹掉特异性；C 的 Span 未论证为何影响收益；E 的 freed_space 未说明如何从候选 anchor 计算。
**全员漏**：labels（语义类型：决策/错误/指令，决定该保护哪些）和 compact count（摘要漂移累积风险）两类现成信号无人纳入。agent reference 最需语义信号区分"能 compact"与"该 compact"。

### Reviewer 3
**最强 E**：(1) "Reversibility is axiom"消解 B/D 对 S/D 不可计算的纠结；(2) freed×pressure 极简可解释可直接实现；(3) Ranking not threshold 是正确范式。"distance≈dropped_size"揭穿 C 除 (Span+1) 的伪独立性——Span 与 Δtokens 高度相关，除 Span 等于双重惩罚大区间。
**盲点**：无人建模"回查成本"。reversibility 是公理不代表回查零成本——agent 回头展开被压缩内容要付 token，频繁回查侵蚀收益。compact count 正是回查历史代理，应作成本修正项。
**全员漏**：(1) labels/tree/compact count 三类信号闲置；(2) compact 的序列本质——一次 compact 改变后续所有 compact 起点和压力曲线，无人建模级联；(3) "何时停止 compact"的对称问题无 metric 信号。

### Reviewer 4（实测代码库）
**最强 E**：ranking vs threshold 直击"reference not auto-decision"。recoverability 极性反转、distance 与 dropped_size 同构却分子分母打架——两诊断最精准。方案最简最贴合机制。
**盲点 C**：编造了 token 估算公式——核查 getMsgContent（116-175 行）仅有显示截断，**代码库无任何 token 估算函数**；computeCompactBenefit 不存在。虚假具体性比愿景陈述更有害。
**全员漏**：(a) per-entry token estimate 代码库完全不存在，contextUsage.tokens 是窗口级总量非 per-entry，任何公式需先补 token 估算函数；(b) summary 是 agent 调 acm_compact 时手写传入（params.summary），决策时刻不存在，S 不只是难量化而是无值可取；(c) compact count 是 in-memory 进程级（pendingCompactCounts），session_shutdown 清空，不作为工具参数暴露给 agent，决策点实际不可用。

### Reviewer 5
**最强 E**：零成本+可逆使"是否紧凑化"成伪问题，真问题是"先做哪个"。score=freed×pressure 最小充分式，精准匹配"排序非阈值"。"可逆性是公理非变量"消解 S/D 纠缠。E 唯一识别 summary_weakness 盲点。
**盲点**：信息丢失风险量化。五家都在量"释放多少/压力多大"，summary 质量几乎无人处理。激进度若无质量约束=激进销毁，与"鼓励激进"自相矛盾。
**全员漏**：(a) labels 与 tree 深度结构——题目给了却无人纳入；(b) compact count 的累积退化——多层 summary 层叠衰减无人建模；(c) 指标校准路径——怎么验证 metric"对"，无判据无法迭代。

---

## Chairman Synthesis

### Where the Council Agrees
1. 草稿 `H×P(p)/(C×D+S)` 三致命硬伤应废弃：S 极性反转、D 决策时刻无值可取、recoverability 是公理非变量。
2. 真问题是排序（选哪个 anchor）非阈值（要不要 compact）——compact 近免费+可逆，"值不值得"默认 yes。
3. 公式应收敛到 2-3 个可观测量，极简可解释。bash-agent 5 项成本在 omp-context ②③④ 全归零。

### Where the Council Clashes
- **要不要公式**：First Principles/Outsider 倾向极简 `H×P`；Executor/Contrarian 倾向 3 项带 Span。裁决：3 项但呈现时主指标 2 项。
- **pressure 形态**：`p²/(100-p)` 爆炸 vs `p/(100-p)` 温和。裁决：用 `p/(100-p)`，鼓励激进但不失控。

### Blind Spots Caught
1. **per-entry token 估算代码库不存在**（reviewer 4 实测）——getMsgContent 只有截断，需补 helper。
2. **labels 和 compact count 被全员闲置**（reviewer 2/3/5）——compact count 可作温和谨慎系数（summary 叠加漂移 + 回查负担）。
3. **回查成本是 reversibility 公理下唯一真实反作用力**（reviewer 3）——用 compact count 代理。

### Recommendation
```
Benefit(a) = Δtokens(a) × pressure(p) × decay(c)

  Δtokens(a)  = Σ entry∈[a,HEAD] (getMsgContent(entry).length+3)/4 + 1
  pressure(p) = p / (100 - p)        (p = getContextUsage().percent)
  decay(c)    = r^c                   (c = branch 上 branch_summary 数；r=0.9)
```
- Δtokens × pressure：主收益（腾空间 × 压力）
- decay(c)：唯一温和反向项（防 summary 叠加漂移 + 回查负担，c=5 仍剩 59%）
- 无 S/D/recoverability：公理或不可观测，移出公式
- 排序分非阈值分：agent 对比候选 anchor 选最高

### The One Thing to Do First
先把公式写进 SKILL.md 作为 agent 参考框架（零代码风险），验证 agent 能否用好"Benefit = 腾出空间 × 压力 × 衰减折扣"心智模型，再决定是否做成 acm_timeline HUD 自动计算。理由：council 揭露最大风险是 per-entry token 估算函数不存在，代码实现有实际工作量；心智模型可先通过 SKILL 文字传递，零成本验证 agent 是否买账。
