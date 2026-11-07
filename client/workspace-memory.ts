export const workspacePages = [
  'overview',
  'workspace',
  'orders',
  'knowledge',
  'evaluations',
  'architecture',
] as const;
export type WorkspacePage = (typeof workspacePages)[number];
const KEY = 'relay.workspace.v1';
export type WorkspaceMemory = { page: WorkspacePage; conversation: string | null };
export function readWorkspace(): WorkspaceMemory {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null');
    return {
      page: workspacePages.includes(value?.page) ? value.page : 'overview',
      conversation:
        typeof value?.conversation === 'string' && /^[a-f\d-]{36}$/i.test(value.conversation)
          ? value.conversation
          : null,
    };
  } catch {
    return { page: 'overview', conversation: null };
  }
}
export function saveWorkspace(value: WorkspaceMemory) {
  // Store only UI pointers. Never save session tokens, API keys, messages or draft text.
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* Storage may be disabled. */
  }
}
