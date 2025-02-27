import { OutputOptions, RollupOptions, rollup } from "rollup";
import json from '@rollup/plugin-json';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import babel from '@rollup/plugin-babel';

import chalk from 'chalk'
import { Logger } from "./Logger";
import fs from 'fs';

import injectProcessEnv from 'rollup-plugin-inject-process-env';
import dotenv from 'dotenv';

const envConfig = dotenv.config().parsed || {};

if (envConfig) {
    Logger.Info("Injecting environment variables...")
}

const envVars = Object.keys(envConfig).reduce((acc: any, key) => {
  acc[`process.env.${key}`] = JSON.stringify(envConfig[key]);
  return acc;
}, {});

declare global {
    interface Window {
        PLUGIN_LIST: any
    }
}

declare const pluginName: string, millennium_main: any, MILLENNIUM_BACKEND_IPC: any

export interface TranspilerProps {
    bTersePlugin?: boolean,
    strPluginInternalName: string
}

const WrappedCallServerMethod = "const __call_server_method__ = (methodName, kwargs) => Millennium.callServerMethod(pluginName, methodName, kwargs)"
const WrappedCallable = "const __wrapped_callable__ = (route) => MILLENNIUM_API.callable(__call_server_method__, route)"

/**
 * @description Append the active plugin to the global plugin 
 * list and notify that the frontend Loaded.
 */
function ExecutePluginModule() {
	// Assign the plugin on plugin list. 
	Object.assign(window.PLUGIN_LIST[pluginName], millennium_main)
	// Run the rolled up plugins default exported function 
	millennium_main["default"]();
	MILLENNIUM_BACKEND_IPC.postMessage(1, { pluginName: pluginName })
}

/**
 * @description Append the active plugin to the global plugin 
 * list and notify that the frontend Loaded.
 */
function ExecuteWebkitModule() {
	// Assign the plugin on plugin list. 
	Object.assign(window.PLUGIN_LIST[pluginName], millennium_main)
	// Run the rolled up plugins default exported function 
	millennium_main["default"]();
}

/**
 * @description Simple bootstrap function that initializes PLUGIN_LIST 
 * for current plugin given that is doesnt exist. 
 */
function InitializePlugins() {
	/** 
	 * This function is called n times depending on n plugin count,
	 * Create the plugin list if it wasn't already created 
	 */
	!window.PLUGIN_LIST && (window.PLUGIN_LIST = {})

	// initialize a container for the plugin
	if (!window.PLUGIN_LIST[pluginName]) {
		window.PLUGIN_LIST[pluginName] = {};
	}
}

const ContructFunctions = (parts: any) => { return parts.join('\n'); }

function InsertMillennium(props: TranspilerProps) 
{
    const generateBundle = (_: unknown, bundle: any) => {	
		for (const fileName in bundle) {
			if (bundle[fileName].type != 'chunk') continue 
			
            Logger.Info("Injecting Millennium shims into module... " + chalk.green.bold("okay"))

			bundle[fileName].code = ContructFunctions([    
				`const pluginName = "${props.strPluginInternalName}";`,
				InitializePlugins.toString(), InitializePlugins.name + "()",
				WrappedCallServerMethod, WrappedCallable, bundle[fileName].code,
				ExecutePluginModule.toString(), ExecutePluginModule.name + "()"
			])
		}
    }

    return { name: String(), generateBundle };
}

function InsertWebkitMillennium(props: TranspilerProps) 
{
    const generateBundle = (_: unknown, bundle: any) => {	
		for (const fileName in bundle) {
			if (bundle[fileName].type != 'chunk') continue 
			
            Logger.Info("Injecting Millennium shims into webkit module... " + chalk.green.bold("okay"))

			bundle[fileName].code = ContructFunctions([    
				`const pluginName = "${props.strPluginInternalName}";`,
                InitializePlugins.toString(), InitializePlugins.name + "()",
				WrappedCallServerMethod, WrappedCallable, bundle[fileName].code,
				ExecuteWebkitModule.toString(), ExecuteWebkitModule.name + "()"
			])
		}
    }

    return { name: String(), generateBundle };
}

