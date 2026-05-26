const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'src', 'assets', 'icons');
const SIZE = 256;

const icons = {
  gmail: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <defs>
        <linearGradient id="gmailRed" x1="45" y1="66" x2="212" y2="166" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#FF6D5F"/>
          <stop offset=".55" stop-color="#EA4335"/>
          <stop offset="1" stop-color="#B3261E"/>
        </linearGradient>
        <linearGradient id="gmailBlue" x1="163" y1="104" x2="213" y2="209" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#6EA8FE"/>
          <stop offset="1" stop-color="#1A73E8"/>
        </linearGradient>
        <linearGradient id="gmailGreen" x1="47" y1="105" x2="94" y2="208" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#5FCE72"/>
          <stop offset="1" stop-color="#188038"/>
        </linearGradient>
      </defs>
      <rect width="256" height="256" fill="none"/>
      <path d="M48 72h32l48 36 48-36h32v112c0 13.255-10.745 24-24 24H72c-13.255 0-24-10.745-24-24V72z" fill="#F2F6FC"/>
      <path d="M48 72l80 60 80-60v38l-80 60-80-60V72z" fill="url(#gmailRed)"/>
      <path d="M48 110v74c0 13.255 10.745 24 24 24h20v-75.5L48 110z" fill="url(#gmailGreen)"/>
      <path d="M208 110v74c0 13.255-10.745 24-24 24h-20v-75.5L208 110z" fill="url(#gmailBlue)"/>
      <path d="M48 72l80 60 80-60v-6c0-9.941-8.059-18-18-18h-8l-54 40.5L74 48h-8c-9.941 0-18 8.059-18 18v6z" fill="#FBBC04"/>
      <path d="M48 72l80 60v38l-80-60V72z" fill="#C5221F"/>
      <path d="M208 72l-80 60v38l80-60V72z" fill="#D93025"/>
    </svg>`,
  gchat: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <defs>
        <linearGradient id="chatGreen" x1="46" y1="26" x2="207" y2="205" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#7BE495"/>
          <stop offset=".45" stop-color="#34A853"/>
          <stop offset="1" stop-color="#0B8043"/>
        </linearGradient>
      </defs>
      <rect width="256" height="256" fill="none"/>
      <path d="M46 58c0-17.673 14.327-32 32-32h100c17.673 0 32 14.327 32 32v76c0 17.673-14.327 32-32 32h-55l-47 44c-6.44 6.031-17 1.465-17-7.358V164.5C51.338 158.636 46 149.393 46 138V58z" fill="url(#chatGreen)"/>
      <path d="M78 58h100v62H98l-20 20V58z" fill="#fff" opacity=".92"/>
      <path d="M86 166l37-36h55c17.673 0 32-14.327 32-32V78c0-10.531-5.09-19.874-12.942-25.704C205.539 57.886 211 67.498 211 78.4V135c0 17.673-14.327 32-32 32h-56l-37 35v-36z" fill="#0F9D58"/>
      <circle cx="111" cy="94" r="8" fill="#34A853"/>
      <circle cx="144" cy="94" r="8" fill="#34A853"/>
      <circle cx="177" cy="94" r="8" fill="#34A853"/>
    </svg>`,
  gmeet: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <defs>
        <linearGradient id="meetGreen" x1="41" y1="38" x2="197" y2="203" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#6DDB83"/>
          <stop offset="1" stop-color="#0F9D58"/>
        </linearGradient>
        <linearGradient id="meetBlue" x1="42" y1="113" x2="151" y2="219" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#7BAAF7"/>
          <stop offset="1" stop-color="#1A73E8"/>
        </linearGradient>
        <linearGradient id="meetRed" x1="60" y1="116" x2="146" y2="218" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#FF8A80"/>
          <stop offset="1" stop-color="#EA4335"/>
        </linearGradient>
      </defs>
      <rect width="256" height="256" fill="none"/>
      <path d="M42 66c0-15.464 12.536-28 28-28h76v75H42V66z" fill="url(#meetGreen)"/>
      <path d="M42 113h104v105H70c-15.464 0-28-12.536-28-28v-77z" fill="url(#meetBlue)"/>
      <path d="M146 38h18c15.464 0 28 12.536 28 28v34l40-32c7.864-6.291 19.5-.692 19.5 9.379v101.242c0 10.071-11.636 15.67-19.5 9.379l-40-32v34c0 15.464-12.536 28-28 28h-18V38z" fill="url(#meetGreen)"/>
      <path d="M146 113h46v43h-46v-43z" fill="#00832D"/>
      <path d="M42 113h104v-43L42 113z" fill="#FBBC04"/>
      <path d="M146 113v105L42 113h104z" fill="url(#meetRed)"/>
    </svg>`,
  gcalendar: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <defs>
        <linearGradient id="calBlue" x1="30" y1="36" x2="226" y2="111" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#7BAAF7"/>
          <stop offset="1" stop-color="#1A73E8"/>
        </linearGradient>
        <linearGradient id="calGreen" x1="30" y1="88" x2="89" y2="220" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#6DDB83"/>
          <stop offset="1" stop-color="#188038"/>
        </linearGradient>
        <linearGradient id="calYellow" x1="177" y1="88" x2="226" y2="220" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#FDD663"/>
          <stop offset="1" stop-color="#F9AB00"/>
        </linearGradient>
      </defs>
      <rect width="256" height="256" fill="none"/>
      <path d="M54 36h148c13.255 0 24 10.745 24 24v136c0 13.255-10.745 24-24 24H54c-13.255 0-24-10.745-24-24V60c0-13.255 10.745-24 24-24z" fill="#fff"/>
      <path d="M54 36h148c13.255 0 24 10.745 24 24v30H30V60c0-13.255 10.745-24 24-24z" fill="url(#calBlue)"/>
      <path d="M30 90h196v106c0 13.255-10.745 24-24 24H54c-13.255 0-24-10.745-24-24V90z" fill="#fff"/>
      <path d="M30 88h49v132H54c-13.255 0-24-10.745-24-24V88z" fill="url(#calGreen)"/>
      <path d="M177 88h49v108c0 13.255-10.745 24-24 24h-25V88z" fill="url(#calYellow)"/>
      <path d="M79 88h98v132H79V88z" fill="#fff"/>
      <path d="M30 88h196v24H30V88z" fill="#EA4335"/>
      <path d="M89 158h22c9.389 0 16-5.308 16-13.6 0-7.639-5.61-12.4-14.368-12.4-7.155 0-12.326 3.247-15.358 9.182l-17.403-9.989C86.163 120.249 97.66 114 112.632 114 132.266 114 147 125.328 147 143.418c0 9.784-5.232 17.014-13.134 21.274C143.713 168.77 150 176.816 150 188.063 150 207.296 134.128 220 112 220c-17.49 0-30.616-7.306-37.038-20.027l17.795-10.186C96.206 197.17 102.764 201 112 201c10.669 0 17-5.01 17-14 0-8.415-6.131-13-18-13H89v-16z" fill="#3C4043"/>
    </svg>`,
  hubspot: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <rect width="256" height="256" fill="none"/>
      <path d="M181.5 76.7V52.8c6.8-3.1 11.5-9.9 11.5-17.8 0-10.8-8.7-19.5-19.5-19.5S154 24.2 154 35c0 7.9 4.7 14.7 11.5 17.8v23.9c-12.3 1.9-23.4 7.4-32.1 15.5L70.9 43.5c.5-2 .8-4.1.8-6.2 0-13.4-10.9-24.3-24.3-24.3S23.1 23.9 23.1 37.3s10.9 24.3 24.3 24.3c4.7 0 9.1-1.3 12.8-3.6l61.5 47.9c-5.1 8.5-8.1 18.4-8.1 29 0 12.5 4.1 24 11.1 33.3l-18.7 18.7c-2.8-.9-5.7-1.4-8.8-1.4-15.9 0-28.8 12.9-28.8 28.8S81.3 243 97.2 243s28.8-12.9 28.8-28.8c0-3-.5-5.9-1.4-8.6l18.5-18.5c8.9 5.9 19.7 9.4 31.2 9.4 31.4 0 56.8-25.4 56.8-56.8 0-29-21.7-52.9-49.6-56.5zM97.2 226.2c-6.6 0-12-5.4-12-12s5.4-12 12-12 12 5.4 12 12-5.4 12-12 12zm77.1-47.6c-21.4 0-38.8-17.4-38.8-38.8s17.4-38.8 38.8-38.8 38.8 17.4 38.8 38.8-17.4 38.8-38.8 38.8z" fill="#FF7A59"/>
    </svg>`
};

function pageHtml(svg) {
  return `<!doctype html>
<html>
<head>
<style>
html,body{margin:0;width:${SIZE}px;height:${SIZE}px;background:transparent;overflow:hidden}
svg{display:block;width:${SIZE}px;height:${SIZE}px}
</style>
</head>
<body>${svg}</body>
</html>`;
}

async function renderIcon(browserWindow, name, svg) {
  await browserWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pageHtml(svg))}`);
  const image = await browserWindow.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), image.toPNG());
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: SIZE,
    height: SIZE,
    transparent: true,
    frame: false,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false
    }
  });

  for (const [name, svg] of Object.entries(icons)) {
    await renderIcon(win, name, svg);
    console.log(`Generated ${name}.png`);
  }

  app.quit();
});
