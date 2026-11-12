// 統一 CommonJS（package.json 未設定 "type": "module"）
const { defineConfig, globalIgnores } = require('eslint/config');
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = defineConfig([
  globalIgnores([
    'node_modules/**',
    'dist/**',
    'reports/**',
    'coverage/**',
    'web/**',
    'specs/**',
    'plans/**',
    'prisma/migrations/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,js,cjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // CommonJS 設定檔允許 require()；BDD support 以 require 延遲載入 src（tsx/cjs 可直接載入 .ts）
    files: ['**/*.cjs', 'eslint.config.js', 'tests/bdd/support/**/*.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  prettier,
]);
