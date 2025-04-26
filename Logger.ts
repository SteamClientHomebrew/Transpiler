import chalk from 'chalk';

const Logger = {
	Info: (name: string, ...LogMessage: any) => {
		console.log(chalk.magenta.bold(name), ...LogMessage);
	},

	Warn: (...LogMessage: any) => {
		console.log(chalk.yellow.bold('**'), ...LogMessage);
	},

	Error: (...LogMessage: any) => {
		console.error(chalk.red.bold('!!'), ...LogMessage);
	},

	Tree: (name: string, strTitle: string, LogObject: any) => {
		const fixedPadding = 15; // <-- always pad keys to 15 characters

		console.log(chalk.greenBright.bold(name).padEnd(fixedPadding), strTitle);

		const isLocalPath = (strTestPath: string): boolean => {
			const filePathRegex = /^(\/|\.\/|\.\.\/|\w:\/)?([\w-.]+\/)*[\w-.]+\.\w+$/;
			return filePathRegex.test(strTestPath);
		};

		for (const [key, value] of Object.entries(LogObject)) {
			let color = chalk.white;

			switch (typeof value) {
				case 'string':
					color = isLocalPath(value) ? chalk.blueBright : chalk.white;
					break;
				case 'boolean':
					color = chalk.green;
					break;
				case 'number':
					color = chalk.yellow;
					break;
			}

			console.log(chalk.greenBright.bold(`${key}:        `).padEnd(fixedPadding), color(String(value)));
		}
	},
};

export { Logger };
