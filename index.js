/**
 * dsh-novel-wallpaper — host half.
 *
 * Intentionally a no-op. This plugin is browser-only: it renders the novel as a
 * text layer behind the GUI and keeps all state in the tab (IndexedDB +
 * localStorage). It registers no tools, appends no session events, and exposes
 * nothing to the model, so reading stays private to the user.
 */

export function apply() {}
