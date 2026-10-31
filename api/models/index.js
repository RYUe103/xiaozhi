const mongoose = require('mongoose');
const { createMethods } = require('@librechat/data-schemas');
const { matchModelName, findMatchingPattern } = require('@librechat/api');
const getLogStores = require('~/cache/getLogStores');
const {
  getSanSuoFiles,
  getSanSuoFileParseJobs,
  upsertSanSuoFileRecord,
  upsertSanSuoFileParseJob,
  claimSanSuoFileParseJob,
  finishSanSuoFileParseJob,
  markSanSuoFilesDeletedByLibreIds,
  syncSanSuoFileMessageRefs,
  rebindSanSuoFileConversationRefs,
  touchSanSuoArtifacts,
  updateSanSuoArtifactGovernance,
  createSanSuoArtifactAudit,
} = require('./sansuoFile');

const methods = createMethods(mongoose, {
  matchModelName,
  findMatchingPattern,
  getCache: getLogStores,
});

const seedDatabase = async () => {
  await methods.initializeRoles();
  await methods.seedDefaultRoles();
  await methods.ensureDefaultCategories();
  await methods.seedSystemGrants();
};

module.exports = {
  ...methods,
  saveMessage: async (...args) => {
    const savedMessage = await methods.saveMessage(...args);
    if (savedMessage?.files?.length) {
      try {
        const rebound = await syncSanSuoFileMessageRefs({
          userId: args[0]?.userId,
          message: savedMessage,
        });
        const total = Object.values(rebound).reduce((sum, count) => sum + Number(count || 0), 0);
        if (total > 0) {
          console.info('[SanSuoFileGateway] conversation refs rebound', {
            conversationId: savedMessage.conversationId,
            messageId: savedMessage.messageId,
            rootFiles: savedMessage.files.length,
            ...rebound,
          });
        }
      } catch (error) {
        console.warn('[SanSuoFileGateway] Failed to sync message refs:', error);
      }
    }
    return savedMessage;
  },
  getSanSuoFiles,
  getSanSuoFileParseJobs,
  upsertSanSuoFileRecord,
  upsertSanSuoFileParseJob,
  claimSanSuoFileParseJob,
  finishSanSuoFileParseJob,
  markSanSuoFilesDeletedByLibreIds,
  syncSanSuoFileMessageRefs,
  rebindSanSuoFileConversationRefs,
  touchSanSuoArtifacts,
  updateSanSuoArtifactGovernance,
  createSanSuoArtifactAudit,
  seedDatabase,
};
