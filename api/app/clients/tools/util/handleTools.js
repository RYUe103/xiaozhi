const { logger } = require('@librechat/data-schemas');
const {
  EnvVar,
  Calculator,
  createSearchTool,
  createCodeExecutionTool,
} = require('@librechat/agents');
const {
  checkAccess,
  toolkitParent,
  createSafeUser,
  mcpToolPattern,
  loadWebSearchAuth,
  buildImageToolContext,
  buildWebSearchContext,
  getCodeApiAuthHeaders,
} = require('@librechat/api');
const {
  Tools,
  Constants,
  Permissions,
  EToolResources,
  PermissionTypes,
} = require('librechat-data-provider');
const {
  availableTools,
  manifestToolMap,
  // Basic Tools
  GoogleSearchAPI,
  // Structured Tools
  DALLE3,
  FluxAPI,
  OpenWeather,
  StructuredSD,
  StructuredACS,
  TraversaalSearch,
  StructuredWolfram,
  TavilySearchResults,
  createGeminiImageTool,
  createOpenAIImageTools,
} = require('../');
const { createMCPTool, createMCPTools, resolveConfigServers } = require('~/server/services/MCP');
const { createFileSearchTool, primeFiles: primeSearchFiles } = require('./fileSearch');
const { primeFiles: primeCodeFiles } = require('~/server/services/Files/Code/process');
const { getUserPluginAuthValue } = require('~/server/services/PluginService');
const { loadAuthValues } = require('~/server/services/Tools/credentials');
const { getMCPServerTools } = require('~/server/services/Config');
const { getMCPServersRegistry } = require('~/config');
const { getRoleByName } = require('~/models');
const {
  getSanSuoCodeExecutionIntent,
} = require('~/server/services/Endpoints/agents/sansuoToolPolicy');

