import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { makeServer } from '../server/app';
import { loadScenarios } from '../server/scenarios';
import { loadSettings } from '../server/settings';
import { findScenario, matches } from '../src/engine';

test('fuzzy project search tolerates typos and leaves changes to Trinity', async () => {
  const settings = await loadSettings(resolve('config.yaml'));
  const config = await loadScenarios(resolve('scenarios'), settings.mcpServers, settings.agents);
  const scenario = config.scenarios.find(scenario => scenario.id === 'projets-github')!;
  assert.equal(scenario.matcher.type, 'fuzzy');
  for (const prompt of [
    'Peux-tu me lister les projets dans l’organisation Example ?',
    'Quels sont les projtes en cours ?',
    'Recherhce les dépots Example',
    'List the GitHub repositories',
    'Liste les projets Trinity',
  ]) {
    for (const server of ['github', 'github via NAI']) {
      const states = { github: false, 'github via NAI': false, [server]: true };
      assert.equal(findScenario(config, prompt, states, 'Brown')?.id, scenario.id, prompt);
      assert.notEqual(findScenario(config, prompt, states, 'Jones')?.id, scenario.id, prompt);
    }
  }
  for (const prompt of [
    'Bonjour',
    'Liste les outils GitHub',
    'Crée une branche de test pour un nouvel agent',
    'Mets à jour le README du projet pour Trinity',
  ]) {
    assert.equal(matches(scenario, prompt), false, prompt);
  }
  assert.equal(
    findScenario(config, 'Mets à jour le README du projet pour Trinity', { github: true }, 'Brown')?.id,
    'trinity-readme-github',
  );
});

test('project search follows the workflow and reports the active MCP over HTTP', async () => {
  const settings = await loadSettings(resolve('config.yaml'));
  const config = await loadScenarios(resolve('scenarios'), settings.mcpServers, settings.agents);
  const projects = config.scenarios.filter(scenario => scenario.id.startsWith('projets-'));
  assert.equal(projects.length, 1);
  const scenario = projects[0];
  const tools = scenario.events.filter(event => event.type === 'tool');
  assert.deepEqual(
    tools.map(event => event.name),
    ['get_me', 'search_repositories'],
  );
  assert.equal((tools[1].output as { total_count: number }).total_count, 12);
  assert.ok(scenario.events.at(-1)!.content!.includes('terraform-provider-example'));
  const directory = await mkdtemp(join(tmpdir(), 'github-projects-'));
  const server = makeServer({ scenarios: directory, config: resolve('config.yaml') }, {});
  try {
    await writeFile(
      join(directory, 'projects.yaml'),
      stringify({
        version: 1,
        ...scenario,
        events: scenario.events.map(event => ({ ...event, duration: 0, delay: 0 })),
      }),
    );
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    for (const [github, nai, expectedServer] of [
      [true, false, 'github'],
      [false, true, 'github via NAI'],
      [true, true, 'github'],
    ] as const) {
      const response: Response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: scenario.example,
          agent: 'Brown',
          mcpStates: { github, 'github via NAI': nai },
        }),
      });
      assert.equal(response.status, 200);
      const stream: { type: string; event?: { type: string; server?: string } }[] = (await response.text())
        .trim()
        .split('\n')
        .map(line => JSON.parse(line));
      const calls = stream.filter(item => item.type === 'event' && item.event?.type === 'tool');
      assert.equal(calls.length, 2);
      assert.ok(calls.every(item => item.event?.server === expectedServer));
      assert.equal(stream.at(-1)?.type, 'done');
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('without a GitHub MCP, project search only asks for clarification', async () => {
  const settings = await loadSettings(resolve('config.yaml'));
  const config = await loadScenarios(resolve('scenarios'), settings.mcpServers, settings.agents);
  for (const agent of settings.agents) {
    const scenario = findScenario(
      config,
      'Quels sont les projets en cours ?',
      { github: false, 'github via NAI': false },
      agent,
    );
    assert.equal(scenario?.id, 'recherche');
    assert.equal(scenario!.events.length, 1);
    assert.equal(scenario!.events[0].type, 'final');
    assert.equal(
      scenario!.events[0].content,
      "De quel projet parles-tu ? Je n'ai pas d'outil spécifique pour faire ce genre de recherche.",
    );
  }
  for (const server of ['github', 'github via NAI']) {
    assert.notEqual(
      findScenario(
        config,
        'Quels sont les projets en cours ?',
        { github: false, 'github via NAI': false, [server]: true },
        'Brown',
      )?.id,
      'recherche',
    );
  }
});

