import { loadTls } from './tls';
import { realpathSync } from 'node:fs';
import { assets } from './generated-assets';
import { makeServer } from './app';
import { parseOptions } from './options';
import { loadScenarios } from './scenarios';
import { loadSettings } from './settings';
try {
  const options = parseOptions(process.argv.slice(2), realpathSync(process.execPath));
  if (options.help) {
    console.log(
      `Harness Emulator — local server\n\nUsage: harness-emulator [--port 4097] [--scenarios PATH] [--config PATH] [--tls] [--tls-cert CERT] [--tls-key KEY] [--check]\n\nThe scenarios/ directory is located in the current working directory.\n--check     Validate the configuration and scenarios without starting the server.\n--port      Localhost port (4097 for HTTP, 443 with --tls).\n--tls       Enable HTTPS using cert.pem and key.pem in the current working directory.\n--tls-cert  Path to the PEM certificate.\n--tls-key   Path to the PEM private key.\n--scenarios Use a different directory.\n--config    Use a different configuration file.\n--help      Show this help.`,
    );
  } else {
    const settings = await loadSettings(options.config);
    const config = await loadScenarios(options.scenarios, settings.mcpServers, settings.agents);
    const tls = options.tls ? loadTls(options.tlsCert, options.tlsKey) : undefined;
    if (options.check)
      console.log(`Valid configuration; ${config.scenarios.length} valid scenarios in ${options.scenarios}`);
    else {
      const server = makeServer(options, assets, tls);
      server.on('error', error => {
        console.error(`Unable to start: ${error.message}`);
        process.exitCode = 1;
      });
      server.listen(options.port, '127.0.0.1', () =>
        console.log(
          `Harness Emulator\n\n  ${options.tls ? 'https' : 'http'}://127.0.0.1:${options.port}\n\n  Scenarios: ${options.scenarios}\n  Ctrl+C to stop.`,
        ),
      );
      const stop = () => {
        server.closeAllConnections();
        server.close(() => process.exit(0));
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    }
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
