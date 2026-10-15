import { expect, test } from '@playwright/test';
import { marketplaceFixture, testListing } from './fixtures/marketplace';

test('supporting-photo buttons retain focus through arrow keys and restore it after the full gallery', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await marketplaceFixture(page);
  await page.goto(`/listings/${testListing.id}`);
  const mainPhoto = page.locator('.galleryMainImage');
  const cover = new RegExp(`${testListing.media[0]!.id}/variants/1280$`);
  const supporting = page.getByRole('button', { name: 'Open photo 2 in full gallery', exact: true });
  await expect(mainPhoto).toHaveAttribute('src', cover);
  await supporting.focus();
  await page.keyboard.press('ArrowRight');
  await expect(supporting).toBeFocused();
  await expect(mainPhoto).toHaveAttribute('src', cover);
  await page.keyboard.press('ArrowLeft');
  await expect(supporting).toBeFocused();
  await expect(mainPhoto).toHaveAttribute('src', cover);

  await page.keyboard.press('Enter');
  const gallery = page.getByRole('dialog', { name: 'Full property photo gallery', exact: true });
  await expect(gallery).toBeVisible();
  await expect(gallery.locator('.galleryDialogStage img')).toHaveAttribute('src', new RegExp(`${testListing.media[1]!.id}/variants/1280$`));
  await expect(gallery.getByRole('button', { name: 'Close photo gallery', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(gallery).not.toBeVisible();
  await expect(supporting).toBeFocused();
  await expect(mainPhoto).toHaveAttribute('src', cover);
});
