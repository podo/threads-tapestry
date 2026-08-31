const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

async function run() {
  const archive = path.join(__dirname, "..", "Threads.tapestry");
  assert.ok(fs.existsSync(archive), "build must produce Threads.tapestry");
  execFileSync("unzip", ["-t", archive], { stdio: "pipe" });
  const listed = execFileSync("unzip", ["-l", archive], { encoding: "utf8" });
  assert.match(listed, /plugin\.js/);
  assert.match(listed, /DESIGN\.md/);
  assert.match(listed, /TESTING\.md/);
  const config = JSON.parse(execFileSync("unzip", ["-p", archive, "plugin-config.json"], { encoding: "utf8" }));
  const ui = JSON.parse(execFileSync("unzip", ["-p", archive, "ui-config.json"], { encoding: "utf8" }));
  const actions = JSON.parse(execFileSync("unzip", ["-p", archive, "actions.json"], { encoding: "utf8" }));
  assert.strictEqual(config.id, "local.threads.web");
  assert.strictEqual(config.display_name, "Threads");
  assert.strictEqual(config.version, 9);
  assert.ok(ui.inputs.some(input => input.name === "show_metrics"));
  assert.ok(ui.inputs.some(input => input.name === "following_account_cap"));
  assert.ok(ui.inputs.some(input => input.name === "authorization_bearer"));
  assert.ok(actions.items.some(item => item.id === "like"));
  assert.ok(actions.items.some(item => item.id === "save"));
  assert.ok(actions.items.some(item => item.id === "thread" && item.role === "context"));
  assert.ok(ui.inputs.some(input => input.name === "sessionid"));
  assert.ok(ui.inputs.some(input => input.name === "csrftoken"));
  assert.ok(ui.inputs.some(input => input.name === "query_doc_id"));
  assert.ok(!ui.inputs.some(input => input.name === "cookie_header"));
  assert.ok(!ui.inputs.some(input => input.name === "query_variables"));
  console.log("Packaged Threads connector archive validated.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
