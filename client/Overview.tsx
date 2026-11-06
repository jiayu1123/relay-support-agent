import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  FlaskConical,
  Globe2,
  MessageSquare,
  Package,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

type Props = {
  data: any;
  report: any;
  busy: boolean;
  onOpen: (id: string) => void;
  onTest: () => void;
  onExample: (text: string) => void;
  onNavigate: (page: 'knowledge' | 'evaluations' | 'orders' | 'architecture') => void;
  onRefresh: () => void;
};

function relativeTime(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

const guardrails = [
  ['Human confirmation', 'Approve every exchange or refund request.'],
  ['Return window', 'Eligibility checked within 30 days of delivery.'],
  ['Order ownership', 'Customers can only access their own orders.'],
  ['Inventory validation', 'Stock is rechecked before an exchange.'],
  ['Duplicate protection', 'Repeated confirmations reuse the same request.'],
];

export function Overview({
  data,
  report,
  busy,
  onOpen,
  onTest,
  onExample,
  onNavigate,
  onRefresh,
}: Props) {
  const resolutions = data.resolutions.length;
  const count = data.conversations.length;
  const percent = report ? Math.round((report.passed / report.total) * 100) : null;
  return (
    <section className="studio-overview">
      <div className="overview-heading">
        <div>
          <div className="studio-kicker">NORTHSTAR STORE / AGENT WORKSPACE</div>
          <h1>Overview</h1>
          <p>Your support agent, conversations, and safeguards. All in one place.</p>
        </div>
        <button className="secondary" onClick={onRefresh}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>
      <div className="overview-grid">
        <section className="studio-card agent-overview">
          <div className="agent-card-title">
            <span className="studio-agent-icon">
              <Bot size={23} />
            </span>
            <div>
              <h2>Relay Support</h2>
              <p>Customer service agent</p>
            </div>
            <span className="active-badge">
              <i />
              Active
            </span>
          </div>
          <div className="language-row">
            <span>
              <Globe2 size={13} />
              English
            </span>
            <span>中文</span>
            <span className="model-tag">{data.mode === 'openai' ? 'Live LLM' : 'Demo'}</span>
          </div>
          <div className="overview-metrics">
            <div className="overview-metric">
              <div className="metric-caption">
                CONFIRMED REQUESTS
                <CheckCircle2 size={16} />
              </div>
              <strong>
                {resolutions}
                <small> / {data.orders.length} orders</small>
              </strong>
              <div className="metric-track">
                <span
                  style={{
                    width: `${data.orders.length ? (resolutions / data.orders.length) * 100 : 0}%`,
                  }}
                />
              </div>
              <p>Approved exchanges and return requests</p>
            </div>
            <div className="overview-metric">
              <div className="metric-caption">
                CONVERSATIONS
                <MessageSquare size={16} />
              </div>
              <strong>{count}</strong>
              <p>Saved in your isolated demo account</p>
            </div>
            <div className="overview-metric">
              <div className="metric-caption">
                OFFLINE EVALUATION
                <FlaskConical size={16} />
              </div>
              <strong>
                {percent === null ? '—' : `${percent}%`}
                <small>
                  {report ? `${report.passed}/${report.total} scenarios` : 'No run yet'}
                </small>
              </strong>
              <p>
                {report
                  ? 'Latest authored regression suite'
                  : 'Run the suite to establish a baseline'}
              </p>
            </div>
          </div>
          <div className="agent-runtime">
            <span className="small-dot" />
            <span>{data.model}</span>
          </div>
          <button className="card-footer-action" onClick={() => onNavigate('evaluations')}>
            View evaluations
            <ArrowRight size={16} />
          </button>
        </section>

        <section className="studio-card conversations-overview">
          <div className="studio-card-heading">
            <div>
              <h2>Conversations</h2>
              <span className="count-badge">{count}</span>
            </div>
            <button
              className="icon-button"
              aria-label="Refresh conversations"
              title="Refresh conversations"
              onClick={onRefresh}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          <div className="conversation-feed">
            {count ? (
              data.conversations.slice(0, 6).map((c: any) => {
                const isReturn = /refund|return|退/i.test(c.title);
                const isExchange = /exchang|replac|broken|换|声音/i.test(c.title);
                const label = isReturn
                  ? 'RETURN REQUEST'
                  : isExchange
                    ? 'EXCHANGE REQUEST'
                    : 'SUPPORT REQUEST';
                return (
                  <button
                    key={c.id}
                    className="conversation-feed-item"
                    onClick={() => onOpen(c.id)}
                    disabled={busy}
                  >
                    <span className={`feed-icon ${isReturn ? 'blue' : ''}`}>
                      {isReturn ? <Package size={19} /> : <MessageSquare size={19} />}
                    </span>
                    <div>
                      <div className="feed-title">
                        <strong>Alex Morgan</strong>
                        <time>{relativeTime(c.created_at)}</time>
                      </div>
                      <span className="feed-label">{label}</span>
                      <p>{c.title}</p>
                      <small>
                        Handled by: <b>Relay AI</b>
                      </small>
                    </div>
                    <ChevronRight size={15} />
                  </button>
                );
              })
            ) : (
              <div className="empty-feed">
                <span className="empty-feed-icon">
                  <MessageSquare size={29} />
                </span>
                <h3>Your next conversation starts here.</h3>
                <p>
                  Try a sample request and see the agent turn a customer question into a clear next
                  step.
                </p>
                <button className="primary" disabled={busy} onClick={onTest}>
                  <Sparkles size={15} />
                  Start a conversation
                </button>
              </div>
            )}
          </div>
          {!count && (
            <div className="overview-examples">
              <span>TRY A CUSTOMER SCENARIO</span>
              <button
                onClick={() =>
                  onExample(
                    'My RL-1042 headphones have no sound on the left side. Can I get a replacement?',
                  )
                }
              >
                <RefreshCw size={17} />
                <div>
                  <b>Replace a defective item</b>
                  <small>Check policy, inventory, and confirmation.</small>
                </div>
                <ArrowRight size={15} />
              </button>
              <button
                onClick={() =>
                  onExample('I would like to return my canvas tote, order RL-1043, for a refund.')
                }
              >
                <Package size={17} />
                <div>
                  <b>Request a return</b>
                  <small>Prepare a policy-eligible refund request.</small>
                </div>
                <ArrowRight size={15} />
              </button>
            </div>
          )}
          {count > 6 && (
            <p className="feed-more-note">
              Showing the 6 most recent of {count} conversations. All conversations are available in
              the playground.
            </p>
          )}
          <button className="card-footer-action" disabled={busy} onClick={onTest}>
            Open agent playground
            <ArrowRight size={16} />
          </button>
        </section>

        <section className="studio-card guardrails-overview">
          <div className="studio-card-heading">
            <h2>Guardrails & policies</h2>
            <button className="teal-link" onClick={() => onNavigate('knowledge')}>
              View policies
            </button>
          </div>
          <div className="guardrail-list">
            {guardrails.map(([title, description]) => (
              <div className="guardrail-item" key={title}>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
                <span
                  className="enforced-switch"
                  role="img"
                  aria-label={`${title}: enforced`}
                  title="Enforced by the backend"
                >
                  <Check size={11} />
                  <i />
                </span>
              </div>
            ))}
          </div>
          <div className="enforcement-section">
            <span>ENFORCEMENT STATUS</span>
            <p>
              <ShieldCheck size={18} />
              Server-side policy checks
            </p>
            <p>
              <CheckCircle2 size={18} />
              Expiring confirmation proposals
            </p>
            <p>
              <Activity size={18} />
              Inspectable execution traces
            </p>
          </div>
          <div className="studio-tip">
            <BookOpen size={18} />
            <div>
              <b>Designed for review.</b>
              <p>
                Policies stay enforced in the backend. View a conversation’s execution trace to
                inspect what the agent actually did.
              </p>
            </div>
          </div>
          <div className="sample-scope">
            <ShieldCheck size={14} />
            <span>Sample store data · No real payments</span>
          </div>
        </section>
      </div>
      <div className="overview-bottom">
        <span>
          <Clock size={14} />
          Metrics reflect this demo account, not production traffic.
        </span>
        <button onClick={() => onNavigate('architecture')}>
          Explore the workflow
          <ArrowUpRight size={14} />
        </button>
      </div>
    </section>
  );
}
