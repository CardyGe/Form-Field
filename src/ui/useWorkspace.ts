import { useRef, useState } from 'react';

const KEY = 'formfield-workspace-v1';
interface Preferences { layersExpanded: boolean; inspectorOpen: boolean }
const defaults: Preferences = { layersExpanded: false, inspectorOpen: true };
function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return { layersExpanded: typeof value?.layersExpanded === 'boolean' ? value.layersExpanded : defaults.layersExpanded,
      inspectorOpen: typeof value?.inspectorOpen === 'boolean' ? value.inspectorOpen : window.innerWidth > 900 };
  } catch { return defaults; }
}

export function useWorkspace() {
  const [preferences, setPreferences] = useState(readPreferences);
  const currentPreferences = useRef(preferences);
  currentPreferences.current = preferences;
  const [focusMode, setFocusMode] = useState(false), [libraryOpen, setLibraryOpen] = useState(false), [variationOpen, setVariationOpen] = useState(false);
  const library = useRef<HTMLElement>(null), variation = useRef<HTMLDivElement>(null);
  const libraryButton = useRef<HTMLButtonElement>(null), layersButton = useRef<HTMLButtonElement>(null);
  const inspectorButton = useRef<HTMLButtonElement>(null), focusButton = useRef<HTMLButtonElement>(null);
  const variationButton = useRef<HTMLButtonElement>(null);
  const updatePreferences = (change: (value: Preferences) => Preferences) => {
    const next = change(currentPreferences.current);
    currentPreferences.current = next;
    // Persist within the action, so an immediate reload cannot lose the layout.
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Layout still works without storage. */ }
    setPreferences(next);
  };
  const closePopovers = () => { library.current?.hidePopover(); variation.current?.hidePopover(); };
  const toggleFocus = () => {
    closePopovers(); setFocusMode(value => !value);
    requestAnimationFrame(() => focusButton.current?.focus({ preventScroll: true }));
  };
  const toggleLayers = () => {
    updatePreferences(value => ({ ...value, layersExpanded: !value.layersExpanded }));
    requestAnimationFrame(() => layersButton.current?.focus({ preventScroll: true }));
  };
  const toggleInspector = () => {
    updatePreferences(value => ({ ...value, inspectorOpen: !value.inspectorOpen }));
    requestAnimationFrame(() => inspectorButton.current?.focus({ preventScroll: true }));
  };
  return { ...preferences, focusMode, setFocusMode, libraryOpen, setLibraryOpen, variationOpen, setVariationOpen,
    library, variation, libraryButton, layersButton, inspectorButton, focusButton, variationButton,
    toggleFocus, toggleLayers, toggleInspector, closePopovers };
}