const SANSUO_CODE_TOOL_GUIDE = `

SanSuo sandbox office helpers:
- execute_code is the only code/file execution tool in this environment. Call it with exactly {"lang":"py","code":"..."} for Python; do not use a language field or the value "python". Request-scoped read_parsed_pdf and read_parsed_docx may be provided for already parsed documents; they read persisted backend artifacts without sandbox execution. Legacy names such as read_pdf_smart and read_pdf_find must never be emitted as tools or invoked inside execute_code.
- read_parsed_docx can list documents and read persisted headings, paragraphs, tables, or adjacent content. Older persisted Word artifacts may not contain table coordinates; report that limitation instead of reopening the source in execute_code.
- Uploaded PDF, DOCX, XLSX, CSV, TXT, and MD files are normally parsed before model invocation. Read-only summaries, Q&A, rewriting, and extraction should use the parsed context already provided to the model and should not call execute_code merely to reopen the source file.
- DOCX image Q&A uses persisted images sent directly to the vision model by the backend. Answer from its visual summaries; never use execute_code, docx_build_reading_pack, read_docx, or read_file_auto to re-extract DOCX images. Missing Visio/OLE image content must be stated as unavailable. File creation, editing and explicit conversion may still use execute_code.
- Decide autonomously whether execute_code is needed. Call it only for real execution such as creating or editing a downloadable file, converting formats, precise computation, data processing, or building charts. Ordinary answers and already-parsed document Q&A do not need it. If the user has not made clear whether they want chat text or a downloadable file, ask briefly instead of calling the tool. Failed or insufficient PDF parsing is handled by the backend and never authorizes sandbox PDF reading.
- The Python environment provides /mnt/data/sansuo_tools.py and /mnt/data/TOOL_REFERENCE.md. Inside execute_code, prefer these helpers before third-party package-specific code. For helper details run: from sansuo_tools import tool_reference; print(tool_reference("<keyword>")).
- Common generation helpers inside execute_code: create_docx, create_pdf, create_xlsx, write_text, make_zip, and chart helpers. read_file_auto/read_xlsx may be used for non-PDF execution tasks. PDF reading helpers are backend implementation details and must not be invoked from execute_code. DOCX reading and image extraction are backend responsibilities.
- For Word/Office to PDF, including .doc and .docx, call:
  from pathlib import Path
  from sansuo_tools import convert_to_pdf
  out = convert_to_pdf(Path('/mnt/data') / '<uploaded filename>', '<output filename>.pdf')
  print(out)
- Do not find user files by blindly listing/searching /mnt/data. Each sandbox run contains /mnt/data/SANDBOX_AVAILABLE_FILES.json when files were mounted. If a user says "the previous file", "the file I just uploaded", "刚刚的文件", or if /mnt/data lookup seems empty, read this manifest first and use the exact filename/path listed there. Do not claim a file is missing before checking it.
- The /mnt/data copy is temporary after each sandbox run. Persistent files can be remounted by exact filename. In follow-up code, explicitly write Path('/mnt/data') / '<exact filename from manifest or prior artifact>' instead of vague references or directory scans.
- For creating downloadable files, use create_pdf, create_docx, create_xlsx, create_pptx, write_text, or make_zip.
- For a new Word/docx, use create_docx(body_text, output="文件.docx", title="标题") and return the .docx. Pass the document title exactly once through title; do not repeat it in body_text. Defaults are deterministic: centered document title, left-aligned section headings, black text, no title/heading underline or bottom rule, Chinese in 宋体, and Latin text/numbers in Times New Roman.
- Translate only explicit user formatting requests into create_docx keyword arguments. Supported overrides include paragraph/title/heading alignment; body/title/heading font names, sizes, colors, bold and underline; line/paragraph spacing and indentation; and table alignment. Never use a hyperlink style or decorative horizontal rule for a title unless the user explicitly requests that decoration. For exact argument names inspect tool_reference("create_docx").
- To edit an existing Word/docx, locate the exact original .docx from SANDBOX_AVAILABLE_FILES.json, open that file with python-docx, and preserve all content and formatting the user did not ask to change. Do not rebuild an existing document with create_docx. Do not convert Word to PDF unless the user explicitly asks for PDF, 转 PDF, 同时给 PDF, or a PDF version.
- Correct create_pdf usage is: create_pdf(body_text, output="文件.pdf", title="标题"). Do not call create_pdf(title, content, filename) or create_pdf(title, filename, content). For formal PDF documents, convert from docx only when PDF is explicitly requested.
- User-visible downloadable attachments and tool-readable follow-up resources are different. Files listed in generatedFiles/outputFiles are visible to the user. Files listed in hidden_intermediate_files, internalFiles, or SANDBOX_AVAILABLE_FILES.json are valid tool-readable resources when mounted, even when they are hidden from the user download list.
- Current-conversation files in SANDBOX_AVAILABLE_FILES.json may be used for authorized generation, editing, conversion, and calculation. PDF read-only follow-up never uses this manifest or sandbox.
- Hidden intermediate files are not user deliverables. PDF chunks/manifests are consumed by the LibreChat backend and must not be reopened by execute_code.
- When execute_code is genuinely required and hidden intermediate files are mounted, reuse them inside the Python code before reopening the original source. Do not expose helper names as separate tool calls.
- If the request intent says persisted_pdf_context_ready=true, the PDF text needed for this task is already in the model context. Use execute_code only to write the requested output; do not call read_pdf, read_pdf_smart, read_pdf_find, mineru_parse_pdf, pdf_build_reading_pack, or read_file_auto on the source PDF.
- For Word/document generation, final .docx/.pdf/.xlsx outputs are visible deliverables. Only reading cache files such as *_docx_blocks.jsonl, *_docx_manifest.json, and *_docx_reading_pack.md are hidden intermediates. Never hide or suppress a user-requested .docx deliverable because it was produced by code.
- For charts and visual reports, prefer create_line_chart, create_bar_chart, create_pie_chart, create_heatmap, create_dashboard, create_visual_report. These create real PNG/PDF/XLSX outputs that the UI can return as downloadable files. Always print the returned path or returned dict.
- There is no create_png helper. For custom plots not covered by the chart helpers, use matplotlib/numpy/pandas directly, save with plt.savefig('<name>.png'), and print the output path.
- PDF follow-up questions use persisted text and backend visual summaries, including long PDFs. Page details, images, missing chunks, or failed parsing do not authorize sandbox execution. If backend PDF evidence is unavailable, report that failure honestly instead of calling read_pdf_smart, read_pdf_find, mineru_parse_pdf, pdf_build_reading_pack, read_pdf, or read_file_auto on the PDF.
- Do not install packages or system tools with pip, apt-get, npm, brew, yum, or conda. Do not use weasyprint/reportlab/pdfkit directly unless a sansuo_tools helper fails and you have first probed the dependency.
- Never tell the user to convert/download/copy locally when the requested output can be generated by sansuo_tools.
`.trim();

