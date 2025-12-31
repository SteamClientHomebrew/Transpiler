import chalk from 'chalk';
import { existsSync, readFile } from 'fs';
import path from 'path';
import { PluginJson } from './plugin-json';

export const ValidatePlugin = (bIsMillennium: boolean, target: string): Promise<PluginJson> => {
	return new Promise<PluginJson>((resolve, reject) => {
		if (!existsSync(target)) {
			console.error(chalk.red.bold(`\n[-] --target [${target}] `) + chalk.red('is not a valid system path'));
			reject();
			return;
		}

		if (bIsMillennium) {
			console.log(chalk.green.bold('\n[+] Using Millennium internal build configuration'));

			resolve({
				name: 'core',
				common_name: 'Millennium',
				description: 'An integrated plugin that provides core platform functionality.',
				useBackend: false,
				frontend: '.',
			});
			return;
		}

		const pluginModule = path.join(target, 'plugin.json');

		if (!existsSync(pluginModule)) {
			console.error(chalk.red.bold(`\n[-] --target [${target}] `) + chalk.red('is not a valid plugin (missing plugin.json)'));
			reject();
			return;
		}

		readFile(pluginModule, 'utf8', (err, data) => {
			if (err) {
				console.error(chalk.red.bold(`\n[-] couldn't read plugin.json from [${pluginModule}]`));
				reject();
				return;
			}

			try {
				if (!('name' in JSON.parse(data))) {
					console.error(chalk.red.bold(`\n[-] target plugin doesn't contain "name" in plugin.json [${pluginModule}]`));
					reject();
				} else {
					resolve(JSON.parse(data));
				}
			} catch (parseError) {
				console.error(chalk.red.bold(`\n[-] couldn't parse JSON in plugin.json from [${pluginModule}]`));
				reject();
			}
		});
	});
};
