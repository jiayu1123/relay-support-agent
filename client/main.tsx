import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUpRight,
  ArrowUp,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Plus,
  MessageSquare,
  Package,
  BookOpen,
  FlaskConical,
  Workflow,
  ShieldCheck,
  RefreshCw,
  Search,
  Headphones,
  ShoppingBag,
  Speaker,
  Plug,
  Activity,
  X,
  Download,
  Terminal,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Layers,
  Bot,
  LayoutDashboard,
} from 'lucide-react';
import { api } from './api';
import './style.css';
import './studio.css';
import { Overview } from './Overview';
import { LiveEvaluations } from './LiveEvaluations';
import { ConversationStateCard } from './ConversationStateCard';
import type { ConversationState } from '../server/conversation-state';

type Message = { id: string; role: string; content: string; metadata: any; created_at: string };
type Page = 'overview' | 'workspace' | 'orders' | 'knowledge' | 'evaluations' | 'architecture';
const cash = (c: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);
const human = (s: string) => s.replaceAll('_', ' ');
const icons: Record<string, React.ElementType> = {
  'STUDIO-01': Headphones,
  'TOTE-02': ShoppingBag,
  'SPEAKER-03': Speaker,
  'DOCK-04': Plug,
};
const samples = [
  {
    tag: 'EXCHANGE',
    title: 'A replacement, without the back-and-forth.',
    text: 'My RL-1042 headphones have no sound on the left side. Can I get a replacement?',
    icon: RefreshCw,
  },
  {
    tag: 'RETURN',
    title: 'Make a return feel effortless.',
    text: 'I would like to return my canvas tote, order RL-1043, for a refund.',
    icon: Package,
  },
  {
    tag: 'EXCEPTION',
    title: 'Know when a person should take over.',
    text: 'My RL-1048 charging dock is broken. Can you exchange it?',
    icon: ShieldCheck,
  },
];

