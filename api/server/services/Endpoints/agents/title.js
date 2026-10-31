const { isEnabled } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { CacheKeys } = require('librechat-data-provider');
const getLogStores = require('~/cache/getLogStores');
const { saveConvo } = require('~/models');

const createSanSuoFallbackTitle = (text = '') => {
  const source = String(text || '').trim();
  if (!source) {
    return '新聊天';
  }
  if (/^(你好|您好|hi|hello|在吗|哈喽)/i.test(source)) {
    return '问候与咨询';
  }
  if (/主要|总结|概括|说了啥|说的啥|讲了啥|文档|文件|docx|pdf/i.test(source)) {
    return '文档内容总结';
  }
  return (
    source
      .replace(/[#*_`>[\](){}|~]/g, '')
      .replace(/\s+/g, '')
      .slice(0, 12) || '新聊天'
  );
};

const createSanSuoKnowledgeTitle = (text = '') => {
  const source = String(text || '')
    .replace(/[#*_`>[\](){}|~]/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (!source) {
    return '知识库问答';
  }
  if (/^(你好|您好|hi|hello|在吗|哈喽)/i.test(source)) {
    return '知识库咨询';
  }
  return source.slice(0, 18);
};

const isSanSuoTitleClient = (client) => {
  const endpoint = client?.options?.endpoint ?? client?.options?.agent?.endpoint;
  const provider = client?.options?.agent?.provider;
  return endpoint === 'SanSuoMain' || provider === 'SanSuoMain';
};

/**
 * Add title to conversation in a way that avoids memory retention
 */
const addTitle = async (req, { text, response, client }) => {
  const { TITLE_CONVO = true } = process.env ?? {};
  if (!isEnabled(TITLE_CONVO)) {
    return;
  }

  if (client.options.titleConvo === false) {
    return;
  }

  // Skip title generation for temporary conversations
  if (req?.body?.isTemporary) {
    return;
  }

  const titleCache = getLogStores(CacheKeys.GEN_TITLE);
  const key = `${req.user.id}-${response.conversationId}`;
  /** @type {NodeJS.Timeout} */
  let timeoutId;
  try {
    let titlePromise;
    let abortController;
    const useSanSuoFallbackOnly =
      isSanSuoTitleClient(client) && req?.body?.sansuoMode === 'knowledge';
    if (useSanSuoFallbackOnly) {
      titlePromise = Promise.resolve(createSanSuoKnowledgeTitle(text));
    } else if (client && typeof client.titleConvo === 'function') {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Title generation timeout')), 45000);
      }).catch((error) => {
        logger.error('Title error:', error);
      });
      abortController = new AbortController();
      titlePromise = Promise.race([
        client
          .titleConvo({
            text,
            abortController,
          })
          .catch((error) => {
            logger.error('Client title error:', error);
          }),
        timeoutPromise,
      ]);
    } else {
      return;
    }

    const title = await titlePromise;
    if (abortController && !abortController.signal.aborted) {
      abortController.abort();
    }
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    const fallbackTitle = isSanSuoTitleClient(client) ? createSanSuoFallbackTitle(text) : '';
    const resolvedTitle = title || fallbackTitle;
    if (!resolvedTitle) {
      logger.debug(`[${key}] No title generated`);
      return;
    }

    await titleCache.set(key, resolvedTitle, 120000);
    await saveConvo(
      {
        userId: req?.user?.id,
        isTemporary: req?.body?.isTemporary,
        interfaceConfig: req?.config?.interfaceConfig,
      },
      {
        conversationId: response.conversationId,
        title: resolvedTitle,
      },
      { context: 'api/server/services/Endpoints/agents/title.js', noUpsert: true },
    );
    return resolvedTitle;
  } catch (error) {
    logger.error('Error generating title:', error);
    return undefined;
  }
};

module.exports = addTitle;
module.exports.createSanSuoKnowledgeTitle = createSanSuoKnowledgeTitle;
