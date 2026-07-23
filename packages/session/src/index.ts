import type { EvidenceItem, PolicyIntent } from "@policy/schemas/index";

export type ConversationMessage = { role: "user" | "assistant"; content: string };

export type ConversationState = {
  conversation_id: string;
  turn_count: number;
  clarification_count: number;
  active_domain: "childcare-subsidy";
  intent: PolicyIntent;
  confirmed_slots: Record<string, unknown>;
  missing_slots: string[];
  messages: ConversationMessage[];
  evidence_refs: Array<Pick<EvidenceItem, "document_id" | "chunk_id">>;
  created_at: string;
  last_active_at: string;
};

export interface SessionStore {
  get(conversationId: string): Promise<ConversationState | null>;
  set(state: ConversationState): Promise<void>;
  delete(conversationId: string): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly states = new Map<string, ConversationState>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async get(conversationId: string): Promise<ConversationState | null> {
    const state = this.states.get(conversationId);
    if (!state) return null;
    if (this.now() - Date.parse(state.last_active_at) >= this.ttlMs) {
      this.states.delete(conversationId);
      return null;
    }
    return structuredClone(state);
  }

  async set(state: ConversationState): Promise<void> {
    this.pruneExpired();
    this.states.set(state.conversation_id, structuredClone(state));
  }

  async delete(conversationId: string): Promise<void> {
    this.states.delete(conversationId);
  }

  size(): number {
    this.pruneExpired();
    return this.states.size;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [id, state] of this.states) {
      if (now - Date.parse(state.last_active_at) >= this.ttlMs) this.states.delete(id);
    }
  }
}

