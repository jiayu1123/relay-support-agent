# Resume and interview notes

Use the actual month/year of your work and your real repository URL. Add a Live Demo URL only after deployment. Do not imply real store usage or payment processing.

## English project entry

**Relay | Customer Support Agent** — [GitHub](https://github.com/jiayu1123/relay-support-agent) · [Live demo](https://relay-support-agent-9jls.onrender.com)  
_TypeScript, React, Node.js, Express, OpenAI API, PostgreSQL, SQLite, Docker, Vitest_

- Developed a full-stack support agent with OpenAI tool calling, policy retrieval, and persisted structured conversation state for multilingual exchange and return/refund workflows.
- Enforced active order/intent constraints, stale-proposal invalidation, transactional inventory updates, and idempotent customer confirmation across SQLite and PostgreSQL.
- Built inspectable tool/state traces, a 20-case hosted support evaluation and a 6-case multi-turn state suite, verifying intermediate slots, policy boundaries, confirmation safety, and persisted outcomes.

The hosted adapter has been verified with actual OpenAI calls. Automated adapter unit tests use a mock; the saved hosted evaluation report contains real calls. Describe these separately. Inspect [the recorded baseline](../verification/live-baseline.json) and its failures before citing measured results. A single run of 20 authored cases is not a production success rate. Do not claim production adoption, scale, or real payment processing without evidence.

## Short Chinese explanation

Relay 是一个电商售后 Agent。模型负责理解请求、选择工具和组织回答；服务端负责订单权限、政策资格、库存和最终事务。模型只能准备方案，用户确认后系统才写入换货或退货退款申请。我还实现了工具调用轨迹，以及检查工具行为和最终数据库状态的评测。

## Questions to prepare

1. **Why is this an agent rather than a chatbot?** In live mode it chooses executable tools, observes their results, and continues a multi-step workflow. Explain the difference between that mode and the deterministic demo.
2. **Why separate proposal and confirmation?** Natural-language intent alone is insufficient authorization for a business write. Confirmation references an exact, expiring, server-owned proposal.
3. **How do you handle races?** Revalidate inside the transaction, lock order/proposal rows on PostgreSQL, conditionally decrement stock, and enforce unique resolution constraints.
4. **How do you avoid duplicate refunds?** The system records return/refund requests, not payments. Proposal replay and one-resolution-per-order constraints prevent duplicate internal requests. A real payment integration also needs provider idempotency and reconciliation.
5. **What is evaluated?** Authored task outcomes, expected tools and policy decisions, no unconfirmed changes, and persisted order states—not just whether an answer sounds plausible.
6. **What would you improve?** Verified customer auth, real sandbox integrations, broader live evaluation, stronger long-dialogue state, distributed locks/rate limits, and operational tracing.
7. **Why no multi-agent framework?** A bounded single-agent tool loop covers this workflow and makes permissions and failures easier to inspect. Add orchestration complexity only for a demonstrated need.
8. **How was AI used?** Explain honestly that AI assisted implementation. Be ready to trace a request, modify a rule, and diagnose a failed test yourself.
