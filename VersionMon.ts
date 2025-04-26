import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { dirname } from 'path';
import { Logger } from './Logger';

export const CheckForUpdates = async (): Promise<boolean> => {
	return new Promise<boolean>(async (resolve) => {
		const packageJsonPath = path.resolve(dirname(fileURLToPath(import.meta.url)), '../package.json');
		const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));

		fetch('https://registry.npmjs.org/@steambrew/ttc')
			.then((response) => response.json())
			.then((json) => {
				if (json?.['dist-tags']?.latest != packageJson.version) {
					Logger.Tree('versionMon', `@steambrew/ttc@${packageJson.version} requires update to ${json?.['dist-tags']?.latest}`, {
						cmd: `run "npm install @steambrew/ttc@${json?.['dist-tags']?.latest}" to get latest updates!`,
					});

					resolve(true);
				} else {
					Logger.Info('versionMon', `@steambrew/ttc@${packageJson.version} is up-to-date!`);
					resolve(false);
				}
			});
	});
};