function GetPluginComponents(props: TranspilerProps) {

    let tsConfigPath = `./${GetFrontEndDirectory()}/tsconfig.json`

    if (!fs.existsSync(tsConfigPath)) {
        tsConfigPath = './tsconfig.json'
    }

	const pluginList = [
        InsertMillennium(props),
        typescript({
            tsconfig: tsConfigPath
        }), 
        resolve(), commonjs(), json(),
        injectProcessEnv(envVars),
		replace({
			delimiters: ['', ''],
			preventAssignment: true,
            'process.env.NODE_ENV'        : JSON.stringify('production'),
			'Millennium.callServerMethod' : `__call_server_method__`,
            'client.callable'             : `__wrapped_callable__`,
			'client.pluginSelf'           : 'window.PLUGIN_LIST[pluginName]',
            'client.Millennium.exposeObj(': 'client.Millennium.exposeObj(exports, '
		}),
	]
	
	if (props.bTersePlugin) {
		pluginList.push(terser())
	}
	return pluginList
}

function GetWebkitPluginComponents(props: TranspilerProps) {
	const pluginList = [
        InsertWebkitMillennium(props), 
        typescript({
            tsconfig: './webkit/tsconfig.json'
        }), 
        resolve(), commonjs(), json(),
        injectProcessEnv(envVars),
        replace({
			delimiters: ['', ''],
			preventAssignment: true,
			'Millennium.callServerMethod': `__call_server_method__`,
            'webkit.callable': `__wrapped_callable__`,
		}),
        babel({
            presets: ['@babel/preset-env', '@babel/preset-react'],
            babelHelpers: 'bundled',
        })
	]
	
    props.bTersePlugin && pluginList.push(terser())
	return pluginList
}

const GetFrontEndDirectory = () => {
    const pluginJsonPath = './plugin.json';
    try {
        return JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'))?.frontend ?? "frontend";
    } 
    catch (error) {
        return "frontend";
    }
}

export const TranspilerPluginComponent = async (props: TranspilerProps) => {
    
    const frontendRollupConfig: RollupOptions = {
        input: `./${GetFrontEndDirectory()}/index.tsx`,
        plugins: GetPluginComponents(props),
        context: 'window',
        external: (id) => { 
            if (id === '@steambrew/webkit') {
                Logger.Error('The @steambrew/webkit module should not be included in the frontend module, use @steambrew/client instead. Please remove it from the frontend module and try again.')
                process.exit(1)
            }

            return id === '@steambrew/client' || id === 'react' || id === 'react-dom'
        },
        output: {
            name: "millennium_main",
            file: ".millennium/Dist/index.js",
            globals: {
                "react"            : "window.SP_REACT",
                "react-dom"        : "window.SP_REACTDOM",
                "@steambrew/client": "window.MILLENNIUM_API"
            },
            exports: 'named',
            format: 'iife'
        }
    }

    Logger.Info("Starting build; this may take a few moments...")

    try {
        await (await rollup(frontendRollupConfig)).write(frontendRollupConfig.output as OutputOptions);

        if (fs.existsSync(`./webkit/index.tsx`)) {
            Logger.Info("Compiling webkit module...")
            
            const webkitRollupConfig: RollupOptions = {
                input: `./webkit/index.tsx`,
                plugins: GetWebkitPluginComponents(props),
                context: 'window',
                external: (id) => {
                    if (id === '@steambrew/client') {
                    Logger.Error('The @steambrew/client module should not be included in the webkit module, use @steambrew/webkit instead. Please remove it from the webkit module and try again.')
                    process.exit(1)
                    }

                    return id === '@steambrew/webkit'
                },
                output: {
                    name: "millennium_main",
                    file: ".millennium/Dist/webkit.js",
                    exports: 'named',
                    format: 'iife',
                    globals: {
                        "@steambrew/webkit": "window.MILLENNIUM_API"
                    },
                }
            }

            await (await rollup(webkitRollupConfig)).write(webkitRollupConfig.output as OutputOptions);
        }
        
        Logger.Info('Build succeeded!', Number((performance.now() - global.PerfStartTime).toFixed(3)), 'ms elapsed.')
    }
    catch (exception) {
        Logger.Error('Build failed!', exception)
        process.exit(1)
    }
}