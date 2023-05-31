/*

  Theming functions for Gamma MCA.

  Parts are taken from the color mode toggler for Bootstrap's docs (https://getbootstrap.com/) and remixed.
  Copyright 2011-2023 The Bootstrap Authors
  Licensed under the Creative Commons Attribution 3.0 Unported License.

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2023, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

*/

export type Theme = 'dark' | 'light' | 'auto';

/*
function saveJSON(name: string, value: string | boolean | number): boolean {
	localStorage.setItem(name, JSON.stringify(value));
	return true;
}
*/


function loadJSON(name: string): any {
	return JSON.parse(<string>localStorage.getItem(name));
}


function getPreferredTheme(): Theme {
	const storedTheme = loadJSON('theme');
	if (storedTheme !== 'auto') return storedTheme;

	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}


function changeTabBorders(theme: Theme = 'dark'): void {
	const borderColor = theme === 'dark' ? 'light' : 'dark';

	const boarderModeElements = document.getElementsByClassName('border-mode');
	for (const element of boarderModeElements) {
		element.classList.replace(`border-${theme}`, `border-${borderColor}`);
	}

	const plotTabElement = document.getElementById('plot-tab');
	if (plotTabElement) {
		plotTabElement.classList.replace(`border-${theme}`, `border-${borderColor}`);
	}
}


function setTheme(theme: Theme): void {
	if (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
		document.documentElement.setAttribute('data-bs-theme', 'dark');
		changeTabBorders('dark');
	} else {
		document.documentElement.setAttribute('data-bs-theme', theme);
		changeTabBorders(theme);
	}
}


export function autoThemeChange(): Theme {
	const storedTheme = loadJSON('theme');
	if (storedTheme !== 'light' && storedTheme !== 'dark') { // Only change if theme is not set or auto
		const theme = getPreferredTheme();
		setTheme(theme);
		return theme;
	}
	return storedTheme;
}


export function applyTheming(): Theme {
	const theme = getPreferredTheme();

	setTheme(theme); // Apply theme

	/*
	// Add event listener to theming toggle buttons
	document.querySelectorAll('[data-bs-theme-value]').forEach(toggle => {
		toggle.addEventListener('click', () => {
			const theme = <Theme | null>toggle.getAttribute('data-bs-theme-value');

			if (theme) {
				saveJSON('theme', theme);
				setTheme(theme);
			}
		})
	});
	*/

	return theme;
}

