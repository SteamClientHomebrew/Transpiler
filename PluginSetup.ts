declare global {
	interface Window {
		/**
		 * @description The plugin list is a global object that contains all the plugins loaded in the client.
		 * It is used to store the pluginSelf object
		 */
		PLUGIN_LIST: any;
		/**
		 * @description The plugin settings store is a global object that contains all the plugins settings.
		 * It is used to store the plugin settings and the plugin settings parser.
		 */
		MILLENNIUM_PLUGIN_SETTINGS_STORE: any;
	}
}

interface SettingsProps {
	options?: any[];
	range?: number[];
	type: string;
	value: any;
}

/**
 * the pluginName is the name of the plugin.
 * It is used to identify the plugin in the plugin list and settings store.
 */
declare const pluginName: string;
/**
 * PluginEntryPointMain is the default function returned by rolling up the plugin.
 * It is the main entry point for the plugin. It's IIFE has been removed, therefore it only runs once its manually called.
 * This is done to prevent the plugin from running before the settings have been parsed.
 */
declare const PluginEntryPointMain: any;
/**
 * The underlying IPC object used to communicate with the backend.
 * Its defined within the plugin utils package under the client module.
 */
declare const MILLENNIUM_BACKEND_IPC: any;
/**
 * Since ExecutePluginModule is called from both the webkit and the client module,
 * this flag is used to determine if the plugin is running in the client module or not.
 */
declare const MILLENNIUM_IS_CLIENT_MODULE: boolean;
/**
 * A reference to the main Web Browser within the client.
 * This is used to send messages to the main window browser manager.
 */
declare const MainWindowBrowserManager: any;
/**
 * Steam Client API object
 */
declare const SteamClient: any;

/**
 * @description Append the active plugin to the global plugin
 * list and notify that the frontend Loaded.
 */
function ExecutePluginModule() {
	let MillenniumStore = window.MILLENNIUM_PLUGIN_SETTINGS_STORE[pluginName];

	function OnPluginConfigChange(key: any, __: string, value: any) {
		if (key in MillenniumStore.settingsStore) {
			MillenniumStore.ignoreProxyFlag = true;
			MillenniumStore.settingsStore[key] = value;
			MillenniumStore.ignoreProxyFlag = false;
		}
	}

	/** Expose the OnPluginConfigChange so it can be called externally */
	MillenniumStore.OnPluginConfigChange = OnPluginConfigChange;

	MILLENNIUM_BACKEND_IPC.postMessage(0, { pluginName: pluginName, methodName: '__builtins__.__millennium_plugin_settings_parser__' }).then((response: any) => {
		/**
		 * __millennium_plugin_settings_parser__ will return false if the plugin has no settings.
		 * If the plugin has settings, it will return a base64 encoded string.
		 * The string is then decoded and parsed into an object.
		 */
		if (typeof response.returnValue === 'string') {
			MillenniumStore.ignoreProxyFlag = true;

			/** Initialize the settings store from the settings returned from the backend. */
			MillenniumStore.settingsStore = MillenniumStore.DefinePluginSetting(
				Object.fromEntries(JSON.parse(atob(response.returnValue)).map((item: any) => [item.functionName, item])),
			);

			MillenniumStore.ignoreProxyFlag = false;
		}

		/** @ts-ignore: call the plugin main after the settings have been parsed. This prevent plugin settings from being undefined at top level. */
		let PluginModule = PluginEntryPointMain();

		/** Assign the plugin on plugin list. */
		Object.assign(window.PLUGIN_LIST[pluginName], {
			...PluginModule,
			__millennium_internal_plugin_name_do_not_use_or_change__: pluginName,
		});

		/** Run the rolled up plugins default exported function */
		PluginModule.default();

		/** If the current module is a client module, post message id=1 which calls the front_end_loaded method on the backend. */
		if (MILLENNIUM_IS_CLIENT_MODULE) {
			MILLENNIUM_BACKEND_IPC.postMessage(1, { pluginName: pluginName });
		}
	});
}

/**
 * @description Initialize the plugins settings store and the plugin list.
 * This function is called once per plugin and is used to store the plugin settings and the plugin list.
 */