function App() {
  const [data, setData] = useState<any>(null),
    [page, setPage] = useState<Page>('overview'),
    [conversation, setConversation] = useState<string | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [conversationState, setConversationState] = useState<ConversationState | null>(null),
    [input, setInput] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [tab, setTab] = useState('context'),
    [search, setSearch] = useState(''),
    [report, setReport] = useState<any>(null),
    [evaluating, setEvaluating] = useState(false),
    [evaluationMode, setEvaluationMode] = useState<'live' | 'demo'>('live'),
    [expanded, setExpanded] = useState<string | null>(null),
    [localProposals, setLocalProposals] = useState<Record<string, string>>({});
  const chatScroll = useRef<HTMLDivElement>(null);
  async function refresh() {
    const d = await api('/bootstrap');
    setData(d);
    if (d.latestEvaluation) setReport(d.latestEvaluation);
    return d;
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const container = chatScroll.current;
    if (page !== 'workspace' || !container) return;
    container.scrollTo({
      top: messages.length || busy ? container.scrollHeight : 0,
      behavior: messages.length ? 'smooth' : 'auto',
    });
  }, [messages, busy, page]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [page]);
  async function open(id: string) {
    if (busy) return;
    setError('');
    try {
      const d = await api(`/conversations/${id}`);
      setConversation(id);
      setMessages(d.messages);
      setConversationState(d.state);
      setPage('workspace');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function fresh() {
    if (busy) return;
    setConversation(null);
    setConversationState(null);
    setMessages([]);
    setInput('');
    setError('');
    setPage('workspace');
  }
  async function send(text = input) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setInput('');
    setError('');
    setPage('workspace');
    let optimistic = '';
    let activeId = conversation;
    try {
      let id = conversation;
      if (!id) {
        const c = await api('/conversations', { title: text.slice(0, 60) });
        id = c.id;
        setConversation(id);
      }
      activeId = id;
      optimistic = `temp-${Date.now()}`;
      setMessages((m) => [
        ...m,
        {
          id: optimistic,
          role: 'user',
          content: text,
          metadata: {},
          created_at: new Date().toISOString(),
        },
      ]);
      const r = await api(`/conversations/${id}/messages`, { content: text });
      setMessages((m) => [...m.filter((x) => x.id !== optimistic), r.user, r.assistant]);
      const persisted = await api(`/conversations/${id}`);
      setMessages(persisted.messages);
      setConversationState(persisted.state);
      await refresh();
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== optimistic));
      setInput(text);
      setError((e as Error).message);
      if (activeId) {
        const persisted = await api(`/conversations/${activeId}`).catch(() => null);
        if (persisted) {
          setMessages(persisted.messages);
          setConversationState(persisted.state);
        }
      }
    } finally {
      setBusy(false);
    }
  }
  async function confirm(id: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api(`/proposals/${id}/confirm`, { confirmed: true });
      setLocalProposals((p) => ({ ...p, [id]: 'confirmed' }));
      if (conversation) {
        const d = await api(`/conversations/${conversation}`);
        setMessages(d.messages);
        setConversationState(d.state);
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api(`/proposals/${id}/cancel`, {});
      setLocalProposals((p) => ({ ...p, [id]: 'cancelled' }));
      if (conversation) {
        const persisted = await api(`/conversations/${conversation}`);
        setMessages(persisted.messages);
        setConversationState(persisted.state);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function runEval() {
    setEvaluating(true);
    setError('');
    try {
      const r = await api('/evaluations', {});
      setReport(r);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEvaluating(false);
    }
  }
  function exportReport() {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `relay-evaluation-${report.mode}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const traces = messages.flatMap((m) =>
    (m.metadata?.traces || []).map((t: any) => ({ ...t, messageId: m.id })),
  );
  const lastAgent = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant' && m.metadata?.model);
  const proposalIds = messages
    .filter((m) => m.metadata?.proposal)
    .map((m) => m.metadata.proposal.id);
  if (!data)
    return (
      <div className="loading">
        <div className="brand-mark">r</div>
        <p>{error || 'Opening your support workspace…'}</p>
        {error && <button onClick={() => location.reload()}>Retry</button>}
      </div>
    );
  const nav = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'workspace', label: 'Playground', icon: MessageSquare },
    { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
    { id: 'orders', label: 'Orders', icon: Package },
    { id: 'evaluations', label: 'Insights', icon: FlaskConical },
    { id: 'architecture', label: 'Workflows', icon: Workflow },
  ];
  return (
    <div className="app">
      <header className="studio-header">
        <a
          href="#"
          className="studio-brand"
          onClick={(e) => {
            e.preventDefault();
            setPage('overview');
          }}
        >
          <span className="studio-brand-icon">
            <Bot size={24} />
          </span>
          <span>
            Relay <b>Agent Studio</b>
          </span>
        </a>
        <nav className="studio-nav" aria-label="Main navigation">
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? 'active' : ''}
              aria-current={page === n.id ? 'page' : undefined}
              onClick={() => {
                setPage(n.id as Page);
                setSearch('');
              }}
            >
              <n.icon size={16} />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="studio-header-right">
          <span className="studio-environment" title={data.model}>
            <i />
            {data.mode === 'openai' ? 'Live LLM' : 'Sandbox'}
          </span>
          <span className="studio-avatar" title="Jiayu's workspace">
            JZ
          </span>
        </div>
      </header>
      <main>
        {error && (
          <div role="alert" className="error-banner">
            <AlertCircle size={17} />
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}
        {page === 'overview' ? (
          <Overview
            data={data}
            report={report}
            busy={busy}
            onOpen={open}
            onTest={fresh}
            onExample={(text) => {
              fresh();
              setInput(text);
            }}
            onNavigate={(next) => {
              setPage(next);
              setSearch('');
            }}
            onRefresh={() => {
              refresh().catch((e) => setError(e.message));
            }}
          />
        ) : page === 'workspace' ? (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">
                  <span /> CUSTOMER SUPPORT AGENT
                </div>
                <h1>Agent playground</h1>
                <p>Test a customer request and inspect every step from answer to action.</p>
              </div>
              <button className="secondary" onClick={fresh} disabled={busy}>
                <Plus size={16} />
                New conversation
              </button>
            </section>
            <div className="history-toolbar">
              <label>
                <MessageSquare size={15} />
                <span>Conversation</span>
                <select
                  aria-label="Select a saved conversation"
                  value={conversation || ''}
                  disabled={busy}
                  onChange={(e) => (e.target.value ? open(e.target.value) : fresh())}
                >
                  <option value="">New conversation</option>
                  {data.conversations.map((c: any) => (
                    <option value={c.id} key={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
              <span className="history-note">
                <ShieldCheck size={14} /> Your sample account is isolated
              </span>
            </div>
            <div className="playground">
              <section className="chat-panel">
                <div className="panel-header">
                  <div className="agent-symbol">
                    <Workflow size={20} />
                  </div>
                  <div>
                    <b>Relay Support</b>
                    <span>
                      <span className="small-dot" />
                      Ready to help · Northstar Store
                    </span>
                  </div>
                  <span className="agent-pill">AGENT</span>
                </div>
                <div className="chat-scroll" ref={chatScroll} aria-live="polite">
                  {!messages.length ? (
                    <div className="empty-chat">
                      <div className="welcome-icon">
                        <MessageSquare size={26} />
                        <span>✦</span>
                      </div>
                      <h2>Good support starts here.</h2>
                      <p>
                        Try a customer request. Watch Relay find the facts,
                        <br />
                        prepare a solution, and ask before taking action.
                      </p>
                      <div className="starter-cards">
                        {samples.map((s) => (
                          <button key={s.tag} disabled={busy} onClick={() => send(s.text)}>
                            <div>
                              <s.icon size={17} />
                              <span>{s.tag}</span>
                              <ArrowUpRight size={16} />
                            </div>
                            <b>{s.title}</b>
                            <p>{s.text}</p>
                          </button>
                        ))}
                      </div>
                      <div className="welcome-note">
                        <ShieldCheck size={14} /> Every order change needs your confirmation.
                      </div>
                    </div>
                  ) : (
                    <div className="messages">
                      {messages.map((m) => (
                        <div key={m.id} className={`message ${m.role}`}>
                          <div
                            className={`message-avatar ${m.metadata?.confirmation ? 'success' : ''}`}
                          >
                            {m.role === 'user' ? (
                              'AM'
                            ) : m.metadata?.confirmation ? (
                              <Check size={16} />
                            ) : (
                              <Workflow size={17} />
                            )}
                          </div>
                          <div className="message-body">
                            <div className="message-title">
                              <b>{m.role === 'user' ? 'Alex Morgan' : 'Relay'}</b>
                              {m.role !== 'user' && (
                                <span>
                                  {m.metadata?.confirmation ? 'ACTION RECORDED' : 'SUPPORT AGENT'}
                                </span>
                              )}
                              <time>
                                {new Date(m.created_at).toLocaleTimeString('en-US', {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </time>
                            </div>
                            <div className="message-text">
                              {m.content
                                .split(/(\[(?:RET-01|EXC-02|SHP-03|ESC-04)\])/g)
                                .map((s, i) =>
                                  s.startsWith('[') ? (
                                    <button
                                      className="citation"
                                      key={i}
                                      onClick={() => {
                                        setPage('knowledge');
                                        setSearch(s.slice(1, -1));
                                      }}
                                    >
                                      {s.slice(1, -1)} <ArrowUpRight size={10} />
                                    </button>
                                  ) : (
                                    <React.Fragment key={i}>{s}</React.Fragment>
                                  ),
                                )}
                            </div>
                            {m.metadata?.traces?.length > 0 && (
                              <button className="trace-link" onClick={() => setTab('trace')}>
                                <Workflow size={12} />
                                {m.metadata.traces.length} tool calls
                                <ChevronRight size={12} />
                              </button>
                            )}
                            {m.metadata?.proposal &&
                              (() => {
                                const p = m.metadata.proposal;
                                const resolution = data.resolutions.find(
                                  (r: any) => r.proposal_id === p.id,
                                );
                                const state = resolution
                                  ? 'confirmed'
                                  : localProposals[p.id] ||
                                    (p.status && p.status !== 'pending' ? p.status : null) ||
                                    (proposalIds.at(-1) !== p.id
                                      ? 'superseded'
                                      : new Date(p.expires_at).getTime() < Date.now()
                                        ? 'expired'
                                        : 'pending');
                                return (
                                  <div className="proposal">
                                    <div className="proposal-top">
                                      <span className="proposal-icon">
                                        <RefreshCw size={17} />
                                      </span>
                                      <div>
                                        <b>
                                          {p.action === 'exchange'
                                            ? 'Replacement proposal'
                                            : 'Return & refund proposal'}
                                        </b>
                                        <small>
                                          {p.order_id} · {p.product}
                                        </small>
                                      </div>
                                      <span
                                        className={`status ${state === 'confirmed' ? 'green' : 'amber'}`}
                                      >
                                        {human(state)}
                                      </span>
                                    </div>
                                    <div className="proposal-details">
                                      <span>
                                        {p.action === 'exchange'
                                          ? 'Replacement cost'
                                          : 'Refund request'}
                                      </span>
                                      <b>{cash(p.action === 'exchange' ? 0 : p.amount)}</b>
                                    </div>
                                    <p>
                                      {p.action === 'exchange'
                                        ? 'A replacement will be requested from available stock. Delivery dates are estimates.'
                                        : 'Refund is processed after return and inspection. This does not issue a payment.'}
                                    </p>
                                    {state === 'pending' && (
                                      <div className="proposal-actions">
                                        <button
                                          className="primary"
                                          disabled={busy}
                                          onClick={() => confirm(p.id)}
                                        >
                                          <Check size={15} />
                                          Confirm{' '}
                                          {p.action === 'exchange' ? 'exchange' : 'return request'}
                                        </button>
                                        <button
                                          className="text-button"
                                          disabled={busy}
                                          onClick={() => cancel(p.id)}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    )}
                                    {state === 'confirmed' && (
                                      <div className="confirmed-note">
                                        <CheckCheck size={15} />
                                        Request saved · View in Orders & resolutions
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {busy && (
                    <div className="thinking">
                      <span />
                      <span />
                      <span />
                      Checking the details…
                    </div>
                  )}
                </div>
                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    send();
                  }}
                >
                  <div className="input-wrap">
                    <textarea
                      aria-label="Message Relay"
                      value={input}
                      disabled={busy}
                      maxLength={3000}
                      placeholder="Ask about an order, a return, or a replacement…"
                      rows={2}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                    />
                    <button
                      type="submit"
                      aria-label="Send message"
                      disabled={busy || !input.trim()}
                    >
                      {busy ? <Loader2 size={19} className="spin" /> : <ArrowUp size={20} />}
                    </button>
                  </div>
                  <div className="composer-note">
                    <span>
                      <ShieldCheck size={12} /> Sample orders. No real payments.
                    </span>
                    <span>↵ to send · shift ↵ for a new line</span>
                  </div>
                </form>
              </section>
              <aside className="context-panel">
                <div className="context-tabs">
                  <button
                    onClick={() => setTab('context')}
                    className={tab === 'context' ? 'active' : ''}
                  >
                    Customer context
                  </button>
                  <button
                    onClick={() => setTab('trace')}
                    className={tab === 'trace' ? 'active' : ''}
                  >
                    Execution trace{traces.length > 0 && <span>{traces.length}</span>}
                  </button>
                </div>
                {tab === 'context' ? (
                  <>
                    <div className="customer-card">
                      <div className="customer-avatar">AM</div>
                      <h3>Alex Morgan</h3>
                      <p>alex@example.test</p>
                      <span className="customer-tag">
                        <ShieldCheck size={12} />
                        Isolated demo account
                      </span>
                    </div>
                    <div className="context-section-title">
                      <span>RECENT ORDERS</span>
                      <button onClick={() => setPage('orders')}>
                        View all
                        <ArrowUpRight size={13} />
                      </button>
                    </div>
                    <div className="context-orders">
                      {data.orders
                        .slice()
                        .sort((a: any, b: any) =>
                          a.id === 'RL-1042' ? -1 : b.id === 'RL-1042' ? 1 : 0,
                        )
                        .slice(0, 4)
                        .map((o: any) => {
                          const Icon = icons[o.sku] || ShoppingBag;
                          return (
                            <button
                              key={o.id}
                              onClick={() => {
                                setInput(`I need help with order ${o.id}.`);
                              }}
                            >
                              <span className="product-icon">
                                <Icon size={23} />
                              </span>
                              <div>
                                <small>
                                  {o.id}
                                  <span>{cash(o.amount)}</span>
                                </small>
                                <b>{o.product}</b>
                                <span
                                  className={`order-state ${o.status === 'delivered' ? 'delivered' : ''}`}
                                >
                                  <span />
                                  {human(o.status)}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                    </div>
                    <div className="trust-card">
                      <ShieldCheck size={19} />
                      <b>Built to earn trust.</b>
                      <p>
                        Policies are checked server-side. Proposals expire in 15 minutes. Only you
                        can approve an order change.
                      </p>
                      <button onClick={() => setPage('architecture')}>
                        See how it works
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="trace-panel">
                    <ConversationStateCard state={conversationState} />
                    <div className="trace-intro">
                      <Activity size={20} />
                      <h3>Every step, visible.</h3>
                      <p>
                        Tool inputs, results, and timings from this conversation. These are
                        execution records, not hidden model reasoning.
                      </p>
                    </div>
                    {!traces.length ? (
                      <div className="no-traces">
                        <Terminal size={25} />
                        <p>Start a conversation to inspect tool calls.</p>
                      </div>
                    ) : (
                      traces.map((t: any, i: number) => (
                        <div className="trace-item" key={t.id}>
                          <button onClick={() => setExpanded(expanded === t.id ? null : t.id)}>
                            <span className={`trace-dot ${t.status}`}>{i + 1}</span>
                            <div>
                              <b>{t.tool}</b>
                              <small>
                                {t.durationMs} ms · {t.status === 'ok' ? 'Executed' : 'Tool error'}
                              </small>
                            </div>
                            <ChevronDown size={14} />
                          </button>
                          {expanded === t.id && (
                            <div className="trace-json">
                              <b>INPUT</b>
                              <pre>{JSON.stringify(t.input, null, 2)}</pre>
                              <b>OUTPUT</b>
                              <pre>{JSON.stringify(t.output, null, 2)}</pre>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
                <div className="context-footer">
                  <span className="small-dot" />
                  <span>{data.mode === 'demo' ? 'Deterministic demo' : data.model}</span>
                  {lastAgent && <small>{lastAgent.metadata.latencyMs} ms</small>}
                </div>
              </aside>
            </div>
            <div className="workspace-footer">
              <span>
                <Layers size={13} />
                Policy-grounded answers
              </span>
              <span>
                <ShieldCheck size={13} />
                Human-confirmed actions
              </span>
              <span>
                <Activity size={13} />
                Inspectable tool calls
              </span>
              <span className="footer-brand">Made to resolve.</span>
            </div>
          </>
        ) : page === 'orders' ? (
          <section className="content-page">
            <div className="section-heading">
              <div className="eyebrow">STORE OPERATIONS</div>
              <h1>The record behind the resolution.</h1>
              <p>
                Orders, stock, and requests are persisted in{' '}
                {data.database === 'sqlite' ? 'SQLite' : 'PostgreSQL'}. This account is isolated
                from other visitors.
              </p>
            </div>
            <div className="stats-row">
              <Stat label="Sample orders" value={data.orders.length} />
              <Stat label="Resolution requests" value={data.resolutions.length} />
              <Stat label="Specialist tickets" value={data.tickets.length} />
            </div>
            <div className="table-card">
              <div className="table-toolbar">
                <h3>Customer orders</h3>
                <label className="search-box">
                  <Search size={15} />
                  <input
                    aria-label="Search orders"
                    placeholder="Search orders…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Product</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Replacement stock</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.orders
                      .filter((o: any) =>
                        `${o.id} ${o.product}`.toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((o: any) => (
                        <tr key={o.id}>
                          <td className="mono">{o.id}</td>
                          <td>
                            {o.product}
                            <small>{o.category}</small>
                          </td>
                          <td>{cash(o.amount)}</td>
                          <td>
                            <span
                              className={`status ${o.status === 'delivered' ? 'green' : 'amber'}`}
                            >
                              {human(o.status)}
                            </span>
                          </td>
                          <td>
                            {o.stock > 0 ? (
                              <span>{o.stock} available</span>
                            ) : (
                              <span className="low-stock">Out of stock</span>
                            )}
                          </td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => {
                                setPage('workspace');
                                setInput(`I need help with ${o.id}.`);
                              }}
                            >
                              Get help
                              <ArrowUpRight size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
            <h2 className="subheading">Resolution requests</h2>
            {data.resolutions.length ? (
              <div className="record-grid">
                {data.resolutions.map((r: any) => (
                  <div className="record-card" key={r.id}>
                    <CheckCircle2 size={22} />
                    <span className="status green">Recorded</span>
                    <h3>
                      {r.action === 'exchange' ? 'Exchange request' : 'Return/refund request'}
                    </h3>
                    <p>
                      {r.order_id} · {r.id}
                    </p>
                    <small>
                      {r.action === 'refund'
                        ? `${cash(r.amount)} · No payment issued`
                        : 'No-cost replacement · No carrier integration'}
                    </small>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                icon={Package}
                title="No resolution requests yet"
                text="Confirm an exchange or return proposal in the playground to create one."
              />
            )}
            <h2 className="subheading">Specialist queue</h2>
            {data.tickets.length ? (
              <div className="record-grid">
                {data.tickets.map((t: any) => (
                  <div className="record-card" key={t.id}>
                    <MessageSquare size={22} />
                    <h3>{t.id}</h3>
                    <p className="preserve">{t.summary}</p>
                    <small>Internal demo queue · No external notification</small>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                icon={MessageSquare}
                title="Nothing in the queue"
                text="Ask Relay for a human specialist to create an internal handoff."
              />
            )}
          </section>
        ) : page === 'knowledge' ? (
          <section className="content-page">
            <div className="section-heading">
              <div className="eyebrow">KNOWLEDGE BASE</div>
              <h1>Clear policies. Grounded answers.</h1>
              <p>
                A small, versioned policy corpus powers lexical retrieval and citation-backed
                responses.
              </p>
            </div>
            <label className="search-box large">
              <Search size={18} />
              <input
                aria-label="Search policies"
                placeholder="Search by policy, keyword, or reference…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="policy-grid">
              {data.policies
                .filter((p: any) => JSON.stringify(p).toLowerCase().includes(search.toLowerCase()))
                .map((p: any) => (
                  <article className="policy-card" key={p.id}>
                    <div>
                      <span className="policy-id">{p.id}</span>
                      <span className="status green">Active · v1</span>
                    </div>
                    <BookOpen size={25} />
                    <h2>{p.title}</h2>
                    <h4>{p.section}</h4>
                    <p>{p.body}</p>
                    <div className="policy-tags">
                      {p.tags.slice(0, 3).map((t: string) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                  </article>
                ))}
            </div>
            <div className="info-box">
              <BookOpen size={20} />
              <div>
                <b>Retrieval that you can inspect.</b>
                <p>
                  Policy documents are ranked with TF-IDF cosine similarity and bilingual keyword
                  matches. The model receives relevant excerpts; backend eligibility checks
                  independently enforce the 30-day window and item restrictions. This version does
                  not use embeddings or a vector database.
                </p>
              </div>
            </div>
          </section>
        ) : page === 'evaluations' ? (
          <section className="content-page">
            <div className="section-heading heading-actions">
              <div>
                <div className="eyebrow">EVALUATION LAB</div>
                <h1>Good answers need evidence.</h1>
                <p>
                  Run isolated scenarios against the agent, then inspect behavior and database
                  outcomes.
                </p>
              </div>
              {evaluationMode === 'demo' && (
                <button className="primary" disabled={evaluating} onClick={runEval}>
                  {evaluating ? <Loader2 size={16} className="spin" /> : <FlaskConical size={16} />}{' '}
                  {evaluating ? 'Running scenarios…' : 'Run demo evaluation'}
                </button>
              )}
            </div>
            <div className="evaluation-tabs" role="tablist" aria-label="Evaluation mode">
              <button
                role="tab"
                aria-selected={evaluationMode === 'live'}
                className={evaluationMode === 'live' ? 'active' : ''}
                onClick={() => setEvaluationMode('live')}
              >
                <Activity size={16} />
                Live model baseline
              </button>
              <button
                role="tab"
                aria-selected={evaluationMode === 'demo'}
                className={evaluationMode === 'demo' ? 'active' : ''}
                onClick={() => setEvaluationMode('demo')}
              >
                <FlaskConical size={16} />
                Offline regression
              </button>
            </div>
            {evaluationMode === 'live' ? (
              <LiveEvaluations />
            ) : (
              <>
                <div className="info-box eval-info">
                  <ShieldCheck size={20} />
                  <div>
                    <b>
                      {report?.mode === 'openai'
                        ? 'Live-model evaluation'
                        : 'Offline regression suite'}
                    </b>
                    <p>
                      20 authored scenarios cover workflows, policy boundaries, retrieval,
                      authorization, multilingual requests, and confirmation. Demo results measure
                      the deterministic engine, not LLM quality. Select Live model baseline for the
                      recorded real-model results and rerun instructions.
                    </p>
                  </div>
                </div>
                {report ? (
                  <>
                    <div className="stats-row four">
                      <Stat
                        label="Scenarios passed"
                        value={`${report.passed}/${report.total}`}
                        sub={`${Math.round((report.passed / report.total) * 100)}% of this authored suite`}
                      />
                      <Stat
                        label="Assertions checked"
                        value={report.checks}
                        sub="Tool calls + database state"
                      />
                      <Stat
                        label="P95 turn latency"
                        value={`${report.p95Ms} ms`}
                        sub={`${report.mode} · local runtime`}
                      />
                      <Stat
                        label="Model tokens"
                        value={report.usage.inputTokens + report.usage.outputTokens}
                        sub={
                          report.mode === 'demo'
                            ? 'No model calls or API cost'
                            : 'Input + output tokens'
                        }
                      />
                    </div>
                    <div className="table-card">
                      <div className="table-toolbar">
                        <div>
                          <h3>Latest run</h3>
                          <small>
                            {new Date(report.createdAt).toLocaleString()} · {report.model}
                          </small>
                        </div>
                        <button className="secondary" onClick={exportReport}>
                          <Download size={15} />
                          Export JSON
                        </button>
                      </div>
                      <div className="eval-results">
                        {report.results.map((r: any, i: number) => (
                          <div className="eval-result" key={i}>
                            <button
                              onClick={() =>
                                setExpanded(expanded === `eval-${i}` ? null : `eval-${i}`)
                              }
                            >
                              {r.passed ? (
                                <CheckCircle2 size={18} className="green-text" />
                              ) : (
                                <AlertCircle size={18} className="red-text" />
                              )}
                              <b>{r.name}</b>
                              <span className="eval-category">{r.category}</span>
                              <small>{r.latencyMs} ms</small>
                              <ChevronDown size={15} />
                            </button>
                            {expanded === `eval-${i}` && (
                              <div className="eval-detail">
                                <p>
                                  <b>Customer:</b> {r.prompt}
                                </p>
                                <p>{r.text || r.error}</p>
                                {r.checks.map((c: any, j: number) => (
                                  <div key={j} className={c.passed ? 'green-text' : 'red-text'}>
                                    {c.passed ? '✓' : '×'} {c.name}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <Empty
                    icon={FlaskConical}
                    title="Your first baseline starts here."
                    text="Run the suite to measure real results. No scores are pre-filled."
                  />
                )}{' '}
              </>
            )}
          </section>
        ) : (
          <section className="content-page architecture">
            <div className="section-heading">
              <div className="eyebrow">UNDER THE HOOD</div>
              <h1>Useful autonomy. Explicit boundaries.</h1>
              <p>
                An end-to-end support agent built around observable tools and server-enforced
                business rules.
              </p>
            </div>
            <div className="architecture-flow">
              {[
                { icon: MessageSquare, title: 'Customer request', detail: 'React + TypeScript' },
                {
                  icon: Workflow,
                  title: 'Agent orchestrator',
                  detail: 'OpenAI tool calling / demo',
                },
                { icon: BookOpen, title: 'Grounded tools', detail: 'Policy retrieval + Zod' },
                {
                  icon: ShieldCheck,
                  title: 'Customer confirmation',
                  detail: 'Expiring server proposal',
                },
                {
                  icon: Package,
                  title: 'Atomic resolution',
                  detail: 'SQL transaction + stock check',
                },
              ].map((n, i) => (
                <React.Fragment key={n.title}>
                  <div>
                    <n.icon size={24} />
                    <b>{n.title}</b>
                    <span>{n.detail}</span>
                  </div>
                  {i < 4 && <ArrowRight size={19} />}
                </React.Fragment>
              ))}
            </div>
            <div className="architecture-grid">
              <article>
                <ShieldCheck size={23} />
                <h3>Actions require a person.</h3>
                <p>
                  The model can propose an action, but cannot execute it. A separate confirmation
                  endpoint rechecks ownership, policy, expiration, and stock inside a database
                  transaction. Retrying the same confirmation returns the same resolution.
                </p>
              </article>
              <article>
                <Activity size={23} />
                <h3>Observable by design.</h3>
                <p>
                  Every tool call records validated inputs, results, status, and duration.
                  Conversations and traces persist across refreshes. Live mode reports actual model
                  token usage; demo mode reports zero.
                </p>
              </article>
              <article>
                <Layers size={23} />
                <h3>Two database paths.</h3>
                <p>
                  SQLite makes local setup immediate with Node 24. Set DATABASE_URL for PostgreSQL.
                  Both adapters use the same schema and transaction contract. Docker Compose
                  configures the PostgreSQL path.
                </p>
              </article>
              <article>
                <FlaskConical size={23} />
                <h3>Measured, not assumed.</h3>
                <p>
                  20 repeatable agent scenarios check decisions, tool use, and persisted outcomes.
                  Additional automated tests exercise concurrency, ownership, expiration, rollback,
                  and an OpenAI-compatible mocked tool loop.
                </p>
              </article>
            </div>
            <div className="connection-card">
              <div>
                <span className="status amber">
                  {data.mode === 'demo' ? 'Demo engine active' : 'Live model active'}
                </span>
                <h2>Ready for a real model.</h2>
                <p>
                  Configure server-side credentials, set AGENT_MODE=openai, and restart. The same
                  tools and backend constraints power both modes. No API keys enter the browser.
                </p>
              </div>
              <pre>
                AGENT_MODE=openai{'\n'}OPENAI_MODEL=gpt-4.1-mini{'\n'}
                OPENAI_API_KEY=your_server_side_key
              </pre>
            </div>
            <div className="info-box">
              <AlertCircle size={20} />
              <div>
                <b>Portfolio scope</b>
                <p>
                  Northstar is a fictional store. This project records simulated refund and
                  replacement requests; it does not process payments, buy shipping labels, or notify
                  a real support team. Demo sessions are isolated but are not verified customer
                  identities. Read the deployment guide before connecting real customer data.
                </p>
              </div>
            </div>
          </section>
        )}
      </main>
      {page === 'overview' && (
        <button className="floating-test-agent" onClick={fresh} disabled={busy}>
          <MessageSquare size={20} />
          Test agent
        </button>
      )}
    </div>
  );
}
function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
}: {
  icon: React.ElementType;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      <Icon size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
