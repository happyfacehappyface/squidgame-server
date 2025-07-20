const globals = require("globals");

module.exports = [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parser: require("@typescript-eslint/parser"),
      parserOptions: {
        project: "./tsconfig.json"
      },
      globals: {
        ...globals.node
      }
    },
    plugins: {
      "@typescript-eslint": require("@typescript-eslint/eslint-plugin")
    },
    rules: {
      // TypeScript에서는 no-undef 불필요 (TypeScript가 처리)
      "@typescript-eslint/no-unused-vars": "warn",
      "no-var": "error",
      "no-process-exit": "warn"
    }
  }
];
