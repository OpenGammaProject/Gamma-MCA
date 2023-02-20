# Gamma MCA

![GitHub code size in bytes](https://img.shields.io/github/languages/code-size/OpenGammaProject/Gamma-MCA?style=flat-square) ![GitHub](https://img.shields.io/github/license/OpenGammaProject/Gamma-MCA?style=flat-square) ![Website](https://img.shields.io/website?url=https%3A%2F%2Fspectrum.nuclearphoenix.xyz&style=flat-square) ![GitHub deployments](https://img.shields.io/github/deployments/OpenGammaProject/Gamma-MCA/github-pages?label=GitHub%20%20pages&style=flat-square) ![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/OpenGammaProject/Gamma-MCA/codeql-analysis.yml?label=CodeQL&style=flat-square)

Progressive web application for gamma spectroscopy including file and live plot support via the serial interface.

![example spectrum](/assets/screenshots/file.PNG)

Built using [Bootstrap](https://github.com/twbs/bootstrap), [Plotly.js](https://github.com/plotly/plotly.js), [Font Awesome](https://github.com/FortAwesome/Font-Awesome) and [Z-Schema](https://github.com/zaggino/z-schema).

## Feature Overview

* No installation required - accessible on every internet-connected device
* Can be easily installed for stand-alone offline use
* Straightforward interface to get down to business
* File import of common data formats (e.g. CSV, TKA, XML, JSON)
* Export JSON/XML files combining all the spectra, calibration data and sample info
* Live plotting via the serial interface, compatible with any serial device (e.g. Arduino) on [desktop](https://caniuse.com/web-serial)
* Compatible with serial FTDI chips on [mobile](https://caniuse.com/webusb)
* Serial console to control your device
* Linear and quadratic energy calibration
* Gaussian correlation filtering for peak detection
* Customizable list of common isotopes and their gamma-ray energies
* Export interactive graphs of your spectrum to embed it into your website
* Automatic peak detection (energy and isotope)
* ... and much more!

## Importing Spectra

There are essentially two types of files you can use - both being text files, e.g. CSVs, XMLs or JSONs:

1. _Chronological streams_ where each new detected event gets printed to the file after the previous one. This includes streams from our [Open Gamma Detector](https://github.com/OpenGammaProject/Open-Gamma-Detector) or any other serial device that has been set up to do so. **Important:** The whole file will be read and the individual events are confined using the delimiter. Whitespace or newlines do not matter. The delimiter can be changed in the settings.
2. Ready-to-use _histograms_. This includes common file types like TKAs, CSVs and also, e.g., RadiaCode 101 XML exports. **Important:** If your file has more than one element per line (CSV), the first one will be regarded as channel index/energy and the second as the number of counts. If there's one element only, it will be regarded as the number of counts instead.

Gamma MCA can import JSON files complying with the [NPES JSON Schema](https://github.com/OpenGammaProject/NPES-JSON).

## Using Serial

Thanks to the Web Serial API you can use any serial device capable of doing gamma spectroscopy or processing the data to plot your spectra. The are two types of prints supported:

1. _Chronological streams_ where each new detected event gets printed to the serial interface after the other. **Important:** Your device has to print a special character (default's a semicolon `;`) after every single event to signalize the end of a data entry. Whitespace or newlines do not matter. The delimiter can be changed in the settings.
2. Ready-to-use _histograms_. This data has been pre-processed and the finished histogram will be periodically transmitted. **Important:** Your device has to print a special character (default's a semicolon `;`) after every single histogram channel/bin to signalize the end of a data entry and each new histogram needs to be on a new line (`\n` or e.g., Arduino's `Serial.println(...)`)! The delimiter can be changed in the settings, as well as the correct number of ADC channels that is required for this to work.

Both modes are currently supported by our [Open Gamma Detector](https://github.com/OpenGammaProject/Open-Gamma-Detector) or any other serial device that has been set up to do so.

**Note:** The API is currently only supported by Chromium-based (desktop) browsers! This includes most browsers except for Safari and Firefox. The feature is either enabled by default or you have to enable it in the settings yourself. See [Can I Use?.com](https://caniuse.com/web-serial).

## Contributing

The PWA is written with TypeScript. To make changes to the code, please only commit to and make pull requests for the `dev` branch! `main` will only pull changes from `dev` once I approve it.

You can find all the `.ts` files inside the `source` folder. The `tsconfig.json` as well as the `package.json` for installation of the node packages and compilation is in the root directory. The `index.html` is the only HTML file and can also be found there. To change other files like the CSS, fonts or so, head to `assets`. Other JS libs used in this app can be found in `assets/js/external`.

To make changes to the service worker, have a look at `service-worker.js`. It is written in vanilla JS, because compiling it in TS is absolute pain and totally not worth it.

## Branding

The [LICENSE](/LICENSE) does not apply to the name _Gamma MCA_ and especially the Gamma MCA/OpenGammaProject [logo](assets/logo.svg). This also includes any derivatives that contain the same logo, such as the images inside `assets/favicon` or `assets/files`.

- Do not use them in any way that suggests you are the OpenGammaProject or Gamma MCA or that the OpenGammaProject is endorsing you or your offering or project.
- Do not use the OpenGammaProject logo as the icon or logo for your business/organization, offering, project, domain name, social media account, or website.
- Do not modify the OpenGammaProject logo.

Feel free to fork this repository to archive it or create pull requests here and contribute. However, if you're forking the project, then make (significant) changes without the purpose of contribution these here, please remove the branding (_Gamma MCA_ name and all OpenGammaProject-related logos).
