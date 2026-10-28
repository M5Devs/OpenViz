import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { importAveeViz } from '../importer/avee';

export function runCLI(argv: string[]) {
  const program = new Command();

  program
    .name('openviz')
    .description('OpenViz Terminal CLI - Web-Native Creative Suite & Audio Visualizer')
    .version('2.0.0');

  // Command 1: info <template.viz>
  program
    .command('info <template>')
    .description('Inspect .viz template composition structure and element hierarchy')
    .action(async (templatePath: string) => {
      try {
        const resolvedPath = path.resolve(templatePath);
        if (!fs.existsSync(resolvedPath)) {
          console.error(`Error: File not found at '${resolvedPath}'`);
          process.exit(1);
        }

        const buffer = fs.readFileSync(resolvedPath);
        const template = await importAveeViz(buffer);

        console.log('\n--- OpenViz Template Info ---');
        console.log(`Schema Version: ${template.schemaVersion}`);
        console.log(`Name:           ${template.name}`);
        console.log(`Aspect Ratio:   ${template.canvasAspect}`);
        console.log(`Nodes Count:    ${template.nodes.length}`);
        console.log(`Post Effects:   ${template.postEffects.length}`);
        console.log(`Extracted Assets: ${Object.keys(template.assets || {}).length}`);
        console.log('\nNodes Hierarchy:');

        template.nodes.forEach((node, i) => {
          console.log(`  [${i + 1}] ${node.name} (${node.type})`);
          if (node.bindings.length > 0) {
            node.bindings.forEach((b) => {
              console.log(`      -> Audio Binding: ${b.source} => ${b.target} [${b.outputRange.join(', ')}]`);
            });
          }
        });
        console.log('-----------------------------\n');
      } catch (err) {
        console.error('Failed to inspect template:', (err as Error).message);
        process.exit(1);
      }
    });

  // Command 2: convert <template.viz> -o template.json
  program
    .command('convert <template>')
    .description('Convert .viz legacy template to clean OpenViz JSON schema')
    .option('-o, --output <outputFile>', 'Output JSON file path', 'template.json')
    .action(async (templatePath: string, options: { output: string }) => {
      try {
        const resolvedPath = path.resolve(templatePath);
        if (!fs.existsSync(resolvedPath)) {
          console.error(`Error: File not found at '${resolvedPath}'`);
          process.exit(1);
        }

        const buffer = fs.readFileSync(resolvedPath);
        const template = await importAveeViz(buffer, {
          assetMode: 'dataUrl',
          maxFileBytes: 5 * 1024 * 1024,
        });

        const outputPath = path.resolve(options.output);
        fs.writeFileSync(outputPath, JSON.stringify(template, null, 2), 'utf-8');

        console.log(`✓ Successfully converted '${templatePath}' -> '${outputPath}'`);
      } catch (err) {
        console.error('Failed to convert template:', (err as Error).message);
        process.exit(1);
      }
    });

  // Command 3: dev
  program
    .command('dev')
    .description('Launch local Vite Studio server')
    .action(() => {
      console.log('Starting OpenViz Studio Vite dev server...');
      const viteProc = spawn('npx', ['vite'], { stdio: 'inherit', shell: true });
      viteProc.on('exit', (code) => {
        process.exit(code || 0);
      });
    });

  program.parse(argv);
}
