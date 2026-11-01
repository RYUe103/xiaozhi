const {
  getSanSuoCodeExecutionIntent,
  registerSanSuoDocxReadTool,
  registerSanSuoPdfReadTool,
  applySanSuoFastProfile,
  prepareSanSuoDeepCodeCapability,
  restrictSanSuoDeepToolSurface,
} = require('./sansuoToolPolicy');

describe('SanSuo tool policy', () => {
  it('keeps persisted document state without forcing execution', () => {
    expect(
      getSanSuoCodeExecutionIntent({
        body: {
          _sansuoPersistedPdfContextReady: true,
          _sansuoPersistedDocxContextReady: true,
        },
      }),
    ).toMatchObject({
      source: 'model_auto',
      intent: 'auto',
      pdf_read_only: false,
      docx_read_only: false,
      persisted_pdf_context_ready: true,
      persisted_docx_context_ready: true,
    });
    expect(getSanSuoCodeExecutionIntent({ body: {} })).toBeUndefined();
  });

  it('registers a scoped persisted PDF JIT reader', async () => {
    const req = {
      body: { _sansuoPersistedPdfContextReady: true },
      _sansuoPdfReadSources: new Map([['doc-1', { documentId: 'doc-1' }]]),
    };
    const agent = { tools: [], toolDefinitions: [], toolRegistry: new Map() };
    const read = jest.fn().mockResolvedValue({ status: 'ok', document_id: 'doc-1' });

    expect(registerSanSuoPdfReadTool(req, agent, read)).toBe(true);
    expect(agent.tools.map((tool) => tool.name)).toEqual(['read_parsed_pdf']);
    expect(agent.toolDefinitions.map((tool) => tool.name)).toEqual(['read_parsed_pdf']);
    expect([...agent.toolRegistry.keys()]).toEqual(['read_parsed_pdf']);
    expect(JSON.parse(await req._sansuoPdfReadTool.invoke({ action: 'info' }))).toEqual({
      status: 'ok',
      document_id: 'doc-1',
    });
  });

  it('registers a scoped persisted DOCX reader', async () => {
    const req = {
      body: { _sansuoPersistedDocxContextReady: true },
      _sansuoDocxReadSources: new Map([['docx-1', { fileId: 'docx-1' }]]),
    };
    const agent = { tools: [], toolDefinitions: [], toolRegistry: new Map() };
    const read = jest.fn().mockResolvedValue({ status: 'ok', content: '正文' });

    expect(registerSanSuoDocxReadTool(req, agent, read)).toBe(true);
    expect(agent.tools.map((tool) => tool.name)).toEqual(['read_parsed_docx']);
    expect(agent.toolDefinitions.map((tool) => tool.name)).toEqual(['read_parsed_docx']);
    expect([...agent.toolRegistry.keys()]).toEqual(['read_parsed_docx']);
    expect(JSON.parse(await req._sansuoDocxReadTool.invoke({ query: '正文' }))).toEqual({
      status: 'ok',
      content: '正文',
    });
  });

  it.each([
    ['deep', true],
    ['fast', false],
    ['knowledge', false],
  ])('registers execute_code only for %s mode', (sansuoMode, expected) => {
    const req = { body: { endpoint: 'SanSuoMain', sansuoMode } };
    const agent = { provider: 'SanSuoMain', tools: ['existing_tool'] };

    expect(prepareSanSuoDeepCodeCapability(req, {}, agent)).toBe(expected);
    expect(agent.tools.includes('execute_code')).toBe(expected);
    expect(req.body._sansuoForceCodeTool).toBeUndefined();
    expect(req.body._sansuoToolChoice).toBeUndefined();
    expect(req.body._sansuoTaskRoute).toBeUndefined();
  });

  it('keeps a single execute_code entry across repeated preparation', () => {
    const req = { body: { endpoint: 'SanSuoMain', sansuoMode: 'deep' } };
    const agent = { provider: 'SanSuoMain', tools: ['execute_code'] };

    prepareSanSuoDeepCodeCapability(req, {}, agent);
    prepareSanSuoDeepCodeCapability(req, {}, agent);

    expect(agent.tools.filter((tool) => tool === 'execute_code')).toHaveLength(1);
  });

  it('removes unsupported shared-package code tools from the SanSuo deep tool surface', () => {
    const req = { body: { endpoint: 'SanSuoMain', sansuoMode: 'deep' } };
    const toolRegistry = new Map([
      ['execute_code', { name: 'execute_code' }],
      ['bash_tool', { name: 'bash_tool' }],
      ['read_file', { name: 'read_file' }],
      ['read_parsed_pdf', { name: 'read_parsed_pdf' }],
    ]);
    const config = {
      provider: 'openAI',
      toolDefinitions: [
        { name: 'execute_code' },
        { name: 'bash_tool' },
        { name: 'read_file' },
        { name: 'read_parsed_pdf' },
      ],
      toolRegistry,
    };

    expect(restrictSanSuoDeepToolSurface(req, {}, config, new Set(['execute_code']))).toBe(true);
    expect(config.toolDefinitions.map((tool) => tool.name)).toEqual([
      'execute_code',
      'read_parsed_pdf',
    ]);
    expect([...toolRegistry.keys()]).toEqual(['execute_code', 'read_parsed_pdf']);
  });

  it('registers the real execute_code definition when the shared package only supplied new tools', () => {
    const req = { body: { endpoint: 'SanSuoMain', sansuoMode: 'deep' } };
    const config = {
      provider: 'openAI',
      toolDefinitions: [{ name: 'bash_tool' }, { name: 'read_file' }],
      toolRegistry: new Map([
        ['bash_tool', { name: 'bash_tool' }],
        ['read_file', { name: 'read_file' }],
      ]),
    };

    expect(restrictSanSuoDeepToolSurface(req, {}, config, new Set(['execute_code']))).toBe(true);
    expect(config.toolDefinitions.map((tool) => tool.name)).toEqual(['execute_code']);
    expect(config.toolDefinitions[0].parameters.required).toEqual(['code']);
    expect(config.toolDefinitions[0].parameters.properties.language).toBeDefined();
    expect([...config.toolRegistry.keys()]).toEqual(['execute_code']);
  });

  it('never restores execute_code after native capability denial', () => {
    const req = { body: { endpoint: 'SanSuoMain', sansuoMode: 'deep' } };
    const config = { toolDefinitions: [{ name: 'execute_code' }, { name: 'bash_tool' }],
      toolRegistry: new Map([['execute_code', {}], ['bash_tool', {}]]) };
    restrictSanSuoDeepToolSurface(req, {}, config, new Set(['tools']));
    expect(config.toolDefinitions).toEqual([]);
    expect(config.toolRegistry.size).toBe(0);
  });

  it('does not alter non-deep or non-SanSuo agent tool surfaces', () => {
    const config = {
      provider: 'openAI',
      toolDefinitions: [{ name: 'bash_tool' }],
      toolRegistry: new Map([['bash_tool', {}]]),
    };

    expect(
      restrictSanSuoDeepToolSurface(
        { body: { endpoint: 'agents', sansuoMode: 'deep' } },
        {},
        config,
      ),
    ).toBe(false);
    expect(config.toolDefinitions.map((tool) => tool.name)).toEqual(['bash_tool']);
  });

  it('clears stale forced routes and leaves tool choice automatic', () => {
    const req = {
      body: {
        endpoint: 'SanSuoMain',
        sansuoMode: 'deep',
        _sansuoForceCodeTool: true,
        _sansuoForceCodeToolName: 'execute_code',
        _sansuoToolChoice: { type: 'function', function: { name: 'execute_code' } },
        _sansuoRuntimeRoute: { executeCode: true },
        _sansuoTaskRoute: { needs_sandbox: true },
        _sansuoRouteTemplate: 'tool_required',
        _sansuoDedicatedToolModel: true,
        _sansuoDeferToolChoiceToFullRoute: true,
      },
    };
    const agent = {
      provider: 'SanSuoMain',
      tools: [],
      model_parameters: {
        tool_choice: { type: 'function', function: { name: 'execute_code' } },
        sansuoForceToolChoice: 'execute_code',
        modelKwargs: {
          tool_choice: { type: 'function', function: { name: 'execute_code' } },
        },
      },
    };

    expect(prepareSanSuoDeepCodeCapability(req, {}, agent)).toBe(true);
    expect(agent.tools).toEqual(['execute_code']);
    expect(agent.model_parameters.tool_choice).toBeUndefined();
    expect(agent.model_parameters.sansuoForceToolChoice).toBeUndefined();
    expect(agent.model_parameters.modelKwargs.tool_choice).toBeUndefined();
    for (const field of [
      '_sansuoForceCodeTool',
      '_sansuoForceCodeToolName',
      '_sansuoToolChoice',
      '_sansuoRuntimeRoute',
      '_sansuoTaskRoute',
      '_sansuoRouteTemplate',
      '_sansuoDedicatedToolModel',
      '_sansuoDeferToolChoiceToFullRoute',
    ]) {
      expect(req.body).not.toHaveProperty(field);
    }
  });

  it('applies an isolated fast model and removes all tools', () => {
    const req = {
      body: {
        endpoint: 'SanSuoMain',
        sansuoMode: 'fast',
        _sansuoForceCodeTool: true,
        _sansuoToolChoice: { type: 'function', function: { name: 'execute_code' } },
      },
    };
    const registry = new Map([['execute_code', {}]]);
    const agent = {
      provider: 'SanSuoMain',
      model: 'qwen3.6-plus',
      instructions: 'deep prompt',
      additional_instructions: 'deep additions',
      tools: ['execute_code'],
      toolDefinitions: [{ name: 'execute_code' }],
      toolRegistry: registry,
      model_parameters: {
        tool_choice: { type: 'function', function: { name: 'execute_code' } },
        modelKwargs: {
          top_p: 0.9,
          tool_choice: { type: 'function', function: { name: 'execute_code' } },
        },
      },
    };

    const profile = applySanSuoFastProfile(req, {}, agent);

    expect(profile).toMatchObject({
      model: 'qwen3.6-flash',
      maxContextTokens: 16000,
      maxTokens: 2048,
      temperature: 0.4,
    });
    expect(agent.model).toBe('qwen3.6-flash');
    expect(agent.instructions).toContain('快速问答模式');
    expect(agent.additional_instructions).toBe('');
    expect(agent.tools).toEqual([]);
    expect(agent.toolDefinitions).toEqual([]);
    expect([...registry.keys()]).toEqual([]);
    expect(agent.model_parameters.tool_choice).toBeUndefined();
    expect(agent.model_parameters.modelKwargs.tool_choice).toBeUndefined();
    expect(req.body._sansuoModelProfile).toBe('fast');
    expect(req.body._sansuoForceCodeTool).toBeUndefined();
    expect(req.body._sansuoToolChoice).toBeUndefined();
  });
});
