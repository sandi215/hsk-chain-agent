import { config } from './config.js';
import { runLoop } from './agent.js';
import { createBot } from './bot.js';
import { agentAddress } from './chain.js';

async function main(): Promise<void> {
  console.log(`HSK agent starting — vault ${config.vaultAddress}`);
  console.log(`agent address: ${agentAddress()}`);
  const bot = createBot();
  if (bot) {
    bot.start().catch((err) => console.error('bot failed:', err));
    console.log('Telegram bot started');
  }
  await runLoop();
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
