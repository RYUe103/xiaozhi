const { logger } = require('@librechat/data-schemas');
const { EModelEndpoint } = require('librechat-data-provider');
const {
  getAnthropicModels,
  getBedrockModels,
  getOpenAIModels,
  getGoogleModels,
} = require('@librechat/api');
const { getAppConfig } = require('./app');

const getEnabledEndpoints = () => {
  const endpointsEnv = process.env.ENDPOINTS ?? '';
  return new Set(
    endpointsEnv
      .split(',')
      .map((endpoint) => endpoint.trim())
      .filter(Boolean),
  );
};

const isEndpointEnabled = (enabledEndpoints, endpoint) => {
  return enabledEndpoints.size === 0 || enabledEndpoints.has(endpoint);
};

const safeLoadModels = async ({ endpoint, enabledEndpoints, load }) => {
  if (!isEndpointEnabled(enabledEndpoints, endpoint)) {
    return undefined;
  }

  try {
    return await load();
  } catch (error) {
    logger.error(`Error fetching ${endpoint} models:`, error);
    return [];
  }
};

/**
 * Loads the default models for the application.
 * @async
 * @function
 * @param {ServerRequest} req - The Express request object.
 */
async function loadDefaultModels(req) {
  try {
    const appConfig =
      req.config ?? (await getAppConfig({ role: req.user?.role, tenantId: req.user?.tenantId }));
    const vertexConfig = appConfig?.endpoints?.[EModelEndpoint.anthropic]?.vertexConfig;
    const enabledEndpoints = getEnabledEndpoints();

    const [openAI, anthropic, azureOpenAI, assistants, azureAssistants, google, bedrock] =
      await Promise.all([
        safeLoadModels({
          endpoint: EModelEndpoint.openAI,
          enabledEndpoints,
          load: () =>
            getOpenAIModels({
              user: req.user?.id,
              userProvidedOpenAI:
                !process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'user_provided',
            }),
        }),
        safeLoadModels({
          endpoint: EModelEndpoint.anthropic,
          enabledEndpoints,
          load: () => getAnthropicModels({ user: req.user?.id, vertexModels: vertexConfig?.modelNames }),
        }),
        safeLoadModels({
          endpoint: EModelEndpoint.azureOpenAI,
          enabledEndpoints,
          load: () => getOpenAIModels({ user: req.user?.id, azure: true }),
        }),
        safeLoadModels({
          endpoint: EModelEndpoint.assistants,
          enabledEndpoints,
          load: () => getOpenAIModels({ assistants: true }),
        }),
        safeLoadModels({
          endpoint: EModelEndpoint.azureAssistants,
          enabledEndpoints,
          load: () => getOpenAIModels({ azureAssistants: true }),
        }),
        safeLoadModels({
          endpoint: EModelEndpoint.google,
          enabledEndpoints,
          load: () => getGoogleModels(),
        }),
        safeLoadModels({
          endpoint: EModelEndpoint.bedrock,
          enabledEndpoints,
          load: () => getBedrockModels(),
        }),
      ]);

    return Object.fromEntries(
      [
        [EModelEndpoint.openAI, openAI],
        [EModelEndpoint.google, google],
        [EModelEndpoint.anthropic, anthropic],
        [EModelEndpoint.azureOpenAI, azureOpenAI],
        [EModelEndpoint.assistants, assistants],
        [EModelEndpoint.azureAssistants, azureAssistants],
        [EModelEndpoint.bedrock, bedrock],
      ].filter(([, models]) => models !== undefined),
    );
  } catch (error) {
    logger.error('Error fetching default models:', error);
    throw new Error(`Failed to load default models: ${error.message}`);
  }
}

module.exports = loadDefaultModels;
