import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, copyFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
const executable = process.platform === 'win32' ? 'harness-emulator.exe' : 'harness-emulator';
const native = resolve('release', `${process.platform}-${process.arch}`, executable);
(existsSync(native) ? test : test.skip)(
  'a moved binary serves embedded assets and reloads scenarios from its working directory',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'opencode-portable-'));
    const moved = join(directory, executable),
      working = join(directory, 'working'),
      scenarios = join(working, 'scenarios');
    let child: ReturnType<typeof spawn> | undefined;
    try {
      await mkdir(scenarios, { recursive: true });
      await mkdir(join(directory, 'scenarios'));
      await writeFile(join(directory, 'scenarios', 'invalid.yaml'), 'invalid: true');
      await copyFile(native, moved);
      await writeFile(
        join(directory, 'config.yaml'),
        'version: 1\nagents: [Architecte]\nmodels: [Atlas]\nreasoningLevels: [Default, High]\n',
      );
      const config = (content: string) =>
        `version: 1\nid: portable\nname: Secret name\nmatcher: { type: exact, value: ping }\nevents:\n  - type: final\n    content: '${content}'\n    duration: 10\n`;
      await writeFile(join(scenarios, 'portable.yaml'), config('Portable first'));
      const checked = await promisify(execFile)(moved, ['--check'], { cwd: working });
      assert.match(checked.stdout, /1 valid scenarios/);
      assert.ok(checked.stdout.includes(scenarios));
      if (process.platform !== 'win32') {
        const link = join(directory, 'harness-emulator-link');
        await symlink(moved, link);
        assert.ok((await promisify(execFile)(link, ['--check'], { cwd: working })).stdout.includes(scenarios));
      }
      const reserve = createServer();
      await new Promise<void>(r => reserve.listen(0, '127.0.0.1', r));
      const address = reserve.address();
      assert.ok(address && typeof address === 'object');
      const port = address.port;
      await new Promise<void>(r => reserve.close(() => r()));
      child = spawn(moved, ['--port', String(port)], { cwd: working, stdio: ['ignore', 'pipe', 'pipe'] });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Startup timed out')), 10000);
        child!.once('error', error => {
          clearTimeout(timeout);
          reject(error);
        });
        child!.once('exit', code => {
          clearTimeout(timeout);
          reject(new Error(`Server exited: ${code}`));
        });
        child!.stdout!.on('data', data => {
          if (data.toString().includes(`127.0.0.1:${port}`)) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
      const url = `http://127.0.0.1:${port}`;
      const settings = await (await fetch(`${url}/api/settings`)).json();
      assert.deepEqual(settings.agents, ['Architecte']);
      assert.deepEqual(settings.models, ['Atlas']);
      const html = await (await fetch(url)).text();
      assert.match(html, /<title>OpenCode<\/title>/);
      const asset = html.match(/src="([^"]+\.js)"/);
      assert.ok(asset);
      const js = await (await fetch(`${url}${asset[1]}`)).text();
      assert.ok(js.length > 10000);
      assert.ok(!/Émulateur|Émulation locale|Scénarios|YAML|matcher/.test(js));
      const chat = () =>
        fetch(`${url}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'ping' }),
        });
      assert.match(await (await chat()).text(), /Portable first/);
      await writeFile(join(scenarios, 'portable.yaml'), config('Portable updated'));
      assert.match(await (await chat()).text(), /Portable updated/);
    } finally {
      if (child && child.exitCode === null) {
        const exited = new Promise<void>(r => child!.once('exit', () => r()));
        child.kill('SIGTERM');
        await exited;
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
  20000,
);
