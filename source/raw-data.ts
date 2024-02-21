/*

  Load and process many different file formats to get usable data.

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

  Do not touch my garbage. All the CSV-related stuff is ugly asf.

*/

// Import all of PolynomialRegression's JS
import PolynomialRegression from './lib/regression/PolynomialRegression.min';

// Import all of z-schema's JS
import ZSchema from 'z-schema';

// Import other TS modules
import { CoeffObj } from './plot';

export interface JSONParseError {
  code: string;
  description: string;
}

export interface NPESv2 {
  schemaVersion: 'NPESv2';
  data: NPESv1[];
}

export interface NPESv1 {
  schemaVersion?: 'NPESv1';
  deviceData?: NPESv1DeviceData;
  sampleInfo?: NPESv1SampleInfo;
  resultData: NPESv1ResultData;
}

export interface NPESv1Spectrum {
  numberOfChannels: number;
  validPulseCount?: number;
  measurementTime?: number;
  energyCalibration?: {
    polynomialOrder: number;
    coefficients: number[];
  };
  spectrum: number[];
}

interface NPESv1ResultData {
  startTime?: string;
  endTime?: string;
  energySpectrum?: NPESv1Spectrum;
  backgroundEnergySpectrum?: NPESv1Spectrum;
}

interface NPESv1DeviceData {
  deviceName?: string;
  softwareName: string;
}

interface NPESv1SampleInfo {
  name?: string;
  location?: string;
  time?: string;
  weight?: number;
  volume?: number;
  note?: string;
}

interface XMLImportData {
  espectrum: number[];
  bgspectrum: number[];
  coeff: CoeffObj;
  meta: ImportDataMeta;
}

interface ImportDataMeta {
  name: string;
  location: string;
  time: string;
  weight?: number;
  volume?: number;
  notes: string;
  deviceName: string;
  startTime: string;
  endTime: string;
  dataMt: number; // Measurement time for the energy spectrum
  backgroundMt: number; // Measurement time for the background energy spectrum
}

interface SchemaJSONStorage {
  NPESv1: NPESv1 | undefined;
  NPESv2: NPESv2 | undefined;
}

interface CSVData {
  histogramData: number[];
  calibrationCoefficients: number[] | undefined;
}

export class RawData {
  valueIndex: number;
  delimiter: string;
  adcChannels = 4096; // For OGD
  fileType: number;
  private tempValIndex: number;
  private schemaURLTable = {
    NPESv1: '/assets/npes-1.schema.json',
    NPESv2: '/assets/npes-2.schema.json'
  };
  private schemaJSON: SchemaJSONStorage = {
    NPESv1: undefined,
    NPESv2: undefined
  };

  constructor(valueIndex: number, delimiter = ',') {
    this.valueIndex = valueIndex;
    this.delimiter = delimiter;
    this.adcChannels;
    this.fileType = valueIndex;
    this.tempValIndex = valueIndex;
  }

  private checkLines(value: string): boolean {
    const values = value.split(this.delimiter);

    if (isNaN(parseFloat(values[0].trim()))) return false;
    if (values.length === 1) this.tempValIndex = 0; // Work-Around for files with only one column

    return values.length > this.tempValIndex;
  }

  private parseLines(value: string): number {
    const values = value.split(this.delimiter);
    return parseFloat(values[this.tempValIndex].trim());
  }

  private histConverter(dataArr: number[]): number[] {
    const xArray: number[] = Array(this.adcChannels).fill(0);

    for (const element of dataArr) {
      xArray[element] += 1;
    }
    return xArray;
  }

  private parseCalibration(valueArray: string[]): number[] | undefined {
    if (!this.tempValIndex) return undefined; // Only one column, return no calibration
    if (valueArray.length < 3) return undefined; // Not enough data to get the coefficients, return no calibration

    const xEnergyData = valueArray.map((value) => parseFloat(value.split(this.delimiter)[0].trim())/*, this*/);
    const regressionArray: {x: number, y: number}[] = [];

    for (const index in xEnergyData) {
      const newObj  = {
        x: parseInt(index),
        y: xEnergyData[index]
      };
      regressionArray.push(newObj);
    }

    const model = PolynomialRegression.read(regressionArray, 3); // Use degree 3 for a good default calibration
    const terms = model.getTerms();

    return terms;
  }

  csvToArray(data: string): CSVData {
    this.tempValIndex = this.valueIndex; // RESET VALUE INDEX

    const returnData: CSVData = {
      histogramData: [],
      calibrationCoefficients: undefined
    };

    if (this.fileType === 1) { // HISTOGRAM
      const dataLines = data.split('\n').filter(this.checkLines, this);

      returnData.calibrationCoefficients = this.parseCalibration(dataLines); // Get linear calibration data
      returnData.histogramData = dataLines.map(this.parseLines, this);
    } else { // CHRONOLOGICAL STREAM
      const dataEvents = data.split(this.delimiter).filter(this.checkLines, this);

      returnData.histogramData = this.histConverter(dataEvents.map(this.parseLines, this));
    }

    return returnData;
  }

