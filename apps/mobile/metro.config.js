// Monorepo-aware Metro config: watch the workspace root + force resolution
// of duplicate packages (react, react-native) to the app's local copy so
// hooks don't break across the symlinked node_modules.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files in the monorepo
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from app + workspace
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Force a single copy of React / RN to avoid hook-mismatch errors
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
