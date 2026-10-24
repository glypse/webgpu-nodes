// Single-component: exported as bare names (use as <Button>, <Input>, etc.)
export { Root as Button, buttonVariants } from "./button/index";
export { Root as Checkbox } from "./checkbox/index";
export { ColorPicker, ColorValueRamp, ColorWheel } from "./color-picker/index";
export { Root as Input } from "./input/index";
export { Root as Label } from "./label/index";
export { Root as Separator } from "./separator/index";
export { Root as Textarea } from "./textarea/index";
export { Root as Scrubbable } from "./scrubbable/index";

// Multi-component: exported as namespaces (use as <ContextMenu.Root>, <Menubar.Menu>, etc.)
export * as AlertDialog from "./alert-dialog/index";
export * as Breadcrumb from "./breadcrumb/index";
export * as Command from "./command/index";
export * as ContextMenu from "./context-menu/index";
export * as Dialog from "./dialog/index";
export * as DropdownMenu from "./dropdown-menu/index";
export * as InputGroup from "./input-group/index";
export * as Kbd from "./kbd/index";
export * as Menubar from "./menubar/index";
export * as Popover from "./popover/index";
export * as Resizable from "./resizable/index";
export * as Select from "./select/index";
export * as Sheet from "./sheet/index";
