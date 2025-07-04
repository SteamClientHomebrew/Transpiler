import babel from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve, { nodeResolve } from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import url from '@rollup/plugin-url';
import { InputPluginOption, OutputBundle, OutputOptions, RollupOptions, rollup } from 'rollup';
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
import constSysfsExpr from './static-embed';

const envConfig = dotenv.config().parsed || {};

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
}

const WrappedCallServerMethod = 'const __call_server_method__ = (methodName, kwargs) => Millennium.callServerMethod(pluginName, methodName, kwargs)';
const WrappedCallable = 'const __wrapped_callable__ = (route) => MILLENNIUM_API.callable(__call_server_method__, route)';

const ConstructFunctions = (parts: string[]): string => {
	return parts.join('\n');
};

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

async function MergePluginList(plugins: any[]) {
	const customPlugins = await GetCustomUserPlugins();

	// Filter out custom plugins that have the same name as input plugins
	const filteredCustomPlugins = customPlugins.filter((customPlugin: any) => !plugins.some((plugin: any) => plugin.name === customPlugin.name));

	// Merge input plugins with the filtered custom plugins
	return [...plugins, ...filteredCustomPlugins];
}

async function GetPluginComponents(props: TranspilerProps): Promise<InputPluginOption[]> {
	let tsConfigPath = '';
	const frontendDir = GetFrontEndDirectory();

	if (frontendDir === '.' || frontendDir === './') {
		tsConfigPath = './tsconfig.json';
	} else {
		tsConfigPath = `./${frontendDir}/tsconfig.json`;
	}

	if (!fs.existsSync(tsConfigPath)) {
		tsConfigPath = './tsconfig.json';
	}

	Logger.Info('millenniumAPI', 'Loading tsconfig from ' + chalk.cyan.bold(tsConfigPath) + '... ' + chalk.green.bold('okay'));

	let pluginList = [
		url({
			include: ['**/*.gif', '**/*.webm', '**/*.svg'], // Add all non-JS assets you use
			limit: 0, // Set to 0 to always copy the file instead of inlining as base64
			fileName: '[hash][extname]', // Optional: custom output naming
		}),
		InsertMillennium(ComponentType.Plugin, props),
		commonjs(),
		nodePolyfills(),
		nodeResolve({
			browser: true,
		}),
		typescript({
			include: ['**/*.ts', '**/*.tsx', 'src/**/*.ts', 'src/**/*.tsx'],
			tsconfig: tsConfigPath,
		}),
		scss({
			output: false,
			outputStyle: 'compressed',
			sourceMap: false,
			watch: 'src/styles',
			sass: sass,
		}),
		resolve(),
		json(),
		constSysfsExpr(),
		injectProcessEnv(envVars),
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

	if (props.bTersePlugin) {
		pluginList.push(terser());
	}
	return pluginList;
}

async function GetWebkitPluginComponents(props: TranspilerProps) {
	let pluginList = [
		InsertMillennium(ComponentType.Webkit, props),
		typescript({
			tsconfig: './webkit/tsconfig.json',
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
		injectProcessEnv(envVars),
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

	pluginList = await MergePluginList(pluginList);

	props.bTersePlugin && pluginList.push(terser());
	return pluginList;
}

const GetFrontEndDirectory = () => {
	const pluginJsonPath = './plugin.json';
	try {
		return JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'))?.frontend ?? 'frontend';
	} catch (error) {
		return 'frontend';
	}
};

export const TranspilerPluginComponent = async (props: TranspilerProps) => {
	const frontendRollupConfig: RollupOptions = {
		input: `./${GetFrontEndDirectory()}/index.tsx`,
		plugins: await GetPluginComponents(props),
		context: 'window',
		external: (id) => {
			if (id === '@steambrew/webkit') {
				Logger.Error(
					'The @steambrew/webkit module should not be included in the frontend module, use @steambrew/client instead. Please remove it from the frontend module and try again.',
				);
				process.exit(1);
			}

			return id === '@steambrew/client' || id === 'react' || id === 'react-dom' || id === 'react-dom/client';
		},
		output: {
			name: 'millennium_main',
			file: '.millennium/Dist/index.js',
			globals: {
				react: 'window.SP_REACT',
				'react-dom': 'window.SP_REACTDOM',
				'react-dom/client': 'window.SP_REACTDOM',
				'@steambrew/client': 'window.MILLENNIUM_API',
			},
			exports: 'named',
			format: 'iife',
		},
	};

	try {
		await (await rollup(frontendRollupConfig)).write(frontendRollupConfig.output as OutputOptions);

		if (fs.existsSync(`./webkit/index.tsx`)) {
			const webkitRollupConfig: RollupOptions = {
				input: `./webkit/index.tsx`,
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
					file: '.millennium/Dist/webkit.js',
					exports: 'named',
					format: 'iife',
					globals: {
						'@steambrew/webkit': 'window.MILLENNIUM_API',
					},
				},
			};

			await (await rollup(webkitRollupConfig)).write(webkitRollupConfig.output as OutputOptions);
		}

		Logger.Info('build', 'Succeeded passing all tests in', Number((performance.now() - global.PerfStartTime).toFixed(3)), 'ms elapsed.');
	} catch (exception) {
		Logger.Error('error', 'Build failed!', exception);
		process.exit(1);
	}
};
