#!/usr/bin/env node
/** Test the configured model through the same Bedrock adapter the application uses. */
import '../server/env.js';
import { bedrockText, narrativeStatus } from '../server/narrative.js';

const status = narrativeStatus();
console.log('Configuration');
console.log(`  credentials   ${status.credentialSource}`);
console.log(`  region        ${status.region}`);
console.log(`  model         ${status.model}\n`);

if (!status.bedrockConfigured) {
  console.error('No AWS credentials found. Configure a local AWS profile or server-side .env credentials.');
  process.exitCode = 1;
} else {
  try {
    const text = await bedrockText({
      system: 'Follow the instruction precisely.',
      user: 'Reply with the single word OK.',
      maxTokens: 16,
      temperature: 0,
    });
    if (!text) throw new Error('Bedrock returned no text');
    console.log(`Bedrock is working: ${status.model} returned a response.`);
  } catch (err) {
    let reason = String(err.message ?? err).replace(/\s+/g, ' ');
    for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']) {
      if (process.env[key]) reason = reason.split(process.env[key]).join('[redacted]');
    }
    console.error(`Bedrock check failed: ${reason.slice(0, 1000)}`);
    if (/AccessDenied|not authorized/i.test(reason)) {
      console.error('Check permission to invoke the configured Bedrock model in this region.');
    } else if (/on-demand throughput/i.test(reason)) {
      console.error('Configure a supported inference profile ID for this model and region.');
    } else if (/signature|security token|credentials/i.test(reason)) {
      console.error('Check the local AWS credentials and any required session token.');
    }
    process.exitCode = 1;
  }
}
