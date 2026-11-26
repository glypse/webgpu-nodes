import type { GraphModel } from "./model";

/**
 * The model's edits, by method name. A command is one of these with its
 * arguments, as plain JSON: what a front end sends, what scenarios are
 * written in, and what a model behind a WASM boundary would receive.
 */
export const COMMANDS = [
	"updateSettings",
	"setScreen",
	"setAreaEditor",
	"setAreaPath",
	"enterGroup",
	"exitGroup",
	"jumpToPath",
	"updateNodeData",
	"setInputValue",
	"setCurve",
	"setSetting",
	"createZone",
	"createRepeatZone",
	"createSimulationZone",
	"addZoneItem",
	"removeZoneItem",
	"renameZoneItem",
	"setZoneItemType",
	"setZoneItemFormat",
	"setZoneItemSize",
	"moveZoneItem",
	"setZoneMaxIterations",
	"connectNewZoneItem",
	"importGroups",
	"groupSelection",
	"ungroupSelection",
	"deepClone",
	"addFromLibrary",
	"createGroup",
	"setGroupLabel",
	"deleteDefinition",
	"pruneUnusedDefinitions",
	"setHandleLabel",
	"addHandle",
	"addBoundaryHandle",
	"setHandleDisplay",
	"setHandleTypeOwner",
	"setVariantsBy",
	"setVariantOffered",
	"setHandleCompiled",
	"setHandleRange",
	"setHandleDefault",
	"setHandleType",
	"addTypeVariable",
	"setTypeVariable",
	"removeTypeVariable",
	"setVariableType",
	"setHandleVariants",
	"removeHandle",
	"setCustomCode",
	"addCustomSocket",
	"removeCustomSocket",
	"renameCustomSocket",
	"setCustomSocketType",
	"moveCustomSocket",
	"setIndexSwitchCases",
	"setColorRamp",
	"addRenderItem",
	"removeRenderItem",
	"renameRenderItem",
	"setRenderItemFormat",
	"setRenderItemType",
	"moveRenderItem",
	"pasteNodes",
	"duplicateNodes",
	"selectNodes",
	"moveNodes",
	"deleteNodes",
	"dissolveNodes",
	"resetNodes",
	"toggleUnlinkedSockets",
	"toggleHiddenLinks",
	"setNodeLabel",
	"rerouteEdges",
	"frameNodes",
	"setNodesFrame",
	"removeFromFrame",
	"previewNode",
	"addAsset",
	"renameAsset",
	"replaceAsset",
	"removeAsset",
	"setNodeAsset",
	"setVideoPlayback",
	"recordHistory",
	"undo",
	"redo",
	"markSaved",
	"connect",
	"loadFromString",
	"addNode",
	"addAssetNode",
	"dropAssets",
	"addMenuEntry",
	"addMenuEntryConnected",
	"setNodeType",
	"layoutDocument",
	"layoutSelection",
	"layoutProject",
] as const satisfies readonly (keyof GraphModel)[];

export type CommandKind = (typeof COMMANDS)[number];

type Json =
	| string
	| number
	| boolean
	| null
	| undefined
	| readonly Json[]
	| { readonly [key: string]: Json };

type Method<K extends CommandKind> = GraphModel[K] extends (...args: infer A) => infer R
	? { args: A; result: R }
	: never;

/** A command whose arguments aren't JSON: the type is `never`, which `COMMAND_ARGS_ARE_JSON` refuses. */
type JsonArgs<K extends CommandKind> = Method<K>["args"] extends Json ? Method<K>["args"] : never;

export type CommandOf<K extends CommandKind> = { kind: K; args: JsonArgs<K> };
export type Command = { [K in CommandKind]: CommandOf<K> }[CommandKind];
export type CommandResult<K extends CommandKind> = Method<K>["result"];

type NonJsonCommands = {
	[K in CommandKind]: [JsonArgs<K>] extends [never] ? K : never;
}[CommandKind];
export const COMMAND_ARGS_ARE_JSON: [NonJsonCommands] extends [never] ? true : NonJsonCommands =
	true;

/** Apply `command` to `model`, giving what its method returns. */
export function applyCommand<K extends CommandKind>(
	model: GraphModel,
	command: CommandOf<K>,
): CommandResult<K> {
	const method = model[command.kind] as (...args: readonly unknown[]) => CommandResult<K>;
	return method.apply(model, command.args);
}