const SANSUO_LANGUAGE_ALIASES = Object.freeze({
  python: 'py',
  python3: 'py',
  javascript: 'js',
  node: 'js',
  nodejs: 'js',
  typescript: 'ts',
  shell: 'bash',
  sh: 'bash',
});

function normalizeSanSuoCodeToolInput(input) {
  const normalized = { ...(input ?? {}) };
  const requestedLanguage = String(normalized.lang || normalized.language || 'py').toLowerCase();
  normalized.lang = SANSUO_LANGUAGE_ALIASES[requestedLanguage] || requestedLanguage;
  delete normalized.language;
  return normalized;
}

function applySanSuoCodeToolGuide(tool) {
  if (!tool) {
    return tool;
  }

  if (
    typeof tool.description === 'string' &&
    !tool.description.includes('SanSuo sandbox office helpers')
  ) {
    tool.description = `${tool.description}\n\n${SANSUO_CODE_TOOL_GUIDE}`;
  }

  const codeDescription = tool.schema?.properties?.code?.description;
  if (
    typeof codeDescription === 'string' &&
    !codeDescription.includes('SanSuo sandbox office helpers')
  ) {
    tool.schema.properties.code.description = `${codeDescription}\n\n${SANSUO_CODE_TOOL_GUIDE}`;
  }

  if (tool.schema?.properties && Array.isArray(tool.schema?.required)) {
    tool.schema.properties.language = {
      type: 'string',
      description:
        'Compatibility alias for lang. Prefer lang="py"; language="python" is normalized to py.',
    };
    tool.schema.properties.lang = {
      ...tool.schema.properties.lang,
      description:
        'Runtime identifier. Prefer "py" for Python. Common aliases such as "python" are accepted and normalized.',
    };
    tool.schema.required = tool.schema.required.filter((field) => field !== 'lang');
  }

  if (typeof tool.func === 'function' && tool._sansuoInputNormalizationApplied !== true) {
    const originalFunc = tool.func;
    tool.func = (input, runManager, config) =>
      originalFunc(normalizeSanSuoCodeToolInput(input), runManager, config);
    tool._sansuoInputNormalizationApplied = true;
  }

  return tool;
}

/**
 * Validates the availability and authentication of tools for a user based on environment variables or user-specific plugin authentication values.
 * Tools without required authentication or with valid authentication are considered valid.
 *
 * @param {Object} user The user object for whom to validate tool access.
 * @param {Array<string>} tools An array of tool identifiers to validate. Defaults to an empty array.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of valid tool identifiers.
 */
const validateTools = async (user, tools = []) => {
  try {
    const validToolsSet = new Set(tools);
    const availableToolsToValidate = availableTools.filter((tool) =>
      validToolsSet.has(tool.pluginKey),
    );

    /**
     * Validates the credentials for a given auth field or set of alternate auth fields for a tool.
     * If valid admin or user authentication is found, the function returns early. Otherwise, it removes the tool from the set of valid tools.
     *
     * @param {string} authField The authentication field or fields (separated by "||" for alternates) to validate.
     * @param {string} toolName The identifier of the tool being validated.
     */
    const validateCredentials = async (authField, toolName) => {
      const fields = authField.split('||');
      for (const field of fields) {
        const adminAuth = process.env[field];
        if (adminAuth && adminAuth.length > 0) {
          return;
        }

        let userAuth = null;
        try {
          userAuth = await getUserPluginAuthValue(user, field);
        } catch (err) {
          if (field === fields[fields.length - 1] && !userAuth) {
            throw err;
          }
        }
        if (userAuth && userAuth.length > 0) {
          return;
        }
      }

      validToolsSet.delete(toolName);
    };

    for (const tool of availableToolsToValidate) {
      if (!tool.authConfig || tool.authConfig.length === 0) {
        continue;
      }

      for (const auth of tool.authConfig) {
        await validateCredentials(auth.authField, tool.pluginKey);
      }
    }

    return Array.from(validToolsSet.values());
  } catch (err) {
    logger.error('[validateTools] There was a problem validating tools', err);
    throw new Error(err);
  }
};

