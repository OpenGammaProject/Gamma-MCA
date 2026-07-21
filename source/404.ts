/*

  Typescript for the 404 page used for applying all the right theming.

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2023, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.net

*/

// Import the main CSS file
// @ts-expect-error SCSS-Import is not recognized by TypeScript, but it works with the build system Webpack/sass-loader
import './css/main.scss';

import { applyTheming, autoThemeChange } from './global-theming';

const localStorageAvailable = 'localStorage' in self; // Test for localStorage, for old browsers

// Apply theming and auto-detection
if (localStorageAvailable) {
	window.addEventListener('DOMContentLoaded', applyTheming);
	window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', autoThemeChange);
}
