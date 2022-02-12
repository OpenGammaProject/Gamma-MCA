# Gamma-MCA

Web application for gamma spectroscopy including file and live plot support via the serial interface.

![example spectrum](/docs/screenshot.PNG)

## Feature Overview

* No installation required - accessible on every internet-connected device
* Straightforward interface to get down to business
* File import of common data formats
* Live plotting of any serial device using the Web Serial API
* Linear energy calibration
* Customizable list of common gamma-ray energies

## Importing Spectra

There are essentially two types of files you can use - both being text files, e.g. CSVs:

1. _Dumped serial streams_ with a new energy event on each line. This includes streams from our [Open Scintillation Counter](https://github.com/Open-Gamma-Project/Open-Scintillation-Counter) or any other serial device. **Important:** If your file is CSV-formatted only the first element will be read. The delimiter can be changed in the settings.
2. Ready-to-use _histograms_. This includes common file types like TKAs, CSVs and also RadiaCode exports. **Important:** If your file has more than one element per line, the first one will be regarded as channel index/energy and the second as the number of counts. If there's one element only, it will be regarded as index instead.

## Using Serial

Thanks to the Web Serial API you can use any serial device capable of doing gamma spectroscopy to plot your data. The are only two requirements for this to work:

1. The API is currently only supported by Chromium-based (desktop) browsers. This includes most browsers except Safari and Firefox. The feature is either enabled on default or you have to enable it in the settings. See [Can I Use?](https://caniuse.com/web-serial)
2. Your device has to print a newline (`\n`) after every single event and must not print other data than the detected energy.

---

The End.
