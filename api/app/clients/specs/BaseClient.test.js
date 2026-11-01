const { Constants, EModelEndpoint } = require('librechat-data-provider');
const { initializeFakeClient } = require('./FakeClient');
const { buildPdfDocument, buildWordDocument } = require('~/server/services/DocumentContextService');

const mockNodeFetch = jest.fn();
jest.mock(
  'node-fetch',
  () =>
    (...args) =>
      mockNodeFetch(...args),
);

jest.mock('~/db/connect');
jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    // Default app config for tests
    paths: { uploads: '/tmp' },
    fileStrategy: 'local',
    memory: { disabled: false },
  }),
}));
jest.mock('~/models', () => ({
  User: jest.fn(),
  Key: jest.fn(),
  Session: jest.fn(),
  Balance: jest.fn(),
  Transaction: jest.fn(),
  getMessages: jest.fn().mockResolvedValue([]),
  saveMessage: jest.fn(),
  updateMessage: jest.fn(),
  deleteMessagesSince: jest.fn(),
  deleteMessages: jest.fn(),
  getConvoTitle: jest.fn(),
  getConvo: jest.fn(),
  saveConvo: jest.fn(),
  deleteConvos: jest.fn(),
  getPreset: jest.fn(),
  getPresets: jest.fn(),
  savePreset: jest.fn(),
  deletePresets: jest.fn(),
  findFileById: jest.fn(),
  createFile: jest.fn(),
  updateFile: jest.fn(),
  deleteFile: jest.fn(),
  deleteFiles: jest.fn(),
  getFiles: jest.fn(),
  getSanSuoFiles: jest.fn(),
  rebindSanSuoFileConversationRefs: jest.fn().mockResolvedValue({
    inputFiles: 0,
    derivedArtifacts: 0,
    parseJobs: 0,
  }),
  upsertSanSuoFileRecord: jest.fn(),
  getRoleByName: jest.fn(),
  updateFileUsage: jest.fn(),
  setMemory: jest.fn(),
  deleteMemory: jest.fn(),
  getFormattedMemories: jest.fn(),
}));

const {
  getConvo,
  saveConvo,
  saveMessage,
  setMemory,
  deleteMemory,
  getFormattedMemories,
  getRoleByName,
  getFiles,
  getMessages,
  getSanSuoFiles,
  updateMessage,
  upsertSanSuoFileRecord,
} = require('~/models');

jest.mock('@librechat/agents', () => {
  const actual = jest.requireActual('@librechat/agents');
  return {
    ...actual,
    ChatOpenAI: jest.fn().mockImplementation(() => {
      return {};
    }),
  };
});

let parentMessageId;
let conversationId;
const fakeMessages = [];
const userMessage = 'Hello, ChatGPT!';
const apiKey = 'fake-api-key';

const messageHistory = [
  { role: 'user', isCreatedByUser: true, text: 'Hello', messageId: '1' },
  { role: 'assistant', isCreatedByUser: false, text: 'Hi', messageId: '2', parentMessageId: '1' },
  {
    role: 'user',
    isCreatedByUser: true,
    text: "What's up",
    messageId: '3',
    parentMessageId: '2',
  },
];

