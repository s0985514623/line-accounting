// 規格不搬移：直接讀 specs/features。統一 CommonJS（tsx/cjs）。
// cucumber-js 會把 CLI 路徑與設定檔 paths 合併，故只在 CLI 未給路徑時才用全部 feature。
// 以路徑篩選單批執行：npx cucumber-js specs/features/access
const cliHasPaths = process.argv
  .slice(2)
  .some((a) => !a.startsWith('-') && /specs[/\\]|\.feature/.test(a));
module.exports = {
  default: {
    paths: cliHasPaths ? [] : ['specs/features/**/*.feature'],
    requireModule: ['tsx/cjs'],
    require: ['tests/bdd/support/**/*.ts', 'tests/bdd/steps/**/*.ts'],
    format: ['progress-bar', 'html:reports/cucumber.html'],
  },
};
