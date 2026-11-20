import { expect, test } from '@playwright/test';
import { SHELF_FIXTURE } from './global-setup';

// The whole offline flow: upload → estimate → slice → OCR → review → library → export.
// The shelf is synthetic, so OCR output is meaningless; the test types the title itself.
test('scan a shelf, confirm a book and export it', async ({ page, request }) => {
  const title = `E2E Book ${Date.now()}`;

  await page.goto('/');
  await page.getByLabel('Upload shelf photo').setInputFiles(SHELF_FIXTURE);

  // The spine count comes from the gap estimate (8 books in the fixture).
  const count = page.getByLabel('Books in this photo');
  await expect(count).toHaveValue('8');

  await page.getByRole('button', { name: 'Slice and read spines' }).click();
  await expect(page.getByText(/\d+ spines · \d+ to review/)).toBeVisible({ timeout: 150_000 });

  const rows = page.locator('tbody tr');
  expect(await rows.count()).toBeGreaterThan(0);
  await rows.first().click();

  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Author').fill('Test Author');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(rows.first().getByText('Confirmed')).toBeVisible();

  // The library shows it under the Confirmed filter.
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByLabel('Filter by status').selectOption({ label: 'Confirmed' });
  await expect(page.getByRole('cell', { name: title })).toBeVisible();

  // Exports include it.
  const csv = await request.get('/api/export/books.csv');
  expect(csv.ok()).toBe(true);
  expect(await csv.text()).toContain(`${title},Test Author`);

  const zip = await request.get('/api/export/library.zip');
  expect(zip.headers()['content-type']).toBe('application/zip');
  expect((await zip.body()).subarray(0, 2).toString()).toBe('PK');
});

test('rejects a file that is not an image', async ({ request }) => {
  const res = await request.post('/api/photos', {
    multipart: { photo: { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') } },
  });
  expect(res.status()).toBe(400);
});
