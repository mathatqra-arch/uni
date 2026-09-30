import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * ESLint is intentionally scoped to the shipped desktop source and tests.
 * Next.js/PWA rules were removed with the old web application tree, so a
 * failure here now points to code that actually belongs to Uni Kasher Desktop.
 */
export default tseslint.config(
  {
    ignores: ['node_modules/**', 'src-tauri/**', 'dist/**', 'build/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    files: ['vite.config.ts', 'vitest.config.ts'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts', 'vite.config.ts', 'vitest.config.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
      'no-debugger': 'error',
    },
  },
  {
    // shadcn-generated toast hook (~5k lines, vendored): kept byte-compatible
    // with the generator output so future regenerations produce no drift.
    // Typed-wrapper work tracked separately; scoped out of the strict pass.
    files: ['src/hooks/use-toast.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Legacy desktop backend router (~5k lines) predates the strict typing
    // pass applied to the UI layer. Its `any` usage is scheduled for a
    // dedicated typing project; scoped out here so component lint output
    // stays clean and actionable. Do not extend this exemption.
    files: ['src/lib/desktop-api.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
