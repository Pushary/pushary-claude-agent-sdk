import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['@anthropic-ai/claude-agent-sdk', '@pushary/server', /^@pushary\/server\//],
})
