import { join } from 'node:path';
import { ArtifactDao, WorkspaceDao } from '@gobing-ai/spur-domain';
import { CLI_CONFIG } from '../config';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Initialize or refresh the local `.spur` project scaffold. */
export async function runInitCommand(context: CliContext, flags: Record<string, string | boolean>): Promise<number> {
    const projectName = typeof flags.name === 'string' ? flags.name : 'default';
    const configPath = join(context.cwd, CLI_CONFIG.configFile);
    const config = {
        version: 1,
        project: projectName,
        database: CLI_CONFIG.databaseFile,
        generatedBy: '@gobing-ai/spur-cli',
    };

    await context.fs.mkdir(join(context.cwd, CLI_CONFIG.configDir));
    await context.fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const db = await context.getDb();
    await new WorkspaceDao(db).add({
        name: projectName,
        root: context.cwd,
        purpose: 'local project',
        defaultAgent: 'pi',
    });
    await new ArtifactDao(db).record({ path: configPath, kind: 'config' });

    const result = { ok: true, config: CLI_CONFIG.configFile, workspace: projectName };
    context.output.write(flags.json === true ? toJson(result) : `Initialized ${CLI_CONFIG.configFile}`);
    return 0;
}
