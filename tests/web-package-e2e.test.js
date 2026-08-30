const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { runSource } = require("./web.test.js");

async function run() {
  const archive = path.join(__dirname, "..", "dist", "ThreadsWeb.tapestry");
  assert.ok(fs.existsSync(archive), "build must produce ThreadsWeb.tapestry");
  execFileSync("unzip", ["-t", archive], { stdio: "pipe" });
  const plugin = execFileSync("unzip", ["-p", archive, "plugin.js"], { encoding: "utf8" });
  const config = JSON.parse(execFileSync("unzip", ["-p", archive, "plugin-config.json"], { encoding: "utf8" }));
  const ui = JSON.parse(execFileSync("unzip", ["-p", archive, "ui-config.json"], { encoding: "utf8" }));
  assert.strictEqual(config.id, "local.threads.web");
  assert.ok(ui.inputs.some(input => input.name === "sessionid"));
  assert.ok(ui.inputs.some(input => input.name === "query_doc_id"));
  await runSource(plugin);
  console.log("Packaged Threads Web connector passed full rendering E2E.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
