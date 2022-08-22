/*

  File String in CSV, XML, TKA, ... format -> Array

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

*/

export class RawData {
  valueIndex: number;
  delimiter: string;
  adcChannels: number;
  fileType: number;
  private tempValIndex: number;

  constructor(valueIndex: number, delimiter = ',') {
    this.valueIndex = valueIndex;
    this.delimiter = delimiter;

    this.adcChannels = 4096; // For OSC
    this.fileType = valueIndex;
    this.tempValIndex = valueIndex;
  }

  checkLines(value: string): boolean {
    const values = value.split(this.delimiter);

    if (values.length === 1){ // Work-Around for files with only one column
      this.tempValIndex = 0;
    }

    return values.length > this.tempValIndex;
  }

  parseLines(value: string): number {
    const values = value.split(this.delimiter);
    return parseFloat(values[this.tempValIndex].trim());
  }

  histConverter(dataArr: number[]): number[] {
    if (this.fileType === 1) {
      return dataArr;
    }

    let xArray: number[] = Array(this.adcChannels).fill(0);

    for(const element of dataArr) {
      xArray[element] += 1;
    }
    return xArray;
  }

  csvToArray(data: string): number[] {
    this.tempValIndex = this.valueIndex; // RESET VALUE INDEX

    const allLines = data.split('\n');

    const dataLines = allLines.filter(this.checkLines, this);
    const cleanData = dataLines.map(this.parseLines, this);

    return this.histConverter(cleanData);
  }

  xmlToArray(data: string): {espectrum: number[], bgspectrum: number[]} {
    try {
      const parser = new DOMParser();
      let xmlDoc = parser.parseFromString(data, 'text/xml');
      const espec = xmlDoc.getElementsByTagName('EnergySpectrum')[0].getElementsByTagName('DataPoint');
      const bgspec = xmlDoc.getElementsByTagName('BackgroundEnergySpectrum')[0].getElementsByTagName('DataPoint');

      const especArray = Array.from(espec);
      const bgspecArray = Array.from(bgspec);

      const espectrum = this.histConverter(especArray.map(item => {
        if (item.textContent === null) {
          return -1;
        }
        return parseInt(item.textContent);
      }));
      const bgspectrum = this.histConverter(bgspecArray.map(item => {
        if (item.textContent === null) {
          return -1;
        }
        return parseInt(item.textContent);
      }));

      return {espectrum, bgspectrum};
    } catch (e) {
      return {espectrum: [], bgspectrum: []};
    }
  }
}
