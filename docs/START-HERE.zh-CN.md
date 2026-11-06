# Relay：先跑起来，再逐步理解

这是一个独立的电商售后 Agent 项目，与 EventHub 没有依赖。前端用英文，方便招聘方演示；聊天支持英文和常见中文售后请求。

## 1. 最快启动

安装 Node.js 24 后，可以双击项目根目录的 `START-MAC.command`（Mac）或 `START-WINDOWS.cmd`（Windows）。首次启动会安装依赖、打开本地配置向导并构建应用。向导选 1 可先体验离线版，选 2 可在本机终端隐藏输入 API 密钥。不会显示密钥。启动后打开 http://localhost:3001，保持终端窗口开启。

如果系统阻止双击脚本，使用下面的终端启动方式。已有 `.env` 时，脚本保留原配置；需要重配时运行 `npm run setup`。Mac 脚本语法已检查，Windows 脚本仍需在 Windows 上验证。

安装 Node.js 24 或以上版本，解压项目，在包含 `package.json` 的目录打开终端：

```bash
npm ci
cp .env.example .env
npm run dev
```

Windows PowerShell 可以把第二行改为 `Copy-Item .env.example .env`。浏览器打开 http://localhost:5173。

默认不需要密钥。演示引擎通过确定性规则识别意图，但订单查询、政策检查、库存、确认与写库都是真实后端实现，不是前端播放预设动画。

推荐先生成一个随机值放进 `.env` 的 `SESSION_SECRET`，这样服务器重启后，同一个浏览器仍可恢复原来的演示账户：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

这是会话签名值，与 OpenAI API 密钥不同。不要把 `.env` 提交到 GitHub。

## 2. 接入真实模型

在你自己的 API 项目中创建专用密钥，保存到本地 `.env`：

```dotenv
AGENT_MODE=openai
OPENAI_MODEL=gpt-4.1-mini
OPENAI_API_KEY=你的完整密钥
```

重启应用。界面顶部将显示 Live LLM，工具执行由模型决定。模型必须支持工具调用，而且你的 API 项目必须有模型使用权限和可用额度。ChatGPT 订阅与 API 计费是分开的。

不要把密钥发送到聊天、前端文件或公开仓库。真实模型模式不会在报错后偷偷切换到演示模式。若请求失败，先检查服务端配置、模型权限和 API 额度。服务端日志不会输出完整密钥。

## 3. 三分钟演示顺序

1. 发：`My RL-1042 headphones have no sound on the left side. Can I get a replacement?`
2. 打开右侧 Execution trace，解释查订单、查政策、查库存和生成 proposal。
3. 暂时不点确认，打开 Orders & resolutions，说明还没有修改订单。
4. 返回原会话，点击 Confirm exchange，再查看已保存的申请和库存变化。
5. 新建会话，发：`RL-1048 is broken. Please exchange it.`，展示缺货处理。
6. 发：`I want a human specialist.`，查看内部工单。
7. 打开 Evaluations，运行演示评测，展开其中一个成功场景和一个拒绝场景。

刷新页面后，可从左侧会话列表恢复对话。浏览器演示账户之间互相隔离。新建无痕浏览器可获得另一套样例订单；不要把这描述成真实用户登录系统。

## 4. 技术分别在解决什么

| 技术                          | 在项目中的作用                             |
| ----------------------------- | ------------------------------------------ |
| React + TypeScript + Vite     | 聊天、订单、政策和评测界面，类型检查与构建 |
| Node.js + Express             | HTTP API、会话、限流和错误处理             |
| OpenAI SDK / function calling | 模型选择工具、接收结果、继续回答           |
| Zod                           | 校验用户请求和模型工具参数，拒绝越权字段   |
| TF-IDF 检索                   | 从小型政策库选择相关段落，提供引用 ID      |
| PostgreSQL                    | 多连接并发、事务和行锁；Docker 路径使用它  |
| SQLite                        | 零外部依赖的本地数据库；快速启动           |
| 数据库事务与幂等              | 防止重试导致重复申请，避免库存变成负数     |
| Vitest + Supertest            | 单元、工作流、并发和 HTTP 集成验证         |
| Docker + Compose              | 打包应用并连接 PostgreSQL                  |
| GitHub Actions                | 上传代码后自动运行测试、评测和构建         |

这里没有为了关键词加入多 Agent、LangGraph、向量数据库或 Kubernetes。单 Agent 的明确工具边界已经足够完成这个场景；面试时应能解释这些取舍。

## 5. 按这个顺序读代码

**第一轮：跑通一个请求。** 从 `client/main.tsx` 的 `send`，到 `server/app.ts` 的 messages 路由，再到 `server/agent.ts` 的 `runAgent`。

**第二轮：理解工具调用。** 看 `toolDefinitions` 和 `executeTool`。模型给出工具名和 JSON 参数，服务端校验后执行，再把结果交给模型。工具名不等于模型有执行权限。

**第三轮：理解确认。** `propose_resolution` 只写待确认方案；`confirmResolution` 才修改订单。它在事务里重新检查归属、期限、政策、库存，并记录唯一 resolution。重复确认同一个 proposal 返回原结果。

**第四轮：理解评测。** 读 `server/evaluation.ts`，看场景如何独立建数据、运行 Agent、检查工具轨迹和数据库状态，最后清理样例数据。离线模式通过不代表真实模型也一定通过。

**第五轮：自己改一个功能。** 比如增加一种政策、增加取消订单工具，或增加一个失败场景。自己实现并写一条有效验证，是理解项目的最快方式。

## 6. 投递前的最小准备

- 自己运行一次，不只看测试结果。
- 接入真实模型后，至少完成一次换货和一次拒绝场景，再运行 live eval。
- 上传 GitHub，并把 README 的演示与部署状态写清楚。
- 录一段 60–90 秒视频；只有实际部署后才填写 Live Demo 链接。
- 至少能解释：为什么模型不能直接退款、如何避免重复确认、怎样评估失败、为什么用当前检索方式。

简历措辞在 `docs/RESUME.md`。可以描述已实现的功能，但不要把模拟退款写成真实支付，不要把 demo 通过率写成 LLM 在生产中的成功率。

## 7. 验证真实模型

完成本地密钥配置后，运行 `npm run verify:live`。这会发起付费 API 请求，检查真实模型的换货工具调用、确认前无订单变更、确认幂等和超期订单拒绝。结果写入 `data/live-verification.json`。这是短流程联调；完整评测使用 `npm run eval -- --mode=openai`。
