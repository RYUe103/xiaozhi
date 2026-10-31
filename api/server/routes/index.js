const accessPermissions = require('./accessPermissions');
const assistants = require('./assistants');
const categories = require('./categories');
const adminAuth = require('./admin/auth');
const adminConfig = require('./admin/config');
const adminGrants = require('./admin/grants');
const adminGroups = require('./admin/groups');
const adminRoles = require('./admin/roles');
const adminSanSuoData = require('./admin/sansuoData');
const adminUsers = require('./admin/users');
const endpoints = require('./endpoints');
const staticRoute = require('./static');
const messages = require('./messages');
const memories = require('./memories');
const presets = require('./presets');
const prompts = require('./prompts');
let skills;
try {
  skills = require('./skills');
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') {
    throw error;
  }
}
const balance = require('./balance');
const actions = require('./actions');
const apiKeys = require('./apiKeys');
const banner = require('./banner');
const search = require('./search');
const sansuoUi = require('./sansuoUi').router;
const sansuoUsage = require('./sansuoUsage');
const models = require('./models');
const convos = require('./convos');
const config = require('./config');
const agents = require('./agents');
const roles = require('./roles');
const oauth = require('./oauth');
const files = require('./files');
const share = require('./share');
const tags = require('./tags');
const auth = require('./auth');
const keys = require('./keys');
const user = require('./user');
const mcp = require('./mcp');

module.exports = {
  mcp,
  auth,
  adminAuth,
  adminConfig,
  adminGrants,
  adminGroups,
  adminRoles,
  adminSanSuoData,
  adminUsers,
  keys,
  apiKeys,
  user,
  tags,
  roles,
  oauth,
  files,
  share,
  banner,
  agents,
  convos,
  search,
  sansuoUi,
  sansuoUsage,
  config,
  models,
  prompts,
  ...(skills ? { skills } : {}),
  actions,
  presets,
  balance,
  messages,
  memories,
  endpoints,
  assistants,
  categories,
  staticRoute,
  accessPermissions,
};
