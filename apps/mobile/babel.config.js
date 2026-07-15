module.exports = function (api) {
  api.cache(true)
  return {
    presets: [
      // jsxImportSource: nativewind is what turns `className` on RN components
      // into styles. babel-preset-expo also injects the reanimated plugin.
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  }
}