function InitializePlugins() {
	/**
	 * This function is called n times depending on n plugin count,
	 * Create the plugin list if it wasn't already created
	 */
	(window.PLUGIN_LIST ||= {})[pluginName] ||= {};
	(window.MILLENNIUM_PLUGIN_SETTINGS_STORE ||= {})[pluginName] ||= {};

	/**
	 * Accepted IPC message types from Millennium backend.
	 */
	enum IPCType {
		CallServerMethod,
	}

	let MillenniumStore = window.MILLENNIUM_PLUGIN_SETTINGS_STORE[pluginName];
	let IPCMessageId = `Millennium.Internal.IPC.[${pluginName}]`;
	let isClientModule = MILLENNIUM_IS_CLIENT_MODULE;

	const ComponentTypeMap = {
		DropDown: ['string', 'number', 'boolean'],
		NumberTextInput: ['number'],
		StringTextInput: ['string'],
		FloatTextInput: ['number'],
		CheckBox: ['boolean'],
		NumberSlider: ['number'],
		FloatSlider: ['number'],
	};

	MillenniumStore.ignoreProxyFlag = false;

	function DelegateToBackend(pluginName: string, name: string, value: any) {
		console.log(`Delegating ${name} to backend`, value);
		// print stack trace
		const stack = new Error().stack?.split('\n').slice(2).join('\n');
		console.log(stack);

		return MILLENNIUM_BACKEND_IPC.postMessage(IPCType.CallServerMethod, {
			pluginName,
			methodName: '__builtins__.__update_settings_value__',
			argumentList: { name, value },
		});
	}

	async function ClientInitializeIPC() {
		/** Wait for the MainWindowBrowser to not be undefined */
		while (typeof MainWindowBrowserManager === 'undefined') {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}

		MainWindowBrowserManager.m_browser.on('message', (messageId: string, data: string) => {
			if (messageId !== IPCMessageId) {
				return;
			}

			const { name, value } = JSON.parse(data);

			MillenniumStore.ignoreProxyFlag = true;
			MillenniumStore.settingsStore[name] = value;

			DelegateToBackend(pluginName, name, value);
			MillenniumStore.ignoreProxyFlag = false;
		});
	}

	function WebkitInitializeIPC() {
		SteamClient.BrowserView.RegisterForMessageFromParent((messageId: string, data: string) => {
			if (messageId !== IPCMessageId) {
				return;
			}

			const payload = JSON.parse(data);
			MillenniumStore.ignoreProxyFlag = true;
			MillenniumStore.settingsStore[payload.name] = payload.value;
			MillenniumStore.ignoreProxyFlag = false;
		});
	}

	isClientModule ? ClientInitializeIPC() : WebkitInitializeIPC();

	const StartSettingPropagation = (name: string, value: any) => {
		if (MillenniumStore.ignoreProxyFlag) {
			return;
		}

		if (isClientModule) {
			DelegateToBackend(pluginName, name, value);

			/** If the browser doesn't exist yet, no use sending anything to it. */
			if (typeof MainWindowBrowserManager !== 'undefined') {
				MainWindowBrowserManager?.m_browser?.PostMessage(IPCMessageId, JSON.stringify({ name, value }));
			}
		} else {
			/** Send the message to the SharedJSContext */
			SteamClient.BrowserView.PostMessageToParent(IPCMessageId, JSON.stringify({ name, value }));
		}
	};

	function clamp(value: number, min: number, max: number) {
		return Math.max(min, Math.min(max, value));
	}

	const DefinePluginSetting = <T extends Record<string, SettingsProps>>(obj: T) => {
		return new Proxy(obj, {
			set(target, property, value) {
				if (!(property in target)) {
					throw new TypeError(`Property ${String(property)} does not exist on plugin settings`);
				}

				const settingType = ComponentTypeMap[target[property as keyof T].type as keyof typeof ComponentTypeMap];
				const range = target[property as keyof T]?.range;

				/** Clamp the value between the given range */
				if (settingType.includes('number') && typeof value === 'number') {
					if (range) {
						value = clamp(value, range[0], range[1]);
					}

					value ||= 0; // Fallback to 0 if the value is undefined or null
				}

				/** Check if the value is of the proper type */
				if (!settingType.includes(typeof value)) {
					throw new TypeError(`Expected ${settingType.join(' or ')}, got ${typeof value}`);
				}

				target[property as keyof T].value = value;
				StartSettingPropagation(String(property), value);
				return true;
			},
			get(target, property) {
				if (property === '__raw_get_internals__') {
					return target;
				}

				if (property in target) {
					return target[property as keyof T].value;
				}
				return undefined;
			},
		});
	};

	MillenniumStore.DefinePluginSetting = DefinePluginSetting;
	MillenniumStore.settingsStore = DefinePluginSetting({});
}

export { ExecutePluginModule, InitializePlugins };
