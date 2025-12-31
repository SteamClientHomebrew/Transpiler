import babel from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve, { nodeResolve } from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import url from '@rollup/plugin-url';
import { InputPluginOption, OutputBundle, OutputOptions, rollup, RollupOptions, watch } from 'rollup';
import nodePolyfills from 'rollup-plugin-polyfill-node';
import { minify_sync } from 'terser';

import scss from 'rollup-plugin-scss';
import * as sass from 'sass';

import chalk from 'chalk';
import fs from 'fs';
import { Logger } from './logger';

import dotenv from 'dotenv';
import injectProcessEnv from 'rollup-plugin-inject-process-env';
import { ExecutePluginModule, InitializePlugins } from './plugin-api';
import { PluginJson } from './plugin-json';
import constSysfsExpr from './static-embed';

const envConfig = dotenv.config().parsed || {};

const FRONTEND_OUTPUT_PATH = '.millennium/Dist/index.js';
const WEBKIT_OUTPUT_PATH = '.millennium/Dist/webkit.js';
const WEBKIT_ENTRY_PATH = './webkit/index.tsx';

if (envConfig) {
	Logger.Info('envVars', 'Processing ' + Object.keys(envConfig).length + ' environment variables... ' + chalk.green.bold('okay'));
}

const envVars = Object.keys(envConfig).reduce((acc: any, key) => {
	acc[key] = envConfig[key];
	return acc;
}, {});

declare global {
	interface Window {
		PLUGIN_LIST: any;
		MILLENNIUM_PLUGIN_SETTINGS_STORE: any;
	}
}

declare const pluginName: string, millennium_main: any, MILLENNIUM_BACKEND_IPC: any, MILLENNIUM_IS_CLIENT_MODULE: boolean;

enum ComponentType {
	Plugin,
	Webkit,
}

export interface TranspilerProps {
	bTersePlugin?: boolean;
	strPluginInternalName: string;
	bWatchMode?: boolean;
	bIsMillennium?: boolean;
}

const WrappedCallServerMethod = 'const __call_server_method__ = (methodName, kwargs) => Millennium.callServerMethod(pluginName, methodName, kwargs)';
const WrappedCallable = 'const __wrapped_callable__ = (route) => MILLENNIUM_API.callable(__call_server_method__, route)';

function ConstructFunctions(parts: string[]): string {
	return parts.join('\n');
}

function generate(code: string) {
	/** Wrap it in a proxy */
	return `let PluginEntryPointMain = function() { ${code} return millennium_main; };`;
}

function InsertMillennium(type: ComponentType, props: TranspilerProps): InputPluginOption {
	const generateBundle = (_: unknown, bundle: OutputBundle) => {
		for (const fileName in bundle) {
			if (bundle[fileName].type != 'chunk') {
				continue;
			}

			Logger.Info('millenniumAPI', 'Bundling into ' + ComponentType[type] + ' module... ' + chalk.green.bold('okay'));

			let code = ConstructFunctions([
				`const MILLENNIUM_IS_CLIENT_MODULE = ${type === ComponentType.Plugin ? 'true' : 'false'};`,
				`const pluginName = "${props.strPluginInternalName}";`,
				InitializePlugins.toString(),
				InitializePlugins.name + '()',
				WrappedCallServerMethod,
				WrappedCallable,
				generate(bundle[fileName].code),
				ExecutePluginModule.toString(),
				ExecutePluginModule.name + '()',
			]);

			if (props.bTersePlugin) {
				code = minify_sync(code).code ?? code;
			}

			bundle[fileName].code = code;
		}
	};

	return { name: String(), generateBundle };
}

async function GetCustomUserPlugins() {
	const ttcConfigPath = new URL(`file://${process.cwd().replace(/\\/g, '/')}/ttc.config.mjs`).href;

	if (fs.existsSync('./ttc.config.mjs')) {
		const { MillenniumCompilerPlugins } = await import(ttcConfigPath);

		Logger.Info('millenniumAPI', 'Loading custom plugins from ttc.config.mjs... ' + chalk.green.bold('okay'));
		return MillenniumCompilerPlugins;
	}

	return [];
}

async function MergePluginList(plugins: InputPluginOption[]) {
	const customPlugins = await GetCustomUserPlugins();

	// Filter out custom plugins that have the same name as input plugins
	const filteredCustomPlugins = customPlugins.filter((customPlugin: any) => !plugins.some((plugin: any) => plugin.name === customPlugin.name));

	// Merge input plugins with the filtered custom plugins
	return [...plugins, ...filteredCustomPlugins];
}

function GetTsConfigPath(directory: string): string {
	const configPath = `./${directory}/tsconfig.json`;
	if (fs.existsSync(configPath)) {
		return configPath;
	}

	return './tsconfig.json';
}

