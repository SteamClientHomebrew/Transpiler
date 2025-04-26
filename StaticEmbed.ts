import { Plugin, SourceDescription, TransformPluginContext } from 'rollup';
import fs from 'fs';
import path from 'path';
import { createFilter } from '@rollup/pluginutils';
import MagicString from 'magic-string';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as glob from 'glob';
import chalk from 'chalk';

interface EmbedPluginOptions {
	include?: string | RegExp | (string | RegExp)[];
	exclude?: string | RegExp | (string | RegExp)[];
	encoding?: BufferEncoding;
}

interface CallOptions {
	basePath?: string;
	include?: string;
	encoding?: BufferEncoding;
}

interface FileInfo {
	content: string;
	filePath: string;
	fileName: string;
}

const Log = (...message: any) => {
	console.log(chalk.blueBright.bold('constSysfsExpr'), ...message);
};

export default function constSysfsExpr(options: EmbedPluginOptions = {}): Plugin {
	const filter = createFilter(options.include, options.exclude);
	const pluginName = 'millennium-const-sysfs-expr';

	return {
		name: pluginName,

		transform(this: TransformPluginContext, code: string, id: string): SourceDescription | null {
			if (!filter(id)) return null;
			if (!code.includes('constSysfsExpr')) return null;

			const magicString = new MagicString(code);
			let hasReplaced = false;

			try {
				const stringVariables = new Map<string, string>();

				const ast = parser.parse(code, {
					sourceType: 'module',
					plugins: ['typescript', 'jsx', 'objectRestSpread', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
				});

				traverse(ast, {
					VariableDeclarator(path) {
						const init = path.node.init;
						const id = path.node.id;
						if (id.type === 'Identifier' && init && init.type === 'StringLiteral') {
							stringVariables.set(id.name, init.value);
						}
					},
				});

				traverse(ast, {
					CallExpression: (nodePath) => {
						const node = nodePath.node;
						if (node.callee.type === 'Identifier' && node.callee.name === 'constSysfsExpr') {
							if (typeof node.start !== 'number' || typeof node.end !== 'number') {
								if (node.loc) {
									this.warn(`Missing start/end offset info for constSysfsExpr call.`, node.loc.start.index);
								}
								return;
							}

							const args = node.arguments;
							let pathOrPattern: string | null = null;
							const callOptions: Required<Omit<CallOptions, 'fileName'>> = {
								basePath: '',
								include: '**/*',
								encoding: options.encoding || 'utf8',
							};

							if (args.length >= 1 && (args[0].type === 'StringLiteral' || args[0].type === 'Identifier')) {
								const firstArg = args[0];
								if (firstArg.type === 'StringLiteral') {
									pathOrPattern = firstArg.value;
								} else if (firstArg.type === 'Identifier') {
									const varName = firstArg.name;
									if (stringVariables.has(varName)) {
										pathOrPattern = stringVariables.get(varName) || null;
									} else {
										this.warn(
											`Unable to resolve variable "${varName}" for constSysfsExpr path/pattern. Only simple string literal assignments are supported.`,
											firstArg.loc?.start.index,
										);
										return;
									}
								}

								if (args.length > 1 && args[1].type === 'ObjectExpression') {
									const optionsObj = args[1];
									for (const prop of optionsObj.properties) {
										if (prop.type !== 'ObjectProperty') continue;
										let keyName: string | undefined;
										if (prop.key.type === 'Identifier') keyName = prop.key.name;
										else if (prop.key.type === 'StringLiteral') keyName = prop.key.value;
										else continue;

										if (!['basePath', 'include', 'encoding'].includes(keyName)) continue;

										const valueNode = prop.value;
										if (valueNode.type === 'StringLiteral') {
											const value = (valueNode as any).extra?.rawValue !== undefined ? (valueNode as any).extra.rawValue : valueNode.value;
											if (keyName === 'basePath') callOptions.basePath = value;
											else if (keyName === 'include') callOptions.include = value;
											else if (keyName === 'encoding') callOptions.encoding = value as BufferEncoding;
										} else {
											this.warn(
												`Option "${keyName}" for constSysfsExpr must be a string literal. Found type: ${valueNode.type}`,
												valueNode.loc?.start.index,
											);
										}
									}
								}
							} else if (args.length >= 1 && args[0].type === 'ObjectExpression') {
								const optionsObj = args[0];
								for (const prop of optionsObj.properties) {
									if (prop.type !== 'ObjectProperty') continue;
									let keyName: string | undefined;
									if (prop.key.type === 'Identifier') keyName = prop.key.name;
									else if (prop.key.type === 'StringLiteral') keyName = prop.key.value;
									else continue;

									// In this case, we need to look for 'basePath' and 'include' within the options object itself
									if (!['basePath', 'include', 'encoding'].includes(keyName)) continue;

									const valueNode = prop.value;
									if (valueNode.type === 'StringLiteral') {
										const value = (valueNode as any).extra?.rawValue !== undefined ? (valueNode as any).extra.rawValue : valueNode.value;
										if (keyName === 'basePath') callOptions.basePath = value;
										else if (keyName === 'include') callOptions.include = value;
										else if (keyName === 'encoding') callOptions.encoding = value as BufferEncoding;
									} else {
										this.warn(
											`Option "${keyName}" for constSysfsExpr must be a string literal. Found type: ${valueNode.type}`,
											valueNode.loc?.start.index,
										);
									}
								}

								if (callOptions.include !== '**/*') {
									pathOrPattern = callOptions.include;
								} else {
									if (!callOptions.basePath) {
										this.warn(
											`constSysfsExpr called with only an options object requires at least 'include' or 'basePath' for a pattern.`,
											node.loc?.start.index,
										);
										return;
									}
									this.warn(`constSysfsExpr called with only an options object requires an explicit 'include' pattern.`, node.loc?.start.index);
									return;
								}
							} else {
								this.warn(`constSysfsExpr requires a path/pattern string/variable or an options object as the first argument.`, node.loc?.start.index);
								return;
							}

							if (!pathOrPattern) {
								this.warn(`Invalid or unresolved path/pattern argument for constSysfsExpr.`, args[0]?.loc?.start.index);
								return;
							}

							try {
								const currentLocString = node.loc?.start ? ` at ${id}:${node.loc.start.line}:${node.loc.start.column}` : ` in ${id}`;

								const searchBasePath = callOptions.basePath
									? path.isAbsolute(callOptions.basePath)
										? callOptions.basePath
										: path.resolve(path.dirname(id), callOptions.basePath)
									: path.isAbsolute(pathOrPattern) && !/[?*+!@()[\]{}]/.test(pathOrPattern)
									? path.dirname(pathOrPattern)
									: path.resolve(path.dirname(id), path.dirname(pathOrPattern));

								let embeddedContent: string;
								let embeddedCount = 0;

								const isPotentialPattern = /[?*+!@()[\]{}]/.test(pathOrPattern);

								if (
									!isPotentialPattern &&
									fs.existsSync(path.resolve(searchBasePath, pathOrPattern)) &&
									fs.statSync(path.resolve(searchBasePath, pathOrPattern)).isFile()
								) {
									const singleFilePath = path.resolve(searchBasePath, pathOrPattern);
									Log(`Mode: Single file (first argument "${pathOrPattern}" resolved to "${singleFilePath}" relative to "${searchBasePath}")`);

									try {
										const rawContent: string | Buffer = fs.readFileSync(singleFilePath, callOptions.encoding);
										const contentString = rawContent.toString();
										const fileInfo: FileInfo = {
											content: contentString,
											filePath: singleFilePath,
											fileName: path.relative(searchBasePath, singleFilePath),
										};
										embeddedContent = JSON.stringify(fileInfo);
										embeddedCount = 1;
										Log(`Embedded 1 specific file for call${currentLocString}`);
									} catch (fileError: unknown) {
										let message = String(fileError instanceof Error ? fileError.message : fileError ?? 'Unknown file read error');
										this.error(`Error reading file ${singleFilePath}: ${message}`, node.loc?.start.index);
										return;
									}
								} else {
									Log(`Mode: Multi-file (first argument "${pathOrPattern}" is pattern or not a single file)`);

									Log(`Searching with pattern "${pathOrPattern}" in directory "${searchBasePath}" (encoding: ${callOptions.encoding})`);

									const matchingFiles = glob.sync(pathOrPattern, {
										cwd: searchBasePath,
										nodir: true,
										absolute: true,
									});

									const fileInfoArray: FileInfo[] = [];
									for (const fullPath of matchingFiles) {
										try {
											const rawContent: string | Buffer = fs.readFileSync(fullPath, callOptions.encoding);
											const contentString = rawContent.toString();
											fileInfoArray.push({
												content: contentString,
												filePath: fullPath,
												fileName: path.relative(searchBasePath, fullPath),
											});
										} catch (fileError: unknown) {
											let message = String(fileError instanceof Error ? fileError.message : fileError ?? 'Unknown file read error');
											this.warn(`Error reading file ${fullPath}: ${message}`);
										}
									}
									embeddedContent = JSON.stringify(fileInfoArray);
									embeddedCount = fileInfoArray.length;
									Log(`Embedded ${embeddedCount} file(s) matching pattern for call${currentLocString}`);
								}

								// Replace the call expression with the generated content string
								magicString.overwrite(node.start, node.end, embeddedContent);
								hasReplaced = true;
							} catch (error: unknown) {
								console.error(`Failed to process files for constSysfsExpr call in ${id}:`, error);
								const message = String(error instanceof Error ? error.message : error ?? 'Unknown error during file processing');
								this.error(`Could not process files for constSysfsExpr: ${message}`, node.loc?.start.index);
								return;
							}
						}
					},
				});
			} catch (error: unknown) {
				console.error(`Error parsing or traversing ${id}:`, error);
				const message = String(error instanceof Error ? error.message : error ?? 'Unknown parsing error');
				this.error(`Failed to parse ${id}: ${message}`);
				return null;
			}

			// If no replacements were made, return null
			if (!hasReplaced) {
				return null;
			}

			// Return the modified code and source map
			const result: SourceDescription = {
				code: magicString.toString(),
				map: magicString.generateMap({ hires: true }),
			};
			return result;
		},
	};
}
