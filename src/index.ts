#!/usr/bin/env node

/**
 * this component serves as:
 * - typescript transpiler
 * - rollup configurator
 */
import { performance } from 'perf_hooks';
import { ValidatePlugin } from './check-health';
import { Logger } from './logger';
import { PluginJson } from './plugin-json';
import { BuildType, ValidateParameters } from './query-parser';
import { TranspilerPluginComponent, TranspilerProps } from './transpiler';
import { CheckForUpdates } from './version-control';

declare global {
	var PerfStartTime: number;
}

const CheckModuleUpdates = async () => {
	return await CheckForUpdates();
};

const StartCompilerModule = () => {
	const parameters = ValidateParameters(process.argv.slice(2));
	const bIsMillennium = parameters.isMillennium || false;
	const bTersePlugin = parameters.type == BuildType.ProdBuild;
	const bWatchMode = parameters.watch || false;

	Logger.Config('Building target:', parameters.targetPlugin, 'with type:', BuildType[parameters.type], 'minify:', bTersePlugin, '...');

	ValidatePlugin(bIsMillennium, parameters.targetPlugin)
		.then((json: PluginJson) => {
			const props: TranspilerProps = {
				bTersePlugin,
				strPluginInternalName: json.name,
				bWatchMode,
				bIsMillennium,
			};

			TranspilerPluginComponent(json, props);
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
