/*

  Typescript for the 404 page used for applying all the right theming.

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2023, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

*/

// Import the main CSS file
import './css/main.scss';

import { applyTheming, autoThemeChange } from './global-theming';

const localStorageAvailable = 'localStorage' in self; // Test for localStorage, for old browsers

// Apply theming and auto-detection
if (localStorageAvailable) {
	window.addEventListener('DOMContentLoaded', applyTheming);
	window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', autoThemeChange);
}
