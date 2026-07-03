// Self-check for CHROME_CANDIDATES construction (mac paths kept + Windows Chrome/Edge added).
// Run: pnpm --filter @qualiflow/adapter-alibaba exec tsx src/cli/chrome-cdp.check.ts
// No framework on purpose (ponytail). Mirrors the builder in chrome-cdp.ts; if that list
// changes shape, update here too.
import assert from "node:assert/strict";

function buildCandidates(env: NodeJS.ProcessEnv): string[] {
  return [
    env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    env.PROGRAMFILES && `${env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    env["PROGRAMFILES(X86)"] && `${env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    env.LOCALAPPDATA && `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    env.PROGRAMFILES && `${env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    env["PROGRAMFILES(X86)"] && `${env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`
  ].filter((value): value is string => Boolean(value));
}

// mac (no Windows env): the two original mac paths survive, no .exe leaks in.
const macList = buildCandidates({});
assert.ok(macList.includes("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), "mac Chrome path missing");
assert.ok(macList.includes("/Applications/Chromium.app/Contents/MacOS/Chromium"), "mac Chromium path missing");
assert.ok(!macList.some((p) => p.endsWith(".exe")), "unexpected .exe candidate with empty env");

// Windows: Chrome under Program Files + Edge fallback, backslashes intact.
const winList = buildCandidates({
  PROGRAMFILES: "C:\\Program Files",
  "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
  LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local"
});
assert.ok(winList.includes("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"), "Windows Chrome path missing");
assert.ok(winList.includes("C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"), "Windows Edge fallback missing");
assert.ok(
  winList.includes("C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"),
  "Windows per-user Chrome path missing"
);
// Chrome candidates must come before Edge (Chrome preferred).
assert.ok(
  winList.findIndex((p) => p.includes("chrome.exe")) < winList.findIndex((p) => p.includes("msedge.exe")),
  "Edge should be a fallback after Chrome"
);

console.log("chrome-cdp candidates self-check OK");
