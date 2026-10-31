import type { Types, Document } from 'mongoose';

// Base memory interfaces
export interface IMemoryEntry extends Document {
  userId: Types.ObjectId;
  key: string;
  value: string;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
  updated_at?: Date;
  tenantId?: string;
}

export interface IMemoryEntryLean {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  key: string;
  value: string;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
  updated_at?: Date;
  __v?: number;
}

// Method parameter interfaces
export interface SetMemoryParams {
  userId: string | Types.ObjectId;
  key: string;
  value: string;
  tokenCount?: number;
  userMessage?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  conversationId?: string;
  messageId?: string;
}

export interface DeleteMemoryParams {
  userId: string | Types.ObjectId;
  key: string;
  query?: string;
  userMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface GetFormattedMemoriesParams {
  userId: string | Types.ObjectId;
  userMessage?: string;
  conversationContext?: string;
  endpoint?: string;
  agentId?: string;
}

// Result interfaces
export interface MemoryResult {
  ok: boolean;
}

export interface FormattedMemoriesResult {
  withKeys: string;
  withoutKeys: string;
  totalTokens?: number;
}