/** @typedef {typeof import('@langchain/core/tools').Tool} ToolConstructor */
/** @typedef {import('@langchain/core/tools').Tool} Tool */

/**
 * Initializes a tool with authentication values for the given user, supporting alternate authentication fields.
 * Authentication fields can have alternates separated by "||", and the first defined variable will be used.
 *
 * @param {string} userId The user ID for which the tool is being loaded.
 * @param {Array<string>} authFields Array of strings representing the authentication fields. Supports alternate fields delimited by "||".
 * @param {ToolConstructor} ToolConstructor The constructor function for the tool to be initialized.
 * @param {Object} options Optional parameters to be passed to the tool constructor alongside authentication values.
 * @returns {() => Promise<Tool>} An Async function that, when called, asynchronously initializes and returns an instance of the tool with authentication.
 */
const loadToolWithAuth = (userId, authFields, ToolConstructor, options = {}) => {
  return async function () {
    const authValues = await loadAuthValues({ userId, authFields });
    return new ToolConstructor({ ...options, ...authValues, userId });
  };
};

/**
 * @param {string} toolKey
 * @returns {Array<string>}
 */
const getAuthFields = (toolKey) => {
  return manifestToolMap[toolKey]?.authConfig.map((auth) => auth.authField) ?? [];
};

/**
 *
 * @param {object} params
 * @param {string} params.user
 * @param {Record<string, Record<string, string>>} [object.userMCPAuthMap]
 * @param {AbortSignal} [object.signal]
 * @param {Pick<Agent, 'id' | 'provider' | 'model'>} [params.agent]
 * @param {string} [params.model]
 * @param {EModelEndpoint} [params.endpoint]
 * @param {LoadToolOptions} [params.options]
 * @param {boolean} [params.useSpecs]
 * @param {Array<string>} params.tools
 * @param {boolean} [params.functions]
 * @param {boolean} [params.returnMap]
 * @param {AppConfig['webSearch']} [params.webSearch]
 * @param {AppConfig['fileStrategy']} [params.fileStrategy]
 * @param {AppConfig['imageOutputType']} [params.imageOutputType]
 * @returns {Promise<{ loadedTools: Tool[], toolContextMap: Object<string, any> } | Record<string,Tool>>}
 */