function GetFrontEndDirectory(pluginJson: PluginJson): string {
	return pluginJson?.frontend ?? 'frontend';
}

function GetFrontendPluginComponents(pluginJson: PluginJson, props: TranspilerProps): InputPluginOption[] {
	const frontendDir = GetFrontEndDirectory(pluginJson);
	const tsConfigPath = GetTsConfigPath(frontendDir);

	Logger.Config('Loading frontend tsconfig from ' + chalk.cyan.bold(tsConfigPath) + '... ' + chalk.green.bold('okay'));

	let pluginList = [
		typescript({
			tsconfig: tsConfigPath,
			compilerOptions: {
				outDir: undefined,
			},
		}),
		url({
			include: ['**/*.gif', '**/*.webm', '**/*.svg', '**/*.scss', '**/*.css'], // Add all non-JS assets you use
			limit: 0, // Set to 0 to always copy the file instead of inlining as base64
			fileName: '[hash][extname]', // Optional: custom output naming
		}),
		InsertMillennium(ComponentType.Plugin, props),
		nodeResolve({
			browser: true,
		}),
		commonjs(),
		nodePolyfills(),
		scss({
			output: false,
			outputStyle: 'compressed',
			sourceMap: false,
			watch: 'src/styles',
			sass: sass,
		}),
		json(),
		constSysfsExpr(),
		replace({
			delimiters: ['', ''],
			preventAssignment: true,
			'process.env.NODE_ENV': JSON.stringify('production'),
			'Millennium.callServerMethod': `__call_server_method__`,
			'client.callable': `__wrapped_callable__`,
			'client.pluginSelf': 'window.PLUGIN_LIST[pluginName]',
			'client.Millennium.exposeObj(': 'client.Millennium.exposeObj(exports, ',
			'client.BindPluginSettings()': 'client.BindPluginSettings(pluginName)',
		}),
	];

	if (envVars.length > 0) {
		pluginList.push(injectProcessEnv(envVars));
	}

	if (props.bTersePlugin) {
		pluginList.push(terser());
	}

	return pluginList;
}

async function GetFrontendRollupConfig(props: TranspilerProps, pluginJson: PluginJson): Promise<RollupOptions> {
	const frontendDir = GetFrontEndDirectory(pluginJson);
	Logger.Config('Frontend directory set to:', chalk.cyan.bold(frontendDir));

	const frontendPlugins = await GetFrontendPluginComponents(pluginJson, props);

	let entryFile = '';
	if (frontendDir === '.' || frontendDir === './' || frontendDir === '') {
		entryFile = './index.tsx';
	} else {
		entryFile = `./${frontendDir}/index.tsx`;
	}

	Logger.Config('Frontend entry file set to:', chalk.cyan.bold(entryFile));

	return {
		input: entryFile,
		plugins: frontendPlugins,
		context: 'window',
		external: (id) => {
			if (id === '@steambrew/webkit') {
				Logger.Error(
					'The @steambrew/webkit module should not be included in the frontend module, use @steambrew/client instead. Please remove it from the frontend module and try again.',
				);
				process.exit(1);
			}

			return id === '@steambrew/client' || id === 'react' || id === 'react-dom' || id === 'react-dom/client' || id === 'react/jsx-runtime';
		},
		output: {
			name: 'millennium_main',
			file: props.bIsMillennium ? '../../build/frontend.bin' : FRONTEND_OUTPUT_PATH,
			globals: {
				react: 'window.SP_REACT',
				'react-dom': 'window.SP_REACTDOM',
				'react-dom/client': 'window.SP_REACTDOM',
				'react/jsx-runtime': 'SP_JSX_FACTORY',
				'@steambrew/client': 'window.MILLENNIUM_API',
			},
			exports: 'named',
			format: 'iife',
		},
	};
}

async function GetWebkitPluginComponents(props: TranspilerProps): Promise<InputPluginOption[]> {
	const tsConfigPath = GetTsConfigPath('webkit');

	Logger.Config('Loading webkit tsconfig from ' + chalk.cyan.bold(tsConfigPath) + '... ' + chalk.green.bold('okay'));

	let pluginList: InputPluginOption[] = [
		InsertMillennium(ComponentType.Webkit, props),
		typescript({
			tsconfig: tsConfigPath,
		}),
		url({
			include: ['**/*.mp4', '**/*.webm', '**/*.ogg'],
			limit: 0, // do NOT inline
			fileName: '[name][extname]',
			destDir: 'dist/assets', // or adjust as needed
		}),
		resolve(),
		commonjs(),
		json(),
		constSysfsExpr(),
		replace({
			delimiters: ['', ''],
			preventAssignment: true,
			'Millennium.callServerMethod': `__call_server_method__`,
			'webkit.callable': `__wrapped_callable__`,
			'client.BindPluginSettings()': 'client.BindPluginSettings(pluginName)',
		}),
		babel({
			presets: ['@babel/preset-env', '@babel/preset-react'],
			babelHelpers: 'bundled',
		}),
	];

	if (envVars.length > 0) {
		pluginList.push(injectProcessEnv(envVars));
	}

	pluginList = await MergePluginList(pluginList);

	props.bTersePlugin && pluginList.push(terser());
	return pluginList;
}

