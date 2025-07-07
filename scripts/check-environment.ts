#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function checkEnv() {
  const envPath = join(process.cwd(), '.env');
  const envExamplePath = join(process.cwd(), '.env.example');

  if (!existsSync(envPath)) {
    console.error('❌ .env file not found!');
    console.log('💡 Copy .env.example to .env and configure your environment variables.');
    process.exit(1);
  }

  if (!existsSync(envExamplePath)) {
    console.warn('⚠️  .env.example file not found!');
    return;
  }

  const envContent = await readFile(envPath, 'utf-8');
  const envExampleContent = await readFile(envExamplePath, 'utf-8');

  const envKeys = extractKeys(envContent);
  const exampleKeys = extractKeys(envExampleContent);

  const missingKeys = exampleKeys.filter((key) => !envKeys.includes(key));

  if (missingKeys.length > 0) {
    console.warn('⚠️  Missing environment variables:');
    missingKeys.forEach((key) => console.warn(`   - ${key}`));
    console.log('\n💡 Check .env.example for required variables.');
  } else {
    console.log('✅ All environment variables are set!');
  }
}

function extractKeys(content: string): string[] {
  return content
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .map((line) => line.split('=')[0]?.trim() ?? '')
    .filter(Boolean);
}

checkEnv().catch(console.error);
