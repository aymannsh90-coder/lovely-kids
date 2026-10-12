const { getDefaultConfig } = require('expo/metro-config');

// Expo SDK 52+ configures pnpm/yarn/npm monorepos automatically.
// Keeping the legacy manual watchFolders/nodeModulesPaths overrides can make
// Metro reuse or resolve modules outside the active worktree.
module.exports = getDefaultConfig(__dirname);
