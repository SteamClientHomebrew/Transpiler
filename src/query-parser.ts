import chalk from 'chalk';
import { Logger } from './logger';

/***
 * @brief print the parameter list to the stdout
 */
export const PrintParamHelp = () => {
	console.log(`
millennium-ttc parameter list:
	${chalk.magenta('--help')}: display parameter list
	${chalk.bold.red('--build')}: ${chalk.bold.red('(required)')}: build type [dev, prod] (prod minifies code)
	${chalk.magenta('--target')}: path to plugin, default to cwd
	${chalk.magenta('--watch')}: enable watch mode for continuous rebuilding`);
};

export enum BuildType {
	DevBuild,
	ProdBuild,
}

export interface ParameterProps {
	type: BuildType;
	targetPlugin: string; // path
	isMillennium?: boolean;
	watch?: boolean;
}

export const ValidateParameters = (args: Array<string>): ParameterProps => {
	let typeProp: BuildType = BuildType.DevBuild,
		targetProp: string = process.cwd(),
		isMillennium: boolean = false,
		watch: boolean = false;

	if (args.includes('--help')) {
		PrintParamHelp();
		process.exit();
	}

	// startup args are invalid
	if (!args.includes('--build')) {
		Logger.Error('Received invalid arguments...');
		PrintParamHelp();
		process.exit();
	}

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--build') {
			const BuildMode: string = args[i + 1];

			switch (BuildMode) {
				case 'dev':
					typeProp = BuildType.DevBuild;
					break;
				case 'prod':
					typeProp = BuildType.ProdBuild;
					break;
				default: {
					Logger.Error('--build parameter must be preceded by build type [dev, prod]');
					process.exit();
				}
			}
		}

		if (args[i] === '--target') {
			if (args[i + 1] === undefined) {
				Logger.Error('--target parameter must be preceded by system path');
				process.exit();
			}

			targetProp = args[i + 1];
		}

		if (args[i] === '--millennium-internal') {
			isMillennium = true;
		}

		if (args[i] === '--watch') {
			watch = true;
		}
	}

	return {
		type: typeProp,
		targetPlugin: targetProp,
		isMillennium: isMillennium,
		watch: watch,
	};
};