const loadTools = async ({
  user,
  agent,
  model,
  signal,
  endpoint,
  userMCPAuthMap,
  tools = [],
  options = {},
  functions = true,
  returnMap = false,
  webSearch,
  fileStrategy,
  imageOutputType,
}) => {
  const toolConstructors = {
    flux: FluxAPI,
    calculator: Calculator,
    google: GoogleSearchAPI,
    open_weather: OpenWeather,
    wolfram: StructuredWolfram,
    'stable-diffusion': StructuredSD,
    'azure-ai-search': StructuredACS,
    traversaal_search: TraversaalSearch,
    tavily_search_results_json: TavilySearchResults,
  };

  const customConstructors = {
    image_gen_oai: async (toolContextMap) => {
      const authFields = getAuthFields('image_gen_oai');
      const authValues = await loadAuthValues({ userId: user, authFields });
      const imageFiles = options.tool_resources?.[EToolResources.image_edit]?.files ?? [];
      const toolContext = buildImageToolContext({
        imageFiles,
        toolName: `${EToolResources.image_edit}_oai`,
        contextDescription: 'image editing',
      });
      if (toolContext) {
        toolContextMap.image_edit_oai = toolContext;
      }
      return createOpenAIImageTools({
        ...authValues,
        isAgent: !!agent,
        req: options.req,
        imageOutputType,
        fileStrategy,
        imageFiles,
      });
    },
    gemini_image_gen: async (toolContextMap) => {
      const authFields = getAuthFields('gemini_image_gen');
      const authValues = await loadAuthValues({ userId: user, authFields, throwError: false });
      const imageFiles = options.tool_resources?.[EToolResources.image_edit]?.files ?? [];
      const toolContext = buildImageToolContext({
        imageFiles,
        toolName: 'gemini_image_gen',
        contextDescription: 'image context',
      });
      if (toolContext) {
        toolContextMap.gemini_image_gen = toolContext;
      }
      return createGeminiImageTool({
        ...authValues,
        isAgent: !!agent,
        req: options.req,
        imageFiles,
        userId: user,
        fileStrategy,
      });
    },
  };

  const requestedTools = {};

  if (functions === true) {
    toolConstructors.dalle = DALLE3;
  }

  /** @type {ImageGenOptions} */
  const imageGenOptions = {
    isAgent: !!agent,
    req: options.req,
    fileStrategy,
    processFileURL: options.processFileURL,
    returnMetadata: options.returnMetadata,
    uploadImageBuffer: options.uploadImageBuffer,
  };

  const toolOptions = {
    flux: imageGenOptions,
    dalle: imageGenOptions,
    'stable-diffusion': imageGenOptions,
    gemini_image_gen: imageGenOptions,
  };

  /** @type {Record<string, string>} */
  const toolContextMap = {};
  const requestedMCPTools = {};

  /** Resolve config-source servers for the current user/tenant context */
  let configServers;
  if (tools.some((tool) => tool && mcpToolPattern.test(tool))) {
    configServers = await resolveConfigServers(options.req);
  }

  for (const tool of tools) {
    if (tool === Tools.execute_code) {
      requestedTools[tool] = async () => {
        const codeApiKey = process.env.LIBRECHAT_CODE_API_KEY || process.env.CODE_API_KEY;
        const { files, toolContext } = await primeCodeFiles(
          {
            ...options,
            agentId: agent?.id,
          },
          codeApiKey,
        );
        if (toolContext) {
          toolContextMap[tool] = toolContext;
        }
        const sanSuoIntent = getSanSuoCodeExecutionIntent(options.req);
        if (sanSuoIntent?.pdf_read_only === true) {
          throw new Error(
            'PDF read-only questions must use the persisted context, not execute_code.',
          );
        }
        const CodeExecutionTool = createCodeExecutionTool({
          user_id: user,
          files,
          authHeaders: () =>
            typeof getCodeApiAuthHeaders === 'function'
              ? getCodeApiAuthHeaders(options.req)
              : {
                  ...(codeApiKey ? { 'X-API-Key': codeApiKey } : {}),
                  ...(user ? { 'User-Id': String(user) } : {}),
                },
          ...(sanSuoIntent ? { intent: sanSuoIntent } : {}),
        });
        applySanSuoCodeToolGuide(CodeExecutionTool);
        CodeExecutionTool.apiKey = codeApiKey;
        return CodeExecutionTool;
      };
      continue;
    } else if (tool === Tools.file_search) {
      requestedTools[tool] = async () => {
        const { files, toolContext } = await primeSearchFiles({
          ...options,
          agentId: agent?.id,
        });
        if (toolContext) {
          toolContextMap[tool] = toolContext;
        }

        /** @type {boolean | undefined} Check if user has FILE_CITATIONS permission */
        let fileCitations;
        if (fileCitations == null && options.req?.user != null) {
          try {
            fileCitations = await checkAccess({
              user: options.req.user,
              permissionType: PermissionTypes.FILE_CITATIONS,
              permissions: [Permissions.USE],
              getRoleByName,
            });
          } catch (error) {
            logger.error('[handleTools] FILE_CITATIONS permission check failed:', error);
            fileCitations = false;
          }
        }

        return createFileSearchTool({
          userId: user,
          files,
          entity_id: agent?.id,
          fileCitations,
        });
      };
      continue;
    } else if (tool === Tools.web_search) {
      const result = await loadWebSearchAuth({
        userId: user,
        loadAuthValues,
        webSearchConfig: webSearch,
      });
      const { onSearchResults, onGetHighlights } = options?.[Tools.web_search] ?? {};
      requestedTools[tool] = async () => {
        toolContextMap[tool] = buildWebSearchContext();
        return createSearchTool({
          ...result.authResult,
          onSearchResults,
          onGetHighlights,
          logger,
        });
      };
      continue;
    } else if (tool && mcpToolPattern.test(tool)) {
      const [toolName, serverName] = tool.split(Constants.mcp_delimiter);
      if (toolName === Constants.mcp_server) {
        /** Placeholder used for UI purposes */
        continue;
      }
      const serverConfig = serverName
        ? await getMCPServersRegistry().getServerConfig(serverName, user, configServers)
        : null;
      if (!serverConfig) {
        logger.warn(
          `MCP server "${serverName}" for "${toolName}" tool is not configured${agent?.id != null && agent.id ? ` but attached to "${agent.id}"` : ''}`,
        );
        continue;
      }
      if (toolName === Constants.mcp_all) {
        requestedMCPTools[serverName] = [
          {
            type: 'all',
            serverName,
            config: serverConfig,
          },
        ];
        continue;
      }

      requestedMCPTools[serverName] = requestedMCPTools[serverName] || [];
      requestedMCPTools[serverName].push({
        type: 'single',
        toolKey: tool,
        serverName,
        config: serverConfig,
      });
      continue;
    }

    const toolKey = customConstructors[tool] ? tool : toolkitParent[tool];
    if (toolKey && customConstructors[toolKey]) {
      if (!requestedTools[toolKey]) {
        let cached;
        requestedTools[toolKey] = async () => {
          cached ??= customConstructors[toolKey](toolContextMap);
          return cached;
        };
      }
      requestedTools[tool] = requestedTools[toolKey];
      continue;
    }

    if (toolConstructors[tool]) {
      const options = toolOptions[tool] || {};
      const toolInstance = loadToolWithAuth(
        user,
        getAuthFields(tool),
        toolConstructors[tool],
        options,
      );
      requestedTools[tool] = toolInstance;
      continue;
    }
  }

  if (returnMap) {
    return requestedTools;
  }

  const toolPromises = [];
  for (const tool of tools) {
    const validTool = requestedTools[tool];
    if (validTool) {
      toolPromises.push(
        validTool().catch((error) => {
          logger.error(`Error loading tool ${tool}:`, error);
          return null;
        }),
      );
    }
  }

  const loadedTools = (await Promise.all(toolPromises)).flatMap((plugin) => plugin || []);
  const mcpToolPromises = [];
  /** MCP server tools are initialized sequentially by server */
  let index = -1;
  const failedMCPServers = new Set();
  const safeUser = createSafeUser(options.req?.user);

  for (const [serverName, toolConfigs] of Object.entries(requestedMCPTools)) {
    index++;
    /** @type {LCAvailableTools} */
    let availableTools;
    for (const config of toolConfigs) {
      try {
        if (failedMCPServers.has(serverName)) {
          continue;
        }
        const mcpParams = {
          index,
          signal,
          user: safeUser,
          userMCPAuthMap,
          configServers,
          res: options.res,
          streamId: options.req?._resumableStreamId || null,
          model: agent?.model ?? model,
          serverName: config.serverName,
          provider: agent?.provider ?? endpoint,
          config: config.config,
        };

        if (config.type === 'all' && toolConfigs.length === 1) {
          /** Handle async loading for single 'all' tool config */
          mcpToolPromises.push(
            createMCPTools(mcpParams).catch((error) => {
              logger.error(`Error loading ${serverName} tools:`, error);
              return null;
            }),
          );
          continue;
        }
        if (!availableTools) {
          try {
            availableTools = await getMCPServerTools(safeUser.id, serverName);
          } catch (error) {
            logger.error(`Error fetching available tools for MCP server ${serverName}:`, error);
          }
        }

        /** Handle synchronous loading */
        const mcpTool =
          config.type === 'all'
            ? await createMCPTools(mcpParams)
            : await createMCPTool({
                ...mcpParams,
                availableTools,
                toolKey: config.toolKey,
              });

        if (Array.isArray(mcpTool)) {
          loadedTools.push(...mcpTool);
        } else if (mcpTool) {
          loadedTools.push(mcpTool);
        } else {
          failedMCPServers.add(serverName);
          logger.warn(
            `MCP tool creation failed for "${config.toolKey}", server may be unavailable or unauthenticated.`,
          );
        }
      } catch (error) {
        logger.error(`Error loading MCP tool for server ${serverName}:`, error);
      }
    }
  }
  loadedTools.push(...(await Promise.all(mcpToolPromises)).flatMap((plugin) => plugin || []));
  return { loadedTools, toolContextMap };
};

module.exports = {
  applySanSuoCodeToolGuide,
  normalizeSanSuoCodeToolInput,
  loadToolWithAuth,
  validateTools,
  loadTools,
};
