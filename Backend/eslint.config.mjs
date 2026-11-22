// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * ESLint 9 reads this file (`eslint.config.mjs`) and nothing else — the old
 * `.eslintrc.*` files are ignored. That is the whole reason `npm run lint` used
 * to fail with "couldn't find eslint.config.*": the package was installed, the
 * config was not.
 *
 * What is deliberately *not* here, and why:
 *
 * - **Formatting.** Prettier owns indentation, quotes and line width
 *   (`npm run format`). Rules like `@typescript-eslint/quotes` would only
 *   produce a second, disagreeing opinion about the same keystrokes.
 * - **A NestJS plugin.** `@nestjs/eslint-plugin` is worth adding when this
 *   grows past a handful of modules; today the mistakes that actually happen
 *   here are plain TypeScript mistakes — a missing `await`, an unused
 *   parameter, a `void` promise nobody checks.
 *
 * The two rules switched on below are the two that have already been bugs in
 * this codebase:
 *
 * - `no-floating-promises` — a mail send or a notification write that is not
 *   awaited fails silently, and nothing else would notice.
 * - `no-misused-promises` — an `async` function passed where a synchronous
 *   callback is expected (an Express middleware, an event listener) has its
 *   rejection swallowed by the caller.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'test/.e2e-server.*', '*.tsbuildinfo'] },

  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Type-aware rules need a TypeScript project that covers every file
        // ESLint reads. `tsconfig.json` excludes `test/`, so this file exists
        // only to widen `include` — pointing at it instead would make the app
        // build depend on the test tree.
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // Deliberately off. The `recommendedTypeChecked` set flags every value
      // that TypeScript cannot prove, which in this codebase means the Express
      // `req`, Multer's `file`, Nest's `ArgumentsHost` and a test's `res.body`
      // — all `any` at the framework boundary. Turning these on would produce
      // ~40 messages that are true about the *framework* and useless about the
      // code; the fix it asks for is a cast, not a change in behaviour.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      // Tests reach into `body.data` and cast contexts; an unused `_x` is the
      // signal for "intentionally not read", which is already the codebase style.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/require-await': 'off',
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
);
