import { expect, test } from '@playwright/test';

const html = `
  <style>
    body { margin: 0; padding: 32px; background: #f4f5f7; font-family: sans-serif; }
    .card { padding: 24px; border-radius: 8px; background: #fff; box-shadow: 0 1px 3px #0003; border-left: 4px solid #0969da; }
    h1 { margin: 0 0 8px; font-size: 20px; color: #1f2328; }
    p { margin: 0; font-size: 14px; color: #59636e; }
  </style>
  <div class="card">
    <h1>screenshot-review</h1>
    <p>Review screenshot changes on a pull request.</p>
  </div>
`;

test('card', async ({ page }) => {
  await page.setContent(html);
  await expect(page).toHaveScreenshot('card.png');
});
