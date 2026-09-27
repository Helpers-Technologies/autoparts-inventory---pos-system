"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const BUNDLE_VERSION = 1;
const ARRAY_CHUNK_SIZE = 25000;

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function writeFixtureBundle(dataset, bundleDir) {
  const root = path.resolve(bundleDir);
  fs.mkdirSync(root, { recursive: true });
  const entries = [];
  let bytes = 0;
  const aggregate = crypto.createHash("sha256");

  for (const [name, value] of Object.entries(dataset)) {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    if (Array.isArray(value)) {
      const collectionDir = path.join(root, "collections", safeName);
      fs.mkdirSync(collectionDir, { recursive: true });
      const files = [];
      const chunks = Math.ceil(value.length / ARRAY_CHUNK_SIZE);
      for (let index = 0; index < chunks; index++) {
        const relative = path.posix.join("collections", safeName, `${String(index).padStart(5, "0")}.json`);
        const text = JSON.stringify(value.slice(index * ARRAY_CHUNK_SIZE, (index + 1) * ARRAY_CHUNK_SIZE));
        fs.writeFileSync(path.join(root, ...relative.split("/")), text);
        const file = { path: relative, bytes: Buffer.byteLength(text), sha256: sha256(text) };
        files.push(file);
        bytes += file.bytes;
        aggregate.update(`${name}\0${index}\0${file.sha256}\0`);
      }
      entries.push({ name, type: "array", count: value.length, chunkSize: ARRAY_CHUNK_SIZE, files });
    } else {
      const relative = path.posix.join("scalars", `${safeName}.json`);
      const text = JSON.stringify(value);
      fs.mkdirSync(path.join(root, "scalars"), { recursive: true });
      fs.writeFileSync(path.join(root, ...relative.split("/")), text);
      const file = { path: relative, bytes: Buffer.byteLength(text), sha256: sha256(text) };
      bytes += file.bytes;
      aggregate.update(`${name}\0scalar\0${file.sha256}\0`);
      entries.push({ name, type: "scalar", file });
    }
  }

  const index = { bundleVersion: BUNDLE_VERSION, arrayChunkSize: ARRAY_CHUNK_SIZE, entries };
  const indexText = `${JSON.stringify(index, null, 2)}\n`;
  fs.writeFileSync(path.join(root, "index.json"), indexText);
  bytes += Buffer.byteLength(indexText);
  return { path: root, bytes, sha256: aggregate.digest("hex"), index };
}

function loadFixtureBundle(source) {
  const resolved = path.resolve(source);
  if (!fs.statSync(resolved).isDirectory()) {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  }
  const index = JSON.parse(fs.readFileSync(path.join(resolved, "index.json"), "utf8"));
  if (index.bundleVersion !== BUNDLE_VERSION || !Array.isArray(index.entries)) {
    throw new Error(`unsupported fixture bundle at ${resolved}`);
  }
  const dataset = {};
  for (const entry of index.entries) {
    if (entry.type === "array") {
      const rows = [];
      for (const file of entry.files) {
        const text = fs.readFileSync(path.join(resolved, ...file.path.split("/")), "utf8");
        if (sha256(text) !== file.sha256) throw new Error(`${entry.name}: checksum mismatch in ${file.path}`);
        const chunk = JSON.parse(text);
        for (const row of chunk) rows.push(row);
      }
      if (rows.length !== entry.count) throw new Error(`${entry.name}: expected ${entry.count}, loaded ${rows.length}`);
      dataset[entry.name] = rows;
    } else {
      const text = fs.readFileSync(path.join(resolved, ...entry.file.path.split("/")), "utf8");
      if (sha256(text) !== entry.file.sha256) throw new Error(`${entry.name}: checksum mismatch in ${entry.file.path}`);
      dataset[entry.name] = JSON.parse(text);
    }
  }
  return dataset;
}

module.exports = { BUNDLE_VERSION, ARRAY_CHUNK_SIZE, writeFixtureBundle, loadFixtureBundle };
