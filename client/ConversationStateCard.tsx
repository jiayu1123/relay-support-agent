import { Database, ChevronDown } from 'lucide-react';
import type { ConversationState } from '../server/conversation-state';

const label = (value: string) => value.replaceAll('_', ' ');
const slotLabels = {
  order_id: 'Order number',
  action: 'Exchange or refund',
  defect_details: 'Defect or damage description',
};
export function ConversationStateCard({ state }: { state: ConversationState | null }) {
  return (
    <section className="conversation-state-card" aria-label="Structured conversation state">
      <div className="state-card-heading">
        <Database size={17} />
        <b>Conversation state</b>
        {state && <span>v{state.revision}</span>}
      </div>
      {!state ? (
        <p>Start a conversation to see its saved order, intent, and next step.</p>
      ) : (
        <>
          <div className="state-stage">
            <i className={state.processing ? 'processing' : ''} />
            {state.processing ? 'Reply in progress' : label(state.stage)}
          </div>
          <dl>
            <div>
              <dt>Active order</dt>
              <dd>
                {state.orderId || 'Not selected'}
                {state.orderId && (
                  <small>
                    {state.orderVerified ? 'Account lookup verified' : 'Awaiting account lookup'}
                  </small>
                )}
              </dd>
            </div>
            <div>
              <dt>Customer intent</dt>
              <dd>{state.intent ? label(state.intent) : 'Not set'}</dd>
            </div>
            <div>
              <dt>Reported issue</dt>
              <dd>{state.issue || 'Not provided'}</dd>
            </div>
            {state.orderCandidates.length > 0 && (
              <div>
                <dt>Needs a choice</dt>
                <dd>{state.orderCandidates.join(' / ')}</dd>
              </div>
            )}
            {state.lastDecision && (
              <div>
                <dt>Backend decision</dt>
                <dd>{label(state.lastDecision.code)}</dd>
              </div>
            )}
            {state.pendingProposal && (
              <div>
                <dt>Pending proposal</dt>
                <dd>
                  {label(state.pendingProposal.action)} · {state.pendingProposal.orderId}
                  <small>
                    Customer click required · expires{' '}
                    {new Date(state.pendingProposal.expiresAt).toLocaleTimeString()}
                  </small>
                </dd>
              </div>
            )}
            {state.resolutionId && (
              <div>
                <dt>Saved request</dt>
                <dd>{state.resolutionId}</dd>
              </div>
            )}
            {state.ticketId && (
              <div>
                <dt>Internal ticket</dt>
                <dd>{state.ticketId}</dd>
              </div>
            )}
          </dl>
          {state.missingSlots.length > 0 && (
            <div className="state-missing">
              <b>Still needed</b>
              {state.missingSlots.map((slot) => (
                <span key={slot}>{slotLabels[slot]}</span>
              ))}
            </div>
          )}
          {state.lastError && (
            <p className="state-recovery">
              The last reply failed. Supplied details are saved; pending proposals were revoked. You
              can retry.
            </p>
          )}
          <details>
            <summary>
              Inspect saved state <ChevronDown size={13} />
            </summary>
            <pre>{JSON.stringify(state, null, 2)}</pre>
          </details>
          <p className="state-card-note">
            Saved per conversation. Order and action changes invalidate old proposals. Chat text
            cannot confirm a request.
          </p>
        </>
      )}
    </section>
  );
}