test('the GitHub scenarios are reserved for Brown and require their MCP', async () => {
  const settings = await loadSettings(resolve('config.yaml'));
  const config = await loadScenarios(resolve('scenarios'), settings.mcpServers, settings.agents);
  const examples: [string, string, string][] = [
    ['Liste-moi les outils GitHub auxquels tu as accès', 'github', 'outils-github'],
    ['Liste-moi les outils GitHub auxquels tu as accès', 'github via NAI', 'outils-nai'],
    ['Quels sont les projets en cours ?', 'github', 'projets-github'],
    ['Quels sont les projets en cours ?', 'github via NAI', 'projets-github'],
    ['Crée-moi une branche de test pour rajouter un nouvel agent dans le repo', 'github', 'creation-branche-github'],
    [
      'Crée-moi une branche de test pour rajouter un nouvel agent dans le repo',
      'github via NAI',
      'creation-branche-github',
    ],
    [
      "Cet agent permettra de surveiller l'infrastructure, appelle le Trinity et met à jour uniquement le fichier readme pour l'instant.",
      'github',
      'trinity-readme-github',
    ],
    [
      "Cet agent permettra de surveiller l'infrastructure, appelle le Trinity et met à jour uniquement le fichier readme pour l'instant.",
      'github via NAI',
      'trinity-readme-github',
    ],
  ];
  const githubIds = new Set(examples.map(([, , id]) => id));
  for (const [prompt, server, id] of examples) {
    const states = { github: false, 'github via NAI': false, [server]: true };
    assert.equal(findScenario(config, prompt, states, 'Brown')?.id, id);
    for (const agent of [...settings.agents.filter(name => name !== 'Brown'), 'brown', undefined]) {
      assert.ok(!githubIds.has(findScenario(config, prompt, states, agent)?.id ?? ''), `${agent}: ${prompt}`);
      assert.ok(
        !githubIds.has(findScenario(config, prompt, { github: true, 'github via NAI': true }, agent)?.id ?? ''),
        `${agent}: both MCPs`,
      );
    }
    assert.ok(
      !githubIds.has(findScenario(config, prompt, { github: false, 'github via NAI': false }, 'Brown')?.id ?? ''),
    );
  }
});

test('Trinity only publishes one README line on the test branch', async () => {
  const settings = await loadSettings(resolve('config.yaml'));
  const config = await loadScenarios(resolve('scenarios'), settings.mcpServers, settings.agents);
  const states = { github: true, 'github via NAI': true };
  const scenario = findScenario(config, 'Mets à jour le README du projet pour Trinity', states, 'Brown')!;
  assert.equal(scenario.id, 'trinity-readme-github');
  assert.equal(scenario.matcher.type, 'fuzzy');
  for (const prompt of [
    'Mets à jour le README du projet pour Trinity',
    'Modifie le readme pour Trinty',
    'Documente Trinity dans le readm du projet',
    'Update the README for Trinity',
    'Cet agent surveillera l’infrastructure, appelle le Trinity et met às jour uniquement le fichier readme',
  ])
    assert.equal(findScenario(config, prompt, states, 'Brown')?.id, scenario.id, prompt);
  for (const prompt of ['Liste les projets Trinity', 'Crée une branche pour Trinity']) {
    assert.equal(matches(scenario, prompt), false, prompt);
  }
  assert.equal(
    findScenario(config, 'Appelle le Trinity et met às jour uniquement le fichier readme', states, 'Brown')?.id,
    scenario.id,
  );
  const tools = scenario.events.filter(event => event.type === 'tool');
  assert.deepEqual(
    tools.map(event => event.name),
    ['get_file_contents', 'push_files', 'create_pull_request', 'merge_pull_request', 'sync_main'],
  );
  assert.ok(scenario.events.some(event => event.type === 'thinking' && event.content?.includes('ouvrir une PR')));
  assert.ok(scenario.events.some(event => event.type === 'thinking' && event.content?.includes('fusion squash')));
  assert.equal((tools[2].input as { base: string }).base, 'main');
  assert.equal((tools[3].input as { merge_method: string }).merge_method, 'squash');
  assert.equal((tools[3].output as { sha: string }).sha, '02ecbf7');
  assert.equal((tools[4].output as { up_to_date: boolean }).up_to_date, true);
  const before = (tools[0].output as { content: string }).content;
  const write = tools[1].input as { branch: string; files: { path: string; content: string }[] };
  assert.equal(write.branch, 'test/add-agent');
  assert.equal(write.files.length, 1);
  assert.equal(write.files[0].path, 'README.md');
  const row =
    '| Trinity Monitor | Monitors infrastructure health and calls Trinity when attention is required | `monitoring` |';
  assert.ok(write.files[0].content.includes(row));
  assert.equal(write.files[0].content.replace(`${row}\n`, '').trimEnd(), before.trimEnd());
  assert.equal(scenario.events[0].type, 'message');
  assert.equal(
    scenario.events[0].content,
    'Je documente le nouvel agent de surveillance directement dans `README.md`, sans modifier les configurations existantes.',
  );
  assert.ok(
    scenario.events.some(
      event =>
        event.type === 'message' &&
        event.content?.includes('Commit et push effectués sur `test/add-agent` : `8f555c1`.'),
    ),
  );
  assert.equal(
    scenario.events.at(-1)!.content,
    'PR créée et fusionnée dans `main` : [#1](https://github.com/example-org/sandbox/pull/1).\n\n- Fusion squash : `02ecbf7`\n- La branche locale `main` est à jour avec `origin/main`.\n',
  );
  assert.notEqual(findScenario(config, 'Liste les projets Trinity', states, 'Brown')?.id, scenario.id);
  assert.equal(findScenario(config, 'Liste les projets Trinity', states, 'Brown')?.id, 'projets-github');
});

