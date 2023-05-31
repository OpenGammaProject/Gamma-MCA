import { applyTheming, autoThemeChange } from './global-theming.js';
const localStorageAvailable = 'localStorage' in self;
if (localStorageAvailable) {
    window.addEventListener('DOMContentLoaded', applyTheming);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', autoThemeChange);
}
//# sourceMappingURL=404.js.map