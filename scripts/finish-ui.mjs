/** Goes to the Finish list, then opens one row, adding the effect first if the layer does not have it yet. */
export async function openFinish(page, name) {
  const back = page.getByRole('button', { name: 'All finishes', exact: true });
  if (await back.count()) await back.click();
  if (!name) return;
  const row = page.getByRole('button', { name: `${name} settings`, exact: true });
  if (await row.count()) return row.click();
  await page.getByRole('button', { name: 'Add effect', exact: true }).click();
  await page.getByRole('button', { name: `Add ${name}`, exact: true }).click();
}
