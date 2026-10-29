import { translate, requestLanguage } from '../src/i18n';
import { createServer as createHttpsServer } from 'node:https';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { findScenario, interpolate, type Event } from '../src/engine';
import { loadScenarios } from './scenarios';
import type { Options } from './options';
import { loadSettings, resolveSelection, resolveMcpSelection } from './settings';
import type { Selection } from '../src/settings';
import { parseCommand } from '../src/commands';
export type Assets = Record<string, { body: string; type: string }>;
function json(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Disconnected'));
    const done = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error('Disconnected'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}
async function body(request: IncomingMessage): Promise<string> {
  let data = '';
  for await (const chunk of request) {
    data += chunk.toString();
    if (Buffer.byteLength(data) > 65536) throw new Error('Request too large');
  }
  return data;
}
export function makeServer(
  options: Pick<Options, 'scenarios'> & Partial<Pick<Options, 'config'>>,
  assets: Assets,
  tls?: { cert: Buffer; key: Buffer },
) {
  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    let locale = requestLanguage(request.headers['accept-language'] ?? 'fr');
    const tr = (message: string, variables: Record<string, string | number> = {}) =>
      translate(message, locale, variables);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Reject requests originating from a different site; no CORS is enabled.
    if (request.headers.origin && request.headers.origin !== `${tls ? 'https' : 'http'}://${request.headers.host}`)
      return json(response, 403, { error: tr('Access denied.') });
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/settings' && request.method === 'GET') {
      try {
        const settings = await loadSettings(options.config);
        return json(response, 200, settings);
      } catch (error) {
        console.error(`Configuration: ${(error as Error).message}`);
        return json(response, 503, { error: tr('The service is temporarily unavailable. Please try again.') });
      }
    }
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      let prompt: string;
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(await body(request));
        if (input.language === 'fr' || input.language === 'en') locale = input.language;
        if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 16000)
          throw new Error('Invalid prompt');
        prompt = input.prompt.trim();
      } catch {
        return json(response, 400, { error: tr('Enter a question with fewer than 16,000 characters.') });
      }
      let events: Event[];
      let selection: Selection;
      let mcpStates: Record<string, boolean>;
      let mcpServers: { name: string }[];
      let agents: string[];
      try {
        const settings = await loadSettings(options.config);
        try {
          selection = resolveSelection(input, settings);
          mcpStates = resolveMcpSelection(input.mcpStates, settings);
          mcpServers = settings.mcpServers;
          agents = settings.agents;
        } catch (error) {
          return json(response, 400, { error: tr((error as Error).message) });
        }
        const parsed = parseCommand(prompt);
        if (parsed) {
          const command = settings.commands.find(command => command.name === parsed.name);
          if (!command)
            return json(response, 400, { error: tr('Unknown command: {name}', { name: `/${parsed.name}` }) });
          if (command.action)
            return json(response, 400, {
              error: command.action === 'mcp' ? tr('Use /mcp from the interface.') : tr('Use /new from the interface.'),
            });
          // Configured commands are decorative and must never reach the scenario engine.
          response.writeHead(204);
          response.end();
          return;
        }
      } catch (error) {
        console.error(`Configuration: ${(error as Error).message}`);
        return json(response, 503, { error: tr('The service is temporarily unavailable. Please try again.') });
      }
      try {
        const config = await loadScenarios(options.scenarios, mcpServers, agents);
        const match = findScenario(config, prompt, mcpStates, selection.agent);
        const mcpServer = match?.when?.mcpAny?.find(name => mcpStates[name] === true) ?? '';
        events = match
          ? (interpolate(match.events, prompt, { ...selection, mcpServer }) as Event[])
          : [{ type: 'final', content: tr('Could you clarify your request?'), delay: 300, duration: 900 }];
      } catch (error) {
        console.error(`Scenario loading: ${(error as Error).message}`);
        return json(response, 503, { error: tr('The service is temporarily unavailable. Please try again.') });
      }
      const controller = new AbortController();
      const onClose = () => controller.abort();
      response.on('close', onClose);
      response.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      });
      const send = (payload: unknown) => response.write(`${JSON.stringify(payload)}\n`);
      const started = performance.now();
      try {
        send({ type: 'start', selection });
        for (const event of events) {
          await pause(event.delay, controller.signal);
          const { delay: _delay, duration, content, output, ...display } = event;
          // Tool results stay hidden until the call has completed.
          send({ type: 'event', event: display });
          if (event.type === 'tool') await pause(duration, controller.signal);
          else {
            const text = content ?? '';
            const chunks = duration ? Math.min(80, Math.max(1, Math.ceil(text.length / 6))) : 1;
            for (let i = 1; i <= chunks; i++) {
              if (duration) await pause(duration / chunks, controller.signal);
              send({ type: 'text', content: text.slice(0, Math.ceil((text.length * i) / chunks)) });
            }
          }
          send({ type: 'complete', output });
        }
        send({ type: 'done', elapsed: performance.now() - started });
      } catch {
        if (!controller.signal.aborted)
          send({ type: 'error', message: tr('The connection was interrupted. Please try again.') });
      } finally {
        response.off('close', onClose);
        response.end();
      }
      return;
    }
    if (url.pathname.startsWith('/api/')) return json(response, 404, { error: tr('Not found.') });
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return json(response, 405, { error: tr('Method not allowed.') });
    const asset =
      assets[url.pathname === '/' || url.pathname.startsWith('/new-session') ? '/index.html' : url.pathname];
    if (!asset) {
      response.writeHead(404);
      response.end(tr('Not found.'));
      return;
    }
    response.writeHead(200, {
      'Content-Type': asset.type,
      'Cache-Control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : Buffer.from(asset.body, 'base64'));
  };
  return tls ? createHttpsServer(tls, handler) : createServer(handler);
}
