// ESLint flat config（ESLint 10 起不再支援 .eslintrc.*，由此檔取代）
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/', 'dist/', 'renderer/vendor/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.es2021 },
    },
    rules: {
      // caughtErrors: 'none' 維持 ESLint 8 的行為（catch (err) 不使用時不警告）
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['renderer/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.es2021 },
    },
  },
  {
    files: ['extractors/domCapture.js', 'extractors/selectorPicker.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
    rules: { 'no-undef': 'off', 'no-unused-vars': 'off' },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
];
