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

declare const MILLENNIUM_API: {
	callable: (fn: Function, route: string) => any;
	__INTERNAL_CALL_WEBKIT_METHOD__: (pluginName: string, methodName: string, kwargs: any) => any;
};

declare const __call_server_method__: (methodName: string, kwargs: any) => any;
const WrappedCallServerMethod = 'const __call_server_method__ = (methodName, kwargs) => Millennium.callServerMethod(pluginName, methodName, kwargs)';

function __wrapped_callable__(route: string) {
	if (route.startsWith('webkit:')) {
		return MILLENNIUM_API.callable(
			(methodName: string, kwargs: any) => MILLENNIUM_API.__INTERNAL_CALL_WEBKIT_METHOD__(pluginName, methodName, kwargs),
			route.replace(/^webkit:/, ''),
		);
	}

	return MILLENNIUM_API.callable(__call_server_method__, route);
}

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
				__wrapped_callable__.toString(),
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

async function GetPluginComponents(pluginJson: any, props: TranspilerProps): Promise<InputPluginOption[]> {
	let tsConfigPath = '';
	const frontendDir = GetFrontEndDirectory(pluginJson);

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
		typescript({
			tsconfig: tsConfigPath,
			compilerOptions: {
				outDir: undefined,
			},
		}),
		url({
			include: ['**/*.gif', '**/*.webm', '**/*.svg'], // Add all non-JS assets you use
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
		replace({
			delimiters: ['', ''],
			preventAssignment: true,
			'Millennium.callServerMethod': `__call_server_method__`,
			'webkit.callable': `__wrapped_callable__`,
			'webkit.Millennium.exposeObj(': 'webkit.Millennium.exposeObj(exports, ',
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

const GetFrontEndDirectory = (pluginJson: any) => {
	try {
		return pluginJson?.frontend ?? 'frontend';
	} catch (error) {
		return 'frontend';
	}
};

export const TranspilerPluginComponent = async (bIsMillennium: boolean, pluginJson: any, props: TranspilerProps) => {
	const frontendDir = GetFrontEndDirectory(pluginJson);
	console.log(chalk.greenBright.bold('config'), 'Frontend directory set to:', chalk.cyan.bold(frontendDir));

	const frontendPlugins = await GetPluginComponents(pluginJson, props);

	// Fix entry file path construction
	let entryFile = '';
	if (frontendDir === '.' || frontendDir === './' || frontendDir === '') {
		entryFile = './index.tsx';
	} else {
		entryFile = `./${frontendDir}/index.tsx`;
	}

	console.log(chalk.greenBright.bold('config'), 'Entry file set to:', chalk.cyan.bold(entryFile));

	const frontendRollupConfig: RollupOptions = {
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
			file: bIsMillennium ? '../../build/frontend.bin' : '.millennium/Dist/index.js',
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
