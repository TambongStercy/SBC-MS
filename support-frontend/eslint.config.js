import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Fast-refresh nicety only (dev HMR); label tables live next to their badge components.
      'react-refresh/only-export-components': 'off',
      // Responses may hold member data: never log them.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
);
