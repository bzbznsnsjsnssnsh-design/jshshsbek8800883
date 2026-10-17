import puppeteer from "puppeteer";

async function testGenerate() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.goto("https://duck.ai/chat", { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 3000));

  // Click "New Image" in the sidebar
  const clickedNewImg = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const newImgBtn = btns.find((b) => (b.innerText || "").toLowerCase().includes("new image"));
    if (newImgBtn) {
      newImgBtn.click();
      return true;
    }
    return false;
  });
  console.log("Clicked New Image sidebar button:", clickedNewImg);
  await new Promise((r) => setTimeout(r, 1000));

  const ta = await page.$("textarea");
  console.log("Textarea found:", Boolean(ta));
  if (!ta) return;
  await ta.click();
  await ta.type("A beautiful cherry blossom tree in spring, anime wallpaper style", { delay: 10 });
  await new Promise((r) => setTimeout(r, 500));

  // Submit via Enter
  await page.keyboard.press("Enter");
  console.log("Submitted prompt, polling for response...");

  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const info = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll("img")).map((img) => ({
        src: img.src ? img.src.slice(0, 70) : "",
        w: img.naturalWidth || img.clientWidth,
        h: img.naturalHeight || img.clientHeight,
        aria: img.getAttribute("aria-label"),
      }));
      const body = document.body ? document.body.innerText.slice(0, 200) : "";
      return { body, imgsCount: imgs.length, imgs };
    });
    console.log(`Poll ${i + 1} (${(i + 1) * 2}s):`, JSON.stringify(info));
    if (info.imgs.some((img) => img.w > 100 && img.h > 100)) {
      console.log("FOUND GENERATED IMAGE!");
      break;
    }
  }

  await browser.close();
}

testGenerate();
