import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'screenshots',
  // Baselines are not shared through the working tree; baseline-pull writes them here.
  snapshotPathTemplate: '.screenshot-baselines/{arg}{ext}',
  use: {
    browserName: 'chromium',
    viewport: { width: 480, height: 320 },
  },
});
