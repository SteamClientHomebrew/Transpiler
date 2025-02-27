import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';

export default {
  input: 'index.ts',
  context: 'window',
  output: {
    file: 'dist/index.js'
  },
  plugins: [commonjs(), typescript(), json()],
  external: [
    "chalk", 
    "path", 
    "url", 
    "fs/promises", 
    "fs", 
    "rollup", 
    "@rollup/plugin-json", 
    "@rollup/plugin-commonjs", 
    "@rollup/plugin-replace", 
    "@rollup/plugin-typescript", 
    "@rollup/plugin-node-resolve",
    "rollup-plugin-import-css",
    "@rollup/plugin-terser",
    "@rollup/plugin-babel",
    "rollup-plugin-inject-process-env",
    "dotenv",
    "perf_hooks",
  ]
};