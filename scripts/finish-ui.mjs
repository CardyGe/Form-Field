/** Goes to the Finish list, then opens one row. Studio remembers the open row between tabs. */
export async function openFinish(page, name) {
  const back = page.getByRole('button', { name: 'All finishes', exact: true });
  if (await back.count()) await back.click();
  if (name) await page.getByRole('button', { name: `${name} settings`, exact: true }).click();
}
