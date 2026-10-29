import { dirname, resolve } from 'node:path';
export interface Options {
  port: number;
  scenarios: string;
  config: string;
  help: boolean;
  check: boolean;
  tls: boolean;
  tlsCert: string;
  tlsKey: string;
}
export function parseOptions(args: string[], executable: string): Options {
  const options: Options = {
    port: 4097,
    scenarios: resolve('scenarios'),
    config: resolve(dirname(executable), 'config.yaml'),
    help: false,
    check: false,
    tls: false,
    tlsCert: resolve('cert.pem'),
    tlsKey: resolve('key.pem'),
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--tls') options.tls = true;
    else if (arg === '--check') options.check = true;
    else if (arg === '--port') {
      const value = args[++i];
      if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
        throw new Error('--port requires an integer between 1 and 65535.');
      options.port = Number(value);
    } else if (['--scenarios', '--config', '--tls-cert', '--tls-key'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path.`);
      options[
        arg === '--config' ? 'config' : arg === '--tls-cert' ? 'tlsCert' : arg === '--tls-key' ? 'tlsKey' : 'scenarios'
      ] = resolve(value);
    } else throw new Error(`Unknown option: ${arg}. Use --help.`);
  }
  if (!options.tls && args.some(arg => arg === '--tls-cert' || arg === '--tls-key'))
    throw new Error('--tls-cert and --tls-key require --tls.');
  if (options.tls && !args.includes('--port')) options.port = 443;
  return options;
}
