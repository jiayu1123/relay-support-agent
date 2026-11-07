import { useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import savedBaseline from '../verification/live-baseline.json';

const baseline: any = savedBaseline;
const dimensionNames: Record<string, string> = {
  task: 'Task outcomes',
  tooling: 'Tool evidence',
  safety: 'Safety boundaries',
  confirmation: 'Confirmation & replay',
  runtime: 'Live-call integrity',
  cleanup: 'Fixture cleanup',
};
export function LiveEvaluations() {
  const [failuresOnly, setFailuresOnly] = useState(false),
    [category, setCategory] = useState('all'),
    [expanded, setExpanded] = useState<string | null>(null);
  const ready = baseline.status !== 'not_run';
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(baseline, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `relay-live-${baseline.id || 'baseline'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  if (!ready)
    return (
      <div className="live-baseline-empty">
        <Activity size={30} />
        <h2>No live baseline recorded yet.</h2>
        <p>
          The live runner sends real conversations through the hosted API, verifies tools and
          database outcomes, and saves a reproducible report. Paid runs are started from the CLI,
          rather than by public visitors.
        </p>
        <a
          className="secondary"
          href="https://github.com/jiayu1123/relay-support-agent/blob/main/docs/LIVE-EVALUATIONS.md"
          target="_blank"
          rel="noreferrer"
        >
          View run instructions
          <ExternalLink size={14} />
        </a>
      </div>
    );
  const categories = [...new Set<string>(baseline.results.map((r: any) => r.category))];
  const shown = baseline.results.filter(
    (r: any) => (!failuresOnly || !r.passed) && (category === 'all' || r.category === category),
  );
  const safety = baseline.breakdown.safety;
  return (
    <div className="live-evaluation">
      <div className="live-baseline-banner">
        <Activity size={21} />
        <div>
          <b>Real model. Recorded evidence.</b>
          <p>
            {baseline.total} of {baseline.planned} planned scenarios ran through the hosted chat API
            using {baseline.model}. Every case used disposable sample data. Offline regression
            scores are shown separately.
          </p>
        </div>
        <span className={`status ${baseline.status === 'completed' ? 'green' : 'amber'}`}>
          {baseline.status}
        </span>
      </div>
      <div className="stats-row four">
        <Metric
          label="Task outcomes passed"
          value={`${baseline.taskPassed}/${baseline.total}`}
          detail="Expected user-facing outcomes"
        />
        <Metric
          label="Safety checks passed"
          value={`${safety.passed}/${safety.total}`}
          detail="No unconfirmed order or stock changes"
        />
        <Metric
          label="P95 agent turn"
          value={baseline.p95Ms === null ? '—' : `${(baseline.p95Ms / 1000).toFixed(2)} s`}
          detail={`${baseline.latencySamples} observed model turns`}
        />
        <Metric
          label="Observed model tokens"
          value={(baseline.usage.inputTokens + baseline.usage.outputTokens).toLocaleString()}
          detail={
            baseline.usage.complete
              ? 'Input + output; no price estimate'
              : 'Partial usage: some requests failed'
          }
        />
      </div>
      <div className="live-run-summary">
        <div>
          <b>
            {baseline.passed}/{baseline.total} scenarios passed all contracts
          </b>
          <span>
            Recorded {new Date(baseline.createdAt).toLocaleString()} · {baseline.repeats} run
            {baseline.repeats === 1 ? '' : 's'} per scenario
          </span>
        </div>
        <button className="secondary" onClick={download}>
          <Download size={15} />
          Export live report
        </button>
      </div>
      <div className="live-dimension-grid">
        {Object.entries(baseline.breakdown).map(([key, v]: [string, any]) => (
          <div key={key}>
            <span>{dimensionNames[key]}</span>
            <b>
              {v.passed}
              <small> / {v.total}</small>
            </b>
            <div>
              <i style={{ width: `${v.total ? (v.passed / v.total) * 100 : 0}%` }} />
            </div>
          </div>
        ))}
      </div>
      {(baseline.failureBuckets.length > 0 || baseline.abortReason || !baseline.revisionStable) && (
        <div className="live-failure-summary">
          <AlertCircle size={19} />
          <div>
            <b>Failures stay in the report.</b>
            <p>
              {baseline.failureBuckets
                .map(
                  (b: any) =>
                    `${dimensionNames[b.dimension]}: ${b.scenarios} scenario${b.scenarios === 1 ? '' : 's'}`,
                )
                .join(' · ')}
            </p>
            {baseline.abortReason && <p>{baseline.abortReason}</p>}
            {!baseline.revisionStable && (
              <p>
                The model or source revision changed during the run, so this baseline is
                invalidated.
              </p>
            )}
          </div>
        </div>
      )}
      <div className="table-card">
        <div className="table-toolbar">
          <div>
            <h3>Live scenario results</h3>
            <small>
              {shown.length} shown · {baseline.suiteVersion} · deterministic contract graders
            </small>
          </div>
          <div className="live-filters">
            <label>
              <input
                type="checkbox"
                checked={failuresOnly}
                onChange={(e) => setFailuresOnly(e.target.checked)}
              />
              Failures only
            </label>
            <select
              aria-label="Filter live scenarios by category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="eval-results">
          {shown.map((r: any) => {
            const key = `${r.id}-${r.repetition}`;
            return (
              <div className="eval-result" key={key}>
                <button
                  onClick={() => setExpanded(expanded === key ? null : key)}
                  aria-expanded={expanded === key}
                >
                  {r.passed ? (
                    <CheckCircle2 size={18} className="green-text" />
                  ) : (
                    <AlertCircle size={18} className="red-text" />
                  )}
                  <b>{r.name}</b>
                  <span className="eval-category">{r.category}</span>
                  <small>
                    {(r.turns.reduce((s: number, t: any) => s + t.latencyMs, 0) / 1000).toFixed(2)}{' '}
                    s
                  </small>
                  <ChevronDown size={15} />
                </button>
                {expanded === key && (
                  <div className="live-case-detail">
                    {r.error && <p className="red-text">{r.error}</p>}
                    <div className="live-check-list">
                      {r.checks.map((c: any, i: number) => (
                        <div key={i} className={c.passed ? 'green-text' : 'red-text'}>
                          <span>{c.passed ? '✓' : '×'}</span>
                          <div>
                            <b>{c.name}</b>
                            <small>{dimensionNames[c.dimension]}</small>
                            {c.expected !== undefined && (
                              <pre>
                                Expected: {JSON.stringify(c.expected)}
                                {'\n'}Observed: {JSON.stringify(c.observed)}
                              </pre>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    {r.turns.map((t: any, i: number) => (
                      <section className="live-turn" key={i}>
                        <div className="live-turn-title">
                          TURN {i + 1}
                          <span>
                            {t.latencyMs} ms · {t.usage.inputTokens} input / {t.usage.outputTokens}{' '}
                            output tokens
                          </span>
                        </div>
                        <p>
                          <b>Customer</b>
                          {t.prompt}
                        </p>
                        <p>
                          <b>Relay</b>
                          {t.text}
                        </p>
                        <div className="live-tool-records">
                          {t.traces.map((trace: any, j: number) => (
                            <details key={j}>
                              <summary>
                                <code>{trace.tool}</code>
                                <span>
                                  {trace.durationMs} ms · {trace.status}
                                </span>
                              </summary>
                              <pre>
                                {JSON.stringify(
                                  { input: trace.input, output: trace.output },
                                  null,
                                  2,
                                )}
                              </pre>
                            </details>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {!shown.length && (
            <div className="empty-state">
              <CheckCircle2 size={25} />
              <h3>No scenarios match this filter.</h3>
            </div>
          )}
        </div>
      </div>
      <div className="live-method-note">
        <ShieldCheck size={20} />
        <div>
          <b>What this baseline proves—and its limits</b>
          <p>
            Grading checks proposals, policy evidence, saved tickets, order and stock state,
            ownership boundaries, and confirmation replay. It does not judge every nuance of
            language quality. This is a small authored suite with {baseline.repeats} run
            {baseline.repeats === 1 ? '' : 's'} per case, not a production success-rate estimate.
          </p>
          <p>
            Source: <code>{baseline.sourceRevision?.slice(0, 12) || 'not reported'}</code> · Suite
            hash: <code>{baseline.suiteHash.slice(0, 12)}</code> · P50 turn:{' '}
            {baseline.p50Ms === null ? '—' : `${(baseline.p50Ms / 1000).toFixed(2)} s`} · Wall time:{' '}
            {(baseline.durationMs / 1000).toFixed(1)} s
          </p>
          <a
            href="https://github.com/jiayu1123/relay-support-agent/blob/main/docs/LIVE-EVALUATIONS.md"
            target="_blank"
            rel="noreferrer"
          >
            Methodology & rerun instructions
            <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </div>
  );
}
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b>{value}</b>
      <small>{detail}</small>
    </div>
  );
}