describe('BaseClient', () => {
  let TestClient;
  const options = {
    // debug: true,
    modelOptions: {
      model: 'gpt-4o-mini',
      temperature: 0,
    },
  };

  beforeEach(() => {
    TestClient = initializeFakeClient(apiKey, options, fakeMessages);
    TestClient.summarizeMessages = jest.fn().mockResolvedValue({
      summaryMessage: {
        role: 'system',
        content: 'Refined answer',
      },
      summaryTokenCount: 5,
    });
  });

  test('returns the input messages without instructions when addInstructions() is called with empty instructions', () => {
    const messages = [{ content: 'Hello' }, { content: 'How are you?' }, { content: 'Goodbye' }];
    const instructions = '';
    const result = TestClient.addInstructions(messages, instructions);
    expect(result).toEqual(messages);
  });

  test('returns the input messages with instructions properly added when addInstructions() is called with non-empty instructions', () => {
    const messages = [{ content: 'Hello' }, { content: 'How are you?' }, { content: 'Goodbye' }];
    const instructions = { content: 'Please respond to the question.' };
    const result = TestClient.addInstructions(messages, instructions);
    const expected = [
      { content: 'Please respond to the question.' },
      { content: 'Hello' },
      { content: 'How are you?' },
      { content: 'Goodbye' },
    ];
    expect(result).toEqual(expected);
  });

  test('returns the input messages with instructions properly added when addInstructions() with legacy flag', () => {
    const messages = [{ content: 'Hello' }, { content: 'How are you?' }, { content: 'Goodbye' }];
    const instructions = { content: 'Please respond to the question.' };
    const result = TestClient.addInstructions(messages, instructions, true);
    const expected = [
      { content: 'Hello' },
      { content: 'How are you?' },
      { content: 'Please respond to the question.' },
      { content: 'Goodbye' },
    ];
    expect(result).toEqual(expected);
  });

  test('concats messages correctly in concatenateMessages()', () => {
    const messages = [
      { name: 'User', content: 'Hello' },
      { name: 'Assistant', content: 'How can I help you?' },
      { name: 'User', content: 'I have a question.' },
    ];
    const result = TestClient.concatenateMessages(messages);
    const expected =
      'User:\nHello\n\nAssistant:\nHow can I help you?\n\nUser:\nI have a question.\n\n';
    expect(result).toBe(expected);
  });

  test('refines messages correctly in summarizeMessages()', async () => {
    const messagesToRefine = [
      { role: 'user', content: 'Hello', tokenCount: 10 },
      { role: 'assistant', content: 'How can I help you?', tokenCount: 20 },
    ];
    const remainingContextTokens = 100;
    const expectedRefinedMessage = {
      role: 'system',
      content: 'Refined answer',
    };

    const result = await TestClient.summarizeMessages({ messagesToRefine, remainingContextTokens });
    expect(result.summaryMessage).toEqual(expectedRefinedMessage);
  });

  test('gets messages within token limit (under limit) correctly in getMessagesWithinTokenLimit()', async () => {
    TestClient.maxContextTokens = 100;
    TestClient.shouldSummarize = true;

    const messages = [
      { role: 'user', content: 'Hello', tokenCount: 5 },
      { role: 'assistant', content: 'How can I help you?', tokenCount: 19 },
      { role: 'user', content: 'I have a question.', tokenCount: 18 },
    ];
    const expectedContext = [
      { role: 'user', content: 'Hello', tokenCount: 5 }, // 'Hello'.length
      { role: 'assistant', content: 'How can I help you?', tokenCount: 19 },
      { role: 'user', content: 'I have a question.', tokenCount: 18 },
    ];
    // Subtract 3 tokens for Assistant Label priming after all messages have been counted.
    const expectedRemainingContextTokens = 58 - 3; // (100 - 5 - 19 - 18) - 3
    const expectedMessagesToRefine = [];

    const lastExpectedMessage =
      expectedMessagesToRefine?.[expectedMessagesToRefine.length - 1] ?? {};
    const expectedIndex = messages.findIndex((msg) => msg.content === lastExpectedMessage?.content);

    const result = await TestClient.getMessagesWithinTokenLimit({ messages });

    expect(result.context).toEqual(expectedContext);
    expect(result.messagesToRefine.length - 1).toEqual(expectedIndex);
    expect(result.remainingContextTokens).toBe(expectedRemainingContextTokens);
    expect(result.messagesToRefine).toEqual(expectedMessagesToRefine);
  });

  test('gets result over token limit correctly in getMessagesWithinTokenLimit()', async () => {
    TestClient.maxContextTokens = 50; // Set a lower limit
    TestClient.shouldSummarize = true;

    const messages = [
      { role: 'user', content: 'Hello', tokenCount: 30 },
      { role: 'assistant', content: 'How can I help you?', tokenCount: 30 },
      { role: 'user', content: 'I have a question.', tokenCount: 5 },
      { role: 'user', content: 'I need a coffee, stat!', tokenCount: 19 },
      { role: 'assistant', content: 'Sure, I can help with that.', tokenCount: 18 },
    ];

    // Subtract 3 tokens for Assistant Label priming after all messages have been counted.
    const expectedRemainingContextTokens = 5; // (50 - 18 - 19 - 5) - 3
    const expectedMessagesToRefine = [
      { role: 'user', content: 'Hello', tokenCount: 30 },
      { role: 'assistant', content: 'How can I help you?', tokenCount: 30 },
    ];
    const expectedContext = [
      { role: 'user', content: 'I have a question.', tokenCount: 5 },
      { role: 'user', content: 'I need a coffee, stat!', tokenCount: 19 },
      { role: 'assistant', content: 'Sure, I can help with that.', tokenCount: 18 },
    ];

    const lastExpectedMessage =
      expectedMessagesToRefine?.[expectedMessagesToRefine.length - 1] ?? {};
    const expectedIndex = messages.findIndex((msg) => msg.content === lastExpectedMessage?.content);

    const result = await TestClient.getMessagesWithinTokenLimit({ messages });

    expect(result.context).toEqual(expectedContext);
    expect(result.messagesToRefine.length - 1).toEqual(expectedIndex);
    expect(result.remainingContextTokens).toBe(expectedRemainingContextTokens);
    expect(result.messagesToRefine).toEqual(expectedMessagesToRefine);
  });

  describe('getMessagesForConversation', () => {
    it('should return an empty array if the parentMessageId does not exist', () => {
      const result = TestClient.constructor.getMessagesForConversation({
        messages: unorderedMessages,
        parentMessageId: '999',
      });
      expect(result).toEqual([]);
    });

    it('should handle messages with messageId property', () => {
      const messagesWithMessageId = [
        { messageId: '1', parentMessageId: null, text: 'Message 1' },
        { messageId: '2', parentMessageId: '1', text: 'Message 2' },
      ];
      const result = TestClient.constructor.getMessagesForConversation({
        messages: messagesWithMessageId,
        parentMessageId: '2',
      });
      expect(result).toEqual([
        { messageId: '1', parentMessageId: null, text: 'Message 1' },
        { messageId: '2', parentMessageId: '1', text: 'Message 2' },
      ]);
    });

    const messagesWithNullParent = [
      { id: '1', parentMessageId: null, text: 'Message 1' },
      { id: '2', parentMessageId: null, text: 'Message 2' },
    ];

    it('should handle messages with null parentMessageId that are not root', () => {
      const result = TestClient.constructor.getMessagesForConversation({
        messages: messagesWithNullParent,
        parentMessageId: '2',
      });
      expect(result).toEqual([{ id: '2', parentMessageId: null, text: 'Message 2' }]);
    });

    const cyclicMessages = [
      { id: '3', parentMessageId: '2', text: 'Message 3' },
      { id: '1', parentMessageId: '3', text: 'Message 1' },
      { id: '2', parentMessageId: '1', text: 'Message 2' },
    ];

    it('should handle cyclic references without going into an infinite loop', () => {
      const result = TestClient.constructor.getMessagesForConversation({
        messages: cyclicMessages,
        parentMessageId: '3',
      });
      expect(result).toEqual([
        { id: '1', parentMessageId: '3', text: 'Message 1' },
        { id: '2', parentMessageId: '1', text: 'Message 2' },
        { id: '3', parentMessageId: '2', text: 'Message 3' },
      ]);
    });

    const unorderedMessages = [
      { id: '3', parentMessageId: '2', text: 'Message 3' },
      { id: '2', parentMessageId: '1', text: 'Message 2' },
      { id: '1', parentMessageId: Constants.NO_PARENT, text: 'Message 1' },
    ];

    it('should return ordered messages based on parentMessageId', () => {
      const result = TestClient.constructor.getMessagesForConversation({
        messages: unorderedMessages,
        parentMessageId: '3',
      });
      expect(result).toEqual([
        { id: '1', parentMessageId: Constants.NO_PARENT, text: 'Message 1' },
        { id: '2', parentMessageId: '1', text: 'Message 2' },
        { id: '3', parentMessageId: '2', text: 'Message 3' },
      ]);
    });

    const unorderedBranchedMessages = [
      { id: '4', parentMessageId: '2', text: 'Message 4', summary: 'Summary for Message 4' },
      { id: '10', parentMessageId: '7', text: 'Message 10' },
      { id: '1', parentMessageId: null, text: 'Message 1' },
      { id: '6', parentMessageId: '5', text: 'Message 7' },
      { id: '7', parentMessageId: '5', text: 'Message 7' },
      { id: '2', parentMessageId: '1', text: 'Message 2' },
      { id: '8', parentMessageId: '6', text: 'Message 8' },
      { id: '5', parentMessageId: '3', text: 'Message 5' },
      { id: '3', parentMessageId: '1', text: 'Message 3' },
      { id: '6', parentMessageId: '4', text: 'Message 6' },
      { id: '8', parentMessageId: '7', text: 'Message 9' },
      { id: '9', parentMessageId: '7', text: 'Message 9' },
      { id: '11', parentMessageId: '2', text: 'Message 11', summary: 'Summary for Message 11' },
    ];

    it('should return ordered messages from a branched array based on parentMessageId', () => {
      const result = TestClient.constructor.getMessagesForConversation({
        messages: unorderedBranchedMessages,
        parentMessageId: '10',
        summary: true,
      });
      expect(result).toEqual([
        { id: '1', parentMessageId: null, text: 'Message 1' },
        { id: '3', parentMessageId: '1', text: 'Message 3' },
        { id: '5', parentMessageId: '3', text: 'Message 5' },
        { id: '7', parentMessageId: '5', text: 'Message 7' },
        { id: '10', parentMessageId: '7', text: 'Message 10' },
      ]);
    });

    it('should return an empty array if no messages are provided', () => {
      const result = TestClient.constructor.getMessagesForConversation({
        messages: [],
        parentMessageId: '3',
      });
      expect(result).toEqual([]);
    });

    it('should map over the ordered messages if mapMethod is provided', () => {
      const mapMethod = (msg) => msg.text;
      const result = TestClient.constructor.getMessagesForConversation({
        messages: unorderedMessages,
        parentMessageId: '3',
        mapMethod,
      });
      expect(result).toEqual(['Message 1', 'Message 2', 'Message 3']);
    });

    let unorderedMessagesWithSummary = [
      { id: '4', parentMessageId: '3', text: 'Message 4' },
      { id: '2', parentMessageId: '1', text: 'Message 2', summary: 'Summary for Message 2' },
      { id: '3', parentMessageId: '2', text: 'Message 3', summary: 'Summary for Message 3' },
      { id: '1', parentMessageId: null, text: 'Message 1' },
    ];

    it('should start with the message that has a summary property and continue until the specified parentMessageId', () => {
      const result = TestClient.constructor.getMessagesForConversation({
        messages: unorderedMessagesWithSummary,
        parentMessageId: '4',
        summary: true,
      });
      expect(result).toEqual([
        {
          id: '3',
          parentMessageId: '2',
          role: 'system',
          text: 'Message 3',
          content: [{ type: 'text', text: 'Summary for Message 3' }],
          summary: 'Summary for Message 3',
        },
        { id: '4', parentMessageId: '3', text: 'Message 4' },
      ]);
    });

    it('should handle multiple summaries and return the branch from the latest to the parentMessageId', () => {
      unorderedMessagesWithSummary = [
        { id: '5', parentMessageId: '4', text: 'Message 5' },
        { id: '2', parentMessageId: '1', text: 'Message 2', summary: 'Summary for Message 2' },
        { id: '3', parentMessageId: '2', text: 'Message 3', summary: 'Summary for Message 3' },
        { id: '4', parentMessageId: '3', text: 'Message 4', summary: 'Summary for Message 4' },
        { id: '1', parentMessageId: null, text: 'Message 1' },
      ];
      const result = TestClient.constructor.getMessagesForConversation({
        messages: unorderedMessagesWithSummary,
        parentMessageId: '5',
        summary: true,
      });
      expect(result).toEqual([
        {
          id: '4',
          parentMessageId: '3',
          role: 'system',
          text: 'Message 4',
          content: [{ type: 'text', text: 'Summary for Message 4' }],
          summary: 'Summary for Message 4',
        },
        { id: '5', parentMessageId: '4', text: 'Message 5' },
      ]);
    });

    it('should handle summary at root edge case and continue until the parentMessageId', () => {
      unorderedMessagesWithSummary = [
        { id: '5', parentMessageId: '4', text: 'Message 5' },
        { id: '1', parentMessageId: null, text: 'Message 1', summary: 'Summary for Message 1' },
        { id: '4', parentMessageId: '3', text: 'Message 4', summary: 'Summary for Message 4' },
        { id: '2', parentMessageId: '1', text: 'Message 2', summary: 'Summary for Message 2' },
        { id: '3', parentMessageId: '2', text: 'Message 3', summary: 'Summary for Message 3' },
      ];
      const result = TestClient.constructor.getMessagesForConversation({
        messages: unorderedMessagesWithSummary,
        parentMessageId: '5',
        summary: true,
      });
      expect(result).toEqual([
        {
          id: '4',
          parentMessageId: '3',
          role: 'system',
          text: 'Message 4',
          content: [{ type: 'text', text: 'Summary for Message 4' }],
          summary: 'Summary for Message 4',
        },
        { id: '5', parentMessageId: '4', text: 'Message 5' },
      ]);
    });

    it('should detect summary content block and use it over legacy fields (summary mode)', () => {
      const messagesWithContentBlock = [
        { id: '3', parentMessageId: '2', text: 'Message 3' },
        {
          id: '2',
          parentMessageId: '1',
          text: 'Message 2',
          content: [
            { type: 'text', text: 'Original text' },
            { type: 'summary', text: 'Content block summary', tokenCount: 42 },
          ],
        },
        { id: '1', parentMessageId: null, text: 'Message 1' },
      ];
      const result = TestClient.constructor.getMessagesForConversation({
        messages: messagesWithContentBlock,
        parentMessageId: '3',
        summary: true,
      });
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('system');
      expect(result[0].content).toEqual([{ type: 'text', text: 'Content block summary' }]);
      expect(result[0].tokenCount).toBe(42);
    });

    it('should prefer content block summary over legacy summary field', () => {
      const messagesWithBoth = [
        { id: '2', parentMessageId: '1', text: 'Message 2' },
        {
          id: '1',
          parentMessageId: null,
          text: 'Message 1',
          summary: 'Legacy summary',
          summaryTokenCount: 10,
          content: [{ type: 'summary', text: 'Content block summary', tokenCount: 20 }],
        },
      ];
      const result = TestClient.constructor.getMessagesForConversation({
        messages: messagesWithBoth,
        parentMessageId: '2',
        summary: true,
      });
      expect(result).toHaveLength(2);
      expect(result[0].content).toEqual([{ type: 'text', text: 'Content block summary' }]);
      expect(result[0].tokenCount).toBe(20);
    });

    it('should fallback to legacy summary when no content block exists', () => {
      const messagesWithLegacy = [
        { id: '2', parentMessageId: '1', text: 'Message 2' },
        {
          id: '1',
          parentMessageId: null,
          text: 'Message 1',
          summary: 'Legacy summary only',
          summaryTokenCount: 15,
        },
      ];
      const result = TestClient.constructor.getMessagesForConversation({
        messages: messagesWithLegacy,
        parentMessageId: '2',
        summary: true,
      });
      expect(result).toHaveLength(2);
      expect(result[0].content).toEqual([{ type: 'text', text: 'Legacy summary only' }]);
      expect(result[0].tokenCount).toBe(15);
    });
  });

  describe('findSummaryContentBlock', () => {
    it('should find a summary block in the content array', () => {
      const message = {
        content: [
          { type: 'text', text: 'some text' },
          { type: 'summary', text: 'Summary of conversation', tokenCount: 50 },
        ],
      };
      const result = TestClient.constructor.findSummaryContentBlock(message);
      expect(result).toBeTruthy();
      expect(result.text).toBe('Summary of conversation');
      expect(result.tokenCount).toBe(50);
    });

    it('should return null when no summary block exists', () => {
      const message = {
        content: [
          { type: 'text', text: 'some text' },
          { type: 'tool_call', tool_call: {} },
        ],
      };
      expect(TestClient.constructor.findSummaryContentBlock(message)).toBeNull();
    });

    it('should return null for string content', () => {
      const message = { content: 'just a string' };
      expect(TestClient.constructor.findSummaryContentBlock(message)).toBeNull();
    });

    it('should return null for missing content', () => {
      expect(TestClient.constructor.findSummaryContentBlock({})).toBeNull();
      expect(TestClient.constructor.findSummaryContentBlock(null)).toBeNull();
    });

    it('should skip summary blocks with no text', () => {
      const message = {
        content: [{ type: 'summary', tokenCount: 10 }],
      };
      expect(TestClient.constructor.findSummaryContentBlock(message)).toBeNull();
    });
  });

  describe('sendMessage', () => {
    test('sendMessage should return a response message', async () => {
      const expectedResult = expect.objectContaining({
        sender: TestClient.sender,
        text: expect.any(String),
        isCreatedByUser: false,
        messageId: expect.any(String),
        parentMessageId: expect.any(String),
        conversationId: expect.any(String),
      });

      const response = await TestClient.sendMessage(userMessage);
      parentMessageId = response.messageId;
      conversationId = response.conversationId;
      expect(response).toEqual(expectedResult);
    });

    test('should replace responseMessageId with new UUID when isRegenerate is true and messageId ends with underscore', async () => {
      const mockCrypto = require('crypto');
      const newUUID = 'new-uuid-1234';
      jest.spyOn(mockCrypto, 'randomUUID').mockReturnValue(newUUID);

      const opts = {
        isRegenerate: true,
        responseMessageId: 'existing-message-id_',
      };

      await TestClient.setMessageOptions(opts);

      expect(TestClient.responseMessageId).toBe(newUUID);
      expect(TestClient.responseMessageId).not.toBe('existing-message-id_');

      mockCrypto.randomUUID.mockRestore();
    });

    test('should not replace responseMessageId when isRegenerate is false', async () => {
      const opts = {
        isRegenerate: false,
        responseMessageId: 'existing-message-id_',
      };

      await TestClient.setMessageOptions(opts);

      expect(TestClient.responseMessageId).toBe('existing-message-id_');
    });

    test('should not replace responseMessageId when it does not end with underscore', async () => {
      const opts = {
        isRegenerate: true,
        responseMessageId: 'existing-message-id',
      };

      await TestClient.setMessageOptions(opts);

      expect(TestClient.responseMessageId).toBe('existing-message-id');
    });

    test('sendMessage should work with provided conversationId and parentMessageId', async () => {
      const userMessage = 'Second message in the conversation';
      const opts = {
        conversationId,
        parentMessageId,
        getReqData: jest.fn(),
        onStart: jest.fn(),
      };

      const expectedResult = expect.objectContaining({
        sender: TestClient.sender,
        text: expect.any(String),
        isCreatedByUser: false,
        messageId: expect.any(String),
        parentMessageId: expect.any(String),
        conversationId: opts.conversationId,
      });

      const response = await TestClient.sendMessage(userMessage, opts);
      parentMessageId = response.messageId;
      expect(response.conversationId).toEqual(conversationId);
      expect(response).toEqual(expectedResult);
      expect(opts.getReqData).toHaveBeenCalled();
      expect(opts.onStart).toHaveBeenCalled();
      expect(TestClient.getBuildMessagesOptions).toHaveBeenCalled();
      expect(TestClient.getSaveOptions).toHaveBeenCalled();
    });

    test('should return chat history', async () => {
      TestClient = initializeFakeClient(apiKey, options, messageHistory);
      const chatMessages = await TestClient.loadHistory(conversationId, '2');
      expect(TestClient.currentMessages).toHaveLength(2);
      expect(chatMessages[0].text).toEqual('Hello');

      const chatMessages2 = await TestClient.loadHistory(conversationId, '3');
      expect(TestClient.currentMessages).toHaveLength(3);
      expect(chatMessages2[chatMessages2.length - 1].text).toEqual("What's up");
    });

    /* Most of the new sendMessage logic revolving around edited/continued AI messages
     *  can be summarized by the following test. The condition will load the entire history up to
     *  the message that is being edited, which will trigger the AI API to 'continue' the response.
     *  The 'userMessage' is only passed by convention and is not necessary for the generation.
     */
    it('should not push userMessage to currentMessages when isEdited is true and vice versa', async () => {
      const overrideParentMessageId = 'user-message-id';
      const responseMessageId = 'response-message-id';
      const newHistory = messageHistory.slice();
      newHistory.push({
        role: 'assistant',
        isCreatedByUser: false,
        text: 'test message',
        messageId: responseMessageId,
        parentMessageId: '3',
      });

      TestClient = initializeFakeClient(apiKey, options, newHistory);
      const sendMessageOptions = {
        isEdited: true,
        overrideParentMessageId,
        parentMessageId: '3',
        responseMessageId,
      };

      await TestClient.sendMessage('test message', sendMessageOptions);
      const currentMessages = TestClient.currentMessages;
      expect(currentMessages[currentMessages.length - 1].messageId).not.toEqual(
        overrideParentMessageId,
      );

      // Test the opposite case
      sendMessageOptions.isEdited = false;
      await TestClient.sendMessage('test message', sendMessageOptions);
      const currentMessages2 = TestClient.currentMessages;
      expect(currentMessages2[currentMessages2.length - 1].messageId).toEqual(
        overrideParentMessageId,
      );
    });

    test('setOptions is called with the correct arguments only when replaceOptions is set to true', async () => {
      TestClient.setOptions = jest.fn();
      const opts = { conversationId: '123', parentMessageId: '456', replaceOptions: true };
      await TestClient.sendMessage('Hello, world!', opts);
      expect(TestClient.setOptions).toHaveBeenCalledWith(opts);
      TestClient.setOptions.mockClear();
    });

    test('loadHistory is called with the correct arguments', async () => {
      const opts = { conversationId: '123', parentMessageId: '456' };
      await TestClient.sendMessage('Hello, world!', opts);
      expect(TestClient.loadHistory).toHaveBeenCalledWith(
        opts.conversationId,
        opts.parentMessageId,
      );
    });

    test('getReqData is called with the correct arguments', async () => {
      const getReqData = jest.fn();
      const opts = { getReqData };
      const response = await TestClient.sendMessage('Hello, world!', opts);
      expect(getReqData).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: expect.objectContaining({ text: 'Hello, world!' }),
          conversationId: response.conversationId,
          responseMessageId: response.messageId,
        }),
      );
    });

    test('onStart is called with the correct arguments', async () => {
      const onStart = jest.fn();
      const opts = { onStart };
      await TestClient.sendMessage('Hello, world!', opts);

      expect(onStart).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Hello, world!' }),
        expect.any(String),
        /** `isNewConvo` */
        true,
      );
    });

    test('saveMessageToDatabase is called with the correct arguments', async () => {
      const saveOptions = TestClient.getSaveOptions();
      const user = {};
      const opts = { user };
      const saveSpy = jest.spyOn(TestClient, 'saveMessageToDatabase');
      await TestClient.sendMessage('Hello, world!', opts);
      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sender: expect.any(String),
          text: expect.any(String),
          isCreatedByUser: expect.any(Boolean),
          messageId: expect.any(String),
          parentMessageId: expect.any(String),
          conversationId: expect.any(String),
        }),
        saveOptions,
        user,
      );
    });

    test('should handle existing conversation when getConvo retrieves one', async () => {
      const existingConvo = {
        conversationId: 'existing-convo-id',
        endpoint: 'openai',
        endpointType: 'openai',
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'user', content: 'Existing message 1' },
          { role: 'assistant', content: 'Existing response 1' },
        ],
        temperature: 1,
      };

      const { temperature: _temp, ...newConvo } = existingConvo;

      const user = {
        id: 'user-id',
      };

      getConvo.mockResolvedValue(existingConvo);
      saveConvo.mockResolvedValue(newConvo);

      TestClient = initializeFakeClient(
        apiKey,
        {
          ...options,
          req: {
            user,
          },
        },
        [],
      );

      const saveSpy = jest.spyOn(TestClient, 'saveMessageToDatabase');

      const newMessage = 'New message in existing conversation';
      const response = await TestClient.sendMessage(newMessage, {
        user,
        conversationId: existingConvo.conversationId,
      });

      expect(getConvo).toHaveBeenCalledWith(user.id, existingConvo.conversationId);
      expect(TestClient.conversationId).toBe(existingConvo.conversationId);
      expect(response.conversationId).toBe(existingConvo.conversationId);
      expect(TestClient.fetchedConvo).toBe(true);

      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: existingConvo.conversationId,
          text: newMessage,
        }),
        expect.any(Object),
        expect.any(Object),
      );

      expect(saveConvo).toHaveBeenCalledTimes(2);
      expect(saveConvo).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          conversationId: existingConvo.conversationId,
        }),
        expect.objectContaining({
          context: 'api/app/clients/BaseClient.js - saveMessageToDatabase #saveConvo',
          unsetFields: {
            temperature: 1,
          },
        }),
      );

      await TestClient.sendMessage('Another message', {
        conversationId: existingConvo.conversationId,
      });
      expect(getConvo).toHaveBeenCalledTimes(1);
    });

    test('should correctly handle existing conversation and unset fields appropriately', async () => {
      const existingConvo = {
        conversationId: 'existing-convo-id',
        endpoint: 'openai',
        endpointType: 'openai',
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'user', content: 'Existing message 1' },
          { role: 'assistant', content: 'Existing response 1' },
        ],
        title: 'Existing Conversation',
        someExistingField: 'existingValue',
        anotherExistingField: 'anotherValue',
        temperature: 0.7,
        modelLabel: 'GPT-3.5',
      };

      getConvo.mockResolvedValue(existingConvo);
      saveConvo.mockResolvedValue(existingConvo);

      TestClient = initializeFakeClient(
        apiKey,
        {
          ...options,
          modelOptions: {
            model: 'gpt-4',
            temperature: 0.5,
          },
        },
        [],
      );

      const newMessage = 'New message in existing conversation';
      await TestClient.sendMessage(newMessage, {
        conversationId: existingConvo.conversationId,
      });

      expect(saveConvo).toHaveBeenCalledTimes(2);

      const saveConvoCall = saveConvo.mock.calls[0];
      const [, savedFields, saveOptions] = saveConvoCall;

      // Instead of checking all excludedKeys, we'll just check specific fields
      // that we know should be excluded
      expect(savedFields).not.toHaveProperty('messages');
      expect(savedFields).not.toHaveProperty('title');

      // Only check that someExistingField is in unsetFields
      expect(saveOptions.unsetFields).toHaveProperty('someExistingField', 1);

      // Mock saveConvo to return the expected fields
      saveConvo.mockImplementation((req, fields) => {
        return Promise.resolve({
          ...fields,
          endpoint: 'openai',
          endpointType: 'openai',
          model: 'gpt-4',
          temperature: 0.5,
        });
      });

      // Only check the conversationId since that's the only field we can be sure about
      expect(savedFields).toHaveProperty('conversationId', 'existing-convo-id');

      expect(TestClient.fetchedConvo).toBe(true);

      await TestClient.sendMessage('Another message', {
        conversationId: existingConvo.conversationId,
      });

      expect(getConvo).toHaveBeenCalledTimes(1);

      const secondSaveConvoCall = saveConvo.mock.calls[1];
      expect(secondSaveConvoCall[2]).toHaveProperty('unsetFields', {});
    });

    test('sendCompletion is called with the correct arguments', async () => {
      const payload = {}; // Mock payload
      TestClient.buildMessages.mockReturnValue({ prompt: payload, tokenCountMap: null });
      const opts = {};
      await TestClient.sendMessage('Hello, world!', opts);
      expect(TestClient.sendCompletion).toHaveBeenCalledWith(payload, opts);
    });

    test('getTokenCount for response is called with the correct arguments', async () => {
      const tokenCountMap = {}; // Mock tokenCountMap
      TestClient.buildMessages.mockReturnValue({ prompt: [], tokenCountMap });
      TestClient.getTokenCountForResponse = jest.fn();
      const response = await TestClient.sendMessage('Hello, world!', {});
      expect(TestClient.getTokenCountForResponse).toHaveBeenCalledWith(response);
    });

    test('returns an object with the correct shape', async () => {
      const response = await TestClient.sendMessage('Hello, world!', {});
      expect(response).toEqual(
        expect.objectContaining({
          sender: expect.any(String),
          text: expect.any(String),
          isCreatedByUser: expect.any(Boolean),
          messageId: expect.any(String),
          parentMessageId: expect.any(String),
          conversationId: expect.any(String),
        }),
      );
    });

    test('saveMessageToDatabase returns early when this.options is null (client disposed)', async () => {
      const savedOptions = TestClient.options;
      TestClient.options = null;
      saveMessage.mockClear();

      const result = await TestClient.saveMessageToDatabase(
        { messageId: 'msg-1', conversationId: 'conv-1', isCreatedByUser: true, text: 'hi' },
        {},
        null,
      );

      expect(result).toEqual({});
      expect(saveMessage).not.toHaveBeenCalled();

      TestClient.options = savedOptions;
    });

    test('saveMessageToDatabase uses snapshot of options, immune to mid-await disposal', async () => {
      const savedOptions = TestClient.options;
      saveMessage.mockClear();
      saveConvo.mockClear();

      // Make db.saveMessage yield, simulating I/O suspension during which disposal occurs
      saveMessage.mockImplementation(async (_reqCtx, msgData) => {
        // Simulate disposeClient nullifying client.options while awaiting
        TestClient.options = null;
        return msgData;
      });
      saveConvo.mockResolvedValue({ conversationId: 'conv-1' });

      const result = await TestClient.saveMessageToDatabase(
        { messageId: 'msg-1', conversationId: 'conv-1', isCreatedByUser: true, text: 'hi' },
        { endpoint: 'openAI' },
        null,
      );

      // Should complete without TypeError, using the snapshotted options
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('conversation');
      expect(saveMessage).toHaveBeenCalled();

      TestClient.options = savedOptions;
      saveMessage.mockReset();
      saveConvo.mockReset();
    });

    test('saveMessageToDatabase reuses conversation resolved on the request', async () => {
      const existingConvo = {
        conversationId: 'cached-convo-id',
        endpoint: 'openai',
        endpointType: 'openai',
        temperature: 0.7,
      };
      const user = { id: 'user-id' };
      const req = { user, resolvedConversation: existingConvo };

      getConvo.mockClear();
      saveMessage.mockResolvedValue({ messageId: 'msg-1' });
      saveConvo.mockResolvedValue(existingConvo);

      TestClient = initializeFakeClient(apiKey, { ...options, endpoint: 'openai', req }, []);

      await TestClient.saveMessageToDatabase(
        {
          messageId: 'msg-1',
          conversationId: existingConvo.conversationId,
          isCreatedByUser: true,
          text: 'hi',
        },
        { endpoint: 'openai' },
        user,
      );

      expect(getConvo).not.toHaveBeenCalled();
      expect(req).not.toHaveProperty('resolvedConversation');
      expect(TestClient.fetchedConvo).toBe(true);
      expect(saveConvo).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ conversationId: existingConvo.conversationId }),
        expect.objectContaining({
          unsetFields: expect.objectContaining({ temperature: 1 }),
        }),
      );
    });

    test('SanSuoMain manual memory mode only reads saved memory', async () => {
      setMemory.mockClear();
      deleteMemory.mockClear();
      getFormattedMemories.mockClear();
      getRoleByName.mockClear();
      getRoleByName.mockResolvedValue({ permissions: { MEMORIES: { USE: true } } });
      getFormattedMemories.mockResolvedValue({ withoutKeys: '1. 我叫俞杨。' });
      TestClient = initializeFakeClient(
        apiKey,
        {
          ...options,
          endpoint: 'SanSuoMain',
          req: {
            user: {
              id: 'user-id',
              role: 'USER',
              personalization: { memories: true, memoryMode: 'manual' },
            },
            config: { memory: { disabled: false } },
          },
        },
        [],
      );

      const result = await TestClient.useNativeMemory();

      expect(result).toEqual({ withoutKeys: '1. 我叫俞杨。' });
      expect(getFormattedMemories).toHaveBeenCalledWith({ userId: 'user-id' });
      expect(setMemory).not.toHaveBeenCalled();
      expect(deleteMemory).not.toHaveBeenCalled();
    });

    test('SanSuoMain off memory mode neither reads nor writes memory', async () => {
      setMemory.mockClear();
      deleteMemory.mockClear();
      getFormattedMemories.mockClear();
      getRoleByName.mockClear();
      TestClient = initializeFakeClient(
        apiKey,
        {
          ...options,
          endpoint: 'SanSuoMain',
          req: {
            user: {
              id: 'user-id',
              role: 'USER',
              personalization: { memories: false, memoryMode: 'off' },
            },
            config: { memory: { disabled: false } },
          },
        },
        [],
      );

      const result = await TestClient.useNativeMemory();

      expect(result).toBeNull();
      expect(getFormattedMemories).not.toHaveBeenCalled();
      expect(getRoleByName).not.toHaveBeenCalled();
      expect(setMemory).not.toHaveBeenCalled();
      expect(deleteMemory).not.toHaveBeenCalled();
    });

    test('userMessagePromise is awaited before saving response message', async () => {
      // Mock the saveMessageToDatabase method
      TestClient.saveMessageToDatabase = jest.fn().mockImplementation(() => {
        return new Promise((resolve) => setTimeout(resolve, 100)); // Simulate a delay
      });

      // Send a message
      const messagePromise = TestClient.sendMessage('Hello, world!');

      // Wait a short time to ensure the user message save has started
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check that saveMessageToDatabase has been called once (for the user message)
      expect(TestClient.saveMessageToDatabase).toHaveBeenCalledTimes(1);

      // Wait for the message to be fully processed
      await messagePromise;

      // Check that saveMessageToDatabase has been called twice (once for user message, once for response)
      expect(TestClient.saveMessageToDatabase).toHaveBeenCalledTimes(2);

      // Check the order of calls
      const calls = TestClient.saveMessageToDatabase.mock.calls;
      expect(calls[0][0].isCreatedByUser).toBe(true); // First call should be for user message
      expect(calls[1][0].isCreatedByUser).toBe(false); // Second call should be for response message
    });
  });

  describe('recordTokenUsage model assignment', () => {
    test('should pass this.model to recordTokenUsage, not the agent ID from responseMessage.model', async () => {
      const actualModel = 'claude-opus-4-5';
      const agentId = 'agent_p5Z_IU6EIxBoqn1BoqLBp';

      TestClient.model = actualModel;
      TestClient.options.endpoint = 'agents';
      TestClient.options.agent = { id: agentId };

      TestClient.getTokenCountForResponse = jest.fn().mockReturnValue(50);
      TestClient.recordTokenUsage = jest.fn().mockResolvedValue(undefined);
      TestClient.buildMessages.mockReturnValue({
        prompt: [],
        tokenCountMap: { res: 50 },
      });

      await TestClient.sendMessage('Hello', {});

      expect(TestClient.recordTokenUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          model: actualModel,
        }),
      );

      const callArgs = TestClient.recordTokenUsage.mock.calls[0][0];
      expect(callArgs.model).not.toBe(agentId);
    });

    test('should pass this.model even when this.model differs from modelOptions.model', async () => {
      const instanceModel = 'gpt-4o';
      TestClient.model = instanceModel;
      TestClient.modelOptions = { model: 'gpt-4o-mini' };

      TestClient.getTokenCountForResponse = jest.fn().mockReturnValue(50);
      TestClient.recordTokenUsage = jest.fn().mockResolvedValue(undefined);
      TestClient.buildMessages.mockReturnValue({
        prompt: [],
        tokenCountMap: { res: 50 },
      });

      await TestClient.sendMessage('Hello', {});

      expect(TestClient.recordTokenUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          model: instanceModel,
        }),
      );
    });
  });

  describe('getMessagesWithinTokenLimit with instructions', () => {
    test('should always include instructions when present', async () => {
      TestClient.maxContextTokens = 50;
      const instructions = {
        role: 'system',
        content: 'System instructions',
        tokenCount: 20,
      };

      const messages = [
        instructions,
        { role: 'user', content: 'Hello', tokenCount: 10 },
        { role: 'assistant', content: 'Hi there', tokenCount: 15 },
      ];

      const result = await TestClient.getMessagesWithinTokenLimit({
        messages,
        instructions,
      });

      expect(result.context[0]).toBe(instructions);
      expect(result.remainingContextTokens).toBe(2);
    });

    test('should handle case when messages exceed limit but instructions must be preserved', async () => {
      TestClient.maxContextTokens = 30;
      const instructions = {
        role: 'system',
        content: 'System instructions',
        tokenCount: 20,
      };

      const messages = [
        instructions,
        { role: 'user', content: 'Hello', tokenCount: 10 },
        { role: 'assistant', content: 'Hi there', tokenCount: 15 },
      ];

      const result = await TestClient.getMessagesWithinTokenLimit({
        messages,
        instructions,
      });

      // Should only include instructions and the last message that fits
      expect(result.context).toHaveLength(1);
      expect(result.context[0].content).toBe(instructions.content);
      expect(result.messagesToRefine).toHaveLength(2);
      expect(result.remainingContextTokens).toBe(7); // 30 - 20 - 3 (assistant label)
    });

    test('should work correctly without instructions (1/2)', async () => {
      TestClient.maxContextTokens = 50;
      const messages = [
        { role: 'user', content: 'Hello', tokenCount: 10 },
        { role: 'assistant', content: 'Hi there', tokenCount: 15 },
      ];

      const result = await TestClient.getMessagesWithinTokenLimit({
        messages,
      });

      expect(result.context).toHaveLength(2);
      expect(result.remainingContextTokens).toBe(22); // 50 - 10 - 15 - 3(assistant label)
      expect(result.messagesToRefine).toHaveLength(0);
    });

    test('should work correctly without instructions (2/2)', async () => {
      TestClient.maxContextTokens = 30;
      const messages = [
        { role: 'user', content: 'Hello', tokenCount: 10 },
        { role: 'assistant', content: 'Hi there', tokenCount: 20 },
      ];

      const result = await TestClient.getMessagesWithinTokenLimit({
        messages,
      });

      expect(result.context).toHaveLength(1);
      expect(result.remainingContextTokens).toBe(7);
      expect(result.messagesToRefine).toHaveLength(1);
    });

    test('should handle case when only instructions fit within limit', async () => {
      TestClient.maxContextTokens = 25;
      const instructions = {
        role: 'system',
        content: 'System instructions',
        tokenCount: 20,
      };

      const messages = [
        instructions,
        { role: 'user', content: 'Hello', tokenCount: 10 },
        { role: 'assistant', content: 'Hi there', tokenCount: 15 },
      ];

      const result = await TestClient.getMessagesWithinTokenLimit({
        messages,
        instructions,
      });

      expect(result.context).toHaveLength(1);
      expect(result.context[0]).toBe(instructions);
      expect(result.messagesToRefine).toHaveLength(2);
      expect(result.remainingContextTokens).toBe(2); // 25 - 20 - 3(assistant label)
    });
  });

  describe('sendMessage file population', () => {
    const attachment = {
      file_id: 'file-abc',
      filename: 'image.png',
      filepath: '/uploads/image.png',
      type: 'image/png',
      bytes: 1024,
      object: 'file',
      user: 'user-1',
      embedded: false,
      usage: 0,
      text: 'large ocr blob that should be stripped',
      _id: 'mongo-id-1',
    };

    beforeEach(() => {
      TestClient.options.req = { body: { files: [{ file_id: 'file-abc' }] } };
      TestClient.options.attachments = [attachment];
    });

    test('populates userMessage.files before saveMessageToDatabase is called', async () => {
      TestClient.saveMessageToDatabase = jest.fn().mockImplementation((msg) => {
        return Promise.resolve({ message: msg });
      });

      await TestClient.sendMessage('Hello');

      const userSave = TestClient.saveMessageToDatabase.mock.calls.find(
        ([msg]) => msg.isCreatedByUser,
      );
      expect(userSave).toBeDefined();
      expect(userSave[0].files).toBeDefined();
      expect(userSave[0].files).toHaveLength(1);
      expect(userSave[0].files[0].file_id).toBe('file-abc');
    });

    test('populates assistant response files from generated attachments before save', async () => {
      TestClient.artifactPromises = [Promise.resolve(attachment)];
      TestClient.saveMessageToDatabase = jest.fn().mockResolvedValue({ message: {} });

      await TestClient.sendMessage('Hello');

      const assistantSave = TestClient.saveMessageToDatabase.mock.calls.find(
        ([msg]) => msg?.isCreatedByUser === false,
      );
      expect(assistantSave).toBeDefined();
      expect(assistantSave[0].attachments).toBeDefined();
      expect(assistantSave[0].attachments).toHaveLength(1);
      expect(assistantSave[0].files).toBeDefined();
      expect(assistantSave[0].files).toHaveLength(1);
      expect(assistantSave[0].files[0].file_id).toBe('file-abc');
      expect(assistantSave[0].files[0].text).toBeUndefined();
      expect(assistantSave[0].files[0]._id).toBeUndefined();
    });

    test('strips text and _id from files before saving', async () => {
      TestClient.saveMessageToDatabase = jest.fn().mockResolvedValue({ message: {} });

      await TestClient.sendMessage('Hello');

      const userSave = TestClient.saveMessageToDatabase.mock.calls.find(
        ([msg]) => msg.isCreatedByUser,
      );
      expect(userSave[0].files[0].text).toBeUndefined();
      expect(userSave[0].files[0]._id).toBeUndefined();
      expect(userSave[0].files[0].filename).toBe('image.png');
    });

    test('deletes image_urls from userMessage when files are present', async () => {
      TestClient.saveMessageToDatabase = jest.fn().mockResolvedValue({ message: {} });
      TestClient.options.attachments = [
        { ...attachment, image_urls: ['data:image/png;base64,...'] },
      ];

      await TestClient.sendMessage('Hello');

      const userSave = TestClient.saveMessageToDatabase.mock.calls.find(
        ([msg]) => msg.isCreatedByUser,
      );
      expect(userSave[0].image_urls).toBeUndefined();
    });

    test('does not set files when no attachments match request file IDs', async () => {
      TestClient.options.req = { body: { files: [{ file_id: 'file-nomatch' }] } };
      TestClient.saveMessageToDatabase = jest.fn().mockResolvedValue({ message: {} });

      await TestClient.sendMessage('Hello');

      const userSave = TestClient.saveMessageToDatabase.mock.calls.find(
        ([msg]) => msg.isCreatedByUser,
      );
      expect(userSave[0].files).toBeUndefined();
    });

    test('skips file population when attachments is not an array (Promise case)', async () => {
      TestClient.options.attachments = Promise.resolve([attachment]);
      TestClient.saveMessageToDatabase = jest.fn().mockResolvedValue({ message: {} });

      await TestClient.sendMessage('Hello');

      const userSave = TestClient.saveMessageToDatabase.mock.calls.find(
        ([msg]) => msg.isCreatedByUser,
      );
      expect(userSave[0].files).toBeUndefined();
    });

    test('skips file population when skipSaveUserMessage is true', async () => {
      TestClient.skipSaveUserMessage = true;
      TestClient.saveMessageToDatabase = jest.fn().mockResolvedValue({ message: {} });

      await TestClient.sendMessage('Hello');

      const userSave = TestClient.saveMessageToDatabase.mock.calls.find(
        ([msg]) => msg?.isCreatedByUser,
      );
      expect(userSave).toBeUndefined();
    });

    test('ignores file_id: undefined entries in req.body.files (no set poisoning)', async () => {
      TestClient.options.req = {
        body: { files: [{ file_id: undefined }, { file_id: 'file-abc' }] },
      };
      TestClient.options.attachments = [
        { ...attachment, file_id: undefined },
        { ...attachment, file_id: 'file-abc' },
      ];
      TestClient.saveMessageToDatabase = jest.fn().mockResolvedValue({ message: {} });

      await TestClient.sendMessage('Hello');

      const userSave = TestClient.saveMessageToDatabase.mock.calls.find(
        ([msg]) => msg.isCreatedByUser,
      );
      expect(userSave[0].files).toHaveLength(1);
      expect(userSave[0].files[0].file_id).toBe('file-abc');
    });

    test('persists a failed document parse response without starting the model', async () => {
      TestClient.options.endpoint = 'SanSuoMain';
      TestClient.clientName = EModelEndpoint.agents;
      TestClient.options.req = {
        body: {
          sansuoMode: 'deep',
          files: [{ file_id: 'file-pdf' }],
        },
      };
      TestClient.options.attachments = [
        {
          ...attachment,
          file_id: 'file-pdf',
          filename: '方案.pdf',
          type: 'application/pdf',
        },
      ];
      TestClient.options.sansuoProcessTiming = {
        startedAtMs: 1000,
        answerStartedAtMs: 36000,
      };
      TestClient.waitForSanSuoDocumentPreparse = jest
        .fn()
        .mockRejectedValue(new Error('未生成可读取内容'));
      TestClient.saveMessageToDatabase = jest.fn().mockResolvedValue({ message: {} });
      const onSanSuoFileParseStatus = jest.fn();

      const response = await TestClient.sendMessage('总结这个文件', {
        onSanSuoFileParseStatus,
      });

      expect(TestClient.sendCompletion).not.toHaveBeenCalled();
      expect(TestClient.buildMessages).not.toHaveBeenCalled();
      expect(response.text).toContain('文件解析失败，尚未启动模型');
      expect(response.metadata.sansuoFileParse).toEqual(
        expect.objectContaining({ status: 'failed', files: 1 }),
      );
      expect(response.metadata.sansuoProcessTiming).toEqual({
        startedAt: '1970-01-01T00:00:01.000Z',
        completedAt: '1970-01-01T00:00:36.000Z',
        elapsedMs: 35000,
      });
      expect(response.content[0].tool_call).toEqual(
        expect.objectContaining({ name: 'sansuo_file_parse', status: 'failed', progress: 1 }),
      );
      expect(onSanSuoFileParseStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: expect.objectContaining({ status: 'failed', files: 1 }),
        }),
      );
      const assistantSave = TestClient.saveMessageToDatabase.mock.calls.find(
        ([msg]) => msg?.isCreatedByUser === false,
      );
      expect(assistantSave).toBeDefined();
    });

    test('reuses persisted DOCX text context without reading the original file twice', async () => {
      TestClient.options.endpoint = 'SanSuoMain';
      TestClient.options.req = { user: { id: 'user-123' }, body: {} };
      const docxAttachment = {
        file_id: 'docx-root-1',
        filename: '总结.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        metadata: {
          codeEnvRef: {
            storage_session_id: 'source-session',
            file_id: 'source-file',
          },
        },
      };
      getSanSuoFiles.mockResolvedValue([
        {
          displayFilename: '总结_preparse_docx_blocks.jsonl',
          sandboxSessionId: 'artifact-session',
          sandboxFileId: 'blocks-file',
          metadata: {
            artifactKind: 'docx_preparse_artifact',
            rootSourceLibreFileId: 'docx-root-1',
          },
        },
      ]);
      const blocks = Buffer.from(
        [
          JSON.stringify({ type: 'text', paragraph_index: 1, text: '第一段' }),
          JSON.stringify({ type: 'image', image_index: 1 }),
          JSON.stringify({ type: 'text', paragraph_index: 2, text: '第二段' }),
        ].join('\n'),
      );
      mockNodeFetch.mockResolvedValue({
        ok: true,
        buffer: async () => blocks,
      });

      const firstMessage = { text: '普通问题' };
      const secondMessage = { text: '普通问题' };
      await TestClient.addFileContextToMessage(firstMessage, [docxAttachment]);
      await TestClient.addFileContextToMessage(secondMessage, [docxAttachment]);

      expect(firstMessage.fileContext).toContain('[paragraph=1]\n第一段');
      expect(firstMessage.fileContext).toContain('[paragraph=2]\n第二段');
      expect(secondMessage.fileContext).toBe(firstMessage.fileContext);
      expect(getSanSuoFiles).toHaveBeenCalledTimes(1);
      expect(mockNodeFetch).toHaveBeenCalledTimes(1);
    });

    test('DOCX visual questions reuse persisted images, select later images, and never reparse', async () => {
      TestClient.options.endpoint = 'SanSuoMain';
      TestClient.options.req = { user: { id: 'user-123' }, body: {} };
      const attachment = {
        file_id: 'docx-visual-root',
        filename: '流程.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        metadata: { codeEnvRef: { storage_session_id: 'source-session', file_id: 'source' } },
      };
      const record = (name, id, kind = 'docx_preparse_artifact') => ({
        displayFilename: name,
        sandboxSessionId: 'artifact-session',
        sandboxFileId: id,
        metadata: { artifactKind: kind, rootSourceLibreFileId: attachment.file_id },
      });
      getSanSuoFiles.mockResolvedValue([
        record('流程_preparse_docx_blocks.jsonl', 'blocks'),
        record('流程_preparse_docx_manifest.json', 'manifest'),
        record('流程_preparse_docx_image_0020.png', 'image20', 'docx_extracted_image'),
      ]);
      const oldBase = process.env.QWEN_BASE_URL;
      const oldKey = process.env.QWEN_API_KEY;
      process.env.QWEN_BASE_URL = 'https://vision.example.test/v1';
      process.env.QWEN_API_KEY = 'test-key';
      mockNodeFetch.mockClear();
      mockNodeFetch.mockImplementation(async (url) => ({
        ok: true,
        buffer: async () =>
          Buffer.from(
            String(url).includes('manifest')
              ? JSON.stringify({
                  images: [
                    { image_index: 1, persistent_export: '流程_preparse_docx_image_0001.bin' },
                    { image_index: 20, persistent_export: '流程_preparse_docx_image_0020.png' },
                  ],
                })
              : String(url).includes('image20')
                ? 'saved-image'
                : JSON.stringify({ type: 'text', text: '正文' }),
          ),
        json: async () => ({ choices: [{ message: { content: '图20是审批流程' } }] }),
      }));
      try {
        const plain = { text: '总结这个文件' };
        await TestClient.addFileContextToMessage(plain, [attachment], {
          persistVisualContext: false,
        });
        expect(plain.fileContext).not.toContain('Attached DOCX image');
        expect(
          mockNodeFetch.mock.calls.some(([url]) => String(url).includes('chat/completions')),
        ).toBe(false);

        const image = { text: '总结这个文件' };
        await TestClient.addFileContextToMessage(image, [attachment], {
          persistVisualContext: false,
          queryText: '给我展示第20张图并解释',
        });
        expect(image.fileContext).toContain('图20是审批流程');
        expect(image.metadata.sansuoVisualArtifacts[0].imageIndex).toBe(20);
        expect(TestClient.options.req._sansuoRequestedDocxImageArtifacts).toEqual([
          expect.objectContaining({ imageIndex: 20, file_id: 'image20' }),
        ]);

        const missing = { text: '第一张图是什么' };
        await TestClient.addFileContextToMessage(missing, [attachment], {
          persistVisualContext: false,
        });
        expect(missing.fileContext).toContain('没有可用的持久图像');
        expect(missing.fileContext).not.toContain('图20是审批流程');
        expect(
          mockNodeFetch.mock.calls.filter(([url]) => String(url).includes('chat/completions')),
        ).toHaveLength(1);
        expect(mockNodeFetch.mock.calls.some(([url]) => /\/exec$/.test(String(url)))).toBe(false);
      } finally {
        if (oldBase === undefined) delete process.env.QWEN_BASE_URL;
        else process.env.QWEN_BASE_URL = oldBase;
        if (oldKey === undefined) delete process.env.QWEN_API_KEY;
        else process.env.QWEN_API_KEY = oldKey;
      }
    });

    test('missing DOCX visual artifacts do not trigger sandbox fallback', async () => {
      TestClient.options.endpoint = 'SanSuoMain';
      TestClient.options.req = { user: { id: 'user-123' }, body: {} };
      getSanSuoFiles.mockResolvedValue([]);
      mockNodeFetch.mockClear();
      const message = { text: '图片中写了什么' };
      await TestClient.addFileContextToMessage(
        message,
        [
          {
            file_id: 'missing-docx',
            filename: '缺图.docx',
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            metadata: { codeEnvRef: { storage_session_id: 'session', file_id: 'file' } },
          },
        ],
        { persistVisualContext: false },
      );
      expect(message.fileContext).toContain('持久图片产物缺失或不可读取');
      expect(mockNodeFetch.mock.calls.some(([url]) => /\/exec$/.test(String(url)))).toBe(false);
    });

    test('missing PDF artifacts never fall back to the generic sandbox reader', async () => {
      TestClient.options.endpoint = 'SanSuoMain';
      TestClient.options.req = {
        user: { id: 'user-123' },
        body: { conversationId: 'conversation-missing-pdf' },
      };
      getSanSuoFiles.mockResolvedValue([]);
      mockNodeFetch.mockClear();
      const message = {
        conversationId: 'conversation-missing-pdf',
        text: '第1页图里写了什么？',
      };
      await TestClient.addFileContextToMessage(
        message,
        [
          {
            file_id: 'missing-pdf',
            filename: '缺失解析.pdf',
            type: 'application/pdf',
            metadata: { codeEnvRef: { storage_session_id: 'session', file_id: 'file' } },
          },
        ],
        { persistVisualContext: false },
      );
      expect(message.fileContext).toContain('PDF 的后端持久页面产物缺失或不可读');
      expect(mockNodeFetch.mock.calls.some(([url]) => /\/exec$/.test(String(url)))).toBe(false);
    });

    test('batches persisted fitz PDF pages by 20 and selects an explicitly requested page', async () => {
      TestClient.options.endpoint = 'SanSuoMain';
      TestClient.options.req = {
        user: { id: 'user-123' },
        body: { conversationId: 'conversation-fitz' },
      };
      upsertSanSuoFileRecord.mockResolvedValue({});
      const attachment = {
        file_id: 'pdf-fitz-root',
        filename: '扫描手册.pdf',
        type: 'application/pdf',
      };
      const record = (name, id, kind) => ({
        displayFilename: name,
        sandboxSessionId: 'artifact-session',
        sandboxFileId: id,
        metadata: { artifactKind: kind, rootSourceLibreFileId: attachment.file_id },
      });
      getSanSuoFiles.mockResolvedValue([
        record('扫描手册_preparse_visual_manifest.json', 'manifest', 'pdf_preparse_artifact'),
        ...Array.from({ length: 25 }, (_unused, index) =>
          record(
            `扫描手册_preparse_visual_page_${String(index + 1).padStart(4, '0')}.png`,
            `page-${index + 1}`,
            'pdf_extracted_image',
          ),
        ),
      ]);
      const oldBase = process.env.QWEN_BASE_URL;
      const oldKey = process.env.QWEN_API_KEY;
      process.env.QWEN_BASE_URL = 'https://vision.example.test/v1';
      process.env.QWEN_API_KEY = 'test-key';
      mockNodeFetch.mockClear();
      mockNodeFetch.mockImplementation(async (url, options) => {
        if (String(url).includes('chat/completions')) {
          const content = JSON.parse(options.body).messages[0].content;
          const pages = content
            .filter((item) => item.type === 'text')
            .map((item) => String(item.text).match(/^第(\d+)页$/))
            .filter(Boolean)
            .map((match) => Number(match[1]));
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      pages: pages.map((page) => ({
                        page,
                        summary: `第${page}页视觉证据`,
                        keywords: [`主题${page}`],
                      })),
                      batch_summary: '本批共同主题',
                    }),
                  },
                },
              ],
            }),
          };
        }
        return { ok: true, buffer: async () => Buffer.from('page-image') };
      });
      try {
        const summary = { text: '总结这份扫描PDF' };
        await TestClient.addFileContextToMessage(summary, [attachment], {
          persistVisualContext: false,
        });
        const summaryCalls = mockNodeFetch.mock.calls.filter(([url]) =>
          String(url).includes('chat/completions'),
        );
        expect(summaryCalls).toHaveLength(2);
        expect(JSON.parse(summaryCalls[0][1].body).messages[0].content).toHaveLength(41);
        expect(JSON.parse(summaryCalls[1][1].body).messages[0].content).toHaveLength(11);
        expect(summary.fileContext).toContain('Visual index: 25/25 pages');
        expect(summary.fileContext).toContain('Indexed page 1');
        expect(summary.fileContext).toContain('Indexed page 20');
        expect(summary.fileContext).not.toContain('Indexed page 21');
        expect(upsertSanSuoFileRecord).toHaveBeenCalledTimes(2);
        expect(upsertSanSuoFileRecord).toHaveBeenLastCalledWith(
          expect.objectContaining({
            conversationId: 'conversation-fitz',
            metadata: expect.objectContaining({
              artifactKind: 'pdf_visual_summary',
              rootSourceLibreFileId: 'pdf-fitz-root',
              visualIndex: expect.objectContaining({ complete: true, indexedPages: 25 }),
            }),
          }),
        );
        expect(TestClient.options.req.body._sansuoPersistedPdfContextReady).toBe(true);
        expect(mockNodeFetch.mock.calls.some(([url]) => /\/exec$/.test(String(url)))).toBe(false);
      } finally {
        if (oldBase === undefined) delete process.env.QWEN_BASE_URL;
        else process.env.QWEN_BASE_URL = oldBase;
        if (oldKey === undefined) delete process.env.QWEN_API_KEY;
        else process.env.QWEN_API_KEY = oldKey;
      }
    });

    test('completes the fitz index in batches while exposing only the requested page', async () => {
      TestClient.options.endpoint = 'SanSuoMain';
      TestClient.options.req = {
        user: { id: 'user-123' },
        body: { conversationId: 'conversation-fitz-page' },
      };
      upsertSanSuoFileRecord.mockResolvedValue({});
      const attachment = {
        file_id: 'pdf-fitz-page-root',
        filename: '扫描手册.pdf',
        type: 'application/pdf',
      };
      const metadata = (kind) => ({
        artifactKind: kind,
        rootSourceLibreFileId: attachment.file_id,
      });
      getSanSuoFiles.mockResolvedValue([
        {
          displayFilename: '扫描手册_preparse_visual_manifest.json',
          sandboxSessionId: 'artifact-session',
          sandboxFileId: 'manifest',
          metadata: metadata('pdf_preparse_artifact'),
        },
        ...Array.from({ length: 25 }, (_unused, index) => ({
          displayFilename: `扫描手册_preparse_visual_page_${String(index + 1).padStart(4, '0')}.png`,
          sandboxSessionId: 'artifact-session',
          sandboxFileId: `page-${index + 1}`,
          metadata: metadata('pdf_extracted_image'),
        })),
      ]);
      const oldBase = process.env.QWEN_BASE_URL;
      const oldKey = process.env.QWEN_API_KEY;
      process.env.QWEN_BASE_URL = 'https://vision.example.test/v1';
      process.env.QWEN_API_KEY = 'test-key';
      mockNodeFetch.mockImplementation(async (url, options) => {
        if (String(url).includes('chat/completions')) {
          const content = JSON.parse(options.body).messages[0].content;
          const pages = content
            .filter((item) => item.type === 'text')
            .map((item) => String(item.text).match(/^第(\d+)页$/))
            .filter(Boolean)
            .map((match) => Number(match[1]));
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      pages: pages.map((page) => ({
                        page,
                        summary: `第${page}页视觉证据`,
                        keywords: page === 23 ? ['检修'] : [`主题${page}`],
                      })),
                      batch_summary: '分批视觉摘要',
                    }),
                  },
                },
              ],
            }),
          };
        }
        return { ok: true, buffer: async () => Buffer.from('page-image') };
      });
      try {
        const message = { text: '第23页写了什么？' };
        await TestClient.addFileContextToMessage(message, [attachment], {
          persistVisualContext: false,
        });
        const calls = mockNodeFetch.mock.calls.filter(([url]) =>
          String(url).includes('chat/completions'),
        );
        expect(calls).toHaveLength(2);
        expect(JSON.parse(calls[0][1].body).messages[0].content).toHaveLength(41);
        expect(JSON.parse(calls[1][1].body).messages[0].content).toHaveLength(11);
        expect(message.fileContext).toContain('Indexed page 23');
        expect(message.fileContext).not.toContain('Indexed page 22');
        expect(message.fileContext).toContain('Index status: complete');
        expect(upsertSanSuoFileRecord).toHaveBeenCalledTimes(2);
        expect(upsertSanSuoFileRecord).toHaveBeenLastCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              visualIndex: expect.objectContaining({ complete: true, indexedPages: 25 }),
            }),
          }),
        );
        expect(mockNodeFetch.mock.calls.some(([url]) => /\/exec$/.test(String(url)))).toBe(false);
      } finally {
        if (oldBase === undefined) delete process.env.QWEN_BASE_URL;
        else process.env.QWEN_BASE_URL = oldBase;
        if (oldKey === undefined) delete process.env.QWEN_API_KEY;
        else process.env.QWEN_API_KEY = oldKey;
      }
    });

    test('retrieves a persisted fitz VL index within the current conversation and reviews only matching pages', async () => {
      TestClient.options.endpoint = 'SanSuoMain';
      TestClient.options.req = {
        user: { id: 'user-123' },
        body: { conversationId: 'conversation-index-reuse' },
      };
      const attachment = {
        file_id: 'pdf-fitz-reuse-root',
        filename: '设备手册.pdf',
        type: 'application/pdf',
      };
      const baseMetadata = { rootSourceLibreFileId: attachment.file_id };
      const records = [
        {
          displayFilename: '设备手册_preparse_visual_manifest.json',
          metadata: { ...baseMetadata, artifactKind: 'pdf_preparse_artifact' },
        },
        ...[1, 2, 3].map((page) => ({
          displayFilename: `设备手册_preparse_visual_page_${String(page).padStart(4, '0')}.png`,
          sandboxSessionId: 'artifact-session',
          sandboxFileId: `page-${page}`,
          metadata: { ...baseMetadata, artifactKind: 'pdf_extracted_image' },
        })),
        {
          displayFilename: '设备手册_visual_vl_index.json',
          metadata: {
            ...baseMetadata,
            artifactKind: 'pdf_visual_summary',
            visualIndex: {
              version: 'pdf-visual-index-v1',
              complete: true,
              pages: [
                { page: 1, summary: '封面和目录', keywords: ['目录'] },
                { page: 2, summary: '泵阀检修周期为三个月', keywords: ['泵阀', '检修周期'] },
                { page: 3, summary: '电气安全注意事项', keywords: ['电气安全'] },
              ],
            },
          },
        },
      ];
      getSanSuoFiles.mockImplementation(async (filter) =>
        filter.userId === 'user-123' && filter.conversationId === 'conversation-index-reuse'
          ? records
          : [],
      );
      upsertSanSuoFileRecord.mockClear();
      const oldBase = process.env.QWEN_BASE_URL;
      const oldKey = process.env.QWEN_API_KEY;
      process.env.QWEN_BASE_URL = 'https://vision.example.test/v1';
      process.env.QWEN_API_KEY = 'test-key';
      mockNodeFetch.mockClear();
      mockNodeFetch.mockImplementation(async (url) =>
        String(url).includes('chat/completions')
          ? {
              ok: true,
              json: async () => ({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        pages: [
                          { page: 2, summary: '原始第2页确认检修周期为三个月', keywords: ['泵阀'] },
                        ],
                        batch_summary: '检修要求',
                      }),
                    },
                  },
                ],
              }),
            }
          : { ok: true, buffer: async () => Buffer.from('page-image') },
      );
      try {
        const message = {
          conversationId: 'conversation-index-reuse',
          text: '泵阀检修周期是多少？',
        };
        await TestClient.addFileContextToMessage(message, [attachment], {
          persistVisualContext: false,
        });
        const visualQuery = getSanSuoFiles.mock.calls
          .map(([filter]) => filter)
          .find((filter) => filter?.['metadata.artifactKind']?.$in?.includes('pdf_visual_summary'));
        expect(visualQuery).toMatchObject({
          userId: 'user-123',
          conversationId: 'conversation-index-reuse',
        });
        const calls = mockNodeFetch.mock.calls.filter(([url]) =>
          String(url).includes('chat/completions'),
        );
        expect(calls).toHaveLength(1);
        const content = JSON.parse(calls[0][1].body).messages[0].content;
        expect(content.filter((item) => item.type === 'image_url')).toHaveLength(1);
        expect(content).toContainEqual({ type: 'text', text: '第2页' });
        expect(message.fileContext).toContain('Indexed page 2');
        expect(message.fileContext).not.toContain('Indexed page 1');
        expect(message.fileContext).toContain('原始第2页确认检修周期为三个月');
        expect(upsertSanSuoFileRecord).not.toHaveBeenCalled();

        TestClient.options.req.body.conversationId = 'other-conversation';
        const isolatedMessage = {
          conversationId: 'other-conversation',
          text: '泵阀检修周期是多少？',
        };
        await TestClient.addFileContextToMessage(isolatedMessage, [attachment], {
          persistVisualContext: false,
        });
        expect(getSanSuoFiles).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'user-123',
            conversationId: 'other-conversation',
          }),
        );
        expect(isolatedMessage.fileContext || '').not.toContain('泵阀检修周期为三个月');
        expect(isolatedMessage.fileContext || '').not.toContain('Indexed page 2');

        TestClient.options.req.user.id = 'user-456';
        TestClient.options.req.body.conversationId = 'conversation-index-reuse';
        const otherUserMessage = {
          conversationId: 'conversation-index-reuse',
          text: '泵阀检修周期是多少？',
        };
        await TestClient.addFileContextToMessage(otherUserMessage, [attachment], {
          persistVisualContext: false,
        });
        expect(getSanSuoFiles).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'user-456',
            conversationId: 'conversation-index-reuse',
          }),
        );
        expect(otherUserMessage.fileContext || '').not.toContain('泵阀检修周期为三个月');
        expect(otherUserMessage.fileContext || '').not.toContain('Indexed page 2');
      } finally {
        if (oldBase === undefined) delete process.env.QWEN_BASE_URL;
        else process.env.QWEN_BASE_URL = oldBase;
        if (oldKey === undefined) delete process.env.QWEN_API_KEY;
        else process.env.QWEN_API_KEY = oldKey;
      }
    });

    test.each([
      {
        label: 'PDF MinerU Markdown',
        attachment: { file_id: 'pdf-root-1', filename: '规范.pdf', type: 'application/pdf' },
        artifactName: '规范_preparse_mineru.md',
        artifactKind: 'pdf_mineru_markdown',
        artifactBody: '# 第一章\n\n这是 MinerU 解析正文。',
        expectedText: '这是 MinerU 解析正文',
      },
      {
        label: 'XLSX rows',
        attachment: {
          file_id: 'xlsx-root-1',
          filename: '人员.xlsx',
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        artifactName: '人员_preparse_tabular_rows.jsonl',
        artifactKind: 'tabular_preparse_artifact',
        artifactBody: JSON.stringify({ sheet: '名单', row: 2, cells: ['张三', 18] }),
        expectedText: 'Sheet 名单, row 2: 张三 | 18',
      },
      {
        label: 'CSV rows',
        attachment: { file_id: 'csv-root-1', filename: '数据.csv', type: 'text/csv' },
        artifactName: '数据_preparse_tabular_rows.jsonl',
        artifactKind: 'tabular_preparse_artifact',
        artifactBody: JSON.stringify({ sheet: '数据', row: 3, cells: ['项目A', 42] }),
        expectedText: 'Sheet 数据, row 3: 项目A | 42',
      },
      {
        label: 'Markdown blocks',
        attachment: { file_id: 'md-root-1', filename: '说明.md', type: 'text/markdown' },
        artifactName: '说明_preparse_text_blocks.jsonl',
        artifactKind: 'text_preparse_artifact',
        artifactBody: JSON.stringify({ type: 'text', text: '# 使用说明\n直接读取。' }),
        expectedText: '# 使用说明\n直接读取。',
      },
      {
        label: 'plain-text blocks',
        attachment: { file_id: 'txt-root-1', filename: '记录.txt', type: 'text/plain' },
        artifactName: '记录_preparse_text_blocks.jsonl',
        artifactKind: 'text_preparse_artifact',
        artifactBody: JSON.stringify({ type: 'text', text: '第一条记录' }),
        expectedText: '第一条记录',
      },
    ])('reuses persisted $label context without reading the original file', async (fixture) => {
      TestClient.options.endpoint = 'SanSuoMain';
      TestClient.options.req = { user: { id: 'user-123' }, body: {} };
      getSanSuoFiles.mockResolvedValue([
        {
          displayFilename: fixture.artifactName,
          sandboxSessionId: 'artifact-session',
          sandboxFileId: 'artifact-file',
          metadata: {
            artifactKind: fixture.artifactKind,
            rootSourceLibreFileId: fixture.attachment.file_id,
          },
        },
      ]);
      mockNodeFetch.mockResolvedValue({
        ok: true,
        buffer: async () => Buffer.from(fixture.artifactBody),
      });

      const message = { text: '总结附件' };
      await TestClient.addFileContextToMessage(message, [fixture.attachment]);

      expect(message.fileContext).toContain(fixture.expectedText);
      expect(getSanSuoFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          'metadata.rootSourceLibreFileId': { $in: [fixture.attachment.file_id] },
        }),
      );
      expect(mockNodeFetch).toHaveBeenCalledTimes(1);
      expect(mockNodeFetch.mock.calls[0][0]).toContain('artifact-file');
    });

    test('retrieves a relevant late MinerU chunk instead of truncating a long PDF prefix', async () => {
      TestClient.options.endpoint = 'SanSuoMain';
      TestClient.options.req = { user: { id: 'user-123' }, body: {} };
      const attachment = {
        file_id: 'pdf-long-keyword',
        filename: '百页规范.pdf',
        type: 'application/pdf',
      };
      getSanSuoFiles.mockResolvedValue([
        {
          displayFilename: '百页规范_preparse_mineru_chunks.jsonl',
          sandboxSessionId: 'artifact-session',
          sandboxFileId: 'chunks-file',
          metadata: {
            artifactKind: 'pdf_mineru_chunks',
            rootSourceLibreFileId: attachment.file_id,
          },
        },
      ]);
      const chunks = Array.from({ length: 100 }, (_unused, index) =>
        JSON.stringify({
          chunk_id: `mineru-${index + 1}`,
          text:
            index === 89
              ? '第九十块：项目特别预算审批金额为五十万元。'
              : `第${index + 1}块普通内容。${'甲'.repeat(900)}`,
        }),
      ).join('\n');
      mockNodeFetch.mockResolvedValue({ ok: true, buffer: async () => Buffer.from(chunks) });

      const message = { text: '项目特别预算审批金额是多少？' };
      await TestClient.addFileContextToMessage(message, [attachment]);

      expect(message.fileContext).toContain('项目特别预算审批金额为五十万元');
      expect([...TestClient.options.req._sansuoPdfReadSources.values()][0].records.some((r) => r.sourceChunkId === 'mineru-90')).toBe(true);
      expect(message.fileContext).toContain('do not call execute_code');
    });

    test('selects a requested PDF page and its neighboring chunks when page metadata exists', async () => {
      TestClient.options.endpoint = 'SanSuoMain';
      TestClient.options.req = { user: { id: 'user-123' }, body: {} };
      const attachment = {
        file_id: 'pdf-page-query',
        filename: '分页手册.pdf',
        type: 'application/pdf',
      };
      getSanSuoFiles.mockResolvedValue([
        {
          displayFilename: '分页手册_preparse_mineru_chunks.jsonl',
          sandboxSessionId: 'artifact-session',
          sandboxFileId: 'page-chunks-file',
          metadata: {
            artifactKind: 'pdf_mineru_chunks',
            rootSourceLibreFileId: attachment.file_id,
          },
        },
      ]);
      const chunks = Array.from({ length: 100 }, (_unused, index) =>
        JSON.stringify({
          chunk_id: `p${index + 1}-1`,
          page_start: index + 1,
          page_end: index + 1,
          text: index === 72 ? '第73页的独有条款内容。' : `第${index + 1}页普通内容。`,
        }),
      ).join('\n');
      mockNodeFetch.mockResolvedValue({ ok: true, buffer: async () => Buffer.from(chunks) });

      const message = { text: '第73页说了什么？' };
      await TestClient.addFileContextToMessage(message, [attachment]);

      expect(message.fileContext).toContain('page=73 kind=extracted_text');
      expect([...TestClient.options.req._sansuoPdfReadSources.values()][0].records.some((r) => r.sourceChunkId === 'p73-1')).toBe(true);
      expect(message.fileContext).toContain('第73页的独有条款内容');
      expect(message.fileContext).not.toContain('第1页普通内容');
    });

    test('reviews only the requested MinerU page image and ignores extracted figures', async () => {
      TestClient.options.endpoint = 'SanSuoMain';
      TestClient.options.req = {
        user: { id: 'user-123' },
        body: { conversationId: 'conversation-mineru-page-review' },
      };
      const attachment = {
        file_id: 'pdf-mineru-page-review',
        filename: '分页手册.pdf',
        type: 'application/pdf',
      };
      const metadata = { rootSourceLibreFileId: attachment.file_id };
      getSanSuoFiles.mockResolvedValue([
        {
          displayFilename: '分页手册_preparse_mineru_chunks.jsonl',
          sandboxSessionId: 'artifact-session',
          sandboxFileId: 'chunks-file',
          metadata: { ...metadata, artifactKind: 'pdf_mineru_chunks' },
        },
        {
          displayFilename: '分页手册_preparse_mineru_images__figure.png',
          sandboxSessionId: 'artifact-session',
          sandboxFileId: 'figure-file',
          metadata: { ...metadata, artifactKind: 'pdf_extracted_image' },
        },
        {
          displayFilename: '分页手册_preparse_review_page_0073.png',
          sandboxSessionId: 'artifact-session',
          sandboxFileId: 'review-page-73',
          metadata: { ...metadata, artifactKind: 'pdf_extracted_image' },
        },
      ]);
      const chunks = [72, 73, 74]
        .map((page) =>
          JSON.stringify({
            chunk_id: `p${page}-1`,
            page_start: page,
            page_end: page,
            text: page === 73 ? '第73页的独有条款内容。' : `第${page}页普通内容。`,
          }),
        )
        .join('\n');
      const oldBase = process.env.QWEN_BASE_URL;
      const oldKey = process.env.QWEN_API_KEY;
      process.env.QWEN_BASE_URL = 'https://vision.example.test/v1';
      process.env.QWEN_API_KEY = 'test-key';
      mockNodeFetch.mockImplementation(async (url) => {
        const value = String(url);
        if (value.includes('chat/completions')) {
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      pages: [{ page: 73, summary: '原始第73页确认条款', keywords: ['条款'] }],
                      batch_summary: '第73页复核',
                    }),
                  },
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          buffer: async () => Buffer.from(value.includes('chunks-file') ? chunks : 'page-image'),
        };
      });
      try {
        const message = {
          conversationId: 'conversation-mineru-page-review',
          text: '第73页说了什么？',
        };
        await TestClient.addFileContextToMessage(message, [attachment], {
          persistVisualContext: false,
        });

        const visionCall = mockNodeFetch.mock.calls.find(([url]) =>
          String(url).includes('chat/completions'),
        );
        const content = JSON.parse(visionCall[1].body).messages[0].content;
        expect(content.filter((item) => item.type === 'image_url')).toHaveLength(1);
        expect(content.find((item) => item.type === 'text')?.text).toContain('页码：73');
        expect(message.fileContext).toContain('原始第73页确认条款');
        expect(mockNodeFetch.mock.calls.some(([url]) => String(url).includes('figure-file'))).toBe(
          false,
        );
      } finally {
        if (oldBase === undefined) delete process.env.QWEN_BASE_URL;
        else process.env.QWEN_BASE_URL = oldBase;
        if (oldKey === undefined) delete process.env.QWEN_API_KEY;
        else process.env.QWEN_API_KEY = oldKey;
      }
    });

    test('samples the beginning, middle, and end for a whole-document PDF summary', async () => {
      TestClient.options.endpoint = 'SanSuoMain';
      TestClient.options.req = { user: { id: 'user-123' }, body: {} };
      const attachment = {
        file_id: 'pdf-whole-summary',
        filename: '长篇报告.pdf',
        type: 'application/pdf',
      };
      getSanSuoFiles.mockResolvedValue([
        {
          displayFilename: '长篇报告_preparse_mineru_chunks.jsonl',
          sandboxSessionId: 'artifact-session',
          sandboxFileId: 'summary-chunks-file',
          metadata: {
            artifactKind: 'pdf_mineru_chunks',
            rootSourceLibreFileId: attachment.file_id,
          },
        },
      ]);
      const chunks = Array.from({ length: 30 }, (_unused, index) => {
        const marker =
          index === 0
            ? '首段覆盖标记'
            : index >= 12 && index <= 17
              ? '中段覆盖标记'
              : index === 29
                ? '尾段覆盖标记'
                : `区段${index + 1}`;
        return JSON.stringify({
          chunk_id: `mineru-${index + 1}`,
          text: `${marker}${'乙'.repeat(3900)}`,
        });
      }).join('\n');
      mockNodeFetch.mockResolvedValue({ ok: true, buffer: async () => Buffer.from(chunks) });

      const message = { text: '请总结这份 PDF 的全文主要内容' };
      await TestClient.addFileContextToMessage(message, [attachment]);

      expect(message.fileContext).toContain('首段覆盖标记');
      expect(message.fileContext).toContain('中段覆盖标记');
      expect(message.fileContext).toContain('尾段覆盖标记');
    });

    test('samples across legacy MinerU Markdown when chunks are unavailable', async () => {
      TestClient.options.endpoint = 'SanSuoMain';
      TestClient.options.req = { user: { id: 'user-123' }, body: {} };
      const attachment = {
        file_id: 'pdf-legacy-markdown',
        filename: '旧扫描件.pdf',
        type: 'application/pdf',
      };
      getSanSuoFiles.mockResolvedValue([
        {
          displayFilename: '旧扫描件_preparse_mineru.md',
          sandboxSessionId: 'artifact-session',
          sandboxFileId: 'legacy-markdown-file',
          metadata: {
            artifactKind: 'pdf_mineru_markdown',
            rootSourceLibreFileId: attachment.file_id,
          },
        },
      ]);
      const markdown = [
        `# 开头\n旧文档首部标记${'丙'.repeat(45000)}`,
        `# 中间\n旧文档中部标记${'丁'.repeat(45000)}`,
        `# 结尾\n旧文档尾部标记${'戊'.repeat(45000)}`,
      ].join('\n\n');
      mockNodeFetch.mockResolvedValue({ ok: true, buffer: async () => Buffer.from(markdown) });

      const message = { text: '概括整份文档' };
      await TestClient.addFileContextToMessage(message, [attachment]);

      expect(message.fileContext).toContain('旧文档首部标记');
      expect(message.fileContext).toContain('旧文档中部标记');
      expect(message.fileContext).toContain('旧文档尾部标记');
    });

    test('binds document readers from metadata before model inference without eager downloads', async () => {
      TestClient.options.req = { user: { id: 'user-123' }, body: { sansuoMode: 'deep' } };
      TestClient.options.agent = { tools: [], toolDefinitions: [], toolRegistry: new Map() };
      getFiles.mockResolvedValue([{ file_id: 'history-pdf', user: 'user-123', filename: 'history.pdf', type: 'application/pdf' }]);
      getSanSuoFiles.mockResolvedValue([{ libreFileId: 'chunks', userId: 'user-123', conversationId: 'history-conversation', status: 'ready',
        displayFilename: 'history_mineru_chunks.jsonl', sandboxSessionId: 's', sandboxFileId: 'b',
        metadata: { rootSourceLibreFileId: 'history-pdf' } }]);
      mockNodeFetch.mockClear();
      const hiddenUserContexts = [];
      await TestClient.prepareSanSuoDocumentTools({ conversationId: 'history-conversation', userMessage: { metadata: {} }, hiddenUserContexts });
      expect(TestClient.options.agent.toolDefinitions.map(t => t.name)).toContain('read_parsed_pdf');
      expect(TestClient.options.agent.toolRegistry.has('read_parsed_pdf')).toBe(true);
      const result = JSON.parse(await TestClient.options.req._sansuoPdfReadTool.invoke({ action: 'list' }));
      expect(result.documents[0].file_id).toBe('history-pdf');
      expect(mockNodeFetch).not.toHaveBeenCalled();
      expect(hiddenUserContexts.join('')).toContain('没有读取正文');
    });

    test('answers a ready DOCX from persisted context without forcing execute_code', async () => {
      TestClient.options.endpoint = 'SanSuoMain';
      TestClient.clientName = EModelEndpoint.agents;
      TestClient.options.req = {
        user: { id: 'user-123' },
        body: {
          sansuoMode: 'deep',
          files: [{ file_id: 'docx-root-ready' }],
        },
      };
      TestClient.options.attachments = [
        {
          file_id: 'docx-root-ready',
          filename: '策划书.docx',
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          metadata: {
            codeEnvRef: { storage_session_id: 'source-session', file_id: 'source-file' },
          },
        },
      ];
      TestClient.options.agent = {
        tools: ['execute_code', 'bash_tool', 'read_file'],
        toolDefinitions: [{ name: 'execute_code' }, { name: 'bash_tool' }],
        toolRegistry: new Map([
          ['execute_code', {}],
          ['bash_tool', {}],
        ]),
      };
      getMessages.mockImplementation(async (filter) => [
        { messageId: filter?.messageId || 'current-message' },
      ]);
      updateMessage.mockClear();
      TestClient.waitForSanSuoDocumentPreparse = jest.fn().mockResolvedValue({
        required: true,
        status: 'ready',
        files: 1,
        artifacts: 3,
      });
      getSanSuoFiles.mockResolvedValue([
        {
          displayFilename: '策划书_preparse_docx_blocks.jsonl',
          sandboxSessionId: 'artifact-session',
          sandboxFileId: 'blocks-file',
          metadata: {
            artifactKind: 'docx_preparse_artifact',
            rootSourceLibreFileId: 'docx-root-ready',
          },
        },
        {
          displayFilename: '策划书_preparse_docx_manifest.json',
          sandboxSessionId: 'artifact-session',
          sandboxFileId: 'manifest-file',
          metadata: {
            artifactKind: 'docx_preparse_artifact',
            rootSourceLibreFileId: 'docx-root-ready',
          },
        },
      ]);
      mockNodeFetch.mockImplementation(async (url) => ({
        ok: true,
        buffer: async () =>
          Buffer.from(
            String(url).includes('manifest-file')
              ? JSON.stringify({ text_chars: 4, image_count: 0, images: [] })
              : [
                  JSON.stringify({
                    type: 'text',
                    paragraph_index: 1,
                    text: `秋游策划正文${'甲'.repeat(25000)}`,
                  }),
                  JSON.stringify({
                    type: 'text',
                    paragraph_index: 800,
                    text: `${'乙'.repeat(25000)}尾部保密要求：资料回收后登记。`,
                  }),
                ].join('\n'),
          ),
      }));
      TestClient.saveMessageToDatabase = jest.fn().mockResolvedValue({ message: {} });
      TestClient.contentParts = [];
      TestClient.sendCompletion.mockImplementationOnce(async () => {
        TestClient.contentParts.push(
          { type: 'think', think: '分析附件内容' },
          { type: 'text', text: '附件回答正文' },
        );
        return { completion: [...TestClient.contentParts] };
      });
      const onSanSuoFileParseStatus = jest.fn();

      const response = await TestClient.sendMessage('主要说的啥', { onSanSuoFileParseStatus });

      expect(TestClient.sendCompletion).toHaveBeenCalledWith(
        expect.anything(),
        expect.not.objectContaining({ sansuoForceCodeTool: expect.anything() }),
      );
      const completionOptions = TestClient.sendCompletion.mock.calls.at(-1)[1];
      expect(completionOptions.sansuoForceCodeTool).toBeUndefined();
      expect(TestClient.options.req.body._sansuoForceCodeTool).not.toBe(true);
      expect(TestClient.options.req.body._sansuoPersistedDocxContextReady).toBe(true);
      expect(TestClient.options.agent.tools).toEqual(
        expect.arrayContaining([
          'execute_code',
          expect.objectContaining({ name: 'read_parsed_docx' }),
        ]),
      );
      expect(TestClient.options.agent.toolDefinitions.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(['execute_code', 'read_parsed_docx']),
      );
      expect([...TestClient.options.agent.toolRegistry.keys()]).toContain('read_parsed_docx');
      const reader = TestClient.options.req._sansuoDocxReadTool;
      const invoke = async (args) => JSON.parse(await reader.invoke(args));
      const keyword = await invoke({ query: '资料回收后登记', max_chars: 200 });
      expect(keyword).toMatchObject({
        status: 'ok',
        filename: '策划书.docx',
        scope: 'keyword_selection',
        paragraph_start: 800,
      });
      expect(keyword.content).toContain('尾部保密要求');
      expect(updateMessage).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          metadata: expect.objectContaining({
            sansuoDocumentReferences: [
              expect.objectContaining({
                document_id: expect.stringMatching(/^doc_/),
                paragraph_index: 800,
              }),
            ],
          }),
        }),
      );
      const range = await invoke({ paragraph_start: 800, paragraph_end: 800, max_chars: 200 });
      expect(range.content).toContain('[paragraph=800');
      expect(range.truncated).toBe(true);
      const next = await invoke({
        paragraph_start: 800,
        paragraph_end: 800,
        offset: range.next_offset,
        max_chars: 200,
      });
      expect(next.offset).toBe(range.next_offset);
      expect(await invoke({ file_id: 'other-chat-docx' })).toMatchObject({
        status: 'file_selection_required',
        files: [{ file_id: 'docx-root-ready' }],
      });
      const secondWord = buildWordDocument({
        userId: 'user-123',
        fileId: 'docx-second-ready',
        filename: '第二份说明.docx',
        records: [
          {
            index: 0,
            paragraphIndex: 3,
            segmentIndex: 1,
            segmentCount: 1,
            text: '第二份资料专属正文',
          },
        ],
      });
      TestClient.options.req._sansuoDocxReadSources.set(secondWord.documentId, secondWord);
      expect(await invoke({})).toMatchObject({ status: 'file_selection_required' });
      expect((await invoke({ file_id: 'docx-second-ready' })).content).toContain(
        '第二份资料专属正文',
      );
      await expect(reader.invoke({ max_chars: 20001 })).rejects.toThrow();
      expect(onSanSuoFileParseStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: expect.objectContaining({ status: 'completed' }),
        }),
      );
      expect(response.content).toEqual([
        expect.objectContaining({ type: 'think', think: '分析附件内容' }),
        expect.objectContaining({ type: 'text', text: '附件回答正文' }),
      ]);
      expect(response.metadata?.sansuoSources).toEqual([
        expect.objectContaining({
          file_id: 'docx-root-ready',
          filename: '策划书.docx',
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          kind: 'file',
          status: 'ready',
        }),
      ]);
      expect(response.metadata?.sansuoSources[0]).not.toHaveProperty('filepath');
      expect(response.metadata?.sansuoSources[0]).not.toHaveProperty('metadata');
      getMessages.mockReset().mockResolvedValue([]);
    });

    test.each([false, true])(
      'answers a ready PDF without execution (follow-up=%s)',
      async (followUp) => {
        TestClient.options.endpoint = 'SanSuoMain';
        TestClient.clientName = EModelEndpoint.agents;
        TestClient.options.req = {
          user: { id: 'user-123' },
          body: {
            conversationId: 'conversation-pdf-ready',
            sansuoMode: 'deep',
            files: [{ file_id: 'pdf-root-ready' }],
          },
        };
        TestClient.options.attachments = [
          {
            file_id: 'pdf-root-ready',
            filename: '扫描规范.pdf',
            type: 'application/pdf',
            metadata: {
              codeEnvRef: { storage_session_id: 'source-session', file_id: 'source-file' },
            },
          },
        ];
        TestClient.options.attachments[0].user = 'user-123';
        getFiles.mockResolvedValue(TestClient.options.attachments);
        TestClient.options.agent = {
          tools: ['execute_code', 'bash_tool', 'read_file', 'read_parsed_pdf'],
          toolDefinitions: [
            { name: 'execute_code' },
            { name: 'bash_tool' },
            { name: 'read_parsed_pdf' },
          ],
          toolRegistry: new Map([
            ['execute_code', {}],
            ['bash_tool', {}],
            ['read_parsed_pdf', {}],
          ]),
        };
        getMessages.mockImplementation(async (filter) => [
          { messageId: filter?.messageId || 'current-message' },
        ]);
        if (followUp) {
          const files = TestClient.options.attachments;
          TestClient.options.attachments = [];
          TestClient.options.req.body.files = [];
          getFiles.mockResolvedValue(files);
          TestClient.loadHistory.mockImplementation(async () => {
            TestClient.currentMessages = [
              {
                messageId: 'previous-pdf-message',
                isCreatedByUser: true,
                text: '总结这个 PDF',
                files,
              },
            ];
            return TestClient.currentMessages;
          });
          const previousDocument = buildPdfDocument({
            userId: 'user-123',
            fileId: 'pdf-root-ready',
            records: [
              {
                chunk_id: 'p40-1',
                page_start: 40,
                page_end: 40,
                text: '检修周期是三个月。' + '甲乙丙丁'.repeat(6000),
              },
            ],
          });
          getMessages.mockImplementation(async (filter) => {
            if (filter?.conversationId === 'conversation-pdf-ready') {
              return [
                {
                  messageId: 'persisted-reference-message',
                  metadata: {
                    sansuoDocumentReferences: [
                      {
                        document_id: previousDocument.documentId,
                        chunk_id: previousDocument.records[0].chunkId,
                      },
                    ],
                  },
                },
              ];
            }
            return [{ messageId: filter?.messageId || 'current-message' }];
          });
        }
        TestClient.waitForSanSuoDocumentPreparse = jest.fn().mockResolvedValue({
          required: true,
          status: 'ready',
          files: 1,
          artifacts: 4,
        });
        getSanSuoFiles.mockResolvedValue([
          {
            displayFilename: '扫描规范_preparse_mineru_chunks.jsonl',
            sandboxSessionId: 'artifact-session',
            sandboxFileId: 'chunks-file',
            metadata: {
              artifactKind: 'pdf_mineru_chunks',
              rootSourceLibreFileId: 'pdf-root-ready',
            },
          },
        ]);
        mockNodeFetch.mockResolvedValue({
          ok: true,
          buffer: async () =>
            Buffer.from(
              [
                JSON.stringify({
                  chunk_id: 'p1-1',
                  page_start: 1,
                  page_end: 1,
                  text: '扫描 PDF 的持久解析正文',
                }),
                JSON.stringify({
                  chunk_id: 'p40-1',
                  page_start: 40,
                  page_end: 40,
                  text: '检修周期是三个月。' + '甲乙丙丁'.repeat(6000),
                }),
                JSON.stringify({
                  chunk_id: 'p60-1',
                  page_start: 60,
                  page_end: 60,
                  text: '许可证需要双人复核。',
                }),
              ].join('\n'),
            ),
        });
        TestClient.saveMessageToDatabase = jest.fn().mockResolvedValue({ message: {} });
        TestClient.contentParts = [];
        TestClient.sendCompletion.mockImplementationOnce(async () => {
          TestClient.contentParts.push({ type: 'text', text: 'PDF 回答正文' });
          return { completion: [...TestClient.contentParts] };
        });

        await TestClient.sendMessage('总结这个 PDF', {
          conversationId: 'conversation-pdf-ready',
        });

        const completionOptions = TestClient.sendCompletion.mock.calls.at(-1)[1];
        expect(completionOptions.sansuoForceCodeTool).toBeUndefined();
        expect(TestClient.options.req.body._sansuoForceCodeTool).not.toBe(true);
        expect(TestClient.options.req.body._sansuoPersistedPdfContextReady).toBe(true);
        expect(TestClient.options.req.body._sansuoTaskRoute).toBeUndefined();
        expect(TestClient.options.agent.tools).toContain('execute_code');
        expect(TestClient.options.agent.toolDefinitions.map((tool) => tool.name)).toContain(
          'execute_code',
        );
        expect(TestClient.options.req._sansuoPdfReadTool).toBeDefined();
        expect(TestClient.options.req._sansuoPdfReadSources).toBeInstanceOf(Map);
        expect(TestClient.options.agent.toolDefinitions.map((tool) => tool.name)).toContain(
          'read_parsed_pdf',
        );
        const pdfReader = TestClient.options.req._sansuoPdfReadTool;
        const list = JSON.parse(await pdfReader.invoke({ action: 'list' }));
        expect(list.documents).toEqual([
          expect.objectContaining({ filename: '扫描规范.pdf', page_count: 60 }),
        ]);
        const page = JSON.parse(
          await pdfReader.invoke({
            action: 'read',
            document_id: list.documents[0].document_id,
            pages: [40],
            max_chars: 300,
          }),
        );
        expect(page).toMatchObject({ status: 'ok', reference: { page_start: 40 } });
        expect(page.content).toContain('检修周期是三个月');
        if (followUp) {
          const adjacent = JSON.parse(
            await pdfReader.invoke({
              action: 'read_adjacent',
              document_id: list.documents[0].document_id,
            }),
          );
          expect(adjacent).toMatchObject({ status: 'ok' });
          expect(adjacent.content).toContain('检修周期是三个月');
          expect(getMessages).toHaveBeenCalledWith(
            { user: 'user-123', conversationId: 'conversation-pdf-ready' },
            'messageId metadata',
          );
        }
        expect(mockNodeFetch.mock.calls.some(([url]) => String(url).includes('/v1/exec'))).toBe(
          false,
        );
        if (followUp) {
          expect(getFiles).toHaveBeenCalledWith({ file_id: { $in: ['pdf-root-ready'] } }, {}, {});
        }
        getMessages.mockReset().mockResolvedValue([]);
      },
    );
  });
});
