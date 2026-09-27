import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import forge from './tools/eslint-plugin-forge/determinism.js';

export default tseslint.config(
  { ignores: ['coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    extends: [],
    plugins: { forge },
    rules: {
      'forge/no-float-literal': 'error',
      'forge/no-ambient-clock': 'error',
      'forge/no-math-globals': 'error',
      'forge/no-console-in-source': 'error',
    },
  },
  {
    // Tests cross-check integer results against float references and may read
    // Math.* for that purpose only; they still may not touch clocks or
    // Math.random-driven behaviour, because fixtures must stay deterministic.
    files: ['src/**/*.test.ts'],
    rules: {
      'forge/no-float-literal': 'off',
      'forge/no-math-globals': 'off',
    },
  },
);
