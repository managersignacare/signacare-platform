module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "react-hooks", "import", "signacare-rules"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  rules: {
    // BUG-531 — ban empty `} catch { }` blocks on production safety
    // surfaces. Suggestion-mode autofix points at tryAsync from
    // @signacare/shared (BUG-530 SSoT). Path-scoped via .github/
    // safety-surfaces.txt — files NOT on that list are skipped.
    "signacare-rules/no-empty-catch-on-safety-surface": "error",
    // BUG-447-CASCADE-1 — ban onClick on MUI primitives (Box/Paper/
    // Card/Typography) without keyboard-operability props
    // (role+tabIndex+onKeyDown). Off-the-shelf jsx-a11y misses MUI
    // primitives because their runtime DOM element is opaque at
    // parse time. Path-scoped via .github/no-onclick-on-mui-
    // container.allowlist — files on that list are exempt during
    // the BUG-447 campaign; each child commit removes its file as
    // its violations are fixed. When the allowlist is empty,
    // BUG-447 is structurally complete.
    "signacare-rules/no-onclick-on-mui-container": "error",
    // Allow intentionally ignored args/vars prefixed with `_` (for
    // framework signatures, migration placeholders, and exhaustive switch
    // helpers) while keeping all other unused symbol detection strict.
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        args: "all",
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "all",
        caughtErrorsIgnorePattern: "^_"
      }
    ]
  },
  ignorePatterns: [
    "dist",
    "node_modules",
    "eslint-plugins",
    // Generated/runtime artifacts. These are not source-of-truth and produce
    // massive false-positive lint noise that hides actionable source issues.
    "**/build/**",
    "**/coverage/**",
    "**/playwright-report/**",
    "**/test-results/**",
    "**/.next/**",
    "**/.dart_tool/**",
    "**/tmp/**",
    // Historical migrations are retained for forensics only and are not part
    // of active runtime quality gates.
    "apps/api/migrations.archive/**"
  ],
  overrides: [
    {
      files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
      env: {
        node: true,
        commonjs: true,
        es2022: true
      },
      rules: {
        "@typescript-eslint/no-var-requires": "off"
      }
    },
    {
      files: ["scripts/k6/**/*.js"],
      globals: {
        __ENV: "readonly",
        __VU: "readonly",
        __ITER: "readonly"
      }
    }
  ]
};
