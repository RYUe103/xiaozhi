const mongoose = require('mongoose');

const SanSuoUsageEventSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    eventType: {
      type: String,
      enum: [
        'login_success',
        'chat_request',
        'chat_completed',
        'chat_error',
        'sidebar_app_click',
        'knowledge_query',
        'file_upload',
        'file_generate',
        'page_view',
      ],
      required: true,
      index: true,
    },
    occurredAt: { type: Date, default: Date.now, index: true },
    month: { type: String, required: true, index: true },
    requestId: { type: String, index: true },
    conversationId: { type: String, index: true },
    mode: { type: String, enum: ['fast', 'deep', 'knowledge', null], default: null, index: true },
    knowledgeBaseId: { type: String, index: true },
    knowledgeBaseName: { type: String },
    knowledgeAnswerMode: { type: String, enum: ['agentic_ask', 'local_model'] },
    sourceType: { type: String, enum: ['knowledge_base', 'industry_materials'], index: true },
    industryMaterialIds: [{ type: String }],
    industryMaterialNames: [{ type: String }],
    outcome: {
      type: String,
      enum: ['pending', 'success', 'error', 'timeout', 'insufficient'],
      index: true,
    },
    evidenceCount: { type: Number },
    toolCalls: { type: Number },
    errorCode: { type: String },
    appLinkId: { type: String, index: true },
    pagePath: { type: String, index: true },
    sessionId: { type: String, index: true },
    success: { type: Boolean },
    durationMs: { type: Number },
  },
  { timestamps: true, collection: 'sansuo_usage_events' },
);

SanSuoUsageEventSchema.index({ userId: 1, occurredAt: -1 });
SanSuoUsageEventSchema.index({ month: 1, userId: 1 });
SanSuoUsageEventSchema.index({ eventType: 1, occurredAt: -1 });
SanSuoUsageEventSchema.index({ requestId: 1, eventType: 1 }, { unique: true, sparse: true });

module.exports =
  mongoose.models.SanSuoUsageEvent || mongoose.model('SanSuoUsageEvent', SanSuoUsageEventSchema);
