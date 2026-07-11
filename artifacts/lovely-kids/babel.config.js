module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [
      [
        "transform-inline-environment-variables",
        {
          include: ["EXPO_ROUTER_APP_ROOT", "EXPO_ROUTER_IMPORT_MODE"],
        },
      ],
    ],
  };
};