test('branch creation is fast and takes priority over project search', async () => {
  const settings = await loadSettings(resolve('config.yaml'));
  const config = await loadScenarios(resolve('scenarios'), settings.mcpServers, settings.agents);
  const states = { github: true, 'github via NAI': true };
  for (const prompt of [
    'Crée-moi une branche de test pour rajouter un nouvel agent dans le repo',
    'Créer une branche de test pour ajouter un agent dans mon projet',
    'Create a test branch to add a new agent',
    'Crée une brnache de test pour ajouter un agnet',
  ]) {
    const scenario = findScenario(config, prompt, states, 'Brown')!;
    assert.equal(scenario.id, 'creation-branche-github');
    assert.equal(scenario.matcher.type, 'fuzzy');
    assert.ok(scenario.events.reduce((sum, event) => sum + event.duration + event.delay, 0) < 1000);
    assert.equal(
      scenario.events.at(-1)!.content,
      'Branche créée et publiée : `test/add-agent`.\nElle est basée sur `main` et suivie par `origin/test/add-agent`.\n',
    );
  }
  for (const prompt of [
    'Liste les branches de test pour cet agent',
    'Crée une branche de production',
    'Quels sont les projets en cours ?',
  ]) {
    assert.notEqual(findScenario(config, prompt, states, 'Brown')?.id, 'creation-branche-github');
  }
});

test('the tool list requires the plain GitHub MCP, regardless of GitHub via NAI', async () => {
  const settings = await loadSettings(resolve('config.yaml'));
  const config = await loadScenarios(resolve('scenarios'), settings.mcpServers, settings.agents);
  const prompts = [
    'Liste-moi les outils GitHub auxquels tu as accès',
    'Quels sont les outils disponibles ?',
    'Affiche les outils accessibles via GitHub',
    'List the available GitHub tools',
  ];
  for (const prompt of prompts) {
    for (const nai of [false, true]) {
      assert.equal(
        findScenario(config, prompt, { github: true, 'github via NAI': nai }, 'Brown')?.id,
        'outils-github',
        prompt,
      );
      assert.notEqual(
        findScenario(config, prompt, { github: false, 'github via NAI': nai }, 'Brown')?.id,
        'outils-github',
        prompt,
      );
    }
    assert.notEqual(findScenario(config, prompt, {}, 'Brown')?.id, 'outils-github', prompt);
  }
  assert.equal(
    findScenario(config, 'Quels sont les projets en cours ?', { github: true }, 'Brown')?.id,
    'projets-github',
  );
  assert.notEqual(findScenario(config, 'Liste les dépôts GitHub', { github: true }, 'Brown')?.id, 'outils-github');
});

test('GitHub via NAI alone offers a read-only list with sensitive operations disabled', async () => {
  const settings = await loadSettings(resolve('config.yaml'));
  const config = await loadScenarios(resolve('scenarios'), settings.mcpServers, settings.agents);
  for (const prompt of [
    'Liste-moi les outils GitHub auxquels tu as accès',
    'Quels sont les outils disponibles ?',
    'List the available GitHub tools',
  ]) {
    const scenario = findScenario(config, prompt, { github: false, 'github via NAI': true }, 'Brown');
    assert.equal(scenario?.id, 'outils-nai');
    assert.ok(scenario!.events.every(event => event.type !== 'tool'));
    const content = scenario!.events.at(-1)!.content!;
    for (const restriction of [
      'lecture seule',
      'Opérations sensibles désactivées',
      'merge_pull_request',
      'update_pull_request_branch',
      'Créer, modifier ou supprimer des tags',
      'aucune opération d’écriture',
    ]) {
      assert.ok(content.includes(restriction), restriction);
    }
    assert.notEqual(
      findScenario(config, prompt, { github: false, 'github via NAI': false }, 'Brown')?.id,
      'outils-nai',
    );
    assert.equal(findScenario(config, prompt, { github: true, 'github via NAI': true }, 'Brown')?.id, 'outils-github');
  }
});
