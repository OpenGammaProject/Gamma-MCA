function loadJSON(name) {
    return JSON.parse(localStorage.getItem(name));
}
function getPreferredTheme() {
    const storedTheme = loadJSON('theme');
    if (storedTheme !== 'auto')
        return storedTheme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function changeTabBorders(theme = 'dark') {
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
function setTheme(theme) {
    if (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-bs-theme', 'dark');
        changeTabBorders('dark');
    }
    else {
        document.documentElement.setAttribute('data-bs-theme', theme);
        changeTabBorders(theme);
    }
}
export function autoThemeChange() {
    const storedTheme = loadJSON('theme');
    if (storedTheme !== 'light' && storedTheme !== 'dark') {
        const theme = getPreferredTheme();
        setTheme(theme);
        return theme;
    }
    return storedTheme;
}
export function applyTheming() {
    const theme = getPreferredTheme();
    setTheme(theme);
    return theme;
}
//# sourceMappingURL=global-theming.js.map