async function GetWebkitRollupConfig(props: TranspilerProps): Promise<RollupOptions> {
	return {
		input: WEBKIT_ENTRY_PATH,
		plugins: await GetWebkitPluginComponents(props),
		context: 'window',
		external: (id) => {
			if (id === '@steambrew/client') {
				Logger.Error(
					'The @steambrew/client module should not be included in the webkit module, use @steambrew/webkit instead. Please remove it from the webkit module and try again.',
				);
				process.exit(1);
			}

			return id === '@steambrew/webkit';
		},
		output: {
			name: 'millennium_main',
			file: WEBKIT_OUTPUT_PATH,
			exports: 'named',
			format: 'iife',
			globals: {
				'@steambrew/webkit': 'window.MILLENNIUM_API',
			},
		},
	};
}

export async function RunWatchMode(frontendRollupConfig: RollupOptions, webkitRollupConfig: RollupOptions | null): Promise<void> {
	const watchConfigs = webkitRollupConfig ? [frontendRollupConfig, webkitRollupConfig] : [frontendRollupConfig];

	const watcher = watch(watchConfigs);

	watcher.on('event', async (event) => {
		let buildType: 'Frontend' | 'Webkit' | null = null;
		if ('output' in event) {
			buildType = event.output.some((file) => file.includes(FRONTEND_OUTPUT_PATH)) ? 'Frontend' : 'Webkit';
		}

		if (event.code === 'START') {
			console.log(chalk.blueBright.bold('watch'), 'Build started...');
		} else if (event.code === 'BUNDLE_START') {
			console.log(chalk.yellowBright.bold('watch'), `Bundling ${buildType}...`);
		} else if (event.code === 'BUNDLE_END') {
			console.log(chalk.greenBright.bold('watch'), `${buildType} build completed in ${chalk.green(`${event.duration}ms`)}`);
			await event.result.close();
		} else if (event.code === 'END') {
			console.log(chalk.greenBright.bold('watch'), 'All builds completed. Watching for changes...');
		} else if (event.code === 'ERROR') {
			// Remove watchFiles from error object to prevent it from being logged, as it is not relevant to the user
			const error = { ...event.error, watchFiles: undefined };
			Logger.Error(chalk.red.bold('watch'), chalk.red('Build error:'), error);
		}
	});

	console.log(chalk.blueBright.bold('watch'), 'Watch mode enabled. Watching for file changes...');

	function CloseWatcher() {
		console.log(chalk.yellowBright.bold('watch'), 'Stopping watch mode...');
		watcher.close();
		process.exit(0);
	}

	process.on('SIGINT', () => {
		CloseWatcher();
	});

	process.on('SIGUSR2', () => {
		CloseWatcher();
	});
}

export async function TranspilerPluginComponent(pluginJson: PluginJson, props: TranspilerProps) {
	const frontendRollupConfig = await GetFrontendRollupConfig(props, pluginJson);

	const hasWebkit = fs.existsSync(WEBKIT_ENTRY_PATH);

	const webkitRollupConfig: RollupOptions | null = hasWebkit ? await GetWebkitRollupConfig(props) : null;

	if (props.bWatchMode) {
		RunWatchMode(frontendRollupConfig, webkitRollupConfig);
		return;
	}

	try {
		const frontendTimer = performance.now();
		await (await rollup(frontendRollupConfig)).write(frontendRollupConfig.output as OutputOptions);
		Logger.Config('Frontend build time:', (performance.now() - frontendTimer).toFixed(3), 'ms elapsed.');

		if (hasWebkit && webkitRollupConfig !== null) {
			const webkitTimer = performance.now();
			await (await rollup(webkitRollupConfig)).write(webkitRollupConfig.output as OutputOptions);
			Logger.Config('Webkit build time:', (performance.now() - webkitTimer).toFixed(3), 'ms elapsed.');
		}

		Logger.Info('build', 'Succeeded passing all tests in', (performance.now() - global.PerfStartTime).toFixed(3), 'ms elapsed.');
	} catch (exception) {
		Logger.Error('error', 'Build failed!', exception);
		process.exit(1);
	}
}