  xmlToArray(data: string): XMLImportData {
    const coeff: CoeffObj = {
      c1: 0,
      c2: 0,
      c3: 0
    };
    const meta: ImportDataMeta = {
      name: '',
      location: '',
      time: '',
      notes: '',
      deviceName: '',
      startTime: '',
      endTime: '',
      dataMt: 0,
      backgroundMt: 0
    };

    try {
      const xmlDoc = new DOMParser().parseFromString(data, 'text/xml');
      const especTop = xmlDoc.getElementsByTagName('EnergySpectrum');
      let espectrum = <number[]>[];
      let bgspectrum = <number[]>[];

      if (especTop[0]) {
        const espec = especTop[0].getElementsByTagName('DataPoint');

        espectrum = Array.from(espec).map(item => parseFloat(item.textContent ?? '-1'));

        meta.dataMt = parseFloat(especTop[0].getElementsByTagName('MeasurementTime')[0]?.textContent?.trim() ?? '1');
      }

      const bgspecTop = xmlDoc.getElementsByTagName('BackgroundEnergySpectrum');

      if (bgspecTop[0]) {
        const bgspec = bgspecTop[0].getElementsByTagName('DataPoint');

        bgspectrum = Array.from(bgspec).map(item => parseFloat(item.textContent ?? '-1'));

        meta.backgroundMt = parseFloat(bgspecTop[0].getElementsByTagName('MeasurementTime')[0]?.textContent?.trim() ?? '1');
      }

      const calCoeffsTop = xmlDoc.getElementsByTagName('EnergySpectrum')[0];

      if (calCoeffsTop) {
        const calCoeffs = calCoeffsTop.getElementsByTagName('Coefficient');

        const coeffNumArray = Array.from(calCoeffs).map(item => parseFloat((item.textContent ?? '0')));

        for (const i in coeffNumArray) {
          coeff['c' + (parseInt(i) + 1).toString()] = coeffNumArray[parseInt(i)];
        }
      }

      const rdl = xmlDoc.getElementsByTagName('SampleInfo')[0];

      meta.name = rdl?.getElementsByTagName('Name')[0]?.textContent?.trim() ?? '';
      meta.location = rdl?.getElementsByTagName('Location')[0]?.textContent?.trim() ?? '';
      meta.time = rdl?.getElementsByTagName('Time')[0]?.textContent?.trim() ?? '';
      meta.notes = rdl?.getElementsByTagName('Note')[0]?.textContent?.trim() ?? '';

      let val = parseFloat(rdl?.getElementsByTagName('Weight')[0]?.textContent?.trim() ?? '0');
      if (val > 0) meta.weight = val*1000; // Convert from kg to g

      val = parseFloat(rdl?.getElementsByTagName('Volume')[0]?.textContent?.trim() ?? '0'); // Convert from L to ml
      if (val > 0) meta.volume = val*1000;

      meta.deviceName = xmlDoc.getElementsByTagName('DeviceConfigReference')[0]?.getElementsByTagName('Name')[0]?.textContent?.trim() ?? '';

      meta.startTime = xmlDoc.getElementsByTagName('StartTime')[0]?.textContent?.trim() ?? '';
      meta.endTime = xmlDoc.getElementsByTagName('EndTime')[0]?.textContent?.trim() ?? '';

      return {espectrum, bgspectrum, coeff, meta};
    } catch (e) {
      console.error(e);
      return {espectrum: [], bgspectrum: [], coeff, meta};
    }
  }

  async jsonToObject(data: string): Promise<NPESv1[] | JSONParseError[]> {
    let json: unknown;

    try {
      json = JSON.parse(data);

      if (!json || typeof json !== 'object') {
        throw 'Not a valid object!';
      }
    } catch (e) {
      console.error(e);
      return [{code: 'JSON_PARSE_ERROR', description: `A problem with the JSON formatting occured when trying to parse the contents of the file: ${e}`}];
    }

    let version: 'NPESv1' | 'NPESv2';

    try {
      if ('schemaVersion' in json) {
        // Detect schemaVersion (either NPESv1 or NPESv2)
        if (json.schemaVersion === 'NPESv1' || json.schemaVersion === 'NPESv2') {
          version = json.schemaVersion;
        } else {
          throw `schemaVersion is neither NPESv1 nor NPESv2, but ${json.schemaVersion}!`;
        }
      } else {
        throw 'No schemaVersion was supplied, cannot parse data!';
      }
    } catch(e) {
      console.error(e);
      return [{code: 'NPES_VERSION_ERROR', description: `An error occured when trying to parse the schema version: ${e}`}];
    }
    
    try {
      // Load the correct schema if if hasn't been loaded before
      if (!this.schemaJSON[version]) {
        const response = await fetch(this.schemaURLTable[version]);

        if (response.ok) {
          const schema = await response.json();
          delete schema['$schema']; // Remove, otherwise it will crash because it cannot resolve the schema URI, wow...
          this.schemaJSON[version] = schema;
        } else {
          throw 'Could not load the schema file!';
        }
      }

      const validator = new ZSchema({}); // Use empty default options/config
      validator.validate(json, this.schemaJSON[version]);
      const errors = validator.getLastErrors();

      if (errors) {
        //throw errors; // Catch validation errors
        const errorMessages: JSONParseError[] = [];

        for (const error of errors) {
          errorMessages.push({
            'code': error.code,
            'description': error.message
          });
        }

        console.error(errorMessages);
        return errorMessages;
      }

      if (version === 'NPESv1') {
        return [<NPESv1>json]; // Only a single data package available
      } else { // NPESv2
        return (<NPESv2>json).data; // Return all data packages from the file
      }

    } catch(e) {
      console.error(e);
      return [{code: 'UNDEFINED_ERROR', description: `Some undefined error occured: ${e}`}];
    }
  }
}
