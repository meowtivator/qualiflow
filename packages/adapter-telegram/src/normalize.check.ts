import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createTelegramAdapterFromUserDialogs,
  normalizeTelegramUserDialogs,
  type TelegramUserDialog
} from "./index.js";

function assert(label: string, condition: boolean): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${label}`);
  }
  console.log(`✅ ${label}`);
}

const fixturePath = resolve("fixtures/sample-dialogs.json");
const dialogs = JSON.parse(await readFile(fixturePath, "utf8")) as TelegramUserDialog[];
const conversations = normalizeTelegramUserDialogs(dialogs, { operatorDisplayName: "Operator" });

assert("one Telegram user dialog is produced", conversations.length === 1);
assert("conversation has two messages", conversations[0]?.messages.length === 2);
assert("first message is inbound", conversations[0]?.messages[0]?.direction === "inbound");
assert("second message is outbound", conversations[0]?.messages[1]?.direction === "outbound");

const adapter = createTelegramAdapterFromUserDialogs(dialogs, { operatorDisplayName: "Operator" });
const threadPage = await adapter.listThreads();
const messagePage = await adapter.listMessages({ threadId: threadPage.items[0]?.id ?? "" });
const syncResult = await adapter.syncMessages?.();

assert("adapter exposes one thread", threadPage.items.length === 1);
assert("adapter lists normalized messages", messagePage.items.length === 2);
assert("adapter sync result includes normalized messages", (syncResult?.messages.length ?? 0) === 2);
