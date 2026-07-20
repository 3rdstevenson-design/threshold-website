#!/usr/bin/env node
/**
 * ManyChat Comment Automation — Playwright script
 *
 * Usage:
 *   node tools/manychat-automation.cjs --login
 *   node tools/manychat-automation.cjs --config tools/manychat-configs/my-automation.json
 *
 * Config file format:
 *   {
 *     "platform": "instagram-comment",
 *     "keyword": "VIRAL",
 *     "dmText": "Hey! Here's your free guide 👇",
 *     "driveLink": "https://drive.google.com/..."
 *   }
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.join(__dirname, '.manychat-session');
const MANYCHAT_URL = 'https://app.manychat.com';

const args = process.argv.slice(2);
const isLogin = args.includes('--login');
const configIdx = args.indexOf('--config');
const configPath = configIdx !== -1 ? args[configIdx + 1] : null;

if (!isLogin && !configPath) {
  console.error('Usage:\n  --login           Run interactive login and save session\n  --config <file>   Create automation from config file');
  process.exit(1);
}

async function launchBrowser(headless = false) {
  const browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless,
    viewport: { width: 1280, height: 800 },
  });
  return browser;
}

async function login() {
  console.log('Opening ManyChat login...');
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  const context = await launchBrowser(false);
  const page = context.pages()[0] || await context.newPage();

  await page.goto(MANYCHAT_URL);
  console.log('Browser opened. Sign in to ManyChat (Google or email).');
  console.log('Complete any 2FA if prompted.');
  console.log('Once you are logged in and see your dashboard, press Enter here to save session and exit.');

  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', resolve);
  });

  await context.close();
  console.log('Session saved to', SESSION_DIR);
  console.log('You can now run: node tools/manychat-automation.cjs --config <file>');
}

async function createAutomation(config) {
  const { platform, keyword, dmText, driveLink } = config;

  if (!keyword || !dmText) {
    throw new Error('Config must include keyword and dmText');
  }

  if (!/^[A-Z0-9]+$/i.test(keyword)) {
    throw new Error('Keyword must be a single word (no spaces)');
  }

  console.log(`Creating ManyChat automation for keyword: ${keyword}`);

  const context = await launchBrowser(false);
  const page = context.pages()[0] || await context.newPage();

  // Navigate to ManyChat
  await page.goto(MANYCHAT_URL);
  await page.waitForLoadState('networkidle');

  // Check if logged in
  const url = page.url();
  if (url.includes('login') || url.includes('auth')) {
    await context.close();
    throw new Error('Not logged in. Run --login first.');
  }

  console.log('Logged in. Navigating to Automations...');

  // Navigate to Instagram Comment Automation
  // Try sidebar navigation
  try {
    // Look for Automation or Growth Tools in nav
    const automationLink = page.locator('a[href*="automation"], a[href*="growth"]').first();
    if (await automationLink.isVisible({ timeout: 5000 })) {
      await automationLink.click();
      await page.waitForLoadState('networkidle');
    }
  } catch {
    // Fallback: navigate directly
    await page.goto(`${MANYCHAT_URL}/instagram/automation`);
    await page.waitForLoadState('networkidle');
  }

  // Click "New Automation" or "+ Create"
  console.log('Looking for Create Automation button...');
  const createBtn = page.locator('button:has-text("New"), button:has-text("Create"), a:has-text("New Automation")').first();
  await createBtn.waitFor({ timeout: 15000 });
  await createBtn.click();
  await page.waitForLoadState('networkidle');

  // Select "Comment" trigger if prompted to choose trigger type
  try {
    const commentOption = page.locator(':has-text("Comment"), [data-type="comment"]').first();
    if (await commentOption.isVisible({ timeout: 5000 })) {
      await commentOption.click();
      await page.waitForLoadState('networkidle');
    }
  } catch {
    // May already be on comment form
  }

  // Fill keyword
  console.log(`Setting keyword: ${keyword}`);
  const keywordInput = page.locator('input[placeholder*="keyword" i], input[placeholder*="word" i], input[name*="keyword" i]').first();
  await keywordInput.waitFor({ timeout: 10000 });
  await keywordInput.fill(keyword);

  // Fill DM message
  console.log('Setting DM message...');
  const dmInput = page.locator('textarea[placeholder*="message" i], textarea[placeholder*="reply" i], div[contenteditable="true"]').first();
  await dmInput.waitFor({ timeout: 10000 });
  await dmInput.fill(dmText + (driveLink ? `\n\n${driveLink}` : ''));

  // Try to find and click Add Button / Add URL button for the drive link
  if (driveLink) {
    try {
      const addUrlBtn = page.locator('button:has-text("Add Button"), button:has-text("URL"), button:has-text("Link")').first();
      if (await addUrlBtn.isVisible({ timeout: 3000 })) {
        await addUrlBtn.click();
        const urlInput = page.locator('input[type="url"], input[placeholder*="url" i], input[placeholder*="http" i]').first();
        await urlInput.waitFor({ timeout: 5000 });
        await urlInput.fill(driveLink);
      }
    } catch {
      // Link already in DM text — that's fine
    }
  }

  // Save / Publish
  console.log('Saving automation...');
  const saveBtn = page.locator('button:has-text("Save"), button:has-text("Publish"), button:has-text("Activate")').first();
  await saveBtn.waitFor({ timeout: 10000 });
  await saveBtn.click();
  await page.waitForTimeout(2000);

  console.log(`\nAutomation created for keyword: ${keyword}`);
  console.log('Check ManyChat dashboard to confirm it is set to Active.');
  console.log('Test by commenting the keyword on your latest Instagram post.');

  await context.close();
}

async function main() {
  if (isLogin) {
    await login();
    return;
  }

  if (configPath) {
    if (!fs.existsSync(configPath)) {
      console.error(`Config file not found: ${configPath}`);
      process.exit(1);
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    try {
      await createAutomation(config);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  }
}

main();
