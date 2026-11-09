<div align="center">

<img src="docs/assets/ariadne-mark.svg" width="96" height="96" alt="Ariadne的线" />

# Ariadne

**连接工作的线索，直到完成你想做的事。**

一个连接目标、上下文、工具和已验证结果的集成智能体框架。

[![Verify](https://github.com/YouSangSon/Ariadne/actions/workflows/verify.yml/badge.svg)](https://github.com/YouSangSon/Ariadne/actions/workflows/verify.yml)
![Node.js 24.22+](https://img.shields.io/badge/Node.js-24.22%2B-43853d?logo=nodedotjs&logoColor=white)

[한국어](README.md) · [日本語](README.ja.md) · [English](README.en.md) · [简体中文](README.zh-CN.md)

[产品方向](docs/product-direction.md) · [当前功能](#features) · [开始使用](#getting-started) · [执行策略](docs/execution-policy.md)

</div>

以韩语 README 为准，同步更新四种语言的结构、命令和支持范围。链接的详细文档以韩语或英语提供。README 的翻译不代表 CLI 支持这些显示语言。

---

Ariadne 是一个**将用户目标与执行和验证相连接的集成智能体框架**。

项目的目标是接收用户要完成的工作，连接所需的上下文、工具和执行器，并检查结果。
项目希望在同一工作流中处理编码、调研、文档编写、分析和重复性工作。

项目着重减少反复解释目标、重复查找相同资料，以及不清楚失败原因就反复调用所造成的浪费。
衡量标准是在保留必要信息和验证的同时，减少**获得预期结果所需的模型使用总量**。
目前尚未提供自动完成通用任务的执行器。下文和[产品方向](docs/product-direction.md)区分了当前功能与实现优先级。

<a id="workflow"></a>

## 目标工作流

1. 理解预期结果和完成条件，不再重复询问已确认的内容。
2. 查找相关上下文和先前依据，提供工作所需的内容。
3. 选择符合权限、预算和所需功能的工具与执行器。
4. 检查执行结果。如果工作中断，从已确认的状态继续。

该流程是产品目标。目前提供需求、上下文、记忆和工具连接的基础能力，自动分配、执行和恢复仍在开发中。

<a id="features"></a>

## 当前可用的功能

| 功能 | 实际行为 |
| --- | --- |
| **基于 REQ 的工作** | 在一份需求文档中维护目标、验收标准、约束和验证命令 |
| **保留必需上下文** | 优先保留已确认事实和验证内容；必需信息超出预算时不产生输出并失败 |
| **持久记忆** | 以 PostgreSQL 为原始数据源，提供 Qdrant 或 pgvector 搜索、组织级权限及 HTTP、MCP 工具 |
| **代码影响分析** | 本地 SQLite 图、变更影响、验证目标、依据，以及 MCP 和 UI |
| **本体** | 读取用户定义的术语、关系和来源文件，提供有界词汇搜索及审核状态检查 |
| **知识关系** | 将工作记录提升为 Wiki 内容，并索引链接和未解决的关系 |
| **共用规则和技能** | 从单一源文件生成 Codex、Claude Code 镜像并检查一致性 |
| **变更检测基础能力** | 涵盖所有验收标准（AC）和不可变范围的契约哈希，以及包含 dirty、untracked 和 mode 的源指纹 |
| **受限文件工具** | 检查路径、符号链接、敏感信息、大小和现有 SHA，并通过临时文件替换 |
| **API 传输基础能力** | 验证兼容 Chat Completions 的请求和工具响应，阻止重定向，并明确分类错误 |

> **开发中的范围：** 任务数据库、dispatcher、自动恢复、执行池和完成凭证尚未成为公开的执行功能。
> 此仓库是一个检查点，发布的内容仅包括已验证的上下文补充和连接基础能力。
> API 传输模块的存在不代表通用任务可以自动完成，也不代表原生 CLI 可以无人值守地执行。

以下安装和运行说明适用于已获得必要使用许可的情况。请参阅[许可证](#license)。

<a id="getting-started"></a>

## 开始使用

完整产品需要 **Node.js 24.22.2 或更高版本**才能安装和运行。基于文件的核心无需外部数据库即可使用，持久记忆服务需要 PostgreSQL 和选定的向量存储。以下示例安装全部模块；如只需部分模块，请在克隆后参照[选择模块](#module-selection)。

```sh
git clone https://github.com/YouSangSon/Ariadne.git
cd Ariadne
npm run setup
npm run verify
node bin/Ariadne.mjs --help
```

<a id="module-selection"></a>

### 选择模块

源码检出始终包含所有模块。在 `setup` 或 `verify` 的 `--modules` 中以逗号分隔下表名称；`core` 始终包含在内。省略该选项时，将安装或验证全部模块。

| 模块 | 作用与环境要求 |
| --- | --- |
| `core` | 共用框架；无需外部数据库或 npm 包依赖 |
| `ontology` | 搜索和审核 JSON 术语、关系及来源；无需外部数据库或 npm 包依赖 |
| `memory` | 持久记忆；需要 PostgreSQL 和选定的向量存储配置 |
| `code` | 代码影响分析；使用目标仓库的本地 SQLite |

```sh
# 仅选择核心或本体
npm run setup -- --modules core
npm run setup -- --modules ontology
# 一起安装并验证记忆和本体
npm run setup -- --modules memory,ontology
npm run verify -- --modules memory,ontology
```

仅安装所选包的依赖。选择不会保存，后续执行时需再次指定该选项；它不会卸载现有依赖，也不会隐藏其他模块的命令。

本体使用用户编写的 JSON 术语、同义词、带类型的关系及来源路径。

```sh
node bin/Ariadne.mjs ontology inspect --file modules/ontology/example.json
node bin/Ariadne.mjs ontology search --file modules/ontology/example.json --query memory --limit 5
```

每次读取都会根据定义和来源文件重新计算审核摘要，并报告 `unreviewed`、`current` 或 `stale`。搜索是有界词汇搜索，不提供 LLM、SQL 或可回答性判断。审核状态不代表经过身份验证的批准。现有的 `knowledge promote` 和 `knowledge index` 处理独立的 Wiki 快照。

记忆、代码、需求、上下文、规则集成、Wiki、执行基础和本体各自拥有自己的规则和数据。领域层和应用层依赖端口，文件、数据库、HTTP 和进程适配器在外层接入。现有入口与存储契约保持兼容。所有权和边界检查见[架构](docs/architecture.md)，本体格式见[模块与本体](docs/modular-ontology.md)。

在要处理的仓库中运行当前提供的代码分析和上下文命令。代码命令需要 `code` 模块的依赖。

```sh
node /path/to/Ariadne/bin/Ariadne.mjs code init
node /path/to/Ariadne/bin/Ariadne.mjs code index
node /path/to/Ariadne/bin/Ariadne.mjs code analyze --changed src/example.ts --fail-on none
node /path/to/Ariadne/bin/Ariadne.mjs context --root . --req my-task
```

使用记忆功能前，先安装 `memory` 模块的依赖，再将 `packages/memory/.env.example` 复制为根目录下的 `.env`，并检查数据库和向量设置。不要将实际值提交到 Git。默认 transformer 模型在本地运行，首次运行时可能下载权重。API 密钥和付费供应商不会自动配置。

```sh
node --env-file=.env bin/Ariadne.mjs memory serve
node --env-file=.env bin/Ariadne.mjs memory mcp
```

客户端连接和仓库配置请参照[配置与运维指南](docs/consolidation.md#runtime-directories-and-agent-clients)。

将共用规则和技能复制到独立的安装路径。

```sh
node scripts/install.mjs
```

仅在选择 `--global-pointer` 时才会连接现有全局配置。
项目应用和移除步骤请参照[入门指南](docs/ONBOARDING.md)和[运维指南](docs/OPERATIONS.md)。

<a id="responsibilities"></a>

## 规则与执行器的职责

| 对象 | Ariadne 的作用 | 独立维护的内容 |
| --- | --- | --- |
| **Codex · Claude Code** | 提供共用工作规则、需求和上下文 | 各工具的登录、会话和执行权限 |
| **Gemini** | 可选的手动交接包基础能力 | 用户的 CLI 安装、认证和执行 |
| **模型 API、Grok 等** | 兼容 HTTP 传输和受限工具格式 | 单独的 API 认证、费用和实际供应商兼容性验证 |

只使用一个工具也可以。连接多个工具不会合并认证或订阅。
付费供应商的实际调用、原生自动执行和操作系统级进程隔离尚未验证。

<a id="principles"></a>

## 小型框架与可验证的规则

- 首先保留必需上下文，避免冗长的可选笔记挤掉验证契约。
- 明确拒绝无效的 REQ ID、状态、重复的 AC 和不支持的语法。
- 除文件内容外，还将路径、类型、mode 和未跟踪的变更纳入源指纹。
- 保留应对实际失败的检查和防护措施，不以规则或智能体数量为目标。
- 区分模型的完成声明、本地检查、远程 CI 和实际服务的运行结果。

`AGENTS.md` 传达工作规则。脚本和测试负责可以确定性检查的部分。
仅靠指令文件不会产生后台事件接收或自动恢复能力。

<a id="verification"></a>

## 验证

```sh
npm run verify
# 不安装包依赖，仅检查核心源码时
node scripts/verify.mjs
```

完整的 `npm run verify` 保留现有的包检查。与 setup 一样，可使用 `--modules` 验证所选模块。即使仅选择 `core`，核心源码检查也包含共用的本体源码测试。

检查使用真实文件、临时项目和测试启动的 HTTP 服务器。CI 中的 PostgreSQL、pgvector 和本地 transformer 搜索验证作为独立任务运行，无需调用模型。
不要将 API 协议检查视为模型质量、订阅节省率或实际服务性能的依据。
文件 SHA 检查与 rename 之间无法保证防止任意外部写入者竞争，因此需要使用独立工作区。

<a id="repository-guide"></a>

<details>
<summary><strong>仓库指南</strong></summary>

| 位置 | 作用 |
| --- | --- |
| `core/AGENTS.core.md` | 简短共用规则的源文件 |
| `skills/` | 需求、路由、上下文和交接技能的源文件 |
| `.agents/`, `.claude/` | 面向各工具生成的镜像 |
| `lib/`, `scripts/`, `tests/` | 确定性检查和回归依据 |
| `packages/memory/`, `packages/code/` | 内部实现、固定的依赖、现有契约与测试 |
| `bin/Ariadne.mjs` | 单一安装和执行入口 |
| `modules/ontology/` | 基于文件的本体模型和搜索 |
| `modules/llm-wiki/` | Wiki 内容提升和关系索引 |
| `modules/loop/` | 契约、文件工具、传输和手动交接基础能力 |
| `evaluation/` | 无模型调用评估工具的对照组 |

项目名称和仓库路径为 **Ariadne / `Ariadne`**。
保留现有安装数据格式和标识符 `.harness/`、`~/.harness`、`harness-*`。

</details>

<a id="harness-evidence"></a>

## 按需选择技能与比较执行记录

`skills` 显示目标项目的技能名称、描述和内容 hash。`context --skill name@SHA256` 仅将选中的完整正文纳入必需上下文预算，并拒绝内容变更或预算超限。`eval compare` 比较执行记录的条件、报告的结果及失败成本。它不会自动运行代理，也不能证明实际节省比例。

```sh
node bin/Ariadne.mjs skills --root /path/to/project
node bin/Ariadne.mjs eval compare --file evaluation/comparison-example.json
node bin/Ariadne.mjs eval memory-ablation --file evaluation/memory-ablation-example.json
```

记忆可以关联复查方法、触发条件和已报告的来源。`inspect_memory_impact` 查询同一组织和范围内已登记的修正影响。`eval memory-ablation` 比较包含或排除一条可选记忆的执行记录、结果和总成本。这些工具不会自动复查、修改或提升记忆；未登记的依赖关系和实际效用仍需单独验证。参见[契约与使用范围](docs/memory-reuse.md)。

来源定位、按需读取、修正候选和有限维护的[后续详细设计](docs/memory-evolution-design.md)尚未实现。

Go 扩展契约、参考报告转换和包检查处于[实验阶段](docs/extension-implementation-plan.ko.md)。它们独立于现有 Node 产品运行，尚不提供用户扩展安装、执行或经过验证的 sandbox。
Rust worker 和固定 Podman profile 是独立的运行适用性测试工具，尚不提供公开的用户扩展执行功能。

[20 个来源的审查、应用范围与输入格式（韩语）](docs/harness-engineering-adoption.md).

<a id="license"></a>

## 许可证

源代码公开供查阅。使用、复制、修改和再分发须事先获得著作权人的书面许可。适用法律、平台条款及先前许可证授予的权利，以及第三方许可证均不受影响。详见 [LICENSE](LICENSE)。

---

**Read the intent. Keep the thread. Verify the result.**
