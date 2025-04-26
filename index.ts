#!/usr/bin/env node

/**
 * this component serves as:
 * - typescript transpiler
 * - rollup configurator
 */
import { BuildType, ValidateParameters } from './Parameters';
import { CheckForUpdates } from './VersionMon';
import { ValidatePlugin } from './Linter';
import { TranspilerPluginComponent, TranspilerProps } from './Compiler';
import { performance } from 'perf_hooks';
import chalk from 'chalk';
// import { Logger } from './Logger'

declare global {
	var PerfStartTime: number;
}

const CheckModuleUpdates = async () => {
	return await CheckForUpdates();
};

const StartCompilerModule = () => {
	const parameters = ValidateParameters(process.argv.slice(2));
	const bTersePlugin = parameters.type == BuildType.ProdBuild;

	console.log(chalk.greenBright.bold('config'), 'Building target:', parameters.targetPlugin, 'with type:', BuildType[parameters.type], 'minify:', bTersePlugin, '...');

	ValidatePlugin(parameters.targetPlugin)
		.then((json: any) => {
			const props: TranspilerProps = {
				bTersePlugin: bTersePlugin,
				strPluginInternalName: json?.name,
			};

			TranspilerPluginComponent(props);
		})

		/**
		 * plugin is invalid, we close the proccess as it has already been handled
		 */
		.catch(() => {
			process.exit();
		});
};

const Initialize = () => {
	global.PerfStartTime = performance.now();

	// Check for --no-update flag
	if (process.argv.includes('--no-update')) {
		StartCompilerModule();
		return;
	}

	CheckModuleUpdates().then(StartCompilerModule);
};

Initialize();
