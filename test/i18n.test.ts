import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocale, translate } from "../src/i18n.js";

test("resolves supported browser languages", () => {
  assert.equal(resolveLocale(["zh-TW"]), "zh-TW");
  assert.equal(resolveLocale(["zh-Hant", "en-US"]), "zh-TW");
  assert.equal(resolveLocale(["en-GB"]), "en-US");
  assert.equal(resolveLocale(["ja-JP", "zh-TW"]), "zh-TW");
  assert.equal(resolveLocale(["ja-JP"]), "en-US");
});

test("translates and interpolates both locales", () => {
  assert.equal(translate("zh-TW", "agentModes"), "模式");
  assert.equal(translate("en-US", "agentModes"), "Modes");
  assert.equal(
    translate("zh-TW", "sessionClosed", { session: "project-one" }),
    "已關閉 project-one 分頁；tmux session 仍在執行。",
  );
  assert.equal(
    translate("zh-TW", "uploadProgress", { current: 1, total: 2, file: "需求.txt" }),
    "正在上傳 1 / 2：需求.txt",
  );
  assert.equal(
    translate("en-US", "uploadProgress", { current: 1, total: 2, file: "brief.txt" }),
    "Uploading 1 of 2: brief.txt",
  );
});
