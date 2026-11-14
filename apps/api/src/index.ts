import 'dotenv/config';
import { createPorts } from '@ugra/adapters';
import { createPgStore } from '@ugra/db';
import { loadReferenceData } from './data';
import { buildServer } from './server';

async function main(): Promise<void> {
  const data = await loadReferenceData();
  const ports = createPorts(process.env);
  const { store, close } = createPgStore(process.env.DATABASE_URL);
  const ctx = await buildServer({ store, ports, data, logger: true });
  const port = Number(process.env.PORT ?? 3001);
  await ctx.app.listen({ port, host: '0.0.0.0' });
  const shutdown = async (): Promise<void> => {
    await ctx.app.close();
    await close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
