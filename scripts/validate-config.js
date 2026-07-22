"use strict";

const path = require("path");
const config = require("../launcher.config.json");
const packageJson = require("../package.json");
const { validateConfig } = require("../src/config-validation");

const release = process.argv.includes("--release");
const errors = validateConfig(config, {
  projectRoot: path.join(__dirname, ".."),
  release,
  repository: process.env.GITHUB_REPOSITORY,
});

if (release && process.env.GITHUB_REF_TYPE === "tag") {
  const tagVersion = String(process.env.GITHUB_REF_NAME || "").replace(
    /^v/,
    "",
  );
  if (tagVersion !== packageJson.version) {
    errors.push(
      `tag version ${tagVersion || "(missing)"} does not match package version ${packageJson.version}`,
    );
  }
}

if (
  release &&
  process.env.REPOSITORY_PRIVATE === "true" &&
  config.updates.provider === "github"
) {
  errors.push(
    "private GitHub repositories must use the generic or disabled update provider",
  );
}

if (errors.length > 0) {
  console.error(`Invalid launcher configuration:\n- ${errors.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(
    `Launcher configuration is valid (${config.updates.provider} updates).`,
  );
}
