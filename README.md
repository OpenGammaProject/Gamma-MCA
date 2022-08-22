# Gamma MCA

![GitHub code size in bytes](https://img.shields.io/github/languages/code-size/Open-Gamma-Project/Gamma-MCA?style=flat-square) ![GitHub](https://img.shields.io/github/license/Open-Gamma-Project/Gamma-MCA?style=flat-square) ![Website](https://img.shields.io/website?url=https%3A%2F%2Fspectrum.nuclearphoenix.xyz&style=flat-square) ![GitHub deployments](https://img.shields.io/github/deployments/Open-Gamma-Project/Gamma-MCA/github-pages?label=GitHub%20%20Pages&style=flat-square)

Progressive web application for gamma spectroscopy including file and live plot support via the serial interface.

![example spectrum](/assets/screenshots/pwa.PNG)

Built using [Bootstrap](https://github.com/twbs/bootstrap), [Plotly.js](https://github.com/plotly/plotly.js) and [Font Awesome](https://github.com/FortAwesome/Font-Awesome).

## Feature Overview

* No installation required - accessible on every internet-connected device
* Can be easily installed for stand-alone offline use
* Straightforward interface to get down to business
* File import of common data formats (e.g. CSV, TKA)
* Live plotting via the serial interface, compatible with any serial device (e.g. Arduino)
* Linear and quadratic energy calibration
* Customizable list of common isotopes and their gamma-ray energies
* Export interactive graphs of your spectrum to embed it into your website
* Automatic peak detection (energy and isotope)
* ... and much more!

## Importing Spectra

There are essentially two types of files you can use - both being text files, e.g. CSVs:

1. _Dumped serial streams_ with a random new event (energy) on each line. This includes streams from our [Open Gamma Detector](https://github.com/Open-Gamma-Project/Open-Gamma-Detector) or any other serial device. **Important:** If your file is CSV-formatted only the first element will be read. The delimiter can be changed in the settings.
2. Ready-to-use _histograms_. This includes common file types like TKAs, CSVs and also RadiaCode exports. **Important:** If your file has more than one element per line, the first one will be regarded as channel index/energy and the second as the number of counts. If there's one element only, it will be regarded as the number of counts instead.

## Using Serial

Thanks to the Web Serial API you can use any serial device capable of doing gamma spectroscopy to plot your data. The are only two requirements for this to work:

1. The API is currently only supported by Chromium-based (desktop) browsers. This includes most browsers except Safari and Firefox. The feature is either enabled on default or you have to enable it in the settings. See [Can I Use?](https://caniuse.com/web-serial)
2. Your device has to print an EOL character (a semicolon `;`) after every single event to signalize the end of a data entry. Whitespace or newlines do not matter.

## Contributing

The PWA is written with TypeScript. The files can be found in `assets/js/`, please only modify the `.ts` files -- all `.js` files are auto-generated.

---

Notice: The [LICENSE](/LICENSE) does not apply to the name "Gamma MCA" and especially the Gamma MCA logo. These are Copyright 2021 by me, Phoenix1747.
