/**
 * Fetch OpenAI and Anthropic API keys using the user's existing Chrome session.
 * Navigates to each platform's API keys page and creates a new key if needed.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ENV_PATH = '/Users/larsstevenson/Code/Development/threshold-dashboard/.env.local';

// Use the user's real Chrome profile so they're already logged in
const CHROME_USER_DATA = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');

async function getOpenAIKey(page) {
  console.log('\n── OpenAI ──────────────────────────────────');
  await page.goto('https://platform.openai.com/api-keys', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Check if we need to log in
  if (page.url().includes('auth') || page.url().includes('login')) {
    console.log('⚠  Not logged in to OpenAI — please log in manually in the browser window.');
    console.log('   Waiting up to 60 seconds...');
    await page.waitForURL('**/api-keys**', { timeout: 60000 });
    await page.waitForTimeout(2000);
  }

  console.log('✓ On OpenAI API keys page');

  // Click "Create new secret key"
  const createBtn = page.getByRole('button', { name: /create new secret key/i });
  await createBtn.waitFor({ timeout: 10000 });
  await createBtn.click();
  await page.waitForTimeout(1500);

  // Fill in a name
  const nameInput = page.getByPlaceholder(/name/i).first();
  if (await nameInput.isVisible()) {
    await nameInput.fill('Threshold Auto-Caption');
  }

  // Click Create
  const confirmBtn = page.getByRole('button', { name: /^create$/i });
  if (await confirmBtn.isVisible()) await confirmBtn.click();
  await page.waitForTimeout(2000);

  // Grab the key from the revealed input/code
  const keyEl = page.locator('input[type="text"], code').filter({ hasText: /^sk-/ }).first();
  if (await keyEl.isVisible({ timeout: 5000 })) {
    const key = await keyEl.inputValue().catch(() => keyEl.textContent());
    console.log('✓ OpenAI key retrieved');
    return key?.trim() || null;
  }

  // Fallback: look for any text that starts with sk-
  const bodyText = await page.content();
  const match = bodyText.match(/sk-[A-Za-z0-9_-]{20,}/);
  if (match) {
    console.log('✓ OpenAI key retrieved (via page scan)');
    return match[0];
  }

  console.log('✗ Could not extract OpenAI key automatically');
  return null;
}

async function getAnthropicKey(page) {
  console.log('\n── Anthropic ───────────────────────────────');
  await page.goto('https://console.anthropic.com/settings/keys', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  if (page.url().includes('login') || page.url().includes('auth')) {
    console.log('⚠  Not logged in to Anthropic — please log in manually in the browser window.');
    console.log('   Waiting up to 60 seconds...');
    await page.waitForURL('**/settings/keys**', { timeout: 60000 });
    await page.waitForTimeout(2000);
  }

  console.log('✓ On Anthropic API keys page');

  // Click "Create Key"
  const createBtn = page.getByRole('button', { name: /create key/i });
  await createBtn.waitFor({ timeout: 10000 });
  await createBtn.click();
  await page.waitForTimeout(1500);

  // Fill in a name
  const nameInput = page.getByPlaceholder(/key name/i).first();
  if (await nameInput.isVisible()) {
    await nameInput.fill('Threshold Auto-Caption');
  }

  // Click Create Key confirm
  const confirmBtn = page.getByRole('button', { name: /create key/i }).last();
  if (await confirmBtn.isVisible()) await confirmBtn.click();
  await page.waitForTimeout(2000);

  // Grab the key
  const keyEl = page.locator('input[type="text"], code, [data-testid*="key"]').filter({ hasText: /^sk-ant-/ }).first();
  if (await keyEl.isVisible({ timeout: 5000 })) {
    const key = await keyEl.inputValue().catch(() => keyEl.textContent());
    console.log('✓ Anthropic key retrieved');
    return key?.trim() || null;
  }

  // Fallback: scan page
  const bodyText = await page.content();
  const match = bodyText.match(/sk-ant-[A-Za-z0-9_-]{20,}/);
  if (match) {
    console.log('✓ Anthropic key retrieved (via page scan)');
    return match[0];
  }

  console.log('✗ Could not extract Anthropic key automatically');
  return null;
}

function writeKeysToEnv(openaiKey, anthropicKey) {
  let env = fs.readFileSync(ENV_PATH, 'utf-8');
  if (openaiKey) {
    env = env.replace(/^OPENAI_API_KEY=.*$/m, `OPENAI_API_KEY=${openaiKey}`);
    console.log('\n✓ OPENAI_API_KEY written to .env.local');
  }
  if (anthropicKey) {
    env = env.replace(/^ANTHROPIC_API_KEY=.*$/m, `ANTHROPIC_API_KEY=${anthropicKey}`);
    console.log('✓ ANTHROPIC_API_KEY written to .env.local');
  }
  fs.writeFileSync(ENV_PATH, env);
}

(async () => {
  const context = await chromium.launchPersistentContext('/tmp/pw-api-keys-session', {
    headless: false,
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  const page = await context.newPage();

  let openaiKey = null;
  let anthropicKey = null;

  try {
    openaiKey = await getOpenAIKey(page);
  } catch (e) {
    console.log('✗ OpenAI error:', e.message);
  }

  try {
    anthropicKey = await getAnthropicKey(page);
  } catch (e) {
    console.log('✗ Anthropic error:', e.message);
  }

  if (openaiKey || anthropicKey) {
    writeKeysToEnv(openaiKey, anthropicKey);
    console.log('\n✅ Done — restart your dev server to pick up the new keys.');
  } else {
    console.log('\n⚠  No keys were retrieved. Check the browser window and try again.');
  }

  await context.close();
})();
