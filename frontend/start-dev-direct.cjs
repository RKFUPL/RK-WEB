const { startServer } = require('./node_modules/next/dist/server/lib/start-server');

async function main() {
  process.env.NODE_ENV = 'development';

  const port = parseInt(process.env.PORT || '3000', 10);
  const hostname = process.env.HOSTNAME || '127.0.0.1';

  await startServer({
    dir: process.cwd(),
    isDev: true,
    hostname,
    port,
    allowRetry: true,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
