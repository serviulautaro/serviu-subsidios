const { spawn } = require("child_process");

const mode = process.argv[2] === "start" ? "start" : "build";
const script = require.resolve("react-scripts/bin/react-scripts.js");

const child = spawn(process.execPath, [script, mode], {
  stdio: "inherit",
  shell: false,
  env: { ...process.env, REACT_APP_DEMO_MODE: "true" },
});

child.on("exit", (code) => process.exit(code || 0));
