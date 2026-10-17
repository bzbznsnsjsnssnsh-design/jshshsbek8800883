import puppeteer from 'puppeteer';

async function diagnose() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const page = await browser.newPage();
  
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', msg => {
    const text = `[BROWSER CONSOLE ${msg.type()}] ${msg.text()}`;
    consoleMessages.push(text);
    console.log(text);
  });

  page.on('pageerror', err => {
    const text = `[BROWSER PAGEERROR] ${err.toString()}\n${err.stack || ''}`;
    pageErrors.push(text);
    console.error(text);
  });

  console.log('Navigating to http://127.0.0.1:3000 ...');
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle2', timeout: 30000 });

  console.log('Initial page title:', await page.title());

  // Click on "رواية إلى مانجا" or button to switch view to novel-to-manga
  // Let's find buttons or navigation items
  const navText = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, a'));
    return buttons.map(b => ({ text: b.textContent?.trim(), tag: b.tagName }));
  });
  console.log('Available clickable items:', navText.filter(b => b.text && b.text.length < 30).slice(0, 20));

  // Switch to novel-to-manga
  console.log('Attempting to switch to novel-to-manga...');
  const clicked = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('*'));
    for (const el of elements) {
      if (el.textContent && (el.textContent.includes('رواية إلى مانجا') || el.textContent.includes('Novel → Manga'))) {
        if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.parentElement?.tagName === 'BUTTON') {
          (el as HTMLElement).click();
          return true;
        }
      }
    }
    // Alternatively look for buttons in navbar
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const btn of buttons) {
      if (btn.innerText?.includes('رواية') || btn.innerText?.includes('Novel')) {
        btn.click();
        return true;
      }
    }
    return false;
  });
  console.log('Clicked novel-to-manga button?', clicked);

  // Wait 3 seconds to observe render or error
  await new Promise(r => setTimeout(r, 4000));

  const rootHtml = await page.evaluate(() => {
    const root = document.getElementById('root');
    return {
      innerHTMLSnippet: root?.innerHTML?.slice(0, 500),
      textSnippet: root?.innerText?.slice(0, 500),
      childrenCount: root?.children.length
    };
  });
  console.log('Root HTML after switch:', rootHtml);

  console.log('\n--- DIAGNOSTIC SUMMARY ---');
  console.log(`Page errors count: ${pageErrors.length}`);
  if (pageErrors.length > 0) {
    console.log('Errors:', pageErrors);
  }

  await browser.close();
}

diagnose().catch(err => {
  console.error('Diagnostic script failed:', err);
  process.exit(1);
});
