/*

  Serial Capability and Management

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

  TODO: Complete serial class with blackbox usability

*/

import {dataOrder} from './main.js';

export class SerialData {
  maxSize: number;
  port: SerialPort | undefined; // Get the right data type
  adcChannels: number;
  private maxHistLength: number;
  private maxLength: number;
  eolChar: string;
  orderType: dataOrder;
  private consoleMemory: number;
  private serInput: string;
  private rawData: string;
  private serData: number[];
  private baseHist: number[];

  constructor() {
    this.maxSize = 100_000; // Maximum number of pulses/events to hold in the buffer
    this.port = undefined;
    this.adcChannels = 4096; // For OSC
    this.maxLength = 20; // Maximum number of characters for a valid string/number
    this.maxHistLength = 2**16 * 2 * 10; // Maximum number of characters for a valid histogram string/number
    this.eolChar = ';'; // End of Line/Data character
    this.orderType = 'chron'; // Chronological data order

    this.consoleMemory = 100_000;
    this.rawData = ''; // Raw String Input from Serial Reading
    this.serInput = '';
    this.serData = []; // Ready to use Integer Pulse Heights, could use a setget meh
    this.baseHist = []; // Baseline histogram that will be subtracted from every other newer hist
  }

  addRaw(uintArray: Uint8Array, onlyConsole: boolean): void {
    if (this.serData.length > this.maxSize) { // Protect from overflow and crashes
      console.warn('Warning: Serial buffer is saturating!');
      return;
    }

    const string = new TextDecoder("utf-8").decode(uintArray); //String.fromCharCode(...uintArray);

    this.addRawData(string);

    if (onlyConsole) return;

    this.rawData += string;

    if (this.orderType === 'chron') { // CHRONOLOGICAL EVENTS

      let stringArr = this.rawData.split(this.eolChar); //('\r\n');
      stringArr.pop(); // Delete last entry to avoid counting unfinished transmissions
      stringArr.shift(); // Delete first entry. !FIX SERIAL COMMUNICATION ERRORS!

      if (stringArr.length <= 1) {
        if (this.rawData.length > this.maxLength) this.rawData = ''; // String too long without an EOL char, obvious error, delete.
        return;
      } else {
        for (const element of stringArr) {
          //this.rawData = this.rawData.replaceAll(element + '\r\n', '');
          this.rawData = this.rawData.replace(element + this.eolChar, '');
          const trimString = element.trim(); // Delete whitespace and line breaks

          if (!trimString.length || trimString.length >= this.maxLength) continue; // String is empty or longer than maxLength --> Invalid, disregard

          const parsedInt = parseInt(trimString);

          if (isNaN(parsedInt)) {
            continue; // Not an integer -> throw away
          } else {
            if (parsedInt < 0 || parsedInt > this.adcChannels) continue; // Fixed value range. !FIX SERIAL COMMUNICATION ERRORS!
            this.serData.push(parsedInt);
          }
        }
      }

    } else if (this.orderType === 'hist') { // HISTOGRAM DATA

      let stringArr = this.rawData.split('\r\n');

      stringArr.pop(); // Delete last entry to avoid counting unfinished transmissions
      stringArr.shift(); // Delete first entry. !FIX SERIAL COMMUNICATION ERRORS!

      if (!stringArr.length) {
        if (this.rawData.length > this.maxHistLength) this.rawData = ''; // String too long without an EOL char, obvious error, delete.
        return;
      } else {
        for (const element of stringArr) {
          this.rawData = this.rawData.replaceAll(element + '\r\n', '');
          const trimString = element.trim(); // Delete whitespace and line breaks

          if (!trimString.length || trimString.length >= this.maxHistLength) continue; // String is empty or longer than maxHistLength --> Invalid, disregard

          const stringHist = trimString.split(this.eolChar);
          stringHist.pop();

          if (stringHist.length !== this.adcChannels) continue; // Something is wrong with this histogram

          let numHist = stringHist.map(x => parseInt(x));
          numHist = numHist.map(function(item) {
            if (isNaN(item)) {
              return 0;
            } else {
              return item;
            }
          });

          if (!this.baseHist.length) {
            this.baseHist = numHist;
            return;
          }

          const diffHist = numHist.map((item, index) => item - this.baseHist[index]);
          const adcChannels = this.adcChannels;

          for (let ch = 0; ch < adcChannels; ch++) {
            const val = diffHist[ch];
            for (let num = 0; num < val; num++) {
              this.serData.push(ch);
            }
          }

          this.baseHist = numHist; // Update baseline to the current array
        }

      }
    }
  }

  private addRawData(string: string): void {
    this.serInput += string;

    if (this.serInput.length > this.consoleMemory) {
      //console.warn('Serial console log is out of memory, deleting old history...');
      this.serInput = this.serInput.slice(this.serInput.length - this.consoleMemory);
    }
  }

  getRawData(): string {
    return this.serInput;
  }

  flushRawData(): void {
    this.serInput = '';
  }

  getData(): number[] {
    const copyArr = [...this.serData];
    this.serData = [];
    return copyArr;
  }

  flushData(): void {
    this.rawData = '';
    this.serData = [];
  }

  clearBaseHist(): void {
    this.baseHist = [];
  }

  updateData(oldDataArr: number[], newDataArr: number[]): number[] {
    if(!oldDataArr.length) oldDataArr = Array(this.adcChannels).fill(0);

    for (const value of newDataArr) {
      oldDataArr[value] += 1;
    }
    return oldDataArr;
  }
}
