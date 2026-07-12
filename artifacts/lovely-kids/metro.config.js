const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch the entire monorepo root (official Expo monorepo pattern)
config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-dom": path.resolve(projectRoot, "node_modules/react-dom"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
  "react-native-web": path.resolve(
    projectRoot,
    "node_modules/react-native-web"
  ),
};

// Fix: metro@0.83.3 mishandles absolute paths in require.context, producing a
// wrong context module ID (appends the absolute path to expo-router's package
// path). We intercept the "expo-router/_ctx" import (the exact string the
// expo-router qualified-entry uses) and return a project-local file that uses
// a RELATIVE './app' path so Metro resolves the context correctly.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Only apply the web fix on the web platform.
  // Native platforms (android/ios) must resolve to their own _ctx.android.js / _ctx.ios.js
  // via Metro's normal platform-extension resolution.
  if (platform === "web" && moduleName === "expo-router/_ctx") {
    return {
      filePath: path.resolve(projectRoot, "_expo_ctx_web.js"),
      type: "sourceFile",
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
