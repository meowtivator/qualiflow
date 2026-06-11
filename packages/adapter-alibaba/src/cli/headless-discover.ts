#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runAlibabaHeadlessDiscovery, type AlibabaHeadlessDiscoveryOptions } from "../headless.js";
import type { AlibabaInboundBuyer } from "../index.js";

type CliArgs = AlibabaHeadlessDiscoveryOptions & {
  input?: string;
  output?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    headless: true,
    maxCandidatesPerBuyer: 12,
    maxMatchesPerCandidate: 3
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--input") {
      args.input = next;
      index += 1;
    } else if (arg === "--output") {
      args.output = next;
      index += 1;
    } else if (arg === "--headed") {
      args.headless = false;
    } else if (arg === "--channel") {
      args.browserChannel = next as CliArgs["browserChannel"];
      index += 1;
    } else if (arg === "--executable-path") {
      args.executablePath = next;
      index += 1;
    } else if (arg === "--max-candidates") {
      args.maxCandidatesPerBuyer = Number(next);
      index += 1;
    } else if (arg === "--max-matches") {
      args.maxMatchesPerCandidate = Number(next);
      index += 1;
    }
  }

  return args;
}

function printUsage() {
  console.error(`Usage:
  pnpm --filter @qualiflow/adapter-alibaba headless:discover -- --input ./alibaba-buyers.json --output ./discovery-report.json --channel chrome

Input must be a JSON array matching AlibabaInboundBuyer:
[
  {
    "externalLeadId": "ali-1001",
    "buyerName": "Olivia Grant",
    "companyName": "Harbor Beauty Imports",
    "countryCode": "US",
    "receivedAt": "2026-05-17T10:00:00.000Z"
  }
]`);
}

const args = parseArgs(process.argv.slice(2));

if (!args.input) {
  printUsage();
  process.exit(1);
}

const inputPath = resolve(args.input);
const outputPath = args.output ? resolve(args.output) : undefined;
const rawInput = await readFile(inputPath, "utf8");
const buyers = JSON.parse(rawInput) as AlibabaInboundBuyer[];

if (!Array.isArray(buyers)) {
  throw new Error("Alibaba dataset must be a JSON array.");
}

const reports = await runAlibabaHeadlessDiscovery(buyers, {
  headless: args.headless,
  browserChannel: args.browserChannel,
  executablePath: args.executablePath,
  maxCandidatesPerBuyer: args.maxCandidatesPerBuyer,
  maxMatchesPerCandidate: args.maxMatchesPerCandidate
});

const output = `${JSON.stringify(reports, null, 2)}\n`;

if (outputPath) {
  await writeFile(outputPath, output, "utf8");
} else {
  process.stdout.write(output);
}